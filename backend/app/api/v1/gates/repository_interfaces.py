from typing import List, Optional
from uuid import UUID
from abc import ABC, abstractmethod

from app.models.batch import Batch
from app.models.session import FacultyUtilization, TrainingSession


class IGateRepository(ABC):
    """Data-access contract for the Gate 1 / Gate 2 quality checkpoints."""

    @abstractmethod
    def get_utilization_by_id(self, utilization_id: UUID) -> Optional[FacultyUtilization]:
        pass

    @abstractmethod
    def get_training_session_by_id(self, session_id: UUID) -> Optional[TrainingSession]:
        pass

    @abstractmethod
    def get_batch_by_id(self, batch_id: UUID) -> Optional[Batch]:
        pass

    @abstractmethod
    def list_all_sessions_for_batch(self, batch_id: UUID) -> List[List[object]]:
        """Planned and actual session rows for a batch, grouped as two lists."""
        pass

    @abstractmethod
    def delete_batch_edit_history(self, batch_id: UUID) -> None:
        pass

    @abstractmethod
    def commit(self) -> None:
        pass

    @abstractmethod
    def refresh(self, instance) -> None:
        pass