from app.models.user import (
    User,
    UserManagerMapping,
    Role,
    Team,
    AuditEventType,
    AuditLog,
)
from app.models.batch import (
    Batch,
    BatchCategory,
    DeliveryMode,
    Accommodation,
    Entity,
    ApprovalConfiguration,
    FacultyType,
    Vertical,
    ProgramType,
)
from app.models.session import TrainingSession, FacultyUtilization
from app.models.batch_edit import BatchEditHistory

# Every mapped class must be imported here. `alembic/env.py` and revision
# 0001's `Base.metadata.create_all()` both rely on this module to populate
# `target_metadata`; a model that is missing from these imports is silently
# absent from autogenerate and from a fresh `alembic upgrade head`.
__all__ = [
    "User",
    "UserManagerMapping",
    "Role",
    "Team",
    "AuditEventType",
    "AuditLog",
    "Batch",
    "BatchCategory",
    "DeliveryMode",
    "Accommodation",
    "Entity",
    "ApprovalConfiguration",
    "FacultyType",
    "Vertical",
    "ProgramType",
    "TrainingSession",
    "FacultyUtilization",
    "BatchEditHistory",
]
