from typing import List, Optional
from uuid import UUID
from fastapi import HTTPException, status
import json

from app.models.user import Role
from app.schemas.user import RoleCreate, RoleUpdate, RoleResponse
from app.api.v1.roles.repository_interfaces import IRoleRepository
from app.core.cache import RedisCacheService

VALID_SYSTEM_ROLES = {"Admin", "Manager", "Coordinator", "Sales", "Faculty"}


class RoleService:
    def __init__(self, role_repo: IRoleRepository, cache: Optional[RedisCacheService] = None):
        self.role_repo = role_repo
        self.cache = cache or RedisCacheService()

    def list_roles(self, is_active: Optional[bool] = None) -> List[RoleResponse]:
        cache_key = "roles:default"
        cached = self.cache.get("v1", cache_key)
        if cached:
            return [RoleResponse.model_validate(item) for item in json.loads(cached)]

        roles = self.role_repo.list_roles(is_active=is_active)
        result = [RoleResponse.model_validate(r) for r in roles]
        self.cache.set("v1", cache_key, json.dumps([r.model_dump(mode="json") for r in result]), ttl=600)
        return result

    def get_role(self, role_id: UUID) -> Role:
        role = self.role_repo.get_by_id(role_id)
        if not role:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
        return role

    def create_role(self, role_in: RoleCreate) -> Role:
        clean_name = role_in.name.strip()
        if not clean_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role name cannot be blank")

        if role_in.system_role not in VALID_SYSTEM_ROLES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid system_role '{role_in.system_role}'. Must be one of {list(VALID_SYSTEM_ROLES)}"
            )

        if self.role_repo.exists_by_name(clean_name):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Role with name '{clean_name}' already exists")

        role = Role(
            name=clean_name,
            system_role=role_in.system_role,
            is_active=role_in.is_active
        )
        result = self.role_repo.create(role)
        self.cache.delete("v1", "roles:default")
        return result

    def update_role(self, role_id: UUID, role_in: RoleUpdate) -> Role:
        role = self.get_role(role_id)
        update_data = role_in.model_dump(exclude_unset=True)

        if "name" in update_data and update_data["name"]:
            clean_name = update_data["name"].strip()
            if self.role_repo.exists_by_name(clean_name, exclude_id=role_id):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Role with name '{clean_name}' already exists")
            role.name = clean_name

        if "system_role" in update_data and update_data["system_role"]:
            if update_data["system_role"] not in VALID_SYSTEM_ROLES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid system_role. Must be one of {list(VALID_SYSTEM_ROLES)}"
                )
            role.system_role = update_data["system_role"]

        if "is_active" in update_data and update_data["is_active"] is not None:
            role.is_active = update_data["is_active"]

        result = self.role_repo.update(
            role,
            name=update_data.get("name"),
            system_role=update_data.get("system_role"),
            is_active=update_data.get("is_active")
        )
        self.cache.delete("v1", "roles:default")
        return result

    def delete_role(self, role_id: UUID) -> dict:
        role = self.get_role(role_id)
        assigned_user_count = self.role_repo.get_assigned_user_count(role_id)
        if assigned_user_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete role '{role.name}' because {assigned_user_count} user(s) are currently assigned to it. Deactivate the role instead."
            )
        self.role_repo.delete(role)
        self.cache.delete("v1", "roles:default")
        return {"detail": f"Role '{role.name}' successfully deleted"}