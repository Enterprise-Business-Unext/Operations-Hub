from decimal import Decimal
from typing import Optional
from uuid import UUID
from datetime import datetime, timezone

from fastapi import HTTPException, status
from pydantic import BaseModel, field_validator

from app.models.batch import Batch
from app.models.session import SessionStatus, TERMINAL_UTILIZATION_STATUSES
from app.schemas.feedback import SessionFeedbackCreate, BatchNpsClosureCreate
from app.api.v1.batches.lifecycle_service import BatchLifecycleService
from app.api.v1.gates.repository_interfaces import IGateRepository


class GatekeeperService:

    def __init__(
        self,
        gate_repo: IGateRepository,
        lifecycle_service: Optional[BatchLifecycleService] = None,
    ):
        self.gate_repo = gate_repo
        self.lifecycle_service = lifecycle_service

    def complete_session_gate1(
        self,
        session_id: str,
        feedback_data: SessionFeedbackCreate,
        user_id: UUID,
    ) -> dict:
        """
        Quality Checkpoint 1:
        Validates module rating (1.0 - 5.0), saves feedback to DB, marks session Completed,
        and recalculates the batch's average feedback rating.
        """
        if feedback_data.rating < Decimal("1.0") or feedback_data.rating > Decimal("5.0"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Quality Gate 1 Rejected: Rating must be between 1.0 and 5.0."
            )

        # Parse or query session
        session_obj = None
        try:
            parsed_uuid = UUID(str(session_id))
            session_obj = self.gate_repo.get_utilization_by_id(parsed_uuid)
        except (ValueError, TypeError):
            pass

        if not session_obj:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        if session_obj.status in TERMINAL_UTILIZATION_STATUSES:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session is not available for Gate 1 completion")
        if not session_obj.training_session_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A linked training_session_id is required to complete a session",
            )

        session_obj.status = SessionStatus.Completed
        session_obj.feedback_submitted = True
        session_obj.feedback_rating = feedback_data.rating
        notes = feedback_data.topic_feedback or ""
        if feedback_data.faculty_observations:
            notes = f"{notes}\nObservations: {feedback_data.faculty_observations}".strip()
        session_obj.feedback_notes = notes
        session_obj.updated_at = datetime.now(timezone.utc)

        # If linked to a scheduled training session day, mark it Completed
        if session_obj.training_session_id:
            sched = self.gate_repo.get_training_session_by_id(session_obj.training_session_id)
            if sched:
                sched.status = "Completed"
                sched.updated_at = datetime.now(timezone.utc)

        self.gate_repo.commit()

        # Delegate batch-level feedback calculation to the lifecycle service.
        # It only writes batch_avg_feedback once every non-cancelled planned day
        # has a logged delivery whose outcome is terminal, so callers never see
        # a partial average.
        if self.lifecycle_service:
            self.lifecycle_service.check_and_update_batch_feedback(session_obj.batch_id)

        self.gate_repo.refresh(session_obj)

        return {
            "session_id": str(session_obj.id),
            "batch_id": str(session_obj.batch_id),
            "status": session_obj.status,
            "feedback_submitted": session_obj.feedback_submitted,
            "rating": session_obj.feedback_rating,
            "topic_feedback": session_obj.feedback_notes,
            "total_students_present": feedback_data.total_students_present,
            "submitted_by": str(user_id)
        }

    def close_batch_gate2(
        self,
        batch_id: UUID,
        closure_data: BatchNpsClosureCreate,
        user_id: UUID,
    ) -> Batch:
        """
        Quality Checkpoint 2:
        Closing a batch is BLOCKED until Quality Checkpoint 1 has written the batch
        average feedback, and until the final NPS breakdown is supplied (or NPS
        is marked as not available). The NPS index is derived here from the three
        category counts; the client never supplies it. Gate 2 is sequenced after
        Gate 1 but never reads or writes ``batch_avg_feedback``.
        """
        batch = self.gate_repo.get_batch_by_id(batch_id)
        if not batch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Batch {batch_id} not found."
            )

        if batch.status == "Completed":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Batch has already completed Gate 2 and is Closed."
            )

        if batch.batch_avg_feedback is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Quality Checkpoint 1 must be completed before batch closure",
            )

        all_sessions = [
            session
            for group in self.gate_repo.list_all_sessions_for_batch(batch.id)
            for session in group
        ]
        if all_sessions and any(s.status not in TERMINAL_UTILIZATION_STATUSES for s in all_sessions):
            raise HTTPException(status_code=409, detail="Every session must have a terminal outcome before batch closure")

        # Handle NPS not available case
        if not closure_data.nps_available:
            # nps_unavailable_reason is already validated by schema
            reason = closure_data.nps_unavailable_reason

            # Set all NPS fields to NULL
            batch.batch_nps = None
            batch.nps_total_responses = None
            batch.nps_promoters = None
            batch.nps_passives = None
            batch.nps_detractors = None

            # Append reason to remarks
            timestamp = datetime.now(timezone.utc).strftime("%d-%m-%Y %H:%M UTC")
            remark_entry = f"[{timestamp} - NPS closure skipped: {reason}]"
            if batch.remarks:
                batch.remarks = f"{batch.remarks}\n{remark_entry}"
            else:
                batch.remarks = remark_entry

            # Mark batch as completed and schema locked
            batch.status = "Completed"
            batch.is_schema_locked = True
            batch.updated_at = datetime.now(timezone.utc)

            # Delete edit history
            self.gate_repo.delete_batch_edit_history(batch.id)
            self.gate_repo.commit()
            self.gate_repo.refresh(batch)
            return batch

        # NPS available - current logic
        promoters = closure_data.promoters_count
        passives = closure_data.passive_count
        detractors = closure_data.detractors_count
        total = promoters + passives + detractors
        if total == 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="NPS closure requires at least one response",
            )

        batch.batch_nps = ((promoters - detractors) * Decimal("100") / Decimal(total)).quantize(Decimal("0.01"))
        batch.nps_total_responses = total
        batch.nps_promoters = promoters
        batch.nps_passives = passives
        batch.nps_detractors = detractors

        batch.status = "Completed"
        batch.is_schema_locked = True
        batch.updated_at = datetime.now(timezone.utc)

        self.gate_repo.delete_batch_edit_history(batch.id)
        self.gate_repo.commit()
        self.gate_repo.refresh(batch)
        return batch