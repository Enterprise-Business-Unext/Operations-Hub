from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.batch_edit import BatchEditHistory
from app.models.session import FacultyUtilization, TrainingSession
from app.api.v1.gates.repository_interfaces import IGateRepository


class GateRepository(IGateRepository):
    def __init__(self, db: Session):
        self.db = db

    def get_utilization_by_id(self, utilization_id: UUID) -> Optional[FacultyUtilization]:
        return self.db.query(FacultyUtilization).filter(FacultyUtilization.id == utilization_id).first()

    def get_training_session_by_id(self, session_id: UUID) -> Optional[TrainingSession]:
        return self.db.query(TrainingSession).filter(TrainingSession.id == session_id).first()

    def get_batch_by_id(self, batch_id: UUID) -> Optional[Batch]:
        return self.db.query(Batch).filter(Batch.id == batch_id).first()

    def list_all_sessions_for_batch(self, batch_id: UUID) -> List[List[object]]:
        planned = self.db.query(TrainingSession).filter(TrainingSession.batch_id == batch_id).all()
        actual = self.db.query(FacultyUtilization).filter(FacultyUtilization.batch_id == batch_id).all()
        return [planned, actual]

    def delete_batch_edit_history(self, batch_id: UUID) -> None:
        self.db.query(BatchEditHistory).filter(
            BatchEditHistory.batch_id == batch_id
        ).delete(synchronize_session=False)

    def commit(self) -> None:
        self.db.commit()

    def refresh(self, instance) -> None:
        self.db.refresh(instance)