import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, JSON, Uuid
from sqlalchemy.orm import relationship

from app.core.database import Base


class BatchEditHistory(Base):
    __tablename__ = "batch_edit_history"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id = Column(Uuid(as_uuid=True), ForeignKey("batches.id", ondelete="CASCADE"), nullable=False, index=True)
    edited_by = Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    changed_fields = Column(JSON, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    editor = relationship("User", foreign_keys=[edited_by], lazy="joined")

    @property
    def editor_name(self):
        return self.editor.full_name if self.editor else None
