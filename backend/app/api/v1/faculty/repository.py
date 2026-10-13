from typing import List, Optional
from decimal import Decimal
from uuid import UUID

from sqlalchemy import or_
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

    def _get_manager_scope_user_ids(self, user: User) -> List[UUID]:
        """Get user IDs in the manager scope for a coordinator."""
        role = (user.role or "").lower()

        if role == "manager":
            scope_ids: set[UUID] = {user.id}
            # Add managed coordinators
            managed = self.db.query(User.id).filter(User.manager_id == user.id).all()
            scope_ids.update(row[0] for row in managed)
            return list(scope_ids)

        if role != "coordinator":
            return [user.id]

        manager_ids: set[UUID] = set()
        if user.manager_id:
            manager_ids.add(user.manager_id)
        # Get managers via UserManagerMapping
        from app.models.user import UserManagerMapping
        mapped = self.db.query(UserManagerMapping.manager_id).filter(
            UserManagerMapping.coordinator_id == user.id,
        ).all()
        manager_ids.update(manager_id for manager_id, in mapped)
        if not manager_ids:
            return [user.id]

        # Coordinators under the same manager share operational batch visibility.
        scope_ids = {user.id}
        for manager_id in manager_ids:
            scope_ids.add(manager_id)
            managed = self.db.query(User.id).filter(User.manager_id == manager_id).all()
            scope_ids.update(row[0] for row in managed)
        return list(scope_ids)

    def _list_scoped_batch_ids(self, scope_user_ids: List[UUID], current_user_id: UUID) -> List[UUID]:
        rows = self.db.query(Batch.id).filter(or_(
            Batch.primary_manager_id == current_user_id,
            Batch.coordinator_id.in_(list(scope_user_ids)),
        )).all()
        return [row[0] for row in rows]

    def list_utilization_for_export(
        self,
        faculty_type: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        user_id: Optional[str] = None,
        all: bool = False,
    ) -> List[FacultyUtilization]:
        # There is no `domain` column on the ledger, so a domain filter is
        # unsupported. Faculty type lives behind faculty_type_id, so comparing it
        # by name requires the join.
        query = self.db.query(FacultyUtilization).join(Batch, FacultyUtilization.batch_id == Batch.id)

        if user_id and not all:
            user = self.db.query(User).filter(User.id == UUID(user_id), User.is_active == True).first()
            if user and (user.role or "").lower() != "admin":
                scope_ids = self._get_manager_scope_user_ids(user)
                if not scope_ids:
                    return []
                scoped_batch_ids = self._list_scoped_batch_ids(scope_ids, UUID(user_id))
                if not scoped_batch_ids:
                    return []
                query = query.filter(FacultyUtilization.batch_id.in_(scoped_batch_ids))

        if faculty_type:
            query = query.join(
                FacultyType, FacultyUtilization.faculty_type_id == FacultyType.id
            ).filter(FacultyType.name == faculty_type)
        if start_date:
            query = query.filter(FacultyUtilization.date_of_training >= start_date)
        if end_date:
            query = query.filter(FacultyUtilization.date_of_training <= end_date)
        return query.order_by(FacultyUtilization.date_of_training.desc()).all()