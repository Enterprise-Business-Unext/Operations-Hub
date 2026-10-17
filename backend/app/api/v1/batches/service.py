from datetime import datetime, timezone, timedelta, date
from decimal import Decimal
import json
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status

from app.models.batch import (
    Accommodation,
    ApprovalConfiguration,
    ApprovalStatus,
    Batch,
    BatchCategory,
    BatchStatus,
    DeliveryMode,
    Entity,
    FacultyType,
    ProgramType,
    Vertical,
)
from app.models.batch_edit import BatchEditHistory
from app.models.user import User
from app.models.session import SessionStatus
from app.schemas.batch import ApprovalConfigurationBase, ApprovalDecision, BatchApprove, BatchCreateRequest, BatchUpdateRequest, ActiveBatchesResponse
from app.schemas.feedback import BatchNpsClosureCreate
from app.api.v1.auth.repository_interfaces import IUserRepository
from app.api.v1.batches.repository_interfaces import BatchScope, IBatchRepository
from app.api.v1.gates.service import GatekeeperService
from app.core.cache import RedisCacheService


class BatchService:
    REAPPROVAL_FIELDS = {
        "sow_number",
        "category",
        "entity_id",
        "category_id",
        "delivery_mode_id",
        "accommodation_id",
        "program_name",
        "technology",
        "domain",
        "client_name",
        "location_city",
        "start_date",
        "end_date",
        "training_days",
        "total_hours",
        "total_enrollments",
        "primary_manager_id",
        "coordinator_id",
        "sales_spoc_id",
        "faculty_assigned_text",
        "faculty_members",
    }

    def __init__(
        self,
        batch_repo: IBatchRepository,
        user_repo: IUserRepository,
        gatekeeper: GatekeeperService,
        cache: Optional[RedisCacheService] = None,
    ):
        self.batch_repo = batch_repo
        self.user_repo = user_repo
        self.gatekeeper = gatekeeper
        self.cache = cache or RedisCacheService()

    # Batch option catalogue keyed by the URL option type used in
    # batch_options/controller.py OPTION_MODELS.
    _OPTION_TYPE_BY_MODEL = {
        BatchCategory: "categories",
        DeliveryMode: "delivery-modes",
        Accommodation: "accommodations",
        Entity: "entities",
        FacultyType: "faculty-types",
        Vertical: "verticals",
        ProgramType: "program-types",
    }

    @classmethod
    def _option_type_name(cls, option_model) -> str:
        return cls._OPTION_TYPE_BY_MODEL.get(option_model, option_model.__tablename__)

    @staticmethod
    def _row_to_dict(row) -> dict:
        data = {}
        for column in row.__table__.columns:
            value = getattr(row, column.name)
            if isinstance(value, UUID):
                value = str(value)
            elif isinstance(value, (datetime, date)):
                value = value.isoformat()
            data[column.name] = value
        return data

    @staticmethod
    def _is_unrestricted(current_user: User) -> bool:
        """Admins and the Finance team see every batch."""
        role_lower = (current_user.role or "").lower()
        team_lower = (current_user.team_detail.name if current_user.team_detail else "").strip().lower()
        return role_lower == "admin" or team_lower == "finance"

    def _scope(self, current_user: User, ownership_user_id: Optional[UUID] = None) -> BatchScope:
        role_lower = (current_user.role or "").lower()
        return BatchScope(
            user_id=current_user.id,
            scope_user_ids=(
                None if self._is_unrestricted(current_user)
                else self.user_repo.get_manager_scope_user_ids(current_user)
            ),
            ownership_role=role_lower if role_lower in ("coordinator", "manager") else None,
            ownership_user_id=ownership_user_id,
        )

    def _save(self, batch: Batch) -> Batch:
        self.batch_repo.commit()
        self.batch_repo.refresh(batch)
        return batch

    @staticmethod
    def _history_value(value):
        if isinstance(value, UUID):
            return str(value)
        if isinstance(value, Decimal):
            return str(value)
        if isinstance(value, datetime):
            normalized = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
            return normalized.isoformat()
        if isinstance(value, date):
            return value.isoformat()
        if isinstance(value, dict):
            return {str(key): BatchService._history_value(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [BatchService._history_value(item) for item in value]
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                return value
            if isinstance(parsed, (list, dict)):
                return BatchService._history_value(parsed)
        return value

    @staticmethod
    def _as_utc(value):
        """Normalize a stored datetime to timezone-aware UTC for safe comparison.

        Columns are declared DateTime(timezone=True), but some dialects (and
        freshly-built in-session objects) can hand back naive datetimes, which
        cannot be compared against an aware `datetime.now(timezone.utc)`.
        """
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def _estimated_sessions_conducted(self, batch: Batch, now: datetime) -> int:
        """Estimate delivered sessions when no utilization records exist yet."""
        if batch.status == "Completed":
            return batch.training_days or 1
        if batch.status != "Ongoing":
            return 0
        start = self._as_utc(batch.start_date)
        end = self._as_utc(batch.end_date)
        if not start or not end or end <= start:
            return 0
        total_span = (end - start).total_seconds()
        elapsed = max(0.0, (min(now, end) - start).total_seconds())
        fraction = min(1.0, elapsed / total_span) if total_span > 0 else 0.5
        total_expected = batch.training_days or 10
        return max(1, int(fraction * total_expected))

    def create(self, batch_in: BatchCreateRequest, current_user: User) -> Batch:
        # Check for unique batch_id
        if self.batch_repo.exists_by_batch_id(batch_in.batch_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Batch ID '{batch_in.batch_id}' is already registered.")

        # Get delivery mode config for max_hours_per_day validation
        max_hours_per_day = self.batch_repo.get_delivery_mode_max_hours(
            batch_in.delivery_mode_id, batch_in.delivery_mode
        ) or 8

        # Validate total_hours against training_days * max_hours_per_day
        if batch_in.total_hours > batch_in.training_days * max_hours_per_day:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Total hours must be between 0.5 and training_days × max_hours_per_day ({batch_in.training_days} × {max_hours_per_day} = {batch_in.training_days * max_hours_per_day})"
            )

        batch_data = batch_in.model_dump(exclude_none=True)
        batch_data["calendar_days"] = self._calendar_days(batch_data.get("start_date"), batch_data.get("end_date"))
        batch_data["category_id"] = self._option_id(BatchCategory, batch_data.get("category_id"), batch_data.get("category", "Bootcamp"))
        delivery_mode_str = batch_data.get("delivery_mode", "Online")
        if delivery_mode_str == "Online":
            batch_data["location_city"] = None
        batch_data["delivery_mode_id"] = self._option_id(DeliveryMode, batch_data.get("delivery_mode_id"), delivery_mode_str)
        if batch_data.get("accommodation_id"):
            batch_data["accommodation_id"] = self._option_id(Accommodation, batch_data["accommodation_id"], "")
        batch_data["entity_id"] = self._option_id(Entity, batch_data.get("entity_id"), "Unext")
        batch_data["batch_request_date"] = datetime.now(timezone.utc)
        config = self.batch_repo.get_approval_config()
        if not config or not config.approver_1_id or not config.approver_2_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Both approvers must be configured before creating a batch.",
            )
        batch_data["approver_1_id"] = config.approver_1_id
        batch_data["approver_2_id"] = config.approver_2_id
        batch_data["approver_1_status"] = "Pending"
        batch_data["approver_2_status"] = "Pending"
        batch_data["status"] = "Approval 1 Pending"
        if current_user.role == "Coordinator" and not batch_data.get("coordinator_id"):
            batch_data["coordinator_id"] = current_user.id
        elif current_user.role == "Sales" and not batch_data.get("sales_spoc_id"):
            batch_data["sales_spoc_id"] = current_user.id

        # Store faculty_members as JSON
        if "faculty_members" in batch_data:
            batch_data["faculty_members"] = json.dumps(batch_data["faculty_members"])

        return self.batch_repo.create(Batch(**batch_data))

    @staticmethod
    def _calendar_days(start_date, end_date) -> int:
        if not start_date or not end_date:
            return 0
        start_utc = BatchService._as_utc(start_date)
        end_utc = BatchService._as_utc(end_date)
        if end_utc < start_utc:
            raise HTTPException(status_code=422, detail="end_date must be on or after start_date")
        return (end_utc.date() - start_utc.date()).days

    def _option_id(self, model, option_id, legacy_name: str):
        if option_id:
            option = self.batch_repo.get_active_option(model, option_id)
            if not option:
                raise HTTPException(status_code=422, detail=f"Inactive or invalid {model.__tablename__} option")
            return option.id
        normalized = "Non-Residential" if legacy_name == "NR" else "Residential" if legacy_name == "R" else legacy_name
        option = self.batch_repo.get_option_by_name(model, normalized)
        if not option:
            option = self.batch_repo.create_option(model, normalized)
        return option.id

    def get_approval_config(self):
        cache_key = "approval-config:default"
        cached = self.cache.get("v1", cache_key)
        if cached:
            data = json.loads(cached)
            config = ApprovalConfiguration(
                id=UUID(data["id"]),
                approver_1_id=UUID(data["approver_1_id"]) if data.get("approver_1_id") else None,
                approver_2_id=UUID(data["approver_2_id"]) if data.get("approver_2_id") else None,
            )
            config.updated_at = data.get("updated_at")
            return config

        config = self.batch_repo.get_approval_config()
        if not config:
            config = self.batch_repo.create_approval_config()
        self.cache.set("v1", cache_key, json.dumps(self._row_to_dict(config)), ttl=600)
        return config
    def update_approval_config(self, config_in: ApprovalConfigurationBase):
        config = self.batch_repo.get_approval_config()
        if not config:
            config = self.batch_repo.create_approval_config()
        values = config_in.model_dump(exclude_unset=True)
        for field, value in values.items():
            if value:
                user = self.user_repo.get_active_by_id(value)
                if not user or user.role.lower() not in {"admin", "manager"}:
                    raise HTTPException(status_code=422, detail=f"{field} must reference an active Admin or Manager")
            setattr(config, field, value)
        result = self.batch_repo.save_approval_config(config)
        self.cache.delete("v1", "approval-config:default")
        return result

    def submit_for_approval(self, batch_id: UUID, current_user: User) -> Batch:
        batch = self.get(batch_id, current_user)
        self._require_operational_scope(batch, current_user)
        config = self.get_approval_config()
        if not config.approver_1_id or not config.approver_2_id:
            raise HTTPException(status_code=409, detail="Admin must configure both approvers before submission")
        if batch.start_date and batch.start_date.date() < datetime.now(timezone.utc).date():
            raise HTTPException(status_code=422, detail="Cannot submit a batch whose start date has already passed")
        
        # Allow resubmission from Rejected state
        if batch.status != "Rejected" and batch.status != "Requested":
            raise HTTPException(status_code=409, detail="Batch can only be submitted for approval from Requested or Rejected state")
        
        batch.approver_1_id = config.approver_1_id
        batch.approver_2_id = config.approver_2_id
        batch.approver_1_status = "Pending"
        batch.approver_2_status = "Pending"
        batch.status = "Approval 1 Pending"
        return self._save(batch)

    def decide(self, batch_id: UUID, level: int, decision: ApprovalDecision, current_user: User) -> Batch:
        batch = self.get(batch_id)
        expected_id = batch.approver_1_id if level == 1 else batch.approver_2_id
        if expected_id != current_user.id:
            raise HTTPException(status_code=403, detail=f"Only the configured approver {level} can decide this request")
        if level == 2 and batch.approver_1_status != "Approved":
            raise HTTPException(status_code=409, detail="Approver 1 must approve before Approver 2")
        if decision.decision == "reject":
            if level == 1:
                batch.approver_1_status = "Rejected"
            else:
                batch.approver_2_status = "Rejected"
            batch.status = "Rejected"
            if decision.reason:
                batch.remarks = f"Approval {level} rejected: {decision.reason}"
        elif level == 1:
            batch.approver_1_status = "Approved"
            batch.approver_1_approved_at = datetime.now(timezone.utc)
            batch.status = "Approval 2 Pending"
        else:
            batch.approver_2_status = "Approved"
            batch.approver_2_approved_at = datetime.now(timezone.utc)
            batch.is_schema_locked = True
            if decision.reason and not batch.approval_id and len(decision.reason.strip()) <= 100:
                batch.approval_id = decision.reason.strip()

            # Clear reapproval_changes when reapproval cycle completes
            if (batch.reapproval_count or 0) > 0:
                batch.reapproval_changes = None

            # Auto-transition based on start_date
            today = datetime.now(timezone.utc).date()
            if batch.start_date and batch.start_date.date() <= today:
                batch.status = "Ongoing"
            else:
                batch.status = "Upcoming"
        batch.updated_at = datetime.now(timezone.utc)
        return self._save(batch)

    def approve(self, batch_id: UUID, approval: BatchApprove, current_user: User) -> Batch:
        batch = self.get(batch_id, current_user)
        self._require_operational_scope(batch, current_user)
        if batch.approver_1_id and batch.approver_1_status != "Approved" and (current_user.role or "").lower() != "admin":
            raise HTTPException(
                status_code=409,
                detail="Approver 1 signoff is pending. Direct approval requires Admin authorization or Level 1 completion."
            )
        batch.approval_id = approval.approval_id
        batch.is_schema_locked = True
        batch.updated_at = datetime.now(timezone.utc)

        # Auto-transition based on start_date
        today = datetime.now(timezone.utc).date()
        if batch.start_date and batch.start_date.date() <= today:
            batch.status = "Ongoing"
        else:
            batch.status = "Upcoming"

        if not batch.primary_manager_id:
            batch.primary_manager_id = current_user.id
        return self._save(batch)

    def list(self, current_user: User, status_filter: Optional[str], domain: Optional[str], category: Optional[str], client_name: Optional[str], search: Optional[str], skip: int, limit: int, ownership_filter: Optional[UUID] = None) -> List[Batch]:
        self._sync_pending_approvers()
        batches = self.batch_repo.list_scoped(
            self._scope(current_user, ownership_filter),
            status_filter=status_filter,
            domain=domain,
            category=category,
            client_name=client_name,
            search=search,
            skip=skip,
            limit=limit,
        )
        if batches:
            batch_ids = [b.id for b in batches]
            counts = self.batch_repo.get_conducted_session_counts(batch_ids)
            # Timetable rows, i.e. what `GET /batches` used to not report. Lets a
            # coordinator see at a glance which batches still need a schedule.
            scheduled_counts = self.batch_repo.get_scheduled_session_counts(batch_ids)
            now = datetime.now(timezone.utc)
            for b in batches:
                b._scheduled_session_count = scheduled_counts.get(b.id, 0)
                conducted = counts.get(b.id)
                if conducted is None or conducted == 0:
                    conducted = self._estimated_sessions_conducted(b, now)
                b._sessions_conducted = conducted
                total = b.training_days or conducted or 1
                if b.status == "Completed":
                    b._completion_rate = 100.0
                elif b.status in ("Requested", "Approval 1 Pending", "Approval 2 Pending", "Cancelled", "Rejected"):
                    b._completion_rate = 0.0
                else:
                    b._completion_rate = round(min(100.0, (conducted / total) * 100.0), 1)
        return batches

    def get_active_batches(
        self, 
        filter_date: Optional[str], 
        current_user: User,
        skip: int = 0,
        limit: int = 100,
        session_skip: int = 0,
        session_limit: int = 50
    ) -> ActiveBatchesResponse:
        """Get ongoing batches and sessions for a specific date with pagination."""
        from app.schemas.batch import ActiveBatchItem, ActiveSessionItem, ActiveBatchesResponse

        # Parse filter_date or default to today (UTC)
        try:
            if filter_date:
                filter_date_obj = datetime.strptime(filter_date, "%Y-%m-%d").date()
            else:
                filter_date_obj = datetime.now(timezone.utc).date()
        except ValueError:
            filter_date_obj = datetime.now(timezone.utc).date()

        filter_date_str = filter_date_obj.isoformat()
        scope = self._scope(current_user)

        total_batches = self.batch_repo.count_scoped_on_date(scope, filter_date_obj)
        batches = self.batch_repo.list_scoped_on_date(scope, filter_date_obj, skip=skip, limit=limit)

        batch_ids = [b.id for b in batches]
        # Sessions conducted count for progress calculation (same logic as list())
        conducted_counts = self.batch_repo.get_conducted_session_counts(batch_ids)

        # Build batch items
        batch_items = []
        now = datetime.now(timezone.utc)
        for b in batches:
            conducted = conducted_counts.get(b.id, 0)
            if conducted == 0:
                conducted = self._estimated_sessions_conducted(b, now)

            training_days = b.training_days or 0
            progress = round(min(100.0, (conducted / training_days) * 100.0), 1) if training_days > 0 else 0.0

            delivery_mode_name = b.delivery_mode
            if b.delivery_mode_detail:
                delivery_mode_name = b.delivery_mode_detail.name

            batch_items.append(ActiveBatchItem(
                id=str(b.id),
                batch_id=b.batch_id,
                program_name=b.program_name,
                client_name=b.client_name,
                category=b.category,
                delivery_mode=delivery_mode_name or "Online",
                location_city=b.location_city,
                start_date=b.start_date.isoformat() if b.start_date else None,
                end_date=b.end_date.isoformat() if b.end_date else None,
                status=b.status,
                total_enrollments=b.total_enrollments,
                training_days=training_days,
                sessions_conducted=conducted,
                progress=progress,
                batch_avg_feedback=b.batch_avg_feedback,
                batch_nps=b.batch_nps,
            ))

        # Get ALL batch IDs for this date (not just current page) for session querying
        all_batch_ids = self.batch_repo.list_batch_ids_on_date(scope, filter_date_obj)

        # Get sessions for this date
        session_items = []
        batches_by_id = {b.id: b for b in self.batch_repo.list_scoped_on_date(scope, filter_date_obj)}  # Get all batches for session data

        for ts in self.batch_repo.list_scheduled_sessions_on_date(all_batch_ids, filter_date_obj):
            batch = batches_by_id.get(ts.batch_id)
            session_items.append(ActiveSessionItem(
                id=str(ts.id),
                batch_id=batch.batch_id if batch else "",
                batch_name=batch.program_name if batch else "",
                session_type="scheduled",
                sequence_number=None,
                module=ts.module,
                trainer_name=ts.trainer_name,
                faculty_name=None,
                session_date=ts.session_date.isoformat(),
                start_time=ts.start_time.isoformat() if ts.start_time else None,
                end_time=ts.end_time.isoformat() if ts.end_time else None,
                duration_hours=float(ts.duration_hours) if ts.duration_hours else 0.0,
                status=ts.status,
                venue=None,
                location_city=batch.location_city if batch else None,
                mode_of_delivery=batch.delivery_mode if batch else "Online",
            ))

        for fu in self.batch_repo.list_actual_sessions_on_date(all_batch_ids, filter_date_obj):
            batch = batches_by_id.get(fu.batch_id)
            session_items.append(ActiveSessionItem(
                id=str(fu.id),
                batch_id=batch.batch_id if batch else "",
                batch_name=batch.program_name if batch else "",
                session_type="actual",
                sequence_number=None,
                module=fu.topic,
                trainer_name=None,
                faculty_name=fu.faculty_name,
                session_date=fu.date_of_training.date().isoformat(),
                start_time=fu.start_time.isoformat() if fu.start_time else None,
                end_time=fu.end_time.isoformat() if fu.end_time else None,
                duration_hours=float(fu.no_of_hours) if fu.no_of_hours else 0.0,
                status=fu.status,
                venue=fu.venue,
                location_city=fu.location_city,
                mode_of_delivery=fu.mode_of_delivery,
            ))

        # Sort sessions by start_time ASC (NULLS LAST)
        session_items.sort(key=lambda s: (s.start_time is None, s.start_time or ""))

        # Apply separate pagination to sessions
        total_sessions = len(session_items)
        session_items = session_items[session_skip:session_skip + session_limit]

        return ActiveBatchesResponse(
            filter_date=filter_date_str,
            batches=batch_items,
            sessions=session_items,
            total_batches=total_batches,
            total_sessions=total_sessions,
            skip=skip,
            limit=limit,
            session_skip=session_skip,
            session_limit=session_limit,
        )

    def _sync_pending_approvers(self) -> None:
        """Backfill pending approval assignments after admin configuration changes/imports."""
        config = self.batch_repo.get_approval_config()
        if not config or not config.approver_1_id or not config.approver_2_id:
            return
        changed = False
        for batch in self.batch_repo.list_pending_approval_batches():
            if batch.approver_1_id != config.approver_1_id:
                batch.approver_1_id = config.approver_1_id
                changed = True
            if batch.approver_2_id != config.approver_2_id:
                batch.approver_2_id = config.approver_2_id
                changed = True
        if changed:
            self.batch_repo.commit()

    def get(self, batch_id: UUID, current_user: Optional[User] = None) -> Batch:
        batch = self.batch_repo.get_by_id(batch_id)
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if current_user and not self._is_unrestricted(current_user):
            scope_ids = set(self.user_repo.get_manager_scope_user_ids(current_user))
            is_assigned_approver = (
                (batch.status == "Approval 1 Pending" and batch.approver_1_id == current_user.id)
                or (batch.status == "Approval 2 Pending" and batch.approver_2_id == current_user.id)
            )
            if not scope_ids.intersection(self._batch_scope_user_ids(batch)) and not is_assigned_approver:
                raise HTTPException(status_code=404, detail="Batch not found")
        return batch

    @staticmethod
    def _batch_scope_user_ids(batch: Batch) -> set:
        return {
            user_id for user_id in {
                batch.primary_manager_id,
                batch.coordinator_id,
            } if user_id is not None
        }

    def _require_operational_scope(self, batch: Batch, current_user: User) -> None:
        if self._is_unrestricted(current_user):
            return
        scope_ids = set(self.user_repo.get_manager_scope_user_ids(current_user))
        if not scope_ids.intersection(self._batch_scope_user_ids(batch)):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only view or edit batches within your manager scope.",
            )

    def update(self, batch_id: UUID, batch_in: BatchUpdateRequest, current_user: User) -> Batch:
        batch = self.get(batch_id, current_user)
        self._require_operational_scope(batch, current_user)
        update_data = batch_in.model_dump(exclude_unset=True)
        if "training_days" in update_data and update_data["training_days"] is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="training_days cannot be null.",
            )
        if "training_days" in update_data:
            scheduled_days = self.batch_repo.get_scheduled_session_counts([batch.id]).get(batch.id, 0)
            if update_data["training_days"] < scheduled_days:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=(
                        f"training_days cannot be less than the {scheduled_days} "
                        "scheduled sessions already in the timetable."
                    ),
                )
        if (
            "end_date" in update_data
            and update_data["end_date"] is not None
            and batch.end_date is not None
            and BatchService._as_utc(update_data["end_date"]).date()
            < BatchService._as_utc(batch.end_date).date()
        ):
            new_end = BatchService._as_utc(update_data["end_date"]).date()
            offending = self.batch_repo.list_scheduled_sessions_after(batch.id, new_end)
            if offending:
                preview = "; ".join(
                    f"{session.session_date.isoformat()} '{session.module}'"
                    for session in offending[:3]
                )
                if len(offending) > 3:
                    preview = f"{preview} and {len(offending) - 3} more"
                detail = (
                    f"Cannot reduce end_date to {new_end.isoformat()}: {len(offending)} "
                    f"scheduled session(s) fall after it ({preview}). Delete them from the "
                    "Curriculum Schedule first."
                )
                undeliverable = [
                    session
                    for session in offending
                    if session.status == SessionStatus.Completed or len(session.utilizations) > 0
                ]
                if undeliverable:
                    detail += (
                        f" {len(undeliverable)} of these are completed or have a logged "
                        "delivery and cannot be deleted; the end date cannot be reduced past them."
                    )
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=detail,
                )
        finance_fields = {"finance_status", "finance_status_check_date"}
        if finance_fields.intersection(update_data):
            team_name = current_user.team_detail.name if current_user.team_detail else ""
            if team_name.strip().lower() != "finance" and (current_user.role or "").lower() != "admin":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only Finance team members can update finance fields."
                )
        if "start_date" in update_data or "end_date" in update_data:
            update_data["calendar_days"] = self._calendar_days(
                update_data.get("start_date", batch.start_date),
                update_data.get("end_date", batch.end_date),
            )
        if "delivery_mode" in update_data or "delivery_mode_id" in update_data:
            delivery_mode_val = update_data.pop("delivery_mode", None)
            delivery_mode_id = update_data.get("delivery_mode_id")
            if delivery_mode_id or delivery_mode_val:
                update_data["delivery_mode_id"] = self._option_id(DeliveryMode, delivery_mode_id, delivery_mode_val or "Online")

        # Ceiling check mirrors the create rule, but fires only when the pair
        # actually changes: the edit modal always sends the full form, so a
        # presence-based trigger would make batches with a legacy-violating
        # stored pair permanently uneditable.
        stored_days = batch.training_days or 0
        stored_hours = batch.total_hours or Decimal("0.00")
        eff_days = update_data["training_days"] if "training_days" in update_data else stored_days
        eff_hours = (
            Decimal(str(update_data["total_hours"]))
            if "total_hours" in update_data and update_data["total_hours"] is not None
            else Decimal(str(stored_hours))
        )
        if eff_days != stored_days or eff_hours != Decimal(str(stored_hours)):
            max_hours = self.batch_repo.get_delivery_mode_max_hours(
                update_data.get("delivery_mode_id") or batch.delivery_mode_id,
                batch.delivery_mode,
            ) or 8
            if eff_hours > eff_days * max_hours:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=(
                        f"Total hours cannot exceed training_days × max_hours_per_day "
                        f"({eff_days} × {max_hours} = {eff_days * max_hours})"
                    ),
                )

        # Handle faculty_members JSON serialization
        if "faculty_members" in update_data:
            update_data["faculty_members"] = json.dumps(update_data["faculty_members"])

        if batch.is_schema_locked and (current_user.role or "").lower() not in ["admin", "manager", "coordinator"]:
            restricted = {"client_name", "category", "program_name", "technology", "domain"}
            for field in restricted.intersection(update_data):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Batch schema is locked. Modifying '{field}' requires Manager or Admin authorization.")

        changed_fields = {
            field: {
                "before": self._history_value(getattr(batch, field)),
                "after": self._history_value(value),
            }
            for field, value in update_data.items()
            if field in self.REAPPROVAL_FIELDS
            and self._history_value(getattr(batch, field)) != self._history_value(value)
        }
        should_trigger_reapproval = bool(changed_fields)
        if should_trigger_reapproval and batch.status in {"Completed", "Cancelled"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Completed or cancelled batches cannot be changed.",
            )
        if should_trigger_reapproval:
            config = self.get_approval_config()
            if not config.approver_1_id or not config.approver_2_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Both approvers must be configured before batch changes can trigger re-approval."
                )

        has_effective_changes = any(
            self._history_value(getattr(batch, field)) != self._history_value(value)
            for field, value in update_data.items()
        )
        
        # Store changed_fields for notification and reapproval tracking
        batch._changed_fields_for_reapproval = changed_fields if should_trigger_reapproval else None
        batch._reapproval_triggered = should_trigger_reapproval
        
        if not has_effective_changes:
            return batch

        for field, value in update_data.items():
            setattr(batch, field, value)

        batch.updated_at = datetime.now(timezone.utc)

        if "training_days" in update_data or "end_date" in update_data:
            scheduled_count = self.batch_repo.get_scheduled_session_counts([batch.id]).get(batch.id, 0)
            batch.schedule_complete = (scheduled_count >= (batch.training_days or 0))

        if should_trigger_reapproval:
            # Increment reapproval count and set tracking fields
            batch.reapproval_count = (batch.reapproval_count or 0) + 1
            ist_tz = timezone(timedelta(hours=5, minutes=30))
            batch.last_reapproval_at = datetime.now(ist_tz)
            batch.last_reapproval_by = current_user.id
            batch.reapproval_changes = changed_fields
            
            batch.is_schema_locked = False
            batch.approver_1_status = "Pending"
            batch.approver_2_status = "Pending"
            batch.approver_1_id = config.approver_1_id
            batch.approver_2_id = config.approver_2_id
            batch.approver_1_approved_at = None
            batch.approver_2_approved_at = None
            batch.approval_id = None
            batch.status = "Approval 1 Pending"
            ist_tz = timezone(timedelta(hours=5, minutes=30))
            timestamp = datetime.now(ist_tz).strftime("%d-%m-%Y %H:%M IST")
            actor_name = current_user.full_name or current_user.email
            audit_entry = (
                f"[{timestamp} - Batch changed by {actor_name} ({current_user.role or 'User'})]: "
                f"Batch reset to Approval 1 Pending due to change(s): "
                f"{', '.join(sorted(changed_fields))}"
            )
            batch.remarks = f"{batch.remarks}\n{audit_entry}" if batch.remarks else audit_entry
            self.batch_repo.add_edit_history(BatchEditHistory(
                batch_id=batch.id,
                edited_by=current_user.id,
                changed_fields=changed_fields,
            ))

        return self._save(batch)

    def get_edit_history(self, batch_id: UUID, current_user: User) -> List[BatchEditHistory]:
        self.get(batch_id, current_user)
        return self.batch_repo.list_edit_history(batch_id)

    # Valid lifecycle status transitions
    # Key: current_status -> Set of allowed next statuses
    VALID_TRANSITIONS: dict[str, set[str]] = {
        "Requested": {"Approval 1 Pending", "OnHold", "Cancelled"},
        "Approval 1 Pending": {"Approval 2 Pending", "Rejected", "OnHold", "Cancelled"},
        "Approval 2 Pending": {"Upcoming", "Ongoing", "Rejected", "OnHold", "Cancelled"},
        "Upcoming": {"Ongoing", "OnHold", "Cancelled"},
        "Ongoing": {"Pending for Closure", "OnHold", "Cancelled"},
        "Pending for Closure": {"Completed", "OnHold", "Cancelled"},
        "Completed": {"OnHold"},
        "OnHold": {"Requested", "Approval 1 Pending", "Approval 2 Pending", "Upcoming", "Ongoing", "Cancelled"},
        "Cancelled": set(),
        "Rejected": {"Approval 1 Pending"},
    }

    # Statuses that require approval completion before entering
    APPROVAL_REQUIRED_STATUSES = {"Upcoming", "Ongoing", "Pending for Closure", "Completed"}

    def _get_resume_target_status(self, batch: Batch) -> str:
        """Determine the correct status when resuming from OnHold based on approval state."""
        if batch.approver_1_status == "Pending":
            return "Approval 1 Pending"
        if batch.approver_1_status == "Approved" and batch.approver_2_status == "Pending":
            return "Approval 2 Pending"
        if batch.approver_1_status == "Rejected" or batch.approver_2_status == "Rejected":
            return "Rejected"
        if batch.approver_1_status == "Approved" and batch.approver_2_status == "Approved":
            return "Upcoming"
        return "Approval 1 Pending"

    def _is_approval_complete(self, batch: Batch) -> bool:
        """Check if both approval levels are approved."""
        return batch.approver_1_status == "Approved" and batch.approver_2_status == "Approved"

    def update_lifecycle_status(self, batch_id: UUID, new_status: str, reason: str, current_user: User) -> Batch:
        batch = self.get(batch_id, current_user)
        self._require_operational_scope(batch, current_user)

        current_status = batch.status

        # Handle "Resume" special case - maps to resuming from OnHold
        if new_status == "Resume":
            if current_status != "OnHold":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Resume is only valid when batch is OnHold"
                )
            target_status = self._get_resume_target_status(batch)
        else:
            target_status = new_status

        if target_status == "Completed":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Batches can only be completed through Gate 2 NPS closure.",
            )

        # Validate transition is allowed
        allowed_next = self.VALID_TRANSITIONS.get(current_status, set())
        if target_status not in allowed_next:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status transition from '{current_status}' to '{target_status}'. "
                       f"Allowed: {', '.join(sorted(allowed_next))}"
            )

        # Prevent entering approval-required statuses without completed approvals
        if target_status in self.APPROVAL_REQUIRED_STATUSES and not self._is_approval_complete(batch):
            # Redirect to the appropriate approval pending status
            if batch.approver_1_status == "Pending":
                target_status = "Approval 1 Pending"
            elif batch.approver_1_status == "Approved" and batch.approver_2_status == "Pending":
                target_status = "Approval 2 Pending"
            elif batch.approver_1_status == "Rejected" or batch.approver_2_status == "Rejected":
                target_status = "Rejected"
            else:
                target_status = "Requested"

            # If the redirected status isn't allowed from current, that's an error
            if target_status not in allowed_next:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Cannot transition to '{new_status}': approvals not complete. "
                           f"Current approval state: Level 1={batch.approver_1_status}, Level 2={batch.approver_2_status}"
                )

        if not reason or len(reason.strip()) < 3:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A valid reason (minimum 3 characters) is required to update the batch lifecycle status."
            )

        ist_tz = timezone(timedelta(hours=5, minutes=30))
        timestamp = datetime.now(ist_tz).strftime("%d-%m-%Y %H:%M IST")
        actor_name = current_user.full_name or current_user.email
        audit_entry = f"[{timestamp} - Status changed from '{batch.status}' to '{target_status}' by {actor_name} ({current_user.role or 'User'})]: {reason.strip()}"

        batch.remarks = f"{batch.remarks}\n{audit_entry}" if batch.remarks else audit_entry
        batch.status = target_status
        batch.updated_at = datetime.now(timezone.utc)

        # Keep session outcomes consistent with the batch-level cancellation.
        # The cancellation reason is stored in batch.remarks only (not in faculty utilization).
        if target_status == "Cancelled":
            now = datetime.now(timezone.utc)
            for fs in self.batch_repo.list_non_terminal_faculty_sessions(batch.id):
                fs.status = SessionStatus.Cancelled
                fs.updated_at = now

            for ts in self.batch_repo.list_non_terminal_training_sessions(batch.id):
                ts.status = SessionStatus.Cancelled
                ts.updated_at = now

        return self._save(batch)

    def close_gate2(self, batch_id: UUID, closure: BatchNpsClosureCreate, user_id: UUID, current_user: Optional[User] = None) -> Batch:
        if current_user:
            self._require_operational_scope(self.get(batch_id, current_user), current_user)
        return self.gatekeeper.close_batch_gate2(
            batch_id=batch_id,
            closure_data=closure,
            user_id=user_id,
        )

    # --- Batch option catalogue (categories, delivery modes, entities, ...) ---
    def export_finance_batches(
        self,
        current_user: User,
        status_filter: Optional[str] = None,
        finance_status: Optional[str] = None,
        domain: Optional[str] = None,
        delivery_mode: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[Batch]:
        """Batches for the finance review export, scoped to the caller like `list()`."""
        return self.batch_repo.export_finance_rows(
            self._scope(current_user),
            finance_status=finance_status,
            domain=domain,
            delivery_mode_name=delivery_mode,
            start_date=start_date,
            end_date=end_date,
        )

    def list_options(self, option_model):
        option_type = self._option_type_name(option_model)
        cache_key = f"options:{option_type}"
        cached = self.cache.get("v1", cache_key)
        if cached:
            return json.loads(cached)

        result = self.batch_repo.list_active_options(option_model)
        data = [self._row_to_dict(r) for r in result]
        self.cache.set("v1", cache_key, json.dumps(data), ttl=600)
        return data

    def create_option(self, option_model, name: str, description: Optional[str] = None):
        clean_name = name.strip()
        if not clean_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Option name cannot be blank")
        if self.batch_repo.option_exists_by_name(option_model, clean_name):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An option with this name already exists")

        # Delivery mode carries a per-day hour ceiling that batch creation validates against.
        extra = {"max_hours_per_day": 8} if option_model is DeliveryMode else {}
        option = self.batch_repo.create_option_instance(option_model, clean_name, description, **extra)
        self.cache.delete("v1", f"options:{self._option_type_name(option_model)}")
        return option

    def update_option(self, option_model, option_id: UUID, name: str, description: Optional[str] = None):
        option = self.batch_repo.get_option_by_id(option_model, option_id)
        if not option:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Option not found")
        result = self.batch_repo.update_option_instance(option, name.strip(), description)
        self.cache.delete("v1", f"options:{self._option_type_name(option_model)}")
        return result

    def deactivate_option(self, option_model, option_id: UUID):
        option = self.batch_repo.get_option_by_id(option_model, option_id)
        if not option:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Option not found")
        self.batch_repo.deactivate_option_instance(option)
        self.cache.delete("v1", f"options:{self._option_type_name(option_model)}")
        return {"detail": "Option deactivated"}
