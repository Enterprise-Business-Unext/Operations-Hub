from typing import Optional, List
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, EmailStr, ConfigDict


class TeamBase(BaseModel):
    name: str
    department: str = "Ops"
    description: Optional[str] = None
    is_active: bool = True


class TeamCreate(TeamBase):
    pass


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    department: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class TeamResponse(TeamBase):
    id: UUID
    member_count: Optional[int] = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RoleBase(BaseModel):
    name: str
    system_role: str = "Coordinator"  # Admin, Manager, Coordinator, Sales, Faculty
    is_active: bool = True


class RoleCreate(RoleBase):
    pass


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    system_role: Optional[str] = None
    is_active: Optional[bool] = None


class RoleResponse(RoleBase):
    id: UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    role: str = "Coordinator"  # Admin, Manager, Coordinator, Sales, Faculty
    role_id: Optional[UUID] = None
    team_id: Optional[UUID] = None
    manager_id: Optional[UUID] = None
    is_active: bool = True


class UserCreate(UserBase):
    password: str


class AdminUserCreate(UserBase):
    """Schema for admin creating a new user - password is auto-generated and emailed."""
    send_welcome_email: bool = True


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    role_id: Optional[UUID] = None
    team_id: Optional[UUID] = None
    manager_id: Optional[UUID] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class UserResponse(UserBase):
    id: UUID
    created_at: datetime
    role_detail: Optional[RoleResponse] = None
    team_detail: Optional[TeamResponse] = None
    team_name: Optional[str] = None
    department: Optional[str] = None
    manager_name: Optional[str] = None
    is_manager: bool = False
    direct_reports_count: int = 0
    is_configured_approver: bool = False

    model_config = ConfigDict(from_attributes=True)


class UserHierarchyNode(BaseModel):
    id: UUID
    full_name: str
    email: str
    role: str
    role_name: Optional[str] = None
    team_name: Optional[str] = None
    department: Optional[str] = None
    manager_id: Optional[UUID] = None
    direct_reports: List["UserHierarchyNode"] = []

    model_config = ConfigDict(from_attributes=True)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AdminResetPasswordRequest(BaseModel):
    new_password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    detail: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class ResetPasswordResponse(BaseModel):
    detail: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse


class TokenPayload(BaseModel):
    sub: Optional[str] = None
    role: Optional[str] = None
    exp: Optional[int] = None


class CoordinatorMappingCreate(BaseModel):
    coordinator_id: UUID
    manager_id: UUID


class CoordinatorMappingResponse(BaseModel):
    id: UUID
    coordinator_id: UUID
    manager_id: UUID
    assigned_at: datetime
    coordinator: Optional[UserResponse] = None
    manager: Optional[UserResponse] = None

    model_config = ConfigDict(from_attributes=True)


class CoordinatorMappingListResponse(BaseModel):
    """Flattened mapping response with coordinator and manager names for admin UI display."""
    id: UUID
    coordinator_id: UUID
    coordinator_name: Optional[str] = None
    coordinator_email: Optional[str] = None
    manager_id: UUID
    manager_name: Optional[str] = None
    manager_email: Optional[str] = None
    assigned_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuditLogResponse(BaseModel):
    """Audit log entry for admin panel display."""
    id: UUID
    event_type: str
    user_id: Optional[UUID] = None
    user_email: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    details: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

