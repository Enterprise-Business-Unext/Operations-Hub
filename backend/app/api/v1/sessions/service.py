from datetime import datetime, timezone, time
from typing import Optional, List
from uuid import UUID

from fastapi import HTTPException

from app.models.batch import Batch
from app.models.session import (
    FacultyUtilization,
    SessionStatus,
    TERMINAL_UTILIZATION_STATUSES,
    TrainingSession,
)
from app.models.user import User
from app.schemas.feedback import SessionFeedbackCreate
from app.schemas.session import (
    SessionCreate, SessionUpdate,
    TrainingSessionCreate,
    TrainingSessionUpdate,
)
from app.api.v1.auth.repository_interfaces import IUserRepository
from app.api.v1.batches.lifecycle_service import BatchLifecycleService
from app.api.v1.gates.service import GatekeeperService
from app.api.v1.sessions.repository_interfaces import ISessionRepository


class SessionService:
    TERMINAL_STATUSES = TERMINAL_UTILIZATION_STATUSES
    TRAINING_DAYS_LIMIT_DETAIL = (
        "Scheduled session count cannot exceed training_days. Extend the batch end date and update "
        "training days and total hours, then submit the batch changes for reapproval."
    )
    ALLOWED_TRANSITIONS = {
        SessionStatus.Scheduled: {
            SessionStatus.Scheduled,
            SessionStatus.InProgress,
            SessionStatus.Cancelled,
            SessionStatus.NotConducted,
        },
        SessionStatus.InProgress: {
            SessionStatus.InProgress,
            SessionStatus.Cancelled,
            SessionStatus.NotConducted,
        },
    }

    def __init__(
        self,
        session_repo: ISessionRepository,
        user_repo: IUserRepository,
        lifecycle_service: BatchLifecycleService,
        gatekeeper: GatekeeperService,
    ):
        self.session_repo = session_repo
        self.user_repo = user_repo
        self.lifecycle_service = lifecycle_service
        self.gatekeeper = gatekeeper

    @staticmethod
    def _validate_batch_date(batch: Batch, session_date: datetime) -> None:
        training_date = session_date.date()
        if batch.start_date and training_date < batch.start_date.date():
            raise HTTPException(status_code=422, detail="Session date is before the batch start date")
        if batch.end_date and training_date > batch.end_date.date():
            raise HTTPException(
                status_code=422,
                detail=(
                    "Session date is after the batch end date. Extend the batch end date and "
                    "update training days and total hours, then submit the batch changes for reapproval."
                ),
            )

    @staticmethod
    def _record_outcome(session: FacultyUtilization, reason: Optional[str], user_id: Optional[UUID]) -> None:
        clean_reason = reason.strip() if reason else ""
        if len(clean_reason) < 3:
            raise HTTPException(
                status_code=422,
                detail="An outcome reason of at least 3 characters is required",
            )
        session.outcome_reason = clean_reason
        session.outcome_at = datetime.now(timezone.utc)
        session.outcome_by = user_id

    def list(self, batch_id: Optional[UUID], faculty_name: Optional[str], status_filter: Optional[str], user_id: Optional[UUID] = None, all: bool = False) -> List[FacultyUtilization]:
        """Lists actual faculty delivery records (utilization ledger)."""
        if user_id and not all:
            if batch_id:
                batch = self.session_repo.get_batch_by_id(batch_id)
                if batch:
                    self._require_batch_scope(batch, user_id)
            else:
                user = self.session_repo.get_active_user(user_id)
                if user and (user.role or "").lower() != "admin":
                    scope_ids = set(self.user_repo.get_manager_scope_user_ids(user))
                    if not scope_ids:
                        return []
                    scoped_batch_ids = self.session_repo.list_scoped_batch_ids(list(scope_ids), user_id)
                    if not scoped_batch_ids:
                        return []
                    return self.session_repo.list_utilizations(
                        batch_ids=scoped_batch_ids,
                        faculty_name=faculty_name,
                        status_filter=status_filter,
                    )
        return self.session_repo.list_utilizations(
            batch_id=batch_id,
            faculty_name=faculty_name,
            status_filter=status_filter,
        )

    def list_scheduled(self, batch_id: UUID, user_id: Optional[UUID] = None) -> List[dict]:
        """Lists the curriculum schedule days with status and linked utilization details."""
        batch = self.session_repo.get_batch_by_id(batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if user_id:
            self._require_batch_scope(batch, user_id)

        scheduled_days = self.session_repo.list_scheduled_for_batch(batch_id)
        util_map = {
            u.training_session_id: u
            for u in self.session_repo.list_utilizations_for_batch(batch_id)
            if u.training_session_id
        }

        result = []
        for idx, s in enumerate(scheduled_days, start=1):
            util = util_map.get(s.id)
            # Compute week dynamically from batch.start_date
            week_str = "—"
            if batch.start_date and s.session_date:
                delta_days = (s.session_date - batch.start_date.date()).days
                week_num = (delta_days // 7) + 1
                week_str = f"Week {week_num}"
            result.append({
                "id": s.id,
                "batch_id": s.batch_id,
                "sequence_number": idx,
                "week": week_str,
                "session_date": s.session_date,
                "day_name": s.day_name or s.session_date.strftime("%A"),
                "start_time": s.start_time,
                "end_time": s.end_time,
                "duration_hours": s.duration_hours,
                "module": s.module,
                "trainer_name": s.trainer_name,
                # The ledger row is the delivery of record: report its own status so a
                # merely `Scheduled` log does not read as a completed delivery.
                "status": util.status if util else s.status,
                "created_at": s.created_at,
                "updated_at": s.updated_at,
                "utilization_logged": util is not None,
                "utilization_id": util.id if util else None,
                "actual_trainer": util.faculty_name if util else None,
                "actual_hours": util.no_of_hours if util else None,
            })
        return result

    def update_scheduled(self, session_id: UUID, session_in: TrainingSessionUpdate, user_id: Optional[UUID] = None) -> TrainingSession:
        session = self.session_repo.get_scheduled_by_id(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Scheduled session not found")
        batch = self.session_repo.get_batch_by_id(session.batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if user_id:
            self._require_batch_scope(batch, user_id)
        if batch.status == "Completed":
            raise HTTPException(status_code=409, detail="Completed batches cannot be edited")
        if batch.status == "Completed":
            raise HTTPException(status_code=409, detail="Completed batches cannot be edited")

        updates = session_in.model_dump(exclude_unset=True)
        if session.status == SessionStatus.Completed:
            raise HTTPException(status_code=409, detail="Completed sessions cannot be changed")
        if updates.get("status", session.status) != session.status:
            raise HTTPException(
                status_code=409,
                detail="Scheduled session outcomes must be recorded through the linked utilization workflow",
            )
        self._validate_time_window(
            updates.get("start_time", session.start_time),
            updates.get("end_time", session.end_time),
        )
        target_date = updates.get("session_date", session.session_date)
        self._validate_batch_date(
            batch,
            datetime.combine(target_date, time.min, tzinfo=timezone.utc),
        )
        if "session_date" in updates and updates["session_date"]:
            session.day_name = updates["session_date"].strftime("%A")
        for field, value in updates.items():
            setattr(session, field, value)
        session.updated_at = datetime.now(timezone.utc)
        self.session_repo.commit()
        self.session_repo.refresh(session)
        return session

    def create_scheduled(self, session_in: TrainingSessionCreate, user_id: Optional[UUID] = None) -> TrainingSession:
        batch = self.session_repo.get_batch_by_id(session_in.batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if user_id:
            self._require_batch_scope(batch, user_id)
        if batch.status == "Completed":
            raise HTTPException(status_code=409, detail="Completed batches cannot be edited")
        self._validate_batch_date(
            batch,
            datetime.combine(session_in.session_date, time.min, tzinfo=timezone.utc),
        )
        if batch.training_days is not None:
            scheduled_count = len(self.session_repo.list_scheduled_for_batch(batch.id))
            if scheduled_count + 1 > batch.training_days:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"{self.TRAINING_DAYS_LIMIT_DETAIL} Current scheduled sessions: "
                        f"{scheduled_count}; current training_days: {batch.training_days}."
                    ),
                )
        session = TrainingSession(
            **session_in.model_dump(exclude={"batch_id"}),
            batch_id=batch.id,
        )
        session.status = SessionStatus(session.status)
        return self.session_repo.create_scheduled(session)

    def delete_scheduled(self, session_id: UUID, user_id: Optional[UUID] = None) -> None:
        session = self.session_repo.get_scheduled_by_id(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Scheduled session not found")
        batch = self.session_repo.get_batch_by_id(session.batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if user_id:
            self._require_batch_scope(batch, user_id)
        if batch.status == "Completed":
            raise HTTPException(status_code=409, detail="Completed batches cannot be edited")
        if session.status == SessionStatus.Completed:
            raise HTTPException(status_code=409, detail="Completed sessions cannot be deleted")
        if self.session_repo.has_utilization_for_training_session(session.id):
            raise HTTPException(
                status_code=409,
                detail="A scheduled session with a linked delivery record cannot be deleted.",
            )

        batch.schedule_complete = (
            batch.training_days is not None
            and len(self.session_repo.list_scheduled_for_batch(batch.id)) - 1 >= batch.training_days
        )
        self.session_repo.delete_scheduled(session)

    def _resolve_faculty(self, faculty_id: Optional[UUID], faculty_name: Optional[str]) -> tuple[Optional[User], str]:
        """Resolve the faculty user for a ledger row, plus the name to persist.

        `faculty_utilization.faculty_name` is a denormalized free-text column with no
        foreign key, and the write path prefills it from `training_sessions.trainer_name`
        (also free text, and editable or imported from Excel). Requiring a matching
        `users` row therefore rejected every delivery log for a trainer who is not on
        the roster. Resolution is still preferred, so the stored name is canonical, but an
        unresolved name now falls back to the value the caller supplied instead of
        failing the request.
        """
        if faculty_id:
            faculty = self.session_repo.get_active_user(faculty_id)
            if faculty:
                return faculty, faculty.full_name

        clean_name = str(faculty_name).strip() if faculty_name else ""
        if clean_name:
            # Prefer a Faculty-role match, then fall back to any active user.
            faculty = self.session_repo.find_active_faculty_by_name(clean_name, faculty_role_only=True)
            if faculty:
                return faculty, faculty.full_name

            faculty = self.session_repo.find_active_faculty_by_name(clean_name)
            if faculty:
                return faculty, faculty.full_name

        if not clean_name:
            raise HTTPException(status_code=422, detail="Faculty name is required to log a utilization record")

        return None, clean_name

    @staticmethod
    def _validate_time_window(start_time: Optional[time], end_time: Optional[time]) -> None:
        """Reject inverted or zero-length delivery windows.

        An end time at or before the start time is a nonsensical row, so it is
        rejected here rather than stored.
        """
        if start_time and end_time and end_time <= start_time:
            raise HTTPException(
                status_code=422,
                detail=f"End time must be after start time (got {start_time.strftime('%H:%M')} to {end_time.strftime('%H:%M')}).",
            )

    def create(self, session_in: SessionCreate, user_id: Optional[UUID] = None) -> FacultyUtilization:
        """Logs a faculty utilization delivery record, optionally linking to a scheduled session day."""
        batch = self.session_repo.get_batch_by_id(session_in.batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if user_id:
            self._require_batch_scope(batch, user_id)
        self._validate_batch_date(batch, session_in.date_of_training)

        session_dict = session_in.model_dump(exclude_unset=True)
        session_dict["status"] = SessionStatus(
            session_dict.get("status", SessionStatus.Scheduled.value)
        )
        faculty, faculty_name = self._resolve_faculty(None, session_dict.get("faculty_name"))
        session_dict["faculty_name"] = faculty_name

        self._validate_time_window(session_in.start_time, session_in.end_time)

        training_session = None
        if session_in.training_session_id:
            training_session = self.session_repo.get_training_session_by_id(session_in.training_session_id)
            if not training_session or training_session.batch_id != batch.id:
                raise HTTPException(status_code=422, detail="Training session does not belong to this batch")

        session = FacultyUtilization(**session_dict)
        if session.status in (SessionStatus.Cancelled, SessionStatus.NotConducted):
            self._record_outcome(session, session_in.outcome_reason, user_id)
        session = self.session_repo.create_utilization(session)

        if training_session and session.status in self.TERMINAL_STATUSES:
            training_session.status = session.status
            training_session.updated_at = datetime.now(timezone.utc)
            if session.status == SessionStatus.Completed:
                self.session_repo.commit()

        # Check and update batch completion/feedback
        self.lifecycle_service.check_and_update_batch_feedback(session.batch_id)

        return session

    def update(self, session_id: UUID, session_in: SessionUpdate, user_id: Optional[UUID] = None) -> FacultyUtilization:
        session = self.session_repo.get_utilization_by_id(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        update_dict = session_in.model_dump(exclude_unset=True)
        batch = self.session_repo.get_batch_by_id(session.batch_id)
        if user_id:
            self._require_batch_scope(batch, user_id)
        if batch and batch.status == "Completed":
            raise HTTPException(status_code=409, detail="Completed batches cannot be edited")
        if "faculty_name" in update_dict:
            _faculty, update_dict["faculty_name"] = self._resolve_faculty(None, update_dict.get("faculty_name"))
        self._validate_time_window(
            update_dict.get("start_time", session.start_time),
            update_dict.get("end_time", session.end_time),
        )
        target_date = update_dict.get("date_of_training", session.date_of_training)
        if target_date is None:
            raise HTTPException(status_code=422, detail="Session date cannot be empty")
        if batch:
            self._validate_batch_date(batch, target_date)

        current_status = SessionStatus(session.status)
        requested_status = update_dict.get("status")
        new_status = SessionStatus(requested_status) if requested_status else current_status
        if current_status == SessionStatus.Completed:
            raise HTTPException(status_code=409, detail="Completed sessions cannot be changed")
        if current_status in self.TERMINAL_STATUSES and new_status != current_status:
            raise HTTPException(status_code=409, detail="Terminal sessions cannot be changed")
        if new_status == SessionStatus.Completed and current_status != SessionStatus.Completed:
            raise HTTPException(status_code=409, detail="Use Gate 1 to complete a session")
        if new_status not in self.ALLOWED_TRANSITIONS.get(current_status, {current_status}):
            raise HTTPException(
                status_code=409,
                detail=f"Cannot change session status from {current_status.value} to {new_status.value}",
            )
        if new_status in (SessionStatus.Cancelled, SessionStatus.NotConducted):
            self._record_outcome(session, update_dict.get("outcome_reason"), user_id)

        training_session_id = update_dict.get("training_session_id", session.training_session_id)
        if training_session_id:
            linked = self.session_repo.get_training_session_by_id(training_session_id)
            if not linked or linked.batch_id != session.batch_id:
                raise HTTPException(status_code=422, detail="Training session does not belong to this batch")

        for field, value in update_dict.items():
            setattr(session, field, value)
        session.status = new_status
        session.updated_at = datetime.now(timezone.utc)
        self.session_repo.commit()
        self.session_repo.refresh(session)

        if session.training_session_id and new_status in self.TERMINAL_STATUSES:
            sched = self.session_repo.get_training_session_by_id(session.training_session_id)
            if sched:
                sched.status = new_status
                sched.updated_at = datetime.now(timezone.utc)
                self.session_repo.commit()

        # Check and update batch completion/feedback
        self.lifecycle_service.check_and_update_batch_feedback(session.batch_id)

        return session

    def cancel(self, session_id: UUID, reason: str, user_id: UUID) -> FacultyUtilization:
        return self.update(
            session_id,
            SessionUpdate(status=SessionStatus.Cancelled.value, outcome_reason=reason),
            user_id,
        )

    def mark_not_conducted(self, session_id: UUID, reason: str, user_id: UUID) -> FacultyUtilization:
        return self.update(
            session_id,
            SessionUpdate(status=SessionStatus.NotConducted.value, outcome_reason=reason),
            user_id,
        )

    def reschedule(
        self,
        session_id: UUID,
        date_of_training: datetime,
        start_time: Optional[time],
        end_time: Optional[time],
        reason: str,
        user_id: UUID,
    ) -> FacultyUtilization:
        session = self.session_repo.get_utilization_by_id(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        batch = self.session_repo.get_batch_by_id(session.batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        self._require_batch_scope(batch, user_id)
        if session.status == SessionStatus.Completed:
            raise HTTPException(status_code=409, detail="Completed sessions cannot be rescheduled")
        self._validate_batch_date(batch, date_of_training)
        self._validate_time_window(start_time, end_time)
        self._record_outcome(session, reason, user_id)
        session.date_of_training = date_of_training
        session.start_time = start_time
        session.end_time = end_time
        session.status = SessionStatus.Scheduled
        session.updated_at = datetime.now(timezone.utc)
        self.session_repo.commit()

        if session.training_session_id:
            scheduled = self.session_repo.get_training_session_by_id(session.training_session_id)
            if scheduled:
                scheduled.session_date = date_of_training.date()
                scheduled.start_time = start_time
                scheduled.end_time = end_time
                scheduled.day_name = date_of_training.strftime("%A")
                scheduled.status = SessionStatus.Scheduled
                scheduled.updated_at = datetime.now(timezone.utc)
                self.session_repo.commit()

        self.lifecycle_service.check_and_update_batch_feedback(session.batch_id)
        self.session_repo.refresh(session)
        return session

    def _require_batch_scope(self, batch: Batch, user_id: UUID) -> None:
        user = self.session_repo.get_active_user(user_id)
        if not user:
            raise HTTPException(status_code=401, detail="Active user not found")
        role = (user.role or "").lower()
        team = (user.team_detail.name if user.team_detail else "").strip().lower()
        if role == "admin" or team == "finance":
            return
        scope_ids = set(self.user_repo.get_manager_scope_user_ids(user))
        batch_user_ids = {batch.primary_manager_id, batch.coordinator_id, batch.sales_spoc_id}
        if not scope_ids.intersection({value for value in batch_user_ids if value is not None}):
            raise HTTPException(status_code=403, detail="You can only view or edit sessions within your manager scope.")

    def complete_gate1(self, session_id: str, feedback: SessionFeedbackCreate, user_id: UUID) -> dict:
        return self.gatekeeper.complete_session_gate1(
            session_id=session_id,
            feedback_data=feedback,
            user_id=user_id,
        )