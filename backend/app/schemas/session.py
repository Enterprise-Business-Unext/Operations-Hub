from typing import Any, Optional, List, Literal
from uuid import UUID
from datetime import datetime, time, date
from decimal import Decimal
from pydantic import BaseModel, Field, ConfigDict, model_validator
from app.schemas.user import UserResponse
from app.schemas.feedback import SessionFeedbackResponse


SessionStatus = Literal["Scheduled", "InProgress", "Completed", "Cancelled", "Not Conducted", "Rescheduled"]


# ============================================================================
# Scheduled Training Session Schemas (Curriculum Schedule from Ingested Excel)
# ============================================================================

class TrainingSessionBase(BaseModel):
    batch_id: UUID
    session_date: date
    day_name: Optional[str] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    duration_hours: Decimal = Field(default=Decimal("8.0"), gt=Decimal("0.0"), le=Decimal("24.0"))
    module: str
    trainer_name: Optional[str] = None
    status: SessionStatus = "Scheduled"

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
            # If day_name not given, infer from session_date
            if "session_date" in cleaned and isinstance(cleaned["session_date"], (date, datetime)) and not cleaned.get("day_name"):
                d = cleaned["session_date"]
                cleaned["day_name"] = d.strftime("%A")
            return cleaned
        return data


class TrainingSessionCreate(TrainingSessionBase):
    pass


class TrainingSessionUpdate(BaseModel):
    session_date: Optional[date] = None
    day_name: Optional[str] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    duration_hours: Optional[Decimal] = None
    module: Optional[str] = None
    trainer_name: Optional[str] = None
    status: Optional[SessionStatus] = None


class TrainingSessionResponse(TrainingSessionBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    utilization_logged: Optional[bool] = False
    utilization_id: Optional[UUID] = None
    actual_trainer: Optional[str] = None
    actual_hours: Optional[Decimal] = None

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Faculty Utilization Schemas (Delivery Ledger, Attendance & Timesheet)
# ============================================================================

class SessionBase(BaseModel):
    batch_id: UUID
    training_session_id: Optional[UUID] = None
    date_of_training: datetime  # TIMESTAMPTZ UTC
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    topic: str
    faculty_name: str
    no_of_hours: Decimal = Field(default=Decimal("8.0"), gt=Decimal("0.0"), le=Decimal("24.0"))
    venue: Optional[str] = None
    location_city: Optional[str] = None
    mode_of_delivery: str = "Online"  # Online, Offline, F2F, Blended
    status: SessionStatus = "Scheduled"
    feedback_submitted: Optional[bool] = False
    feedback_rating: Optional[Decimal] = None
    feedback_notes: Optional[str] = None
    outcome_reason: Optional[str] = None
    vertical: Optional[str] = None  # Delivery vertical, e.g. IT/ITES
    program_type_id: Optional[UUID] = None
    faculty_type_id: Optional[UUID] = None  # Engagement type, from faculty_types
    coordinator_id: Optional[UUID] = None

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
            if "date" in cleaned and not cleaned.get("date_of_training"):
                cleaned["date_of_training"] = cleaned["date"]
            return cleaned
        return data


class SessionCreate(SessionBase):
    @model_validator(mode="after")
    def validate_training_session_id(self):
        # `Completed` may be logged directly at create time (the log form's
        # feedback section becomes that day's feedback of record). The update
        # path still routes completion through Gate 1 (sessions/service.py).
        if self.status in ("Cancelled", "Not Conducted") and len((self.outcome_reason or "").strip()) < 3:
            raise ValueError("outcome_reason is required for Cancelled or Not Conducted sessions")
        return self


class SessionUpdate(BaseModel):
    training_session_id: Optional[UUID] = None
    date_of_training: Optional[datetime] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    topic: Optional[str] = None
    faculty_name: Optional[str] = None
    no_of_hours: Optional[Decimal] = None
    venue: Optional[str] = None
    location_city: Optional[str] = None
    mode_of_delivery: Optional[str] = None
    status: Optional[SessionStatus] = None
    feedback_submitted: Optional[bool] = None
    feedback_rating: Optional[Decimal] = None
    feedback_notes: Optional[str] = None
    outcome_reason: Optional[str] = None
    vertical: Optional[str] = None
    program_type_id: Optional[UUID] = None
    faculty_type_id: Optional[UUID] = None
    coordinator_id: Optional[UUID] = None

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
            return cleaned
        return data


class SessionResponse(SessionBase):
    id: UUID
    feedback_submitted: bool
    feedback_rating: Optional[Decimal] = None
    feedback_notes: Optional[str] = None
    outcome_reason: Optional[str] = None
    outcome_at: Optional[datetime] = None
    outcome_by: Optional[UUID] = None
    vertical: Optional[str] = None
    program_type_id: Optional[UUID] = None
    faculty_type_id: Optional[UUID] = None
    faculty_type_name: Optional[str] = None  # Resolved display name
    coordinator_id: Optional[UUID] = None
    coordinator_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SessionDetailResponse(SessionResponse):
    feedback: Optional[SessionFeedbackResponse] = None
    # Batch-related fields for display. `batch_id` is deliberately NOT redeclared
    # here: SessionBase already types it as the batches.id UUID, and shadowing it
    # with Optional[str] made every /sessions response fail validation against the
    # ORM row. The human-readable code is `batch_code`.
    entity: Optional[str] = None
    category: Optional[str] = None
    client: Optional[str] = None
    program: Optional[str] = None
    batch_code: Optional[str] = None
    coordinator: Optional[str] = None
    module_feedback: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# Aliases for clear semantic naming
FacultyUtilizationBase = SessionBase
FacultyUtilizationCreate = SessionCreate
FacultyUtilizationUpdate = SessionUpdate
FacultyUtilizationResponse = SessionResponse
FacultyUtilizationDetailResponse = SessionDetailResponse


class SessionCancelRequest(BaseModel):
    reason: str = Field(min_length=3)


class SessionRescheduleRequest(BaseModel):
    date_of_training: datetime
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    reason: str = Field(min_length=3)
