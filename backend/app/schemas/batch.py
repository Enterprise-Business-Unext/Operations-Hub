from typing import Optional, List, Any, Literal
from uuid import UUID
from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
from app.schemas.user import UserResponse
import json


class BatchCreateRequest(BaseModel):
    """Payload accepted by POST /batches.

    Declared explicitly rather than inherited from a shared base: this is the
    create contract only. Lifecycle, approval, finance and quality-gate fields
    are owned by the server and must never arrive from the client, so they are
    absent here by design.
    """

    model_config = ConfigDict(extra="forbid")

    # Identification and classification
    batch_id: str = Field(..., min_length=3, max_length=255, description="Unique immutable batch identifier")
    sow_number: Optional[str] = Field(None, max_length=100, description="Client-side SOW number")
    program_name: str = Field(..., min_length=2, max_length=255)
    category: str = Field("Bootcamp", description="Legacy category name, used only when category_id is absent")
    entity_id: Optional[UUID] = None
    category_id: Optional[UUID] = None
    delivery_mode_id: Optional[UUID] = None
    delivery_mode: Optional[str] = Field("Online", description="Legacy delivery mode name, used only when delivery_mode_id is absent")
    accommodation_id: Optional[UUID] = None
    technology: Optional[str] = Field(None, max_length=255)
    domain: Optional[str] = Field(None, max_length=100)
    client_name: Optional[str] = Field(None, max_length=255)
    location_city: Optional[str] = Field(None, max_length=100)

    # Schedule
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None

    # Effort and headcount
    training_days: int = Field(0, ge=0)
    total_hours: Decimal = Field(Decimal("0.00"), ge=Decimal("0.00"))
    total_enrollments: int = Field(0, ge=0)

    # Ownership
    primary_manager_id: UUID
    coordinator_id: UUID
    sales_spoc_id: UUID

    # Faculty and notes
    faculty_assigned_text: Optional[str] = Field(None, max_length=500)
    faculty_members: List[dict] = Field(default_factory=list, description="Array of faculty member objects with name, email, etc.")
    remarks: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def sanitize_inputs(cls, data: Any) -> Any:
        if isinstance(data, dict):
            cleaned = {}
            for k, v in data.items():
                if isinstance(v, str):
                    s = v.strip()
                    cleaned[k] = s if s else None
                else:
                    cleaned[k] = v
            if "sow_number" in cleaned and cleaned["sow_number"] is not None:
                cleaned["sow_number"] = str(cleaned["sow_number"]).strip()
            # Parse faculty_members if it's a JSON string
            if "faculty_members" in cleaned and isinstance(cleaned["faculty_members"], str):
                try:
                    cleaned["faculty_members"] = json.loads(cleaned["faculty_members"])
                except json.JSONDecodeError:
                    cleaned["faculty_members"] = []
            return cleaned
        return data

    @model_validator(mode="after")
    def validate_dates(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            self.end_date = self.start_date
        return self

    @model_validator(mode="after")
    def validate_create_dates(self):
        today = datetime.now().date()

        # start_date must be >= today (date only)
        if self.start_date and self.start_date.date() < today:
            raise ValueError("Commencement date cannot be in the past")

        # end_date must be >= start_date (same date allowed = 1 calendar day)
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("End date must be on or after start date")

        # training_days must be > 0 and <= calendar_days
        if self.training_days <= 0:
            raise ValueError("Training days must be greater than 0")
        if self.start_date and self.end_date:
            calendar_days = (self.end_date.date() - self.start_date.date()).days
            if calendar_days == 0:
                calendar_days = 1  # same start and end date = 1 calendar day
            if self.training_days > calendar_days:
                raise ValueError("Training days must be between 1 and calendar days")

        # total_hours must be > 0
        if self.total_hours <= 0:
            raise ValueError("Total hours must be greater than 0")

        # total_enrollments must be >= 1
        if self.total_enrollments < 1:
            raise ValueError("At least 1 candidate required")

        # faculty_members array must have at least 1 item
        if not self.faculty_members or len(self.faculty_members) == 0:
            raise ValueError("At least one proposed faculty member required")

        return self



class BatchApprove(BaseModel):
    approval_id: str = Field(..., min_length=3, max_length=100, description="Financial SOW or Manager Approval Reference")


class ApprovalDecision(BaseModel):
    decision: str = Field(..., pattern="^(approve|reject)$")
    reason: Optional[str] = Field(None, max_length=1000)


class ApprovalConfigurationBase(BaseModel):
    approver_1_id: Optional[UUID] = None
    approver_2_id: Optional[UUID] = None

    @model_validator(mode="before")
    @classmethod
    def sanitize_inputs(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {
                k: (v.strip() if isinstance(v, str) and v.strip() else None if isinstance(v, str) else v)
                for k, v in data.items()
            }
        return data


class ApprovalConfigurationResponse(ApprovalConfigurationBase):
    id: UUID
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BatchLifecycleStatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(OnHold|Cancelled|Upcoming|Ongoing|Requested|Approval 1 Pending|Approval 2 Pending|Rejected|Resume)$", description="Target lifecycle status")
    reason: str = Field(..., min_length=3, max_length=1000, description="Mandatory reason/justification for status change")


class BatchUpdateRequest(BaseModel):
    """Payload accepted by PATCH /batches/{id}.

    Editable fields only. batch_request_date and calendar_days are excluded
    because they are server-owned/derived; the service recomputes calendar_days
    from start_date and end_date.
    """

    model_config = ConfigDict(extra="forbid")

    sow_number: Optional[str] = Field(None, max_length=100)
    approval_id: Optional[str] = Field(None, max_length=100)
    category: Optional[str] = None
    entity_id: Optional[UUID] = None
    category_id: Optional[UUID] = None
    delivery_mode_id: Optional[UUID] = None
    delivery_mode: Optional[str] = None
    accommodation_id: Optional[UUID] = None
    program_name: Optional[str] = Field(None, min_length=2, max_length=255)
    technology: Optional[str] = Field(None, max_length=255)
    domain: Optional[str] = Field(None, max_length=100)
    client_name: Optional[str] = Field(None, max_length=255)
    location_city: Optional[str] = Field(None, max_length=100)
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    training_days: Optional[int] = Field(None, ge=0)
    total_hours: Optional[Decimal] = Field(None, ge=Decimal("0.00"))
    total_enrollments: Optional[int] = Field(None, ge=0)
    status: Optional[str] = None
    primary_manager_id: Optional[UUID] = None
    coordinator_id: Optional[UUID] = None
    sales_spoc_id: Optional[UUID] = None
    faculty_assigned_text: Optional[str] = Field(None, max_length=500)
    faculty_members: Optional[List[dict]] = None
    finance_status: Optional[str] = Field(None, pattern="^(Pending|Cleared)$")
    finance_status_check_date: Optional[date] = None
    remarks: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def sanitize_inputs(cls, data: Any) -> Any:
        if isinstance(data, dict):
            cleaned = {}
            for k, v in data.items():
                if isinstance(v, str):
                    s = v.strip()
                    cleaned[k] = s if s else None
                else:
                    cleaned[k] = v
            if "sow_number" in cleaned and cleaned["sow_number"] is not None:
                cleaned["sow_number"] = str(cleaned["sow_number"]).strip()
            # Parse faculty_members if it's a JSON string
            if "faculty_members" in cleaned and isinstance(cleaned["faculty_members"], str):
                try:
                    cleaned["faculty_members"] = json.loads(cleaned["faculty_members"])
                except json.JSONDecodeError:
                    cleaned["faculty_members"] = []
            return cleaned
        return data

    @model_validator(mode="after")
    def validate_dates(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")

        return self


class BatchResponse(BaseModel):
    """Read model for GET /batches.

    Declared standalone on purpose. A shared "base" schema applied write-time
    constraints (patterns, min_length, ge=...) to stored rows as well, and any
    legacy value outside those constraints raised ResponseValidationError -
    a 500 that the browser then reported as a CORS failure.
    """

    id: UUID
    batch_id: str
    sow_number: Optional[str] = None
    approval_id: Optional[str] = None
    category: str = "Bootcamp"
    entity_id: Optional[UUID] = None
    category_id: Optional[UUID] = None
    delivery_mode_id: Optional[UUID] = None
    delivery_mode: Optional[str] = "Online"
    accommodation_id: Optional[UUID] = None
    program_name: str
    technology: Optional[str] = None
    domain: Optional[str] = None
    client_name: Optional[str] = None
    location_city: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    batch_request_date: Optional[datetime] = None
    training_days: int = 0
    calendar_days: Optional[int] = 0
    total_hours: Decimal = Decimal("0.00")
    total_enrollments: int = 0
    status: str = "Requested"
    primary_manager_id: Optional[UUID] = None
    coordinator_id: Optional[UUID] = None
    sales_spoc_id: Optional[UUID] = None
    faculty_assigned_text: Optional[str] = None
    faculty_members: List[dict] = Field(default_factory=list)
    finance_status: str = "Pending"
    finance_status_check_date: Optional[date] = None
    remarks: Optional[str] = None
    is_schema_locked: bool
    approver_1_id: Optional[UUID] = None
    approver_2_id: Optional[UUID] = None
    approver_1_status: str = "Pending"
    approver_2_status: str = "Pending"
    approver_1_approved_at: Optional[datetime] = None
    approver_2_approved_at: Optional[datetime] = None
    batch_avg_feedback: Optional[Decimal] = None
    batch_nps: Optional[Decimal] = None
    nps_total_responses: Optional[int] = None
    nps_promoters: Optional[int] = None
    nps_passives: Optional[int] = None
    nps_detractors: Optional[int] = None
    primary_manager: Optional[UserResponse] = None
    coordinator: Optional[UserResponse] = None
    sales_spoc: Optional[UserResponse] = None
    sessions_conducted: Optional[int] = 0
    completion_rate: Optional[float] = 0.0
    scheduled_session_count: int = 0
    schedule_complete: bool = False
    created_at: datetime
    updated_at: datetime
    # Reapproval fields
    reapproval_count: int = 0
    is_reapproval: bool = False
    last_reapproval_at: Optional[datetime] = None
    last_reapproval_by: Optional[UUID] = None
    reapproval_changes: Optional[dict[str, dict[str, Any]]] = None

    @field_validator("faculty_members", mode="before")
    @classmethod
    def normalize_faculty_members(cls, value: Any) -> Any:
        """The column is nullable and may hold legacy JSON text; never fail the
        whole list response on it."""
        if value is None:
            return []
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                return []
        return value if isinstance(value, list) else []

    model_config = ConfigDict(from_attributes=True)


class BatchDetailResponse(BatchResponse):
    primary_manager: Optional[UserResponse] = None
    coordinator: Optional[UserResponse] = None
    sales_spoc: Optional[UserResponse] = None

    model_config = ConfigDict(from_attributes=True)


class BatchEditHistoryResponse(BaseModel):
    id: UUID
    batch_id: UUID
    edited_by: Optional[UUID] = None
    editor_name: Optional[str] = None
    changed_fields: dict[str, dict[str, Any]]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Program Type Schemas (Admin-editable options for Faculty Utilization)
# ============================================================================

class ProgramTypeBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=255)
    is_active: bool = True


class ProgramTypeCreate(ProgramTypeBase):
    pass


class ProgramTypeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None


class ProgramTypeResponse(ProgramTypeBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Active Batches Schemas (for /batches/active endpoint)
# ============================================================================

class ActiveBatchItem(BaseModel):
    id: str
    batch_id: str
    program_name: str
    client_name: Optional[str]
    category: str
    delivery_mode: str
    location_city: Optional[str]
    start_date: Optional[str]
    end_date: Optional[str]
    status: str
    total_enrollments: int
    training_days: int
    sessions_conducted: int
    progress: float  # computed: (sessions_conducted / training_days) * 100
    batch_avg_feedback: Optional[Decimal] = None
    batch_nps: Optional[Decimal] = None

    model_config = ConfigDict(from_attributes=True)


class ActiveSessionItem(BaseModel):
    id: str
    batch_id: str
    batch_name: str
    session_type: Literal["scheduled", "actual"]  # "scheduled" = TrainingSession, "actual" = FacultyUtilization
    sequence_number: Optional[int]
    module: str
    trainer_name: Optional[str]
    faculty_name: Optional[str]
    session_date: str
    start_time: Optional[str]
    end_time: Optional[str]
    duration_hours: float
    status: str
    venue: Optional[str]
    location_city: Optional[str]
    mode_of_delivery: Optional[str]

    model_config = ConfigDict(from_attributes=True)


class ActiveBatchesResponse(BaseModel):
    filter_date: str
    batches: List[ActiveBatchItem]
    sessions: List[ActiveSessionItem]
    total_batches: int
    total_sessions: int
    skip: int
    limit: int
    session_skip: int
    session_limit: int

    model_config = ConfigDict(from_attributes=True)