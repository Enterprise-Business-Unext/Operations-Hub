from typing import List, Any, Optional
from fastapi import APIRouter, Depends, Query, HTTPException, status, Request
from uuid import UUID
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.models.user import User
from app.schemas.user import (
    UserCreate, UserUpdate, UserResponse, UserLogin, Token, TokenPair,
    CoordinatorMappingCreate, CoordinatorMappingResponse, CoordinatorMappingListResponse, UserHierarchyNode,
    ChangePasswordRequest, AdminResetPasswordRequest, AdminUserCreate, AuditLogResponse
)
from app.api.deps import get_current_user, require_admin, require_manager_or_admin, require_coordinator_or_above
from app.api.deps_services import get_auth_service
from app.api.v1.auth.service import AuthService

router = APIRouter()


class RefreshTokenRequest(BaseModel):
    refresh_token: str


def get_client_info(request: Request) -> dict:
    return {
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent")
    }


@router.post("/login", response_model=TokenPair)
def login(
    login_data: UserLogin, 
    request: Request,
    service: AuthService = Depends(get_auth_service)
) -> Any:
    client = get_client_info(request)
    return service.authenticate(login_data, ip_address=client["ip_address"], user_agent=client["user_agent"])


@router.post("/refresh", response_model=TokenPair)
def refresh_token(
    data: RefreshTokenRequest,
    request: Request,
    service: AuthService = Depends(get_auth_service)
) -> Any:
    """Generate new access token using refresh token."""
    client = get_client_info(request)
    return service.refresh_tokens(data.refresh_token, ip_address=client["ip_address"], user_agent=client["user_agent"])


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user), service: AuthService = Depends(get_auth_service)) -> Any:
    """Fetch profile of authenticated user."""
    return service._enrich_user(current_user)


@router.post("/change-password")
def change_my_password(
    data: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
) -> Any:
    """Authenticated User: Change own account password."""
    client = get_client_info(request)
    return service.change_my_password(current_user, data, ip_address=client["ip_address"], user_agent=client["user_agent"])



@router.get("/my-reports", response_model=List[UserResponse])
def get_my_reports(current_user: User = Depends(get_current_user), service: AuthService = Depends(get_auth_service)) -> Any:
    """Fetch list of active users reporting directly to the authenticated user."""
    return service.list_direct_reports(current_user)


@router.get("/users", response_model=List[UserResponse], dependencies=[Depends(require_manager_or_admin)])
def list_users(service: AuthService = Depends(get_auth_service)) -> Any:
    """Admin Only: List all organization users with their assigned roles."""
    return service.list_all_users()


@router.post("/users", response_model=UserResponse, dependencies=[Depends(require_admin)])
def create_user(
    user_in: UserCreate,
    service: AuthService = Depends(get_auth_service),
    current_user: User = Depends(require_admin),
) -> Any:
    """Admin Only: Create a new user with an explicitly chosen password."""
    return service.create_user(user_in)


@router.get("/users/assignable", response_model=List[UserResponse])
def list_assignable_users(
    role: str = Query(..., pattern="^(Sales|Coordinator|Manager)$"),
    team_name: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
) -> Any:
    return service.list_assignable_users(role, team_name=team_name)


@router.get("/hierarchy", response_model=List[UserHierarchyNode], dependencies=[Depends(get_current_user)])
def get_organization_hierarchy(service: AuthService = Depends(get_auth_service)) -> Any:
    """Fetch the full organization reporting tree."""
    return service.get_organization_hierarchy()


@router.post("/users/admin-create", dependencies=[Depends(require_admin)])
def create_user_by_admin(
    user_in: AdminUserCreate,
    request: Request,
    service: AuthService = Depends(get_auth_service),
    current_user: User = Depends(require_admin),
) -> Any:
    """Admin Only: Create a new user with auto-generated password and send welcome email."""
    client = get_client_info(request)
    return service.create_user_by_admin(user_in, admin_user=current_user, ip_address=client["ip_address"], user_agent=client["user_agent"])


@router.patch("/users/{id}", response_model=UserResponse, dependencies=[Depends(require_admin)])
def update_user(
    id: UUID,
    user_in: UserUpdate,
    service: AuthService = Depends(get_auth_service),
    current_user: User = Depends(require_admin),
) -> Any:
    """Admin Only: Update a staff member's account and organization assignments."""
    return service.update_user(id, user_in)


@router.post("/users/{id}/change-password", dependencies=[Depends(require_admin)])
def admin_change_user_password(
    id: UUID,
    data: AdminResetPasswordRequest,
    request: Request,
    service: AuthService = Depends(get_auth_service),
    current_user: User = Depends(require_admin),
) -> Any:
    """Admin Only: Reset or change password for any user in the organization."""
    client = get_client_info(request)
    return service.admin_reset_user_password(id, data.new_password, admin_user=current_user, ip_address=client["ip_address"], user_agent=client["user_agent"])



@router.delete("/users/{id}", dependencies=[Depends(require_admin)])
def delete_user(
    id: UUID,
    service: AuthService = Depends(get_auth_service),
    current_user: User = Depends(require_admin),
) -> Any:
    """Admin Only: Delete a staff member's account."""
    if id == current_user.id:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own admin account")
    return service.delete_user(id)


@router.get("/users/coordinators", response_model=List[UserResponse], dependencies=[Depends(require_coordinator_or_above)])
def get_coordinators(
    service: AuthService = Depends(get_auth_service),
    current_user: User = Depends(get_current_user)
) -> Any:
    return service.list_coordinators(current_user)


@router.post("/users/coordinator-mapping", response_model=CoordinatorMappingResponse, dependencies=[Depends(require_admin)])
def assign_coordinator_to_manager(
    mapping_in: CoordinatorMappingCreate,
    service: AuthService = Depends(get_auth_service),
    current_user: User = Depends(get_current_user)
) -> Any:
    """Admin Only: Assign a coordinator to a manager (shared coordinator mapping)."""
    return service.assign_coordinator(mapping_in)


@router.get("/coordinator-mappings", response_model=List[CoordinatorMappingListResponse], dependencies=[Depends(require_admin)])
def list_coordinator_mappings(
    service: AuthService = Depends(get_auth_service),
) -> Any:
    """Admin Only: List all existing coordinator-manager assignments."""
    return service.list_mappings()


@router.delete("/coordinator-mappings/{mapping_id}", dependencies=[Depends(require_admin)])
def delete_coordinator_mapping(
    mapping_id: UUID,
    service: AuthService = Depends(get_auth_service),
) -> Any:
    """Admin Only: Remove a coordinator-manager assignment by its mapping ID."""
    return service.delete_mapping(mapping_id)


@router.get("/audit-logs", response_model=List[AuditLogResponse], dependencies=[Depends(require_admin)])
def get_audit_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    service: AuthService = Depends(get_auth_service),
) -> Any:
    """Admin Only: Retrieve audit logs with pagination."""
    return service.get_audit_logs(skip=skip, limit=limit)
