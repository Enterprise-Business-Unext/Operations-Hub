from typing import List, Optional
from decimal import Decimal

from app.models.user import User
from app.schemas.faculty import (
    FacultyResponse,
    FacultyUtilizationOverview,
    DomainUtilization,
)
from app.api.v1.faculty.repository_interfaces import IFacultyRepository


class FacultyService:
    def __init__(self, faculty_repo: IFacultyRepository):
        self.faculty_repo = faculty_repo

    def list(self, faculty_type: Optional[str] = None, domain: Optional[str] = None) -> List[FacultyResponse]:
        return [
            FacultyResponse(
                id=fac.id,
                full_name=fac.full_name,
                email=fac.email,
                role="Faculty",
                faculty_type=faculty_type or "Internal Full-time",
                domain=domain or "IT/ITES",
                is_active=fac.is_active,
                created_at=fac.created_at,
            )
            for fac in self.faculty_repo.list_active_faculty()
        ]

    def utilization(self) -> FacultyUtilizationOverview:
        faculty_users = self.faculty_repo.list_active_faculty()
        total_faculty = len(faculty_users)

        deployed_names = {
            name.strip().lower()
            for name in self.faculty_repo.get_distinct_deployed_faculty_names()
        }
        roster_names = {fac.full_name.strip().lower() for fac in faculty_users}
        active_deployed = len(deployed_names.intersection(roster_names))

        if total_faculty > 0:
            utilization_pct = Decimal(str(round((active_deployed / total_faculty) * 100, 1)))
        else:
            utilization_pct = Decimal("0.0")

        # Compute breakdown by domain across batches and sessions
        breakdown = []
        for domain in ("IT/ITES", "Cloud", "DS/ML", "CyberSecurity", "FullStack"):
            domain_sessions = self.faculty_repo.list_non_cancelled_deliveries_for_domain(domain)
            faculty_in_domain = {s.faculty_name.strip().lower() for s in domain_sessions if s.faculty_name}
            hours = sum((s.no_of_hours for s in domain_sessions), Decimal("0.0"))
            breakdown.append(DomainUtilization(
                domain=domain,
                faculty_count=len(faculty_in_domain),
                hours_scheduled=hours,
            ))

        return FacultyUtilizationOverview(
            total_faculty_count=total_faculty,
            active_deployed_faculty=active_deployed,
            overall_utilization_percentage=utilization_pct,
            domain_breakdown=breakdown,
        )

    def utilization_export_rows(
        self,
        faculty_type: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        user_id: Optional[str] = None,
        all: bool = False,
    ) -> List:
        """Delivery ledger rows backing the utilization CSV export."""
        return self.faculty_repo.list_utilization_for_export(
            faculty_type=faculty_type,
            start_date=start_date,
            end_date=end_date,
            user_id=user_id,
            all=all,
        )