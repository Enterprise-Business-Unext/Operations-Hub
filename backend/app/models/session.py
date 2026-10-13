import uuid
from datetime import datetime, timezone, time, date
from decimal import Decimal
from enum import Enum as PyEnum

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Numeric, String, Text, Time, Uuid, UniqueConstraint, Enum
from sqlalchemy.orm import relationship

from app.core.database import Base


class SessionStatus(str, PyEnum):
    Scheduled = "Scheduled"
    InProgress = "InProgress"
    Completed = "Completed"
    Cancelled = "Cancelled"
    NotConducted = "Not Conducted"
    Rescheduled = "Rescheduled"


TERMINAL_UTILIZATION_STATUSES = frozenset({
    SessionStatus.Completed,
    SessionStatus.Cancelled,
    SessionStatus.NotConducted,
})
ACTIVE_UTILIZATION_STATUSES = frozenset({
    SessionStatus.Scheduled,
    SessionStatus.InProgress,
    SessionStatus.Completed,
})


class TrainingSession(Base):
    """Stores the ingested day-wise curriculum schedule for a batch."""
    __tablename__ = "training_sessions"
    __table_args__ = (
        UniqueConstraint("batch_id", "session_date", "module", name="uq_batch_date_module"),
    )

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id = Column(Uuid(as_uuid=True), ForeignKey("batches.id", ondelete="CASCADE"), nullable=False, index=True)
    session_date = Column(Date, nullable=False, index=True)
    day_name = Column(String(20), nullable=True)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    duration_hours = Column(Numeric(5, 2), nullable=False, default=Decimal("8.0"))
    module = Column(Text, nullable=False)
    trainer_name = Column(String(255), nullable=True, index=True)
    status = Column(Enum(SessionStatus), default=SessionStatus.Scheduled, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    batch = relationship("Batch", back_populates="scheduled_sessions")
    utilizations = relationship("FacultyUtilization", back_populates="training_session")

    @property
    def effective_status(self) -> str:
        """Compute effective status based on session_date and stored status."""
        today = datetime.now(timezone.utc).date()
        if self.status == "Completed":
            return "Completed"
        session_date = self.session_date
        if session_date > today:
            return "Upcoming"
        elif session_date == today:
            return "Ongoing"
        else:  # session_date < today
            return "Overdue"


class FacultyUtilization(Base):
    """Tracks actual delivery, attendance, timesheet hours, and feedback ratings per faculty session."""
    __tablename__ = "faculty_utilization"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id = Column(Uuid(as_uuid=True), ForeignKey("batches.id", ondelete="CASCADE"), nullable=False, index=True)
    training_session_id = Column(Uuid(as_uuid=True), ForeignKey("training_sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    faculty_name = Column(String(255), nullable=False, index=True)
    date_of_training = Column(DateTime(timezone=True), nullable=False, index=True)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    topic = Column(Text, nullable=False)
    no_of_hours = Column(Numeric(5, 2), nullable=False, default=Decimal("8.0"))
    venue = Column(String(255), nullable=True)
    location_city = Column(String(100), nullable=True)
    mode_of_delivery = Column(String(50), nullable=False, default="Online")
    status = Column(Enum(SessionStatus), default=SessionStatus.Scheduled, nullable=False, index=True)
    feedback_submitted = Column(Boolean, nullable=False, default=False)
    feedback_rating = Column(Numeric(3, 2), nullable=True)
    feedback_notes = Column(Text, nullable=True)
    outcome_reason = Column(Text, nullable=True)
    outcome_at = Column(DateTime(timezone=True), nullable=True)
    outcome_by = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    vertical = Column(String(50), nullable=True)
    program_type_id = Column(Uuid(as_uuid=True), ForeignKey("program_types.id", ondelete="SET NULL"), nullable=True, index=True)
    faculty_type_id = Column(Uuid(as_uuid=True), ForeignKey("faculty_types.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    batch = relationship("Batch", back_populates="faculty_utilizations")
    training_session = relationship("TrainingSession", foreign_keys=[training_session_id], back_populates="utilizations")
    program_type = relationship("ProgramType", foreign_keys=[program_type_id], lazy="joined")
    faculty_type = relationship("FacultyType", foreign_keys=[faculty_type_id], lazy="joined")

    coordinator_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    coordinator = relationship("User", foreign_keys=[coordinator_id], lazy="joined")

    @property
    def faculty_type_name(self) -> str | None:
        """Display name for the selected faculty type, resolved from the roster."""
        return self.faculty_type.name if self.faculty_type else None

    # Batch context for the utilization ledger. Client, category, batch code and
    # coordinator are facts about the batch, not about the delivery, so they are
    # resolved through the relationship instead of being denormalised onto every
    # ledger row (which would let them drift out of sync with the batch).

    @property
    def client(self) -> str | None:
        return self.batch.client_name if self.batch else None

    @property
    def category(self) -> str | None:
        return self.batch.category if self.batch else None

    @property
    def batch_code(self) -> str | None:
        return self.batch.batch_id if self.batch else None

    @property
    def coordinator(self) -> str | None:
        return self.batch.coordinator.full_name if self.batch and self.batch.coordinator else None

    @property
    def coordinator_name(self) -> str | None:
        return self.coordinator.full_name if self.coordinator else None

    @property
    def module_feedback(self) -> str | None:
        """Per-delivery feedback on the module that was taught."""
        return self.feedback_notes

    @property
    def entity(self) -> str | None:
        return self.batch.entity.name if self.batch and self.batch.entity else None

    @property
    def program(self) -> str | None:
        return self.batch.program_name if self.batch else None
