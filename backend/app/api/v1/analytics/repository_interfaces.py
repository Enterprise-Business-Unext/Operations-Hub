from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional, Sequence, Tuple
from uuid import UUID
from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.models.batch import Batch


@dataclass(frozen=True)
class DomainAggregate:
    active_batches: int
    total_hours: Decimal
    average_feedback: Decimal


class IAnalyticsRepository(ABC):
    """Data-access contract for dashboard aggregates and report exports.

    Every aggregate here is deliberately narrow: each method returns exactly one
    number or list the dashboard needs, so the shaping stays in the service.
    """

    # --- Scope ---
    @abstractmethod
    def list_scoped_batch_ids(self, scope_user_ids: Sequence[UUID], current_user_id: UUID) -> List[UUID]:
        """Batch ids owned by the manager or any coordinator in their hierarchy."""
        pass

    # --- Batch aggregates ---
    @abstractmethod
    def count_batches(self, batch_ids: Optional[Sequence[UUID]], status_filter: Optional[Sequence[str]] = None) -> int:
        pass

    @abstractmethod
    def list_column_values(self, batch_ids: Optional[Sequence[UUID]], column) -> List:
        """Non-null values of one batch column, for averaging in the service."""
        pass

    @abstractmethod
    def count_pending_gate2(self, batch_ids: Optional[Sequence[UUID]], active_statuses: Sequence[str]) -> int:
        """Active batches with no NPS recorded, or still Ongoing."""
        pass

    @abstractmethod
    def sum_batch_hours(self, batch_ids: Optional[Sequence[UUID]], status_filter: Optional[str] = None) -> Decimal:
        pass

    @abstractmethod
    def list_distinct_domains(self, batch_ids: Optional[Sequence[UUID]]) -> List[str]:
        pass

    @abstractmethod
    def aggregate_by_domain(
        self,
        batch_ids: Optional[Sequence[UUID]],
        domains: Sequence[str],
        active_statuses: Sequence[str],
    ) -> List[Tuple[str, DomainAggregate]]:
        """Per-domain active batch count, total hours and average feedback."""
        pass

    @abstractmethod
    def list_all_batches(self) -> List[Batch]:
        pass

    @abstractmethod
    def list_batches_by_ids(self, batch_ids: Sequence[UUID]) -> List[Batch]:
        pass

    # --- Session aggregates ---
    @abstractmethod
    def count_ongoing_sessions(self, batch_ids: Optional[Sequence[UUID]], today: date) -> int:
        pass

    @abstractmethod
    def sum_delivered_hours(self, batch_ids: Optional[Sequence[UUID]]) -> Optional[Decimal]:
        pass

    @abstractmethod
    def count_pending_gate1(self, batch_ids: Optional[Sequence[UUID]], now: datetime) -> int:
        pass

    @abstractmethod
    def count_distinct_deployed_faculty(self, batch_ids: Optional[Sequence[UUID]]) -> int:
        pass

    # --- Faculty ---
    @abstractmethod
    def count_active_faculty(self, manager_ids: Optional[Sequence[UUID]] = None) -> int:
        pass

    @abstractmethod
    def count_schedule_not_updated(self, batch_ids: Optional[Sequence[UUID]]) -> int:
        """Count batches whose schedule has not been marked complete."""
        pass