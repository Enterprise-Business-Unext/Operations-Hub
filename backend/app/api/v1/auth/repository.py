import logging
from typing import List, Optional, Set
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.user import (
    AuditEventType,
    AuditLog,
    Role,
    Team,
    User,
    UserManagerMapping,
)
from app.models.batch import ApprovalConfiguration
from app.api.v1.auth.repository_interfaces import IUserRepository

logger = logging.getLogger(__name__)


class UserRepository(IUserRepository):
    def __init__(self, db: Session):
        self.db = db

    # --- User lookups ---
    def get_by_id(self, user_id: UUID) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id).first()

    def get_active_by_id(self, user_id: UUID) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id, User.is_active == True).first()

    def get_by_email(self, email: str) -> Optional[User]:
        return self.db.query(User).filter(func.lower(User.email) == func.lower(email)).first()

    def exists_by_email(self, email: str, exclude_id: Optional[UUID] = None) -> bool:
        query = self.db.query(User).filter(func.lower(User.email) == func.lower(email))
        if exclude_id:
            query = query.filter(User.id != exclude_id)
        return query.first() is not None

    def list_all(self) -> List[User]:
        return self.db.query(User).order_by(User.created_at.desc()).all()

    def list_active(self) -> List[User]:
        return self.db.query(User).filter(User.is_active == True).all()

    def list_by_role(self, role: str) -> List[User]:
        return self.db.query(User).filter(
            User.role == role,
            User.is_active == True,
        ).order_by(User.full_name).all()

    def list_by_team_name(self, team_name: str) -> List[User]:
        return (
            self.db.query(User)
            .join(Team, User.team_id == Team.id)
            .filter(
                Team.name == team_name,
                User.is_active == True,
            )
            .order_by(User.full_name)
            .all()
        )

    def list_by_ids(self, user_ids: List[UUID]) -> List[User]:
        if not user_ids:
            return []
        return self.db.query(User).filter(User.id.in_(user_ids)).all()

    # --- Reporting hierarchy ---
    def list_direct_reports(self, manager_id: UUID) -> List[User]:
        return self.db.query(User).filter(
            User.manager_id == manager_id,
            User.is_active == True,
        ).all()

    def has_direct_reports(self, manager_id: UUID) -> bool:
        return self.db.query(User.id).filter(
            User.manager_id == manager_id,
            User.is_active == True,
        ).first() is not None

    def get_all_subordinate_ids(self, manager_id: UUID) -> List[UUID]:
        """Breadth-first walk over both hierarchy representations.

        The self-referential ``User.manager_id`` tree and the legacy
        ``UserManagerMapping`` table are both traversed, so a coordinator reaches
        their manager regardless of which mechanism recorded the assignment.
        """
        subordinates: Set[UUID] = set()
        queue = [manager_id]
        visited = {manager_id}

        while queue:
            current_id = queue.pop(0)

            direct_reports = self.db.query(User.id).filter(
                User.manager_id == current_id,
                User.is_active == True,
            ).all()

            mapped_reports = self.db.query(UserManagerMapping.coordinator_id).filter(
                UserManagerMapping.manager_id == current_id,
            ).all()

            for (sub_id,) in direct_reports + mapped_reports:
                if sub_id and sub_id not in visited:
                    visited.add(sub_id)
                    subordinates.add(sub_id)
                    queue.append(sub_id)

        return list(subordinates)

    def get_managed_coordinator_ids(self, manager_id: UUID) -> List[UUID]:
        subordinate_ids = self.get_all_subordinate_ids(manager_id)
        if not subordinate_ids:
            return []

        rows = self.db.query(User.id).filter(
            User.id.in_(subordinate_ids),
            User.role == "Coordinator",
            User.is_active == True,
        ).all()
        return [UUID(str(row[0])) for row in rows]

    def get_manager_ids_for_coordinator(self, coordinator_id: UUID) -> List[UUID]:
        manager_ids: Set[UUID] = set()
        mapped = self.db.query(UserManagerMapping.manager_id).filter(
            UserManagerMapping.coordinator_id == coordinator_id,
        ).all()
        manager_ids.update(manager_id for manager_id, in mapped)
        return list(manager_ids)

    def get_manager_scope_user_ids(self, user: User) -> List[UUID]:
        role = (user.role or "").lower()

        if role == "manager":
            scope_ids: Set[UUID] = {user.id}
            scope_ids.update(self.get_managed_coordinator_ids(user.id))
            return list(scope_ids)

        if role != "coordinator":
            return [user.id]

        manager_ids: Set[UUID] = set()
        if user.manager_id:
            manager_ids.add(user.manager_id)
        manager_ids.update(self.get_manager_ids_for_coordinator(user.id))
        if not manager_ids:
            return [user.id]

        # Coordinators under the same manager share operational batch visibility.
        scope_ids = {user.id}
        for manager_id in manager_ids:
            scope_ids.add(manager_id)
            scope_ids.update(self.get_managed_coordinator_ids(manager_id))
        return list(scope_ids)

    # --- Role and team lookups ---
    def get_role_by_id(self, role_id: UUID) -> Optional[Role]:
        return self.db.query(Role).filter(Role.id == role_id).first()

    def get_role_by_name(self, name: str) -> Optional[Role]:
        return self.db.query(Role).filter(Role.name.ilike(name)).first()

    def get_team_by_id(self, team_id: UUID) -> Optional[Team]:
        return self.db.query(Team).filter(Team.id == team_id).first()

    def get_approval_config(self) -> Optional[ApprovalConfiguration]:
        return self.db.query(ApprovalConfiguration).first()

    # --- Mutations ---
    def create(self, user: User) -> User:
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def update(self, user: User, **fields) -> User:
        for key, value in fields.items():
            setattr(user, key, value)
        self.db.commit()
        self.db.refresh(user)
        return user

    def delete(self, user: User) -> None:
        self.db.delete(user)
        self.db.commit()

    def commit(self) -> None:
        self.db.commit()

    def rollback(self) -> None:
        self.db.rollback()

    # --- Coordinator <-> manager mappings ---
    def get_mapping_by_id(self, mapping_id: UUID) -> Optional[UserManagerMapping]:
        return self.db.query(UserManagerMapping).filter(UserManagerMapping.id == mapping_id).first()

    def get_mapping_by_pair(self, coordinator_id: UUID, manager_id: UUID) -> Optional[UserManagerMapping]:
        return self.db.query(UserManagerMapping).filter(
            UserManagerMapping.coordinator_id == coordinator_id,
            UserManagerMapping.manager_id == manager_id,
        ).first()

    def list_mappings(self) -> List[UserManagerMapping]:
        return self.db.query(UserManagerMapping).order_by(UserManagerMapping.assigned_at.desc()).all()

    def create_mapping(self, mapping: UserManagerMapping) -> UserManagerMapping:
        self.db.add(mapping)
        self.db.commit()
        self.db.refresh(mapping)
        return mapping

    def delete_mapping(self, mapping: UserManagerMapping) -> None:
        self.db.delete(mapping)
        self.db.commit()

    # --- Audit ---
    def log_audit_event(
        self,
        event_type: AuditEventType,
        user_id: Optional[UUID] = None,
        user_email: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        details: Optional[str] = None,
    ) -> None:
        try:
            self.db.add(AuditLog(
                event_type=event_type,
                user_id=user_id,
                user_email=user_email,
                ip_address=ip_address,
                user_agent=user_agent,
                details=details,
            ))
        except Exception as e:
            # Audit logging must never break the caller or rollback main transaction.
            logger.error("Audit logging failure: %s", str(e))

    def get_audit_logs(self, skip: int = 0, limit: int = 100) -> List[AuditLog]:
        return (
            self.db.query(AuditLog)
            .order_by(AuditLog.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )