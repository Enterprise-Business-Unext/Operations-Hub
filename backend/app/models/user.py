import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Uuid, Integer, Text, Enum as SQLEnum
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum


class AuditEventType(str, enum.Enum):
    LOGIN_SUCCESS = "login_success"
    LOGIN_FAILED = "login_failed"
    LOGOUT = "logout"
    PASSWORD_CHANGE = "password_change"
    PASSWORD_RESET_ADMIN = "password_reset_admin"
    PASSWORD_RESET_REQUESTED = "password_reset_requested"
    PASSWORD_RESET_REQUESTED_UNKNOWN_EMAIL = "password_reset_requested_unknown_email"
    ACCOUNT_LOCKED = "account_locked"
    ACCOUNT_UNLOCKED = "account_unlocked"
    USER_CREATED = "user_created"
    USER_UPDATED = "user_updated"
    USER_DELETED = "user_deleted"
    ROLE_ASSIGNED = "role_assigned"
    REFRESH_TOKEN_USED = "refresh_token_used"
    REFRESH_TOKEN_FAILED = "refresh_token_failed"


class Team(Base):
    __tablename__ = "teams"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), unique=True, index=True, nullable=False)
    department = Column(String(100), nullable=False, default="Ops")
    description = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    users = relationship("User", back_populates="team_detail")


class Role(Base):
    __tablename__ = "roles"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), unique=True, index=True, nullable=False)
    system_role = Column(String(50), nullable=False, default="Coordinator")
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    users = relationship("User", back_populates="role_detail")


class User(Base):
    __tablename__ = "users"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="Coordinator")
    role_id = Column(Uuid(as_uuid=True), ForeignKey("roles.id", ondelete="SET NULL"), nullable=True, index=True)
    team_id = Column(Uuid(as_uuid=True), ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True)
    manager_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    role_detail = relationship("Role", foreign_keys=[role_id], back_populates="users")
    team_detail = relationship("Team", foreign_keys=[team_id], back_populates="users")

    # Self-referencing reporting hierarchy
    manager = relationship("User", remote_side=[id], back_populates="direct_reports", foreign_keys=[manager_id])
    direct_reports = relationship("User", back_populates="manager", foreign_keys=[manager_id])

    # Backward-compatible mappings
    managed_coordinators = relationship(
        "UserManagerMapping",
        foreign_keys="UserManagerMapping.manager_id",
        back_populates="manager",
        cascade="all, delete-orphan"
    )
    assigned_managers = relationship(
        "UserManagerMapping",
        foreign_keys="UserManagerMapping.coordinator_id",
        back_populates="coordinator",
        cascade="all, delete-orphan"
    )

    primary_managed_batches = relationship("Batch", foreign_keys="Batch.primary_manager_id", back_populates="primary_manager")
    coordinated_batches = relationship("Batch", foreign_keys="Batch.coordinator_id", back_populates="coordinator")
    sales_batches = relationship("Batch", foreign_keys="Batch.sales_spoc_id", back_populates="sales_spoc")


class UserManagerMapping(Base):
    __tablename__ = "user_manager_mappings"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    coordinator_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    manager_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    assigned_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    coordinator = relationship("User", foreign_keys=[coordinator_id], back_populates="assigned_managers")
    manager = relationship("User", foreign_keys=[manager_id], back_populates="managed_coordinators")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type = Column(SQLEnum(AuditEventType), nullable=False, index=True)
    user_id = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    user_email = Column(String(255), nullable=True, index=True)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)

    user = relationship("User", foreign_keys=[user_id])
