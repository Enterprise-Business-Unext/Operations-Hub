from typing import Optional, Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status

from app.models.user import User
from app.schemas.schedule import (
    ScheduleIngestResponse, ScheduleApplyRequest, ScheduleApplyResponse
)
from app.api.deps import get_current_user, require_coordinator_or_above
from app.api.deps_services import (
    get_excel_ingestion_service,
    get_schedule_repository,
    get_user_repository,
)
from app.api.v1.auth.repository_interfaces import IUserRepository
from app.api.v1.schedules.repository_interfaces import IScheduleRepository
from app.api.v1.schedules.service import ExcelIngestionService

router = APIRouter()

# File upload limits
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_SCHEDULE_EXTENSIONS = {".xlsx", ".xls", ".csv"}

async def validate_upload_file(file: UploadFile, max_size: int = MAX_UPLOAD_SIZE, allowed_extensions: set | None = None) -> bytes:
    """Validate uploaded file size and extension, return file contents.

    Size is enforced via the file's underlying stream before reading content
    into memory, so oversized uploads are rejected early.
    """
    if allowed_extensions:
        filename = file.filename or ""
        if not any(filename.lower().endswith(ext) for ext in allowed_extensions):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File must be one of: {', '.join(sorted(allowed_extensions))}"
            )
    # Enforce content type alongside extension
    if allowed_extensions and file.content_type:
        ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
        expected_types = {
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".xls": "application/vnd.ms-excel",
            ".csv": "text/csv",
        }
        expected = expected_types.get(f".{ext}")
        if expected and file.content_type not in (expected, "application/octet-stream"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Content type {file.content_type} does not match file extension .{ext}"
            )
    # Check size via stream before reading into memory
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)
    if file_size > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File size exceeds maximum allowed size of {max_size // (1024*1024)} MB"
        )
    content = await file.read()
    return content


@router.post("/ingest", response_model=ScheduleIngestResponse)
async def ingest_timetable_file(
    file: UploadFile = File(...),
    target_batch_id: Optional[str] = Form(None),
    current_user: User = Depends(require_coordinator_or_above),
    service: ExcelIngestionService = Depends(get_excel_ingestion_service)
) -> Any:
    """Workflow 2: Extract timetable rows from Excel or CSV without persistence."""
    file_bytes = await validate_upload_file(file, allowed_extensions=ALLOWED_SCHEDULE_EXTENSIONS)
    filename = file.filename or "uploaded_schedule"
    result = service.ingest_schedule_file(
        file_contents=file_bytes,
        filename=filename,
        target_batch_id=target_batch_id
    )

    return result


@router.post("/apply", response_model=ScheduleApplyResponse)
def apply_schedule(
    payload: ScheduleApplyRequest,
    schedule_repo: IScheduleRepository = Depends(get_schedule_repository),
    user_repo: IUserRepository = Depends(get_user_repository),
    current_user: User = Depends(require_coordinator_or_above),
) -> ScheduleApplyResponse:
    """Validate and persist the complete extracted schedule atomically."""
    return ExcelIngestionService.apply_schedule_items(
        schedule_repo=schedule_repo,
        user_repo=user_repo,
        target_batch_id=payload.target_batch_id,
        items=payload.items,
        source_filename=payload.source_filename,
        user_id=current_user.id,
    )