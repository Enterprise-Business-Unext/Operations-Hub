import logging
from typing import List, Optional, Any
from uuid import UUID
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status, Response
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models.batch import Batch
from app.models.user import User
from app.models.session import TrainingSession, FacultyUtilization

logger = logging.getLogger(__name__)
from app.schemas.batch import (
    ApprovalConfigurationBase,
    ApprovalConfigurationResponse,
    ApprovalDecision,
    BatchCreateRequest,
    BatchUpdateRequest,
    BatchApprove,
    BatchResponse,
    BatchDetailResponse,
    BatchEditHistoryResponse,
    BatchLifecycleStatusUpdate,
    ActiveBatchesResponse,
)
from app.schemas.feedback import BatchNpsClosureCreate
from app.api.deps import (
    get_current_user, require_admin, require_manager_or_admin, require_coordinator_or_above
)
from app.api.deps_services import get_batch_service, get_batch_lifecycle_service, get_cache
from app.api.v1.batches.lifecycle_service import BatchLifecycleService
from app.api.v1.batches.service import BatchService
from app.api.v1.notifications.service import NotificationService
from app.core.cache import RedisCacheService
from app.core.database import get_db

router = APIRouter()

# File upload limits
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_FEEDBACK_EXTENSIONS = {".xlsx", ".xls", ".csv"}

# Pagination limits
MAX_PAGE_LIMIT = 100
DEFAULT_PAGE_LIMIT = 50

def validate_upload_file(file: UploadFile, max_size: int = MAX_UPLOAD_SIZE, allowed_extensions: set | None = None) -> None:
    """Validate uploaded file size and extension."""
    if allowed_extensions:
        filename = file.filename or ""
        if not any(filename.lower().endswith(ext) for ext in allowed_extensions):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File must be one of: {', '.join(sorted(allowed_extensions))}"
            )
    # Check file size by reading content
    content = file.file.read()
    if len(content) > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File size exceeds maximum allowed size of {max_size // (1024*1024)} MB"
        )
    # Reset file pointer for subsequent reads
    file.file.seek(0)

def validate_pagination(skip: int = 0, limit: int = DEFAULT_PAGE_LIMIT) -> tuple[int, int]:
    """Validate and normalize pagination parameters."""
    if skip < 0:
        skip = 0
    if limit < 1:
        limit = DEFAULT_PAGE_LIMIT
    if limit > MAX_PAGE_LIMIT:
        limit = MAX_PAGE_LIMIT
    return skip, limit


@router.get("/approval-config", response_model=ApprovalConfigurationResponse)
def get_approval_config(
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(require_admin),
) -> Any:
    return service.get_approval_config()


@router.put("/approval-config", response_model=ApprovalConfigurationResponse)
def update_approval_config(
    config_in: ApprovalConfigurationBase,
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(require_admin),
) -> Any:
    return service.update_approval_config(config_in)


@router.post("", response_model=BatchResponse, status_code=status.HTTP_201_CREATED)
async def create_batch(
    batch_in: BatchCreateRequest,
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(require_coordinator_or_above)
) -> Any:
    """Workflow 1: Create a new batch in 'Requested' status. Administrators act strictly in managerial/governance capacity."""
    team_name = current_user.team_detail.name if current_user.team_detail else ""
    if (current_user.role or "").lower() == "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrators cannot create batches. Admin acts strictly in a managerial and governance capacity."
        )
    if team_name.strip().lower() != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Delivery team members can create batches."
        )
    batch = service.create(batch_in, current_user)
    await NotificationService.notify_approval_requested(batch)
    return batch


@router.post("/{id}/submit", response_model=BatchResponse)
async def submit_batch(
    id: UUID,
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(require_coordinator_or_above),
) -> Any:
    batch = service.submit_for_approval(id, current_user)
    await NotificationService.notify_approval_requested(batch)
    return batch


@router.post("/{id}/approve-level-1", response_model=BatchResponse)
async def approve_level_1(
    id: UUID,
    decision: ApprovalDecision,
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(get_current_user),
) -> Any:
    batch = service.decide(id, 1, decision, current_user)
    await NotificationService.notify_approval_decision(batch, 1, decision.decision)
    return batch


@router.post("/{id}/approve-level-2", response_model=BatchResponse)
async def approve_level_2(
    id: UUID,
    decision: ApprovalDecision,
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(get_current_user),
) -> Any:
    batch = service.decide(id, 2, decision, current_user)
    await NotificationService.notify_approval_decision(batch, 2, decision.decision)
    return batch


@router.post("/{id}/approve", response_model=BatchResponse)
async def approve_batch(
    id: UUID,
    approve_in: BatchApprove,
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(require_manager_or_admin)
) -> Any:
    """Manager Approval: Locks schema, assigns financial SOW Approval ID, transitions status to Upcoming/Ongoing."""
    batch = service.approve(id, approve_in, current_user)

    # Trigger Async Notification
    try:
        await NotificationService.notify_batch_approved(
            batch_id=batch.batch_id,
            approval_id=batch.approval_id,
            manager_email=batch.primary_manager.email if batch.primary_manager else None,
            sales_email=batch.sales_spoc.email if batch.sales_spoc else None
        )
    except Exception as exc:
        logger.warning("Notification failed for batch %s: %s", batch.batch_id, str(exc))

    return batch


@router.get("", response_model=List[BatchResponse])
def list_batches(
    status_filter: Optional[str] = Query(None, alias="status"),
    domain: Optional[str] = None,
    category: Optional[str] = None,
    client_name: Optional[str] = None,
    search: Optional[str] = None,
    mine: bool = Query(False, description="Restrict to batches owned by the caller"),
    skip: int = 0,
    limit: int = DEFAULT_PAGE_LIMIT,
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(get_current_user)
) -> Any:
    """List batches with RBAC scoping and multi-attribute filters.

    `mine=true` narrows the result to batches the caller owns. Ownership is
    always resolved from the authenticated user, never from a client-supplied
    id, so no caller can enumerate another user's batches.
    """
    skip, limit = validate_pagination(skip, limit)
    return service.list(
        current_user,
        status_filter,
        domain,
        category,
        client_name,
        search,
        skip,
        limit,
        ownership_filter=current_user.id if mine else None,
    )


@router.get("/active", response_model=ActiveBatchesResponse)
def get_active_batches(
    filter_date: Optional[str] = Query(None, description="Date in YYYY-MM-DD format, defaults to today"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    session_skip: int = Query(0, ge=0, alias="sessionSkip"),
    session_limit: int = Query(50, ge=1, le=100, alias="sessionLimit"),
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(get_current_user)
) -> Any:
    """Get ongoing batches and sessions for a specific date with pagination."""
    return service.get_active_batches(filter_date, current_user, skip, limit, session_skip, session_limit)


@router.get("/{id}", response_model=BatchDetailResponse)
def get_batch_detail(
    id: UUID,
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(get_current_user)
) -> Any:
    """Fetch complete batch details."""
    return service.get(id, current_user)


@router.get("/{id}/edit-history", response_model=List[BatchEditHistoryResponse])
def get_batch_edit_history(
    id: UUID,
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(get_current_user),
) -> Any:
    return service.get_edit_history(id, current_user)


@router.patch("/{id}", response_model=BatchResponse)
async def update_batch(
    id: UUID,
    batch_in: BatchUpdateRequest,
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(require_coordinator_or_above)
) -> Any:
    """Updates batch fields. Schema locked batches restrict modification to non-governed fields."""
    batch = service.update(id, batch_in, current_user)

    if getattr(batch, "_reapproval_triggered", False):
        changed_fields = getattr(batch, "_changed_fields_for_reapproval", None)
        reapproval_count = batch.reapproval_count
        await NotificationService.notify_approval_requested(batch, changed_fields, reapproval_count)

    return batch


@router.post("/{id}/lifecycle-status", response_model=BatchResponse)
def update_batch_lifecycle_status(
    id: UUID,
    payload: BatchLifecycleStatusUpdate,
    service: BatchService = Depends(get_batch_service),
    cache: RedisCacheService = Depends(get_cache),
    current_user: User = Depends(require_coordinator_or_above),
) -> Any:
    """Transition batch lifecycle status (e.g. OnHold, Cancelled, Upcoming, Ongoing) with mandatory reason."""
    result = service.update_lifecycle_status(id, payload.status, payload.reason, current_user)
    cache.delete("v1", f"analytics:dashboard:{current_user.id}")
    return result


@router.post("/{id}/close", response_model=BatchResponse)
async def close_batch_gate2(
    id: UUID,
    closure_in: BatchNpsClosureCreate,
    service: BatchService = Depends(get_batch_service),
    cache: RedisCacheService = Depends(get_cache),
    current_user: User = Depends(require_coordinator_or_above)
) -> Any:
    """
    Quality Gate 2 Checkpoint:
    Closes the batch once Quality Checkpoint 1 has written the batch average
    feedback. The NPS index is computed from the supplied promoter/passive/
    detractor counts. When NPS is not available, a reason must be provided.
    """
    closed_batch = service.close_gate2(id, closure_in, current_user.id, current_user)
    cache.delete("v1", f"analytics:dashboard:{current_user.id}")

    try:
        if closed_batch.batch_nps is None:
            await NotificationService.notify_gate_completion(
                batch_id=closed_batch.batch_id,
                gate_name="Gate 2 (Batch NPS Closure)",
                score="NPS: Not Available"
            )
        else:
            await NotificationService.notify_gate_completion(
                batch_id=closed_batch.batch_id,
                gate_name="Gate 2 (Batch NPS Closure)",
                score=f"NPS: {closed_batch.batch_nps:+.0f}"
            )
    except Exception as exc:
        logger.warning("Notification failed for batch %s: %s", closed_batch.batch_id, str(exc))

    return closed_batch


@router.get("/finance/export")
def export_finance_csv(
    status_filter: Optional[str] = Query(None),
    finance_status: Optional[str] = Query(None),
    domain: Optional[str] = Query(None),
    delivery_mode: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(require_coordinator_or_above),
) -> Response:
    """Export finance review data as CSV."""
    import csv
    from io import StringIO
    from fastapi.responses import StreamingResponse

    batches = service.export_finance_batches(
        current_user=current_user,
        status_filter=status_filter,
        finance_status=finance_status,
        domain=domain,
        delivery_mode=delivery_mode,
        start_date=start_date,
        end_date=end_date,
    )
    
    # Generate CSV
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Batch ID", "SOW Number", "Approval ID", "Client", "Program", "Category",
        "Technology", "Domain", "Delivery Mode", "Location", "Start Date", "End Date",
        "Total Enrollments", "Training Days", "Total Hours", "Finance Status",
        "Finance Check Date", "Batch Avg Feedback", "Batch NPS", "Status"
    ])
    
    for b in batches:
        writer.writerow([
            b.batch_id,
            b.sow_number or "",
            b.approval_id or "",
            b.client_name or "",
            b.program_name,
            b.category or "",
            b.technology or "",
            b.domain or "",
            b.delivery_mode or "",
            b.location_city or "",
            b.start_date.isoformat() if b.start_date else "",
            b.end_date.isoformat() if b.end_date else "",
            b.total_enrollments,
            b.training_days or 0,
            b.total_hours or 0,
            b.finance_status or "Pending",
            b.finance_status_check_date.isoformat() if b.finance_status_check_date else "",
            float(b.batch_avg_feedback) if b.batch_avg_feedback else "",
            b.batch_nps or "",
            b.status
        ])
    
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=finance-review-{datetime.now().strftime('%Y%m%d')}.csv"}
    )


@router.post("/{id}/sync-status", response_model=BatchResponse)
def sync_batch_status(
    id: UUID,
    service: BatchService = Depends(get_batch_service),
    lifecycle_service: BatchLifecycleService = Depends(get_batch_lifecycle_service),
    current_user: User = Depends(require_admin),
) -> Any:
    """Manually trigger batch lifecycle status synchronization (admin only)."""
    lifecycle_service.sync_all()

    # Return the batch after sync
    batch = service.get(id, current_user)
    return batch


@router.get("/{id}/lifecycle-history")
def get_batch_lifecycle_history(
    id: UUID,
    service: BatchService = Depends(get_batch_service),
    current_user: User = Depends(get_current_user)
) -> Any:
    """Get audit trail of status changes for a batch."""
    batch = service.get(id, current_user)
    
    # Parse remarks for lifecycle history
    history = []
    if batch.remarks:
        lines = batch.remarks.split('\n')
        for line in lines:
            if line.strip() and 'Status changed' in line:
                history.append(line.strip())
    
    return {
        "batch_id": batch.batch_id,
        "current_status": batch.status,
        "history": history,
        "approval_history": {
            "level_1": {
                "status": batch.approver_1_status,
                "approved_at": batch.approver_1_approved_at,
            },
            "level_2": {
                "status": batch.approver_2_status,
                "approved_at": batch.approver_2_approved_at,
            }
        }
    }
