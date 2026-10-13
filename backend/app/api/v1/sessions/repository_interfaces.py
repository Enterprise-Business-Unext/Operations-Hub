from typing import List, Optional
from uuid import UUID
from abc import ABC, abstractmethod

from app.models.batch import Batch
from app.models.session import FacultyUtilization, TrainingSession
from app.models.user import User


class ISessionRepository(ABC):
    """Data-access contract for the delivery ledger and the curriculum timetable."""

    # --- Batch context ---
    @abstractmethod
    def get_batch_by_id(self, batch_id: UUID) -> Optional[Batch]:
        pass

    @abstractmethod
    def list_scoped_batch_ids(self, scope_user_ids: list[UUID], current_user_id: UUID) -> list[UUID]:
        """Batch ids visible to the manager hierarchy, for scoping ledger queries."""
        pass

    @abstractmethod
    def list_all_sessions_for_batch(self, batch_id: UUID) -> List[object]:
        """Planned and actual delivery rows for a batch."""
        pass

    # --- Timetable ---
    @abstractmethod
    def list_scheduled_for_batch(self, batch_id: UUID) -> List[TrainingSession]:
        pass

    @abstractmethod
    def get_scheduled_by_id(self, session_id: UUID) -> Optional[TrainingSession]:
        pass

    @abstractmethod
    def create_scheduled(self, session: TrainingSession) -> TrainingSession:
        pass

    @abstractmethod
    def has_utilization_for_training_session(self, session_id: UUID) -> bool:
        pass

    @abstractmethod
    def delete_scheduled(self, session: TrainingSession) -> None:
        pass

    # --- Delivery ledger ---
    @abstractmethod
    def list_utilizations(
        self,
        batch_id: Optional[UUID] = None,
        batch_ids: Optional[list[UUID]] = None,
        faculty_name: Optional[str] = None,
        status_filter: Optional[str] = None,
    ) -> List[FacultyUtilization]:
        pass

    @abstractmethod
    def list_utilizations_for_batch(self, batch_id: UUID) -> List[FacultyUtilization]:
        pass

    @abstractmethod
    def get_utilization_by_id(self, session_id: UUID) -> Optional[FacultyUtilization]:
        pass

    @abstractmethod
    def create_utilization(self, session: FacultyUtilization) -> FacultyUtilization:
        pass

    @abstractmethod
    def get_training_session_by_id(self, session_id: UUID) -> Optional[TrainingSession]:
        pass

    # --- Faculty resolution ---
    @abstractmethod
    def get_active_user(self, user_id: UUID) -> Optional[User]:
        pass

    @abstractmethod
    def find_active_faculty_by_name(self, name: str, faculty_role_only: bool = False) -> Optional[User]:
        pass

    # --- Mutations ---
    @abstractmethod
    def commit(self) -> None:
        pass

    @abstractmethod
    def refresh(self, instance) -> None:
        pass