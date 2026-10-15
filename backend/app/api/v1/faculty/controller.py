from typing import List, Optional, Any
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
import csv
from io import StringIO
from datetime import datetime

from app.models.user import User
from app.schemas.faculty import FacultyResponse, FacultyUtilizationOverview
from app.api.deps import get_current_user, require_manager_or_admin, require_coordinator_or_above
from app.api.deps_services import get_faculty_service
from app.api.v1.faculty.service import FacultyService

router = APIRouter()


@router.get("", response_model=List[FacultyResponse])
def list_faculty(
    faculty_type: Optional[str] = None,
    domain: Optional[str] = None,
    service: FacultyService = Depends(get_faculty_service),
    current_user: User = Depends(get_current_user)
) -> Any:
    """Faculty directory endpoint."""
    return service.list(faculty_type, domain)


@router.get("/utilization", response_model=FacultyUtilizationOverview, dependencies=[Depends(require_coordinator_or_above)])
def get_faculty_utilization(
    service: FacultyService = Depends(get_faculty_service),
    current_user: User = Depends(get_current_user)
) -> Any:
    """Real-time utilization calculation endpoint."""
    return service.utilization()


@router.get("/utilization/export")
def export_faculty_utilization_csv(
    faculty_type: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    all: bool = Query(False, description="Bypass RBAC scoping to view all utilization records (requires Manager or Admin)"),
    service: FacultyService = Depends(get_faculty_service),
    current_user: User = Depends(get_current_user)
) -> StreamingResponse:
    """Export faculty utilization ledger as CSV."""
    if all:
        # Only allow Manager or Admin to view all records
        require_manager_or_admin(current_user)
    records = service.utilization_export_rows(
        faculty_type=faculty_type,
        start_date=start_date,
        end_date=end_date,
        user_id=str(current_user.id),
        all=all,
    )
    
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Date", "Faculty Name", "Faculty Type", "Topic", "Hours", "City", "Venue", "Mode",
        "Status", "Feedback Rating", "Module Feedback"
    ])
    
    for r in records:
        writer.writerow([
            r.date_of_training.isoformat() if r.date_of_training else "",
            r.faculty_name,
            r.faculty_type_name or "",
            r.topic or "",
            float(r.no_of_hours) if r.no_of_hours else "",
            r.location_city or "",
            r.venue or "",
            r.mode_of_delivery or "",
            r.status,
            float(r.feedback_rating) if r.feedback_rating else "",
            r.feedback_notes or "",
        ])
    
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=faculty-utilization-{datetime.now().strftime('%Y%m%d')}.csv"}
    )
