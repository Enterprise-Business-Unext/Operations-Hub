from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException, status

from app.core.security import (
    create_access_token, create_refresh_token, get_password_hash, verify_password, validate_password_strength,
    decode_refresh_token
)
from app.core.config import settings
from app.core.email import generate_random_password, email_service
from app.models.user import User, UserManagerMapping, AuditEventType, AuditLog
from app.schemas.user import (
    CoordinatorMappingCreate, UserCreate, UserLogin, UserResponse, UserHierarchyNode, UserUpdate,
    ChangePasswordRequest, AdminResetPasswordRequest, TokenPair, AdminUserCreate
)
from app.api.v1.auth.repository_interfaces import IUserRepository


class AuthService:
    def __init__(self, user_repo: IUserRepository):
        self.user_repo = user_repo

    def authenticate(self, login_data: UserLogin, ip_address: Optional[str] = None, user_agent: Optional[str] = None) -> dict:
        user = self.user_repo.get_by_email(login_data.email)

        # Check account lockout
        if user and user.locked_until and user.locked_until > datetime.now(timezone.utc):
            self.user_repo.log_audit_event(
                AuditEventType.LOGIN_FAILED,
                user_id=user.id, user_email=user.email,
                ip_address=ip_address, user_agent=user_agent,
                details="Account locked"
            )
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail=f"Account temporarily locked. Try again after {user.locked_until.strftime('%H:%M:%S UTC')}"
            )

        if not user or not verify_password(login_data.password, user.hashed_password):
            # Increment failed attempts
            if user:
                user.failed_login_attempts += 1
                if user.failed_login_attempts >= settings.MAX_FAILED_LOGIN_ATTEMPTS:
                    self.user_repo.log_audit_event(
                        AuditEventType.ACCOUNT_LOCKED,
                        user_id=user.id, user_email=user.email,
                        ip_address=ip_address, user_agent=user_agent,
                        details=f"Account locked after {user.failed_login_attempts} failed attempts"
                    )
                    user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=settings.LOCKOUT_DURATION_MINUTES)
                self.user_repo.commit()

            self.user_repo.log_audit_event(
                AuditEventType.LOGIN_FAILED,
                user_id=user.id if user else None, user_email=login_data.email,
                ip_address=ip_address, user_agent=user_agent,
                details=f"Invalid password (attempt {user.failed_login_attempts if user else 1})"
            )
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password")

        if not user.is_active:
            self.user_repo.log_audit_event(
                AuditEventType.LOGIN_FAILED,
                user_id=user.id, user_email=user.email,
                ip_address=ip_address, user_agent=user_agent,
                details="Inactive account"
            )
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user account")

        # Reset failed attempts on successful login
        was_locked = user.locked_until is not None
        self.user_repo.update(
            user,
            failed_login_attempts=0,
            locked_until=None,
            last_login_at=datetime.now(timezone.utc),
        )

        if was_locked:
            self.user_repo.log_audit_event(
                AuditEventType.ACCOUNT_UNLOCKED,
                user_id=user.id, user_email=user.email,
                ip_address=ip_address, user_agent=user_agent,
                details="Account unlocked by successful login"
            )

        self.user_repo.log_audit_event(
            AuditEventType.LOGIN_SUCCESS,
            user_id=user.id, user_email=user.email,
            ip_address=ip_address, user_agent=user_agent,
            details="User logged in successfully"
        )

        # Enrich user response
        user_resp = self._enrich_user(user)
        return {
            "access_token": create_access_token(subject=str(user.id), role=user.role),
            "refresh_token": create_refresh_token(subject=str(user.id)),
            "token_type": "bearer",
            "user": user_resp,
        }

    def _enrich_user(self, user: User) -> UserResponse:
        direct_reports = self.user_repo.list_direct_reports(user.id)
        approval_config = self.user_repo.get_approval_config()

        resp = UserResponse.model_validate(user)
        resp.manager_name = user.manager.full_name if user.manager else None
        resp.is_manager = len(direct_reports) > 0 or (user.role or "").lower() in ["admin", "manager"]
        resp.direct_reports_count = len(direct_reports)
        resp.team_name = user.team_detail.name if user.team_detail else None
        resp.department = user.team_detail.department if user.team_detail else None
        resp.is_configured_approver = bool(
            approval_config
            and user.id in {approval_config.approver_1_id, approval_config.approver_2_id}
        )
        return resp

    def _resolve_role(self, role_id: Optional[UUID], role_name: Optional[str]) -> tuple:
        """Resolve (role_id, system_role) from an explicit role_id or a role name."""
        if role_id:
            role_obj = self.user_repo.get_role_by_id(role_id)
            if not role_obj:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selected role not found")
            return role_obj.id, role_obj.system_role

        role_obj = self.user_repo.get_role_by_name(role_name) if role_name else None
        if role_obj:
            return role_obj.id, role_obj.system_role
        return role_id, role_name

    def _validate_team_and_manager(self, team_id: Optional[UUID], manager_id: Optional[UUID]) -> None:
        if team_id and not self.user_repo.get_team_by_id(team_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selected team not found")

        if manager_id and not self.user_repo.get_by_id(manager_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assigned manager not found")

    def create_user(self, user_in: UserCreate) -> UserResponse:
        # Validate password strength
        password_errors = validate_password_strength(user_in.password)
        if password_errors:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(password_errors))

        if self.user_repo.exists_by_email(user_in.email):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User with this email already exists")

        role_id, resolved_system_role = self._resolve_role(user_in.role_id, user_in.role)
        self._validate_team_and_manager(user_in.team_id, user_in.manager_id)

        user = User(
            email=user_in.email,
            hashed_password=get_password_hash(user_in.password),
            full_name=user_in.full_name,
            role=resolved_system_role,
            role_id=role_id,
            team_id=user_in.team_id,
            manager_id=user_in.manager_id,
            is_active=user_in.is_active,
        )
        return self._enrich_user(self.user_repo.create(user))

    def create_user_by_admin(self, user_in: AdminUserCreate, admin_user: User, ip_address: Optional[str] = None, user_agent: Optional[str] = None) -> dict:
        """Admin creates a new user with auto-generated password and sends welcome email."""
        if self.user_repo.exists_by_email(user_in.email):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User with this email already exists")

        role_id, resolved_system_role = self._resolve_role(user_in.role_id, user_in.role)
        self._validate_team_and_manager(user_in.team_id, user_in.manager_id)

        # Generate random password
        plain_password = generate_random_password()

        user = User(
            email=user_in.email,
            hashed_password=get_password_hash(plain_password),
            full_name=user_in.full_name,
            role=resolved_system_role,
            role_id=role_id,
            team_id=user_in.team_id,
            manager_id=user_in.manager_id,
            is_active=user_in.is_active,
        )
        user = self.user_repo.create(user)

        # Log audit event
        self.user_repo.log_audit_event(
            AuditEventType.USER_CREATED,
            user_id=user.id, user_email=user.email,
            ip_address=ip_address, user_agent=user_agent,
            details=f"User created by admin {admin_user.email}"
        )

        # Send welcome email if requested
        email_sent = False
        if user_in.send_welcome_email:
            import asyncio
            try:
                email_sent = asyncio.run(email_service.send_welcome_email(
                    to_email=user.email,
                    full_name=user.full_name,
                    password=plain_password
                ))
            except Exception as e:
                print(f"[EMAIL] Failed to send welcome email: {e}")
                email_sent = False

        return {
            "user": self._enrich_user(user),
            "password": plain_password,
            "email_sent": email_sent
        }

    def update_user(self, user_id: UUID, user_in: UserUpdate) -> UserResponse:
        user = self.user_repo.get_by_id(user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

        update_data = user_in.model_dump(exclude_unset=True)

        if "email" in update_data:
            email = str(update_data["email"]).lower().strip()
            if self.user_repo.exists_by_email(email, exclude_id=user_id):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User with this email already exists")
            user.email = email

        if "full_name" in update_data:
            full_name = (update_data["full_name"] or "").strip()
            if not full_name:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Full name cannot be blank")
            user.full_name = full_name

        if "role_id" in update_data or "role" in update_data:
            role_id = update_data.get("role_id")
            role_obj = self.user_repo.get_role_by_id(role_id) if role_id else None
            if role_id and not role_obj:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selected role not found")
            if role_obj:
                user.role_id = role_obj.id
                user.role = role_obj.system_role
            elif "role" in update_data and update_data["role"]:
                user.role = update_data["role"]
                user.role_id = None

        if "team_id" in update_data:
            if update_data["team_id"] and not self.user_repo.get_team_by_id(update_data["team_id"]):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selected team not found")
            user.team_id = update_data["team_id"]

        if "manager_id" in update_data:
            manager_id = update_data["manager_id"]
            if manager_id == user_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user cannot report to themselves")
            if manager_id and not self.user_repo.get_by_id(manager_id):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assigned manager not found")
            user.manager_id = manager_id

        if "is_active" in update_data and update_data["is_active"] is not None:
            user.is_active = update_data["is_active"]
        if "password" in update_data and update_data["password"]:
            password_errors = validate_password_strength(update_data["password"])
            if password_errors:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(password_errors))
            user.hashed_password = get_password_hash(update_data["password"])

        self.user_repo.update(user)
        return self._enrich_user(user)

    def delete_user(self, user_id: UUID) -> dict:
        user = self.user_repo.get_by_id(user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

        email = user.email
        self.user_repo.delete(user)
        return {"detail": f"User '{email}' successfully deleted"}

    def change_my_password(self, user: User, data: ChangePasswordRequest, ip_address: Optional[str] = None, user_agent: Optional[str] = None) -> dict:
        if not verify_password(data.current_password, user.hashed_password):
            self.user_repo.log_audit_event(
                AuditEventType.PASSWORD_CHANGE,
                user_id=user.id, user_email=user.email,
                ip_address=ip_address, user_agent=user_agent,
                details="Failed: incorrect current password"
            )
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

        password_errors = validate_password_strength(data.new_password)
        if password_errors:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(password_errors))

        self.user_repo.update(user, hashed_password=get_password_hash(data.new_password))

        self.user_repo.log_audit_event(
            AuditEventType.PASSWORD_CHANGE,
            user_id=user.id, user_email=user.email,
            ip_address=ip_address, user_agent=user_agent,
            details="Password changed by user"
        )
        return {"detail": "Password successfully updated"}

    def admin_reset_user_password(self, user_id: UUID, new_password: str, admin_user: Optional[User] = None, ip_address: Optional[str] = None, user_agent: Optional[str] = None) -> dict:
        user = self.user_repo.get_by_id(user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

        password_errors = validate_password_strength(new_password)
        if password_errors:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="; ".join(password_errors))

        # Resetting also unlocks the account if it was locked.
        was_locked = user.locked_until is not None
        self.user_repo.update(
            user,
            hashed_password=get_password_hash(new_password),
            failed_login_attempts=0,
            locked_until=None,
        )

        self.user_repo.log_audit_event(
            AuditEventType.PASSWORD_RESET_ADMIN,
            user_id=user.id, user_email=user.email,
            ip_address=ip_address, user_agent=user_agent,
            details=f"Password reset by admin {admin_user.email if admin_user else 'unknown'}" + (" (account unlocked)" if was_locked else "")
        )
        return {"detail": f"Password for '{user.email}' successfully updated"}

    def refresh_tokens(self, refresh_token: str, ip_address: Optional[str] = None, user_agent: Optional[str] = None) -> TokenPair:
        """Generate new access token from refresh token."""
        payload = decode_refresh_token(refresh_token)
        if not payload:
            self.user_repo.log_audit_event(
                AuditEventType.REFRESH_TOKEN_FAILED,
                ip_address=ip_address, user_agent=user_agent,
                details="Invalid or expired refresh token"
            )
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

        user_id = payload.get("sub")
        if not user_id:
            self.user_repo.log_audit_event(
                AuditEventType.REFRESH_TOKEN_FAILED,
                ip_address=ip_address, user_agent=user_agent,
                details="Invalid token payload"
            )
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

        user = self.user_repo.get_active_by_id(UUID(user_id))
        if not user:
            self.user_repo.log_audit_event(
                AuditEventType.REFRESH_TOKEN_FAILED,
                ip_address=ip_address, user_agent=user_agent,
                details="User not found or inactive"
            )
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found or inactive")

        user_resp = self._enrich_user(user)

        self.user_repo.log_audit_event(
            AuditEventType.REFRESH_TOKEN_USED,
            user_id=user.id, user_email=user.email,
            ip_address=ip_address, user_agent=user_agent,
            details="Access token refreshed"
        )

        return TokenPair(
            access_token=create_access_token(subject=str(user.id), role=user.role),
            refresh_token=create_refresh_token(subject=str(user.id)),
            token_type="bearer",
            user=user_resp,
        )

    def list_all_users(self) -> List[UserResponse]:
        return [self._enrich_user(u) for u in self.user_repo.list_all()]

    def list_direct_reports(self, current_user: User) -> List[UserResponse]:
        """Active users reporting directly to the given user."""
        return [self._enrich_user(u) for u in self.user_repo.list_direct_reports(current_user.id)]

    def list_assignable_users(self, role: str, team_name: Optional[str] = None) -> List[User]:
        """Active users holding the given system role or belonging to the given team, for owner pickers."""
        if team_name:
            return self.user_repo.list_by_team_name(team_name)
        return self.user_repo.list_by_role(role)

    def get_user_profile(self, user_id: UUID) -> UserResponse:
        user = self.user_repo.get_by_id(user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return self._enrich_user(user)

    def get_organization_hierarchy(self) -> List[Dict[str, Any]]:
        """Returns the full hierarchical tree of the organization."""
        all_users = self.user_repo.list_active()

        # Build node dictionary
        nodes: Dict[UUID, Dict[str, Any]] = {}
        for u in all_users:
            nodes[u.id] = {
                "id": u.id,
                "full_name": u.full_name,
                "email": u.email,
                "role": u.role,
                "role_name": u.role_detail.name if u.role_detail else u.role,
                "team_name": u.team_detail.name if u.team_detail else None,
                "department": u.team_detail.department if u.team_detail else None,
                "manager_id": u.manager_id,
                "direct_reports": []
            }

        # Build trees
        root_nodes = []
        for u in all_users:
            if u.manager_id and u.manager_id in nodes:
                nodes[u.manager_id]["direct_reports"].append(nodes[u.id])
            else:
                root_nodes.append(nodes[u.id])

        return root_nodes

    def list_coordinators(self, current_user: User) -> List[UserResponse]:
        role = (current_user.role or "").lower()

        if role == "admin":
            return [self._enrich_user(c) for c in self.user_repo.list_by_role("Coordinator")]

        if role == "manager":
            # All direct & indirect reports
            sub_ids = self.user_repo.get_managed_coordinator_ids(current_user.id)
            return [self._enrich_user(c) for c in self.user_repo.list_by_ids(sub_ids)]

        if role == "coordinator":
            # Coordinators see all coordinators under their manager (including themselves)
            if current_user.manager_id:
                sub_ids = self.user_repo.get_managed_coordinator_ids(current_user.manager_id)
                return [self._enrich_user(c) for c in self.user_repo.list_by_ids(sub_ids)]
            return [self._enrich_user(current_user)]

        return []

    def assign_coordinator(self, mapping_in: CoordinatorMappingCreate) -> UserManagerMapping:
        coordinator = self.user_repo.get_by_id(mapping_in.coordinator_id)
        if not coordinator or coordinator.role != "Coordinator":
            raise HTTPException(status_code=404, detail="Coordinator not found")

        manager = self.user_repo.get_by_id(mapping_in.manager_id)
        if not manager or manager.role not in ("Manager", "Admin"):
            raise HTTPException(status_code=404, detail="Manager not found")

        # Also update self-referential manager_id for direct alignment
        coordinator.manager_id = manager.id

        existing = self.user_repo.get_mapping_by_pair(mapping_in.coordinator_id, mapping_in.manager_id)
        if existing:
            self.user_repo.commit()
            return existing

        return self.user_repo.create_mapping(UserManagerMapping(
            coordinator_id=mapping_in.coordinator_id,
            manager_id=mapping_in.manager_id,
        ))

    def list_mappings(self):
        """List all coordinator-manager mappings with names enriched (Admin only)."""
        from app.schemas.user import CoordinatorMappingListResponse
        return [
            CoordinatorMappingListResponse(
                id=m.id,
                coordinator_id=m.coordinator_id,
                coordinator_name=m.coordinator.full_name if m.coordinator else None,
                coordinator_email=m.coordinator.email if m.coordinator else None,
                manager_id=m.manager_id,
                manager_name=m.manager.full_name if m.manager else None,
                manager_email=m.manager.email if m.manager else None,
                assigned_at=m.assigned_at,
            )
            for m in self.user_repo.list_mappings()
        ]

    def delete_mapping(self, mapping_id: UUID) -> dict:
        """Remove a coordinator-manager mapping by its ID (Admin only)."""
        mapping = self.user_repo.get_mapping_by_id(mapping_id)
        if not mapping:
            raise HTTPException(status_code=404, detail="Mapping not found")
        self.user_repo.delete_mapping(mapping)
        return {"detail": "Coordinator-manager mapping removed successfully"}

    def get_audit_logs(self, skip: int = 0, limit: int = 100) -> List[AuditLog]:
        """Admin Only: Retrieve audit logs with pagination."""
        return self.user_repo.get_audit_logs(skip=skip, limit=limit)