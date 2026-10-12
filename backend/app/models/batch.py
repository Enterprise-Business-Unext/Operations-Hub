from datetime import datetime, timezone
import uuid
from decimal import Decimal
from enum import Enum as PyEnum
from sqlalchemy import (
    Column, String, Boolean, Date, DateTime, Integer, Numeric, Text,
    ForeignKey, CheckConstraint, Index, Uuid, JSON, Enum
)
from sqlalchemy.orm import relationship
from app.core.database import Base


class BatchStatus(str, PyEnum):
    Requested = "Requested"
    Approval1Pending = "Approval 1 Pending"
    Approval2Pending = "Approval 2 Pending"
    Upcoming = "Upcoming"
    Ongoing = "Ongoing"
    PendingForClosure = "Pending for Closure"
    Completed = "Completed"
    OnHold = "OnHold"
    Cancelled = "Cancelled"
    Rejected = "Rejected"


class ApprovalStatus(str, PyEnum):
    Pending = "Pending"
    Approved = "Approved"
    Rejected = "Rejected"


class Batch(Base):
    __tablename__ = "batches"

    # Primary Key
    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Identifiers
    batch_id = Column(String(255), unique=True, index=True, nullable=False)  # Immutable locked ID e.g. DTA_PysparkScala_SOW56_ILT_B2
    sow_number = Column(String(100), nullable=True, index=True)  # Client-side SOW number
    approval_id = Column(String(100), nullable=True, index=True)  # Financial SOW Reference

    # Program & Category Classification
    category = Column(String(100), nullable=False, default="Bootcamp")  # Bootcamp, RBT, PJP, Workshop
    entity_id = Column(Uuid(as_uuid=True), ForeignKey("entities.id", ondelete="RESTRICT"), nullable=True, index=True)
    category_id = Column(Uuid(as_uuid=True), ForeignKey("batch_categories.id", ondelete="RESTRICT"), nullable=True, index=True)
    delivery_mode_id = Column(Uuid(as_uuid=True), ForeignKey("delivery_modes.id", ondelete="RESTRICT"), nullable=True, index=True)
    accommodation_id = Column(Uuid(as_uuid=True), ForeignKey("accommodations.id", ondelete="RESTRICT"), nullable=True, index=True)
    program_name = Column(String(255), nullable=False, index=True)
    technology = Column(String(255), nullable=True)  # PySpark, Databricks, Java FullStack
    domain = Column(String(100), nullable=True)  # IT/ITES, Cloud, DS/ML, CyberSecurity

    # Client Account
    client_name = Column(String(255), nullable=True, index=True)

    # Delivery Logistics & Timeline
    location_city = Column(String(100), nullable=True)  # Bengaluru, Hyderabad, Mumbai, Remote
    start_date = Column(DateTime(timezone=True), nullable=True, index=True)
    end_date = Column(DateTime(timezone=True), nullable=True, index=True)
    batch_request_date = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    training_days = Column(Integer, default=0, nullable=False)
    calendar_days = Column(Integer, default=0, nullable=True)
    total_hours = Column(Numeric(8, 2), default=Decimal("0.00"), nullable=False)

    # Student Headcount Breakdown
    total_enrollments = Column(Integer, default=0, nullable=False)

    # Lifecycle State & Governance Lock
    status = Column(Enum(BatchStatus), default=BatchStatus.Requested, nullable=False, index=True)
    is_schema_locked = Column(Boolean, default=False, nullable=False)
    schedule_complete = Column(Boolean, default=False, nullable=False)
    approver_1_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    approver_2_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    approver_1_status = Column(Enum(ApprovalStatus), default=ApprovalStatus.Pending, nullable=False)
    approver_2_status = Column(Enum(ApprovalStatus), default=ApprovalStatus.Pending, nullable=False)
    approver_1_approved_at = Column(DateTime(timezone=True), nullable=True)
    approver_2_approved_at = Column(DateTime(timezone=True), nullable=True)

    # Approver relationships. The FK columns above are not enough: notification
    # code resolves the approver User objects, and without these relationships
    # that access raised AttributeError and failed the whole request.
    approver_1 = relationship("User", foreign_keys=[approver_1_id])
    approver_2 = relationship("User", foreign_keys=[approver_2_id])

    # Reapproval Tracking
    reapproval_count = Column(Integer, default=0, nullable=False)
    last_reapproval_at = Column(DateTime(timezone=True), nullable=True)
    last_reapproval_by = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    reapproval_changes = Column(JSON, nullable=True)

    # Reapproval relationship
    last_reapproval_by_user = relationship("User", foreign_keys=[last_reapproval_by])

    @property
    def is_reapproval(self) -> bool:
        return (self.reapproval_count or 0) > 0

    # Ownership & Operational Roles
    primary_manager_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    coordinator_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    sales_spoc_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    faculty_members = Column(JSON, nullable=True, default=list)
    faculty_assigned_text = Column(String(500), nullable=True)  # Legacy raw faculty names string

    # Financial Milestone Status
    finance_status = Column(String(50), default="Pending", nullable=False)  # Pending, Cleared
    finance_status_check_date = Column(Date, nullable=True)
    finance_check = Column(Integer, nullable=True)

    # Quality Checkpoint Metrics (Gate 1 & Gate 2)
    batch_avg_feedback = Column(Numeric(3, 2), nullable=True)  # Average feedback score (1.0 - 5.0)
    batch_nps = Column(Numeric(6, 2), nullable=True)  # Calculated NPS (-100 to 100)
    nps_total_responses = Column(Integer, nullable=True)
    nps_promoters = Column(Integer, nullable=True)
    nps_passives = Column(Integer, nullable=True)
    nps_detractors = Column(Integer, nullable=True)

    # Remarks & Notes
    remarks = Column(Text, nullable=True)

    # Audit Timestamps (UTC)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False
    )

# Relationships
    primary_manager = relationship("User", foreign_keys=[primary_manager_id], back_populates="primary_managed_batches")
    coordinator = relationship("User", foreign_keys=[coordinator_id], back_populates="coordinated_batches")
    sales_spoc = relationship("User", foreign_keys=[sales_spoc_id], back_populates="sales_batches")
    entity = relationship("Entity", foreign_keys=[entity_id], lazy="joined")
    delivery_mode_detail = relationship("DeliveryMode", foreign_keys=[delivery_mode_id], lazy="joined")
    scheduled_sessions = relationship("TrainingSession", back_populates="batch", cascade="all, delete-orphan")
    faculty_utilizations = relationship("FacultyUtilization", back_populates="batch", cascade="all, delete-orphan")

    @property
    def delivery_mode(self) -> str:
        if getattr(self, "delivery_mode_detail", None) and getattr(self.delivery_mode_detail, "name", None):
            return self.delivery_mode_detail.name
        return getattr(self, "_delivery_mode_name", None) or "Online"

    @delivery_mode.setter
    def delivery_mode(self, value: str):
        self._delivery_mode_name = value

    @property
    def sessions_conducted(self) -> int:
        val = getattr(self, "_sessions_conducted", None)
        if val is not None:
            return val
        if self.status == "Completed":
            return self.training_days or 1
        return 0

    @sessions_conducted.setter
    def sessions_conducted(self, value: int):
        self._sessions_conducted = value

    @property
    def completion_rate(self) -> float:
        val = getattr(self, "_completion_rate", None)
        if val is not None:
            return val
        if self.status == "Completed":
            return 100.0
        conducted = self.sessions_conducted
        total = self.training_days or conducted or 1
        return round(min(100.0, (conducted / total) * 100.0), 1)

    @completion_rate.setter
    def completion_rate(self, value: float):
        self._completion_rate = value

    @property
    def scheduled_session_count(self) -> int:
        """Timetable rows for this batch, as computed by `BatchService.list()`.

        Defaults to 0 everywhere else (detail reads, scheduler, CSV export) so a
        batch without an ingested timetable reads as unscheduled rather than
        failing attribute lookup during response serialisation.
        """
        return getattr(self, "_scheduled_session_count", 0)

    @scheduled_session_count.setter
    def scheduled_session_count(self, value: int):
        self._scheduled_session_count = value


class BatchOptionMixin:
    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), unique=True, index=True, nullable=False)
    description = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)


class BatchCategory(BatchOptionMixin, Base):
    __tablename__ = "batch_categories"


class DeliveryMode(BatchOptionMixin, Base):
    __tablename__ = "delivery_modes"

    max_hours_per_day = Column(Integer, default=8, nullable=False)


class Accommodation(BatchOptionMixin, Base):
    __tablename__ = "accommodations"


class Entity(BatchOptionMixin, Base):
    __tablename__ = "entities"


class FacultyType(BatchOptionMixin, Base):
    __tablename__ = "faculty_types"


class Vertical(BatchOptionMixin, Base):
    __tablename__ = "verticals"


class ProgramType(BatchOptionMixin, Base):
    __tablename__ = "program_types"


class ApprovalConfiguration(Base):
    __tablename__ = "approval_configurations"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    approver_1_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approver_2_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
