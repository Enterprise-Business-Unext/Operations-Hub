from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Dict, List, Optional, Sequence
from uuid import UUID
from abc import ABC, abstractmethod

from sqlalchemy.orm import InstrumentedAttribute

from app.models.batch import ApprovalConfiguration, Batch
from app.models.batch_edit import BatchEditHistory
from app.models.session import FacultyUtilization, TrainingSession


@dataclass(frozen=True)
class BatchScope:
    """RBAC inputs resolved by the service and applied as a query filter.

    ``scope_user_ids`` is ``None`` for unrestricted callers (Admin and the Finance
    team), which is why it cannot simply default to an empty list: an empty list
    would silently narrow those callers to nothing.
    """

    user_id: UUID
    scope_user_ids: Optional[Sequence[UUID]] = None
    ownership_role: Optional[str] = None
    ownership_user_id: Optional[UUID] = None

    @property
    def is_unrestricted(self) -> bool:
        return self.scope_user_ids is None

    @property
    def has_ownership_filter(self) -> bool:
        return self.ownership_role is not None and self.ownership_user_id is not None


class IBatchRepository(ABC):
    """Data-access contract for batches, their approval configuration and option tables."""

    # --- Batch reads ---
    @abstractmethod
    def get_by_id(self, batch_id: UUID) -> Optional[Batch]:
        pass

    @abstractmethod
    def get_by_batch_id(self, batch_id: str) -> Optional[Batch]:
        pass

    @abstractmethod
    def exists_by_batch_id(self, batch_id: str) -> bool:
        pass

    @abstractmethod
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
        pass

    @abstractmethod
    def count_scoped_on_date(self, scope: BatchScope, target_date: date) -> int:
        """Count batches whose schedule spans ``target_date`` within the caller's scope."""
        pass

    @abstractmethod
    def list_scoped_on_date(
        self,
        scope: BatchScope,
        target_date: date,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Batch]:
        pass

    @abstractmethod
    def list_batch_ids_on_date(self, scope: BatchScope, target_date: date) -> List[UUID]:
        """Get all batch IDs for a date (unpaginated) for session querying."""
        pass

    @abstractmethod
    def get_conducted_session_counts(self, batch_ids: Sequence[UUID]) -> Dict[UUID, int]:
        """Completed utilization rows per batch."""
        pass

    @abstractmethod
    def get_scheduled_session_counts(self, batch_ids: Sequence[UUID]) -> Dict[UUID, int]:
        """Distinct scheduled training dates per batch."""
        pass

    @abstractmethod
    def list_scheduled_sessions_on_date(self, batch_ids: Sequence[UUID], target_date: date) -> List[TrainingSession]:
        pass

    @abstractmethod
    def list_scheduled_sessions_after(self, batch_id: UUID, after_date: date) -> List[TrainingSession]:
        """Timetable rows scheduled strictly after ``after_date``, oldest first."""
        pass

    @abstractmethod
    def list_actual_sessions_on_date(self, batch_ids: Sequence[UUID], target_date: date) -> List[FacultyUtilization]:
        pass

    @abstractmethod
    def export_finance_rows(
        self,
        scope: BatchScope,
        finance_status: Optional[str] = None,
        domain: Optional[str] = None,
        delivery_mode_name: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[Batch]:
        """Batches for the finance review export, filtered within the caller's scope.

        ``delivery_mode_name`` is matched against the related DeliveryMode row because
        ``Batch.delivery_mode`` is a Python property, not a queryable column.
        """
        pass

    # --- Session cascades owned by the batch lifecycle ---
    @abstractmethod
    def list_non_terminal_faculty_sessions(self, batch_id: UUID) -> List[FacultyUtilization]:
        pass

    @abstractmethod
    def list_non_terminal_training_sessions(self, batch_id: UUID) -> List[TrainingSession]:
        pass

    # --- Approval configuration ---
    @abstractmethod
    def get_approval_config(self) -> Optional[ApprovalConfiguration]:
        pass

    @abstractmethod
    def create_approval_config(self) -> ApprovalConfiguration:
        pass

    @abstractmethod
    def save_approval_config(self, config: ApprovalConfiguration) -> ApprovalConfiguration:
        pass

    @abstractmethod
    def list_pending_approval_batches(self) -> List[Batch]:
        pass

    # --- Option tables (categories, delivery modes, entities, accommodation) ---
    @abstractmethod
    def get_active_option(self, option_model, option_id: UUID) -> Optional[object]:
        pass

    @abstractmethod
    def list_active_options(self, option_model) -> List[object]:
        pass

    @abstractmethod
    def get_option_by_id(self, option_model, option_id: UUID) -> Optional[object]:
        pass

    @abstractmethod
    def option_exists_by_name(self, option_model, name: str) -> bool:
        pass

    @abstractmethod
    def get_option_by_name(self, option_model, name: str) -> Optional[object]:
        pass

    @abstractmethod
    def create_option(self, option_model, name: str):
        pass

    @abstractmethod
    def create_option_instance(self, option_model, name: str, description: Optional[str] = None, **extra):
        """Create a fully-formed option row for the admin CRUD endpoints."""
        pass

    @abstractmethod
    def update_option_instance(self, option, name: str, description: Optional[str] = None):
        pass

    @abstractmethod
    def deactivate_option_instance(self, option) -> None:
        pass

    @abstractmethod
    def get_delivery_mode_max_hours(self, delivery_mode_id: Optional[UUID], delivery_mode_name: Optional[str]) -> Optional[int]:
        """Max hours per day for the resolved delivery mode, or None when unresolved."""
        pass

    # --- Mutations ---
    @abstractmethod
    def create(self, batch: Batch) -> Batch:
        pass

    @abstractmethod
    def commit(self) -> None:
        pass

    @abstractmethod
    def refresh(self, instance) -> None:
        pass

    @abstractmethod
    def add_edit_history(self, entry: BatchEditHistory) -> None:
        pass

    @abstractmethod
    def list_edit_history(self, batch_id: UUID) -> List[BatchEditHistory]:
        pass


class IBatchLifecycleRepository(ABC):
    """Data-access contract for the scheduled batch/session synchronisation job."""

    @abstractmethod
    def list_upcoming_batches_started_by(self, target_date: date) -> List[Batch]:
        """Upcoming batches whose start date has arrived."""
        pass

    @abstractmethod
    def list_ongoing_batches_ended_before(self, target_date: date) -> List[Batch]:
        """Ongoing batches whose end date has passed."""
        pass

    @abstractmethod
    def list_batches_with_status(self, status: str) -> List[Batch]:
        pass

    @abstractmethod
    def list_batches_missing_avg_feedback(self) -> List[Batch]:
        """Every batch whose ``batch_avg_feedback`` is still NULL.

        ``batch_avg_feedback IS NULL`` is the single sentinel for "Checkpoint 1
        has not been written yet", so this is the sweep's whole work list rather
        than a status filter: a batch that finished while still ``Ongoing`` must
        still be evaluated.
        """
        pass

    @abstractmethod
    def list_completed_utilizations_with_session(self) -> List[FacultyUtilization]:
        pass

    @abstractmethod
    def get_training_session_by_id(self, session_id: UUID) -> Optional[TrainingSession]:
        pass

    @abstractmethod
    def get_batch_by_id(self, batch_id: UUID) -> Optional[Batch]:
        pass

    @abstractmethod
    def list_non_cancelled_training_sessions(self, batch_id: UUID) -> List[TrainingSession]:
        """Planned curriculum days that still count towards delivery coverage."""
        pass

    @abstractmethod
    def list_utilizations_for_batch(self, batch_id: UUID) -> List[FacultyUtilization]:
        """Every delivery ledger row for a batch, whatever its status or linkage."""
        pass

    @abstractmethod
    def list_completed_feedback_ratings(self, batch_id: UUID) -> List[Decimal]:
        """Feedback ratings recorded on completed deliveries for a batch.

        Includes ledger rows with no linked planned day: an unlinked row is still
        a real delivery that faculty delivered and rated.
        """
        pass

    @abstractmethod
    def commit(self) -> None:
        pass