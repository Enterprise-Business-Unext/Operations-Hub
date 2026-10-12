from datetime import date, datetime, timezone
from typing import Dict, List, Optional, Sequence
from uuid import UUID

from sqlalchemy import Date, func, or_
from sqlalchemy.orm import InstrumentedAttribute, Session, joinedload

from app.models.batch import (
    Accommodation,
    ApprovalConfiguration,
    Batch,
    BatchCategory,
    DeliveryMode,
    Entity,
)
from app.models.batch_edit import BatchEditHistory
from app.models.session import (
    FacultyUtilization,
    TERMINAL_UTILIZATION_STATUSES,
    TrainingSession,
    SessionStatus,
)
from app.api.v1.batches.repository_interfaces import BatchScope, IBatchRepository


# Ownership is recorded in a different column per role, so the column is chosen
# from the caller's role rather than hardcoded. Getting this wrong returns zero
# rows for one of the two roles instead of an obvious error.
_OWNERSHIP_COLUMNS: Dict[str, InstrumentedAttribute] = {
    "coordinator": Batch.coordinator_id,
    "manager": Batch.primary_manager_id,
}

_CONDUCTED_STATUSES = [SessionStatus.Completed]


class BatchRepository(IBatchRepository):
    def __init__(self, db: Session):
        self.db = db

    # --- Batch reads ---
    def get_by_id(self, batch_id: UUID) -> Optional[Batch]:
        return self.db.query(Batch).options(
            joinedload(Batch.coordinator),
            joinedload(Batch.sales_spoc)
        ).filter(Batch.id == batch_id).first()

    def get_by_batch_id(self, batch_id: str) -> Optional[Batch]:
        return self.db.query(Batch).filter(Batch.batch_id == batch_id).first()

    def exists_by_batch_id(self, batch_id: str) -> bool:
        return self.db.query(Batch.id).filter(Batch.batch_id == batch_id).first() is not None

    def _apply_scope(self, query, scope: BatchScope):
        if not scope.is_unrestricted:
            query = query.filter(or_(
                Batch.primary_manager_id == scope.user_id,
                Batch.coordinator_id.in_(list(scope.scope_user_ids)),
                ((Batch.status == "Approval 1 Pending") & (Batch.approver_1_id == scope.user_id)),
                ((Batch.status == "Approval 2 Pending") & (Batch.approver_2_id == scope.user_id)),
            ))

        # Ownership narrows the RBAC scope above; it never replaces or widens it.
        if scope.has_ownership_filter:
            column = _OWNERSHIP_COLUMNS.get(scope.ownership_role)
            if column is not None:
                query = query.filter(column == scope.ownership_user_id)
        return query

    def list_scoped(
        self,
        scope: BatchScope,
        status_filter: Optional[str] = None,
        domain: Optional[str] = None,
        category: Optional[str] = None,
        client_name: Optional[str] = None,
        search: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Batch]:
        query = self._apply_scope(
            self.db.query(Batch).options(
                joinedload(Batch.coordinator),
                joinedload(Batch.sales_spoc)
            ),
            scope
        )

        if status_filter:
            query = query.filter(Batch.status == status_filter)
        if domain:
            query = query.filter(Batch.domain == domain)
        if category:
            query = query.filter(Batch.category == category)
        if client_name:
            query = query.filter(Batch.client_name.ilike(f"%{client_name}%"))
        if search:
            term = f"%{search.strip()}%"
            query = query.filter(or_(
                Batch.batch_id.ilike(term),
                Batch.program_name.ilike(term),
                Batch.client_name.ilike(term),
                Batch.technology.ilike(term),
                Batch.location_city.ilike(term),
            ))

        return query.order_by(Batch.created_at.desc()).offset(skip).limit(limit).all()

    def _on_date_query(self, scope: BatchScope, target_date: date):
        query = self._apply_scope(self.db.query(Batch), scope)
        return query.filter(
            Batch.start_date.isnot(None),
            Batch.end_date.isnot(None),
            Batch.start_date.cast(Date) <= target_date,
            Batch.end_date.cast(Date) >= target_date,
        )

    def count_scoped_on_date(self, scope: BatchScope, target_date: date) -> int:
        return self._on_date_query(scope, target_date).count()

    def list_scoped_on_date(self, scope: BatchScope, target_date: date, skip: int = 0, limit: int = 100) -> List[Batch]:
        return (
            self._on_date_query(scope, target_date)
            .order_by(Batch.start_date.asc().nullslast())
            .offset(skip)
            .limit(limit)
            .all()
        )

    def get_conducted_session_counts(self, batch_ids: Sequence[UUID]) -> Dict[UUID, int]:
        if not batch_ids:
            return {}
        rows = (
            self.db.query(FacultyUtilization.batch_id, func.count(FacultyUtilization.id))
            .filter(
                FacultyUtilization.batch_id.in_(list(batch_ids)),
                FacultyUtilization.status.in_(_CONDUCTED_STATUSES),
            )
            .group_by(FacultyUtilization.batch_id)
            .all()
        )
        return {batch_id: count for batch_id, count in rows}

    def get_scheduled_session_counts(self, batch_ids: Sequence[UUID]) -> Dict[UUID, int]:
        if not batch_ids:
            return {}
        rows = (
            self.db.query(
                TrainingSession.batch_id,
                func.count(TrainingSession.id),
            )
            .filter(TrainingSession.batch_id.in_(list(batch_ids)))
            .group_by(TrainingSession.batch_id)
            .all()
        )
        return {batch_id: count for batch_id, count in rows}

    def list_scheduled_sessions_on_date(self, batch_ids: Sequence[UUID], target_date: date) -> List[TrainingSession]:
        if not batch_ids:
            return []
        return self.db.query(TrainingSession).filter(
            TrainingSession.batch_id.in_(list(batch_ids)),
            TrainingSession.session_date == target_date,
        ).order_by(TrainingSession.start_time.asc().nullslast()).all()

    def list_scheduled_sessions_after(self, batch_id: UUID, after_date: date) -> List[TrainingSession]:
        return (
            self.db.query(TrainingSession)
            .filter(
                TrainingSession.batch_id == batch_id,
                TrainingSession.session_date > after_date,
            )
            .order_by(TrainingSession.session_date.asc(), TrainingSession.start_time.asc().nullslast())
            .all()
        )

    def list_actual_sessions_on_date(self, batch_ids: Sequence[UUID], target_date: date) -> List[FacultyUtilization]:
        if not batch_ids:
            return []
        return self.db.query(FacultyUtilization).filter(
            FacultyUtilization.batch_id.in_(list(batch_ids)),
            FacultyUtilization.date_of_training.cast(Date) == target_date,
        ).order_by(FacultyUtilization.start_time.asc().nullslast()).all()

    def export_finance_rows(
        self,
        scope: BatchScope,
        finance_status: Optional[str] = None,
        domain: Optional[str] = None,
        delivery_mode_name: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[Batch]:
        query = self._apply_scope(self.db.query(Batch), scope)

        if finance_status:
            query = query.filter(Batch.finance_status == finance_status)
        if domain:
            query = query.filter(Batch.domain == domain)
        if delivery_mode_name:
            # `Batch.delivery_mode` is a Python property over the related row, so it
            # cannot be filtered in SQL; match the DeliveryMode name instead.
            query = query.join(DeliveryMode, Batch.delivery_mode_id == DeliveryMode.id).filter(
                DeliveryMode.name == delivery_mode_name
            )
        if start_date:
            query = query.filter(Batch.start_date >= start_date)
        if end_date:
            query = query.filter(Batch.start_date <= end_date)

        return query.order_by(Batch.created_at.desc()).all()

    # --- Session cascades owned by the batch lifecycle ---
    def list_non_terminal_faculty_sessions(self, batch_id: UUID) -> List[FacultyUtilization]:
        return self.db.query(FacultyUtilization).filter(
            FacultyUtilization.batch_id == batch_id,
            FacultyUtilization.status.notin_(TERMINAL_UTILIZATION_STATUSES),
        ).all()

    def list_non_terminal_training_sessions(self, batch_id: UUID) -> List[TrainingSession]:
        return self.db.query(TrainingSession).filter(
            TrainingSession.batch_id == batch_id,
            TrainingSession.status.notin_(TERMINAL_UTILIZATION_STATUSES),
        ).all()

    # --- Approval configuration ---
    def get_approval_config(self) -> Optional[ApprovalConfiguration]:
        return self.db.query(ApprovalConfiguration).first()

    def create_approval_config(self) -> ApprovalConfiguration:
        config = ApprovalConfiguration()
        self.db.add(config)
        self.db.commit()
        self.db.refresh(config)
        return config

    def save_approval_config(self, config: ApprovalConfiguration) -> ApprovalConfiguration:
        self.db.commit()
        self.db.refresh(config)
        return config

    def list_pending_approval_batches(self) -> List[Batch]:
        return self.db.query(Batch).filter(
            Batch.status.in_(["Approval 1 Pending", "Approval 2 Pending"])
        ).all()

    # --- Option tables ---
    def get_active_option(self, option_model, option_id: UUID) -> Optional[object]:
        return self.db.query(option_model).filter(
            option_model.id == option_id,
            option_model.is_active.is_(True),
        ).first()

    def list_active_options(self, option_model) -> List[object]:
        return self.db.query(option_model).filter(
            option_model.is_active.is_(True)
        ).order_by(option_model.name).all()

    def get_option_by_id(self, option_model, option_id: UUID) -> Optional[object]:
        return self.db.query(option_model).filter(option_model.id == option_id).first()

    def option_exists_by_name(self, option_model, name: str) -> bool:
        return self.db.query(option_model).filter(
            option_model.name == name
        ).first() is not None

    def get_option_by_name(self, option_model, name: str) -> Optional[object]:
        return self.db.query(option_model).filter(option_model.name == name).first()

    def create_option(self, option_model, name: str):
        option = option_model(name=name, is_active=True)
        self.db.add(option)
        self.db.flush()
        return option

    def create_option_instance(self, option_model, name: str, description: Optional[str] = None, **extra):
        option = option_model(name=name, description=description, **extra)
        self.db.add(option)
        self.db.commit()
        self.db.refresh(option)
        return option

    def update_option_instance(self, option, name: str, description: Optional[str] = None):
        option.name = name
        option.description = description
        option.updated_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(option)
        return option

    def deactivate_option_instance(self, option) -> None:
        option.is_active = False
        option.updated_at = datetime.now(timezone.utc)
        self.db.commit()

    def get_delivery_mode_max_hours(self, delivery_mode_id: Optional[UUID], delivery_mode_name: Optional[str]) -> Optional[int]:
        delivery_mode = None
        if delivery_mode_id:
            delivery_mode = self.get_active_option(DeliveryMode, delivery_mode_id)
        elif delivery_mode_name:
            delivery_mode = self.get_option_by_name(DeliveryMode, delivery_mode_name)

        if delivery_mode and delivery_mode.max_hours_per_day:
            return delivery_mode.max_hours_per_day
        return None

    # --- Mutations ---
    def create(self, batch: Batch) -> Batch:
        self.db.add(batch)
        self.db.commit()
        self.db.refresh(batch)
        return batch

    def commit(self) -> None:
        self.db.commit()

    def refresh(self, instance) -> None:
        self.db.refresh(instance)

    def add_edit_history(self, entry: BatchEditHistory) -> None:
        self.db.add(entry)

    def list_edit_history(self, batch_id: UUID) -> List[BatchEditHistory]:
        return (
            self.db.query(BatchEditHistory)
            .filter(BatchEditHistory.batch_id == batch_id)
            .order_by(BatchEditHistory.created_at.desc())
            .all()
        )