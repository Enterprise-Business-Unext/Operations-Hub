from typing import List, Optional
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.models.batch import Batch
from app.models.session import FacultyUtilization, TrainingSession
from app.models.user import User
from app.api.v1.sessions.repository_interfaces import ISessionRepository


class SessionRepository(ISessionRepository):
    def __init__(self, db: Session):
        self.db = db

    # --- Batch context ---
    def get_batch_by_id(self, batch_id: UUID) -> Optional[Batch]:
        return self.db.query(Batch).filter(Batch.id == batch_id).first()

    def list_scoped_batch_ids(self, scope_user_ids: list[UUID], current_user_id: UUID) -> list[UUID]:
        rows = self.db.query(Batch.id).filter(or_(
            Batch.primary_manager_id == current_user_id,
            Batch.coordinator_id.in_(list(scope_user_ids)),
        )).all()
        return [row[0] for row in rows]

    def list_all_sessions_for_batch(self, batch_id: UUID) -> List[object]:
        scheduled = self.db.query(TrainingSession).filter(TrainingSession.batch_id == batch_id).all()
        actual = self.db.query(FacultyUtilization).filter(FacultyUtilization.batch_id == batch_id).all()
        return list(scheduled) + list(actual)

    # --- Timetable ---
    def list_scheduled_for_batch(self, batch_id: UUID) -> List[TrainingSession]:
        return self.db.query(TrainingSession).filter(
            TrainingSession.batch_id == batch_id
        ).order_by(TrainingSession.session_date.asc(), TrainingSession.module.asc()).all()

    def get_scheduled_by_id(self, session_id: UUID) -> Optional[TrainingSession]:
        return self.db.query(TrainingSession).filter(TrainingSession.id == session_id).first()

    def create_scheduled(self, session: TrainingSession) -> TrainingSession:
        self.db.add(session)
        self.db.commit()
        self.db.refresh(session)
        return session

    def has_utilization_for_training_session(self, session_id: UUID) -> bool:
        return self.db.query(FacultyUtilization.id).filter(
            FacultyUtilization.training_session_id == session_id
        ).first() is not None

    def delete_scheduled(self, session: TrainingSession) -> None:
        self.db.delete(session)
        self.db.commit()

    # --- Delivery ledger ---
    def list_utilizations(
        self,
        batch_id: Optional[UUID] = None,
        batch_ids: Optional[list[UUID]] = None,
        faculty_name: Optional[str] = None,
        status_filter: Optional[str] = None,
    ) -> List[FacultyUtilization]:
        query = self.db.query(FacultyUtilization).options(
            joinedload(FacultyUtilization.batch).joinedload(Batch.entity),
            joinedload(FacultyUtilization.batch).joinedload(Batch.coordinator),
            joinedload(FacultyUtilization.faculty_type),
            joinedload(FacultyUtilization.program_type),
        ).join(Batch, FacultyUtilization.batch_id == Batch.id)
        if batch_ids is not None:
            query = query.filter(FacultyUtilization.batch_id.in_(list(batch_ids)))
        elif batch_id:
            query = query.filter(FacultyUtilization.batch_id == batch_id)
        if faculty_name:
            query = query.filter(FacultyUtilization.faculty_name.ilike(f"%{faculty_name}%"))
        if status_filter:
            query = query.filter(FacultyUtilization.status == status_filter)
        return query.order_by(FacultyUtilization.date_of_training.asc()).all()

    def list_utilizations_for_batch(self, batch_id: UUID) -> List[FacultyUtilization]:
        return self.db.query(FacultyUtilization).filter(
            FacultyUtilization.batch_id == batch_id
        ).all()

    def get_utilization_by_id(self, session_id: UUID) -> Optional[FacultyUtilization]:
        return self.db.query(FacultyUtilization).filter(FacultyUtilization.id == session_id).first()

    def create_utilization(self, session: FacultyUtilization) -> FacultyUtilization:
        self.db.add(session)
        self.db.commit()
        self.db.refresh(session)
        return session

    def get_training_session_by_id(self, session_id: UUID) -> Optional[TrainingSession]:
        return self.db.query(TrainingSession).filter(TrainingSession.id == session_id).first()

    # --- Faculty resolution ---
    def get_active_user(self, user_id: UUID) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()

    def find_active_faculty_by_name(self, name: str, faculty_role_only: bool = False) -> Optional[User]:
        query = self.db.query(User).filter(
            User.full_name.ilike(name),
            User.is_active.is_(True),
        )
        if faculty_role_only:
            query = query.filter(User.role.ilike("faculty"))
        return query.first()

    # --- Mutations ---
    def commit(self) -> None:
        self.db.commit()

    def refresh(self, instance) -> None:
        self.db.refresh(instance)