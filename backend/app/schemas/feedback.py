from typing import Optional
from uuid import UUID
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, Field, ConfigDict, model_validator


class SessionFeedbackCreate(BaseModel):
    """Payload required for Quality Gate 1"""
    rating: Decimal = Field(..., ge=Decimal("1.0"), le=Decimal("5.0"), description="Rating between 1.0 and 5.0")
    topic_feedback: str = Field(..., min_length=3, description="Topic delivery notes and summary")
    faculty_observations: Optional[str] = None
    total_students_present: int = Field(default=0, ge=0)


class SessionFeedbackResponse(BaseModel):
    id: UUID
    session_id: UUID
    rating: Decimal
    topic_feedback: Optional[str] = None
    faculty_observations: Optional[str] = None
    total_students_present: int
    submitted_at: datetime
    submitted_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


class BatchNpsClosureCreate(BaseModel):
    """Payload required for Quality Gate 2.

    Only the three NPS category counts are accepted when NPS is available.
    The index itself, the total and the average batch feedback are derived
    server-side so a client cannot assert its own NPS.

    When NPS is not available, `nps_available` must be false and
    `nps_unavailable_reason` must be provided (min 3 characters).
    """
    promoters_count: int = Field(default=0, ge=0, description="Responses scoring 9-10")
    passive_count: int = Field(default=0, ge=0, description="Responses scoring 7-8")
    detractors_count: int = Field(default=0, ge=0, description="Responses scoring 0-6")
    nps_available: bool = Field(default=True, description="Whether NPS responses are available")
    nps_unavailable_reason: Optional[str] = Field(default=None, min_length=3, description="Reason why NPS is not available (required when nps_available=false)")

    @model_validator(mode="after")
    def validate_nps_available(self):
        if not self.nps_available and not self.nps_unavailable_reason:
            raise ValueError("nps_unavailable_reason is required when nps_available is false")
        return self
