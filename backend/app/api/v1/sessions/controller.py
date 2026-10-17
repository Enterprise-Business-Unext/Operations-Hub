from typing import List, Optional, Any
from uuid import UUID
from datetime import datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, Query, Response, status

from app.models.user import User
from app.schemas.feedback import SessionFeedbackCreate
from app.schemas.session import (
    SessionCreate, SessionUpdate, SessionDetailResponse,
    TrainingSessionResponse,
    TrainingSessionUpdate, TrainingSessionCreate,
    SessionCancelRequest, SessionRescheduleRequest,
)
from app.api.deps import get_current_user, require_coordinator_or_above, require_manager_or_admin
from app.api.deps_services import get_cache, get_session_service
from app.api.v1.sessions.service import SessionService
from app.api.v1.notifications.service import NotificationService
from app.core.cache import RedisCacheService

router = APIRouter()


@router.get("/scheduled", response_model=List[TrainingSessionResponse])
def list_scheduled_sessions(
    batch_id: UUID,
    service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user)
) -> Any:
    """Lists the ingested curriculum training schedule days for a batch."""
    return service.list_scheduled(batch_id, current_user.id)


@router.patch("/scheduled/{id}", response_model=TrainingSessionResponse)
def update_scheduled_session(
    id: UUID,
    session_in: TrainingSessionUpdate,
    service: SessionService = Depends(get_session_service),
    current_user: User = Depends(require_coordinator_or_above),
) -> Any:
    """Correct a parsed curriculum row after it has been saved."""
    return service.update_scheduled(id, session_in, current_user.id)


@router.delete("/scheduled/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scheduled_session(
    id: UUID,
    service: SessionService = Depends(get_session_service),
    current_user: User = Depends(require_coordinator_or_above),
) -> Response:
    """Delete an undelivered curriculum timetable entry."""
    service.delete_scheduled(id, current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/scheduled", response_model=TrainingSessionResponse, status_code=status.HTTP_201_CREATED)
def create_scheduled_session(
    session_in: TrainingSessionCreate,
    service: SessionService = Depends(get_session_service),
    current_user: User = Depends(require_coordinator_or_above),
) -> Any:
    return service.create_scheduled(session_in, current_user.id)


@router.get("", response_model=List[SessionDetailResponse])
def list_sessions(
    batch_id: Optional[UUID] = None,
    faculty_name: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    all: bool = Query(False, description="Bypass RBAC scoping to view all utilization records (requires Manager or Admin)"),
    service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user)
) -> Any:
    """Master session endpoint (Placeholder active for schema expansion)."""
    if all:
        # Only allow Manager or Admin to view all records
        require_manager_or_admin(current_user)
    return service.list(batch_id, faculty_name, status_filter, current_user.id, all)


@router.post("", response_model=SessionDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    session_in: SessionCreate,
    service: SessionService = Depends(get_session_service),
    cache: RedisCacheService = Depends(get_cache),
    current_user: User = Depends(require_coordinator_or_above)
) -> Any:
    """Schedule single session endpoint."""
    result = service.create(session_in, current_user.id)
    cache.delete("v1", f"analytics:dashboard:{current_user.id}")
    await NotificationService.notify_session_scheduled(
        faculty_name=result.faculty_name,
        faculty_email=None,
        date_str=result.date_of_training.isoformat(),
        topic=result.topic,
    )
    return result


@router.patch("/{id}", response_model=SessionDetailResponse)
def update_session(
    id: UUID,
    session_in: SessionUpdate,
    service: SessionService = Depends(get_session_service),
    cache: RedisCacheService = Depends(get_cache),
    current_user: User = Depends(require_coordinator_or_above),
) -> Any:
    result = service.update(id, session_in, current_user.id)
    cache.delete("v1", f"analytics:dashboard:{current_user.id}")
    return result


@router.post("/{id}/cancel", response_model=SessionDetailResponse)
def cancel_session(
    id: UUID,
    payload: SessionCancelRequest,
    service: SessionService = Depends(get_session_service),
    cache: RedisCacheService = Depends(get_cache),
    current_user: User = Depends(require_coordinator_or_above),
) -> Any:
    result = service.cancel(id, payload.reason, current_user.id)
    cache.delete("v1", f"analytics:dashboard:{current_user.id}")
    return result


@router.post("/{id}/not-conducted", response_model=SessionDetailResponse)
def mark_session_not_conducted(
    id: UUID,
    payload: SessionCancelRequest,
    service: SessionService = Depends(get_session_service),
    cache: RedisCacheService = Depends(get_cache),
    current_user: User = Depends(require_coordinator_or_above),
) -> Any:
    result = service.mark_not_conducted(id, payload.reason, current_user.id)
    cache.delete("v1", f"analytics:dashboard:{current_user.id}")
    return result


@router.post("/{id}/reschedule", response_model=SessionDetailResponse)
def reschedule_session(
    id: UUID,
    payload: SessionRescheduleRequest,
    service: SessionService = Depends(get_session_service),
    cache: RedisCacheService = Depends(get_cache),
    current_user: User = Depends(require_coordinator_or_above),
) -> Any:
    result = service.reschedule(
        id,
        payload.date_of_training,
        payload.start_time,
        payload.end_time,
        payload.reason,
        current_user.id,
    )
    cache.delete("v1", f"analytics:dashboard:{current_user.id}")
    return result


@router.patch("/{id}/complete")
async def complete_session_gate1(
    id: str,
    feedback_in: SessionFeedbackCreate,
    service: SessionService = Depends(get_session_service),
    cache: RedisCacheService = Depends(get_cache),
    current_user: User = Depends(require_coordinator_or_above)
) -> Any:
    """Quality Checkpoint 1 Gate."""
    result = service.complete_gate1(id, feedback_in, current_user.id)
    cache.delete("v1", f"analytics:dashboard:{current_user.id}")

    await NotificationService.notify_gate_completion(
        batch_id=str(result.get("batch_id") or id),
        gate_name="Gate 1 (Session Feedback)",
        score=f"{feedback_in.rating}/5.0"
    )

    return result
