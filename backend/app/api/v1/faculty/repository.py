from typing import List, Optional
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.user import User
from app.models.session import ACTIVE_UTILIZATION_STATUSES, FacultyUtilization
from app.models.batch import Batch, FacultyType
from app.api.v1.faculty.repository_interfaces import IFacultyRepository


class FacultyRepository(IFacultyRepository):
    def __init__(self, db: Session):
        self.db = db

    def list_active_faculty(self) -> List[User]:
        return self.db.query(User).filter(
            User.role.ilike("faculty"),
            User.is_active == True,
        ).order_by(User.full_name.asc()).all()

    def get_distinct_deployed_faculty_names(self) -> List[str]:
        rows = self.db.query(FacultyUtilization.faculty_name).filter(
            FacultyUtilization.status.in_(ACTIVE_UTILIZATION_STATUSES),
        ).distinct().all()
        return [row[0] for row in rows if row[0]]

    def list_non_cancelled_deliveries(self) -> List[FacultyUtilization]:
        return self.db.query(FacultyUtilization).filter(
            FacultyUtilization.status.in_(ACTIVE_UTILIZATION_STATUSES),
        ).all()

    def list_non_cancelled_deliveries_for_domain(self, domain: str) -> List[FacultyUtilization]:
        return self.db.query(FacultyUtilization).join(
            Batch, FacultyUtilization.batch_id == Batch.id
        ).filter(
            Batch.domain.ilike(f"%{domain}%"),
            FacultyUtilization.status.in_(ACTIVE_UTILIZATION_STATUSES),
        ).all()

    def list_utilization_for_export(
        self,
        faculty_type: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> List[FacultyUtilization]:
        # There is no `domain` column on the ledger, so a domain filter is
        # unsupported. Faculty type lives behind faculty_type_id, so comparing it
        # by name requires the join.
        query = self.db.query(FacultyUtilization)
        if faculty_type:
            query = query.join(
                FacultyType, FacultyUtilization.faculty_type_id == FacultyType.id
            ).filter(FacultyType.name == faculty_type)
        if start_date:
            query = query.filter(FacultyUtilization.date_of_training >= start_date)
        if end_date:
            query = query.filter(FacultyUtilization.date_of_training <= end_date)
        return query.order_by(FacultyUtilization.date_of_training.desc()).all()