from typing import Generator, List, Optional, Set
from sqlalchemy import text
from uuid import UUID
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User
from app.api.v1.auth.repository import UserRepository

security_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme)
) -> User:
    token = credentials.credentials if credentials else None
    if not token:
        token = request.cookies.get("auth_token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials or token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token or expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    try:
        user_uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user identity format",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = UserRepository(db).get_active_by_id(user_uuid)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found or inactive",
        )
    return user


def require_roles(allowed_roles: List[str]):
    allowed_lower = {r.lower() for r in allowed_roles}
    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        user_role = (current_user.role or "").lower()
        if user_role not in allowed_lower:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access forbidden: requires one of roles [{', '.join(allowed_roles)}]. Current role: {current_user.role}",
            )
        return current_user
    return role_checker


# Convenient role dependencies
require_admin = require_roles(["Admin"])
require_manager_or_admin = require_roles(["Admin", "Manager"])
require_coordinator_or_above = require_roles(["Admin", "Manager", "Coordinator"])


def get_all_subordinate_ids(manager_id: UUID, db: Session) -> List[UUID]:
    """Return all direct and indirect subordinate UUIDs under a manager.

    Combines both the self-referential User.manager_id hierarchy and the legacy UserManagerMapping table.
    """
    return UserRepository(db).get_all_subordinate_ids(manager_id)


def get_managed_coordinator_ids(manager_id: UUID, db: Session) -> List[UUID]:
    """Return only coordinators under a manager, excluding other managers and unrelated roles."""
    return UserRepository(db).get_managed_coordinator_ids(manager_id)


def get_manager_scope_user_ids(user: User, db: Session) -> List[UUID]:
    """Return the operational ownership scope for a user."""
    return UserRepository(db).get_manager_scope_user_ids(user)


def is_manager_or_lead(user: User, db: Session) -> bool:
    """Returns True if user is automatically identified as a Manager (has direct reports) or has Manager/Admin role."""
    if (user.role or "").lower() in ["admin", "manager"]:
        return True
    return UserRepository(db).has_direct_reports(user.id)
