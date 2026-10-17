from typing import List, Optional, Any
from uuid import UUID
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user import User
from app.schemas.user import RoleCreate, RoleUpdate, RoleResponse
from app.api.deps import get_current_user, require_admin, require_manager_or_admin
from app.api.deps_services import get_cache
from app.api.v1.roles.repository import RoleRepository
from app.api.v1.roles.repository_interfaces import IRoleRepository
from app.api.v1.roles.service import RoleService
from app.core.cache import RedisCacheService

router = APIRouter()


def get_role_repository(db: Session = Depends(get_db)) -> IRoleRepository:
    return RoleRepository(db)


def get_role_service(role_repo: IRoleRepository = Depends(get_role_repository), cache: RedisCacheService = Depends(get_cache)) -> RoleService:
    return RoleService(role_repo, cache)


@router.get("", response_model=List[RoleResponse])
def list_roles(
    is_active: Optional[bool] = Query(None),
    service: RoleService = Depends(get_role_service),
    current_user: User = Depends(require_manager_or_admin)
) -> Any:
    """List all configured organizational roles and position titles."""
    return service.list_roles(is_active=is_active)


@router.post("", response_model=RoleResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def create_role(
    role_in: RoleCreate,
    service: RoleService = Depends(get_role_service),
    current_user: User = Depends(require_admin)
) -> Any:
    """Admin Only: Add a new organizational role / position title."""
    return service.create_role(role_in)


@router.get("/{id}", response_model=RoleResponse)
def get_role_by_id(
    id: UUID,
    service: RoleService = Depends(get_role_service),
    current_user: User = Depends(require_manager_or_admin)
) -> Any:
    """Fetch details of a specific role by ID."""
    return service.get_role(id)


@router.patch("/{id}", response_model=RoleResponse, dependencies=[Depends(require_admin)])
def update_role(
    id: UUID,
    role_in: RoleUpdate,
    service: RoleService = Depends(get_role_service),
    current_user: User = Depends(require_admin)
) -> Any:
    """Admin Only: Update role name, base system role capability, or active status."""
    return service.update_role(id, role_in)


@router.delete("/{id}", dependencies=[Depends(require_admin)])
def delete_role(
    id: UUID,
    service: RoleService = Depends(get_role_service),
    current_user: User = Depends(require_admin)
) -> Any:
    """Admin Only: Delete a role if no active users are assigned to it."""
    return service.delete_role(id)
