from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import Date, and_, cast, func, or_
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.session import ACTIVE_UTILIZATION_STATUSES, FacultyUtilization, SessionStatus
from app.models.user import User
from app.api.v1.analytics.repository_interfaces import DomainAggregate, IAnalyticsRepository


class AnalyticsRepository(IAnalyticsRepository):
    def __init__(self, db: Session):
        self.db = db

    # --- Scope ---
    def list_scoped_batch_ids(self, scope_user_ids: Sequence[UUID], current_user_id: UUID) -> List[UUID]:
        rows = self.db.query(Batch.id).filter(or_(
            Batch.primary_manager_id == current_user_id,
            Batch.coordinator_id.in_(list(scope_user_ids)),
        )).all()
        return [row[0] for row in rows]

    # --- Batch aggregates ---
    def _batches(self, batch_ids: Optional[Sequence[UUID]]):
        query = self.db.query(Batch)
        if batch_ids is not None:
            query = query.filter(Batch.id.in_(list(batch_ids)))
        return query

    def _sessions(self, batch_ids: Optional[Sequence[UUID]]):
        query = self.db.query(FacultyUtilization)
        if batch_ids is not None:
            query = query.filter(FacultyUtilization.batch_id.in_(list(batch_ids)))
        return query

    def count_batches(self, batch_ids: Optional[Sequence[UUID]], status_filter: Optional[Sequence[str]] = None) -> int:
        query = self._batches(batch_ids)
        if status_filter is not None:
            query = query.filter(Batch.status.in_(list(status_filter)))
        return query.count()

    def list_column_values(self, batch_ids: Optional[Sequence[UUID]], column) -> List:
        return self._batches(batch_ids).filter(column.isnot(None)).with_entities(column).all()

    def count_pending_gate2(self, batch_ids: Optional[Sequence[UUID]], active_statuses: Sequence[str]) -> int:
        return self._batches(batch_ids).filter(
            Batch.status.in_(list(active_statuses)),
            or_(Batch.batch_nps.is_(None), Batch.status == "Ongoing"),
        ).count()

    def sum_batch_hours(self, batch_ids: Optional[Sequence[UUID]], status_filter: Optional[str] = None) -> Decimal:
        query = self._batches(batch_ids)
        if status_filter is not None:
            query = query.filter(Batch.status == status_filter)
        total = query.with_entities(func.sum(Batch.total_hours)).scalar()
        return Decimal(str(round(float(total or 0.0), 2)))

    def list_distinct_domains(self, batch_ids: Optional[Sequence[UUID]]) -> List[str]:
        rows = self._batches(batch_ids).filter(
            Batch.domain.isnot(None),
            Batch.domain != "",
        ).with_entities(Batch.domain).distinct().all()
        return [row[0] for row in rows if row[0]]

    def aggregate_by_domain(
        self,
        batch_ids: Optional[Sequence[UUID]],
        domains: Sequence[str],
        active_statuses: Sequence[str],
    ) -> List[Tuple[str, DomainAggregate]]:
        results = []
        for domain in domains:
            query = self._batches(batch_ids).filter(Batch.domain == domain)
            active_batches = query.filter(Batch.status.in_(list(active_statuses))).count()
            total_hours = query.with_entities(func.sum(Batch.total_hours)).scalar() or 0.0
            feedback_values = [
                row[0]
                for row in query.filter(
                    Batch.batch_avg_feedback.isnot(None)
                ).with_entities(Batch.batch_avg_feedback).all()
                if row[0] is not None
            ]
            average_feedback = (
                Decimal(str(round(sum(float(v) for v in feedback_values) / len(feedback_values), 2)))
                if feedback_values else Decimal("0.0")
            )
            results.append((domain, DomainAggregate(
                active_batches=active_batches,
                total_hours=Decimal(str(round(float(total_hours), 2))),
                average_feedback=average_feedback,
            )))
        return results

    def list_all_batches(self) -> List[Batch]:
        return self.db.query(Batch).all()

    def list_batches_by_ids(self, batch_ids: Sequence[UUID]) -> List[Batch]:
        return self.db.query(Batch).filter(Batch.id.in_(list(batch_ids))).all()

    # --- Session aggregates ---
    def count_ongoing_sessions(self, batch_ids: Optional[Sequence[UUID]], today: date) -> int:
        return self._sessions(batch_ids).filter(
            and_(
                FacultyUtilization.status.in_({
                    SessionStatus.Scheduled,
                    SessionStatus.InProgress,
                }),
                cast(FacultyUtilization.date_of_training, Date) == today,
            )
        ).count()

    def sum_delivered_hours(self, batch_ids: Optional[Sequence[UUID]]) -> Optional[Decimal]:
        total = self._sessions(batch_ids).filter(
            FacultyUtilization.status == "Completed"
        ).with_entities(func.sum(FacultyUtilization.no_of_hours)).scalar()
        if total is None:
            return None
        return Decimal(str(round(float(total), 2)))

    def count_pending_gate1(self, batch_ids: Optional[Sequence[UUID]], now: datetime) -> int:
        return self._sessions(batch_ids).filter(
            or_(
                FacultyUtilization.status == "Completed",
                and_(
                    FacultyUtilization.status.in_(ACTIVE_UTILIZATION_STATUSES),
                    FacultyUtilization.date_of_training <= now,
                ),
            ),
            or_(
                FacultyUtilization.feedback_rating.is_(None),
                FacultyUtilization.feedback_submitted == False,
            )
        ).count()

    def count_distinct_deployed_faculty(self, batch_ids: Optional[Sequence[UUID]]) -> int:
        return self._sessions(batch_ids).filter(
            FacultyUtilization.status.in_(ACTIVE_UTILIZATION_STATUSES)
        ).with_entities(FacultyUtilization.faculty_name).distinct().count()

    # --- Faculty ---
    def count_active_faculty(self, manager_ids: Optional[Sequence[UUID]] = None) -> int:
        query = self.db.query(User).filter(User.role == "Faculty", User.is_active == True)
        if manager_ids is not None:
            query = query.filter(User.manager_id.in_(list(manager_ids)))
        return query.count()