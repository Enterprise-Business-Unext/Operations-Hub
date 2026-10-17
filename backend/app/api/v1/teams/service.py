from typing import List, Optional
from uuid import UUID
from fastapi import HTTPException, status
import json

from app.models.user import Team
from app.schemas.user import TeamCreate, TeamUpdate, TeamResponse
from app.api.v1.teams.repository_interfaces import ITeamRepository
from app.core.cache import RedisCacheService


class TeamService:
    def __init__(self, team_repo: ITeamRepository, cache: Optional[RedisCacheService] = None):
        self.team_repo = team_repo
        self.cache = cache or RedisCacheService()

    def _enrich_team(self, team: Team) -> TeamResponse:
        count = self.team_repo.get_member_count(team.id)
        resp = TeamResponse.model_validate(team)
        resp.member_count = count
        return resp

    def list_teams(
        self,
        department: Optional[str] = None,
        is_active: Optional[bool] = None
    ) -> List[TeamResponse]:
        if department is None and is_active is None:
            cache_key = "teams:default"
            cached = self.cache.get("v1", cache_key)
            if cached:
                return [TeamResponse.model_validate(item) for item in json.loads(cached)]

        teams = self.team_repo.list_teams(department=department, is_active=is_active)
        result = [self._enrich_team(t) for t in teams]
        if department is None and is_active is None:
            self.cache.set("v1", "teams:default", json.dumps([r.model_dump(mode="json") for r in result]), ttl=600)
        return result

    def get_team(self, team_id: UUID) -> TeamResponse:
        team = self.team_repo.get_by_id(team_id)
        if not team:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
        return self._enrich_team(team)

    def create_team(self, team_in: TeamCreate) -> TeamResponse:
        clean_name = team_in.name.strip()
        if not clean_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team name cannot be blank")

        clean_dept = (team_in.department or "Ops").strip()
        if not clean_dept:
            clean_dept = "Ops"

        if self.team_repo.exists_by_name(clean_name):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Team with name '{clean_name}' already exists")

        team = Team(
            name=clean_name,
            department=clean_dept,
            description=team_in.description.strip() if team_in.description else None,
            is_active=team_in.is_active
        )
        team = self.team_repo.create(team)
        result = self._enrich_team(team)
        self.cache.delete("v1", "teams:default")
        return result

    def update_team(self, team_id: UUID, team_in: TeamUpdate) -> TeamResponse:
        team = self.team_repo.get_by_id(team_id)
        if not team:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

        update_data = team_in.model_dump(exclude_unset=True)

        if "name" in update_data and update_data["name"]:
            clean_name = update_data["name"].strip()
            if self.team_repo.exists_by_name(clean_name, exclude_id=team_id):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Team with name '{clean_name}' already exists")
            team.name = clean_name

        if "department" in update_data and update_data["department"]:
            team.department = update_data["department"].strip()

        if "description" in update_data:
            team.description = update_data["description"].strip() if update_data["description"] else None

        if "is_active" in update_data and update_data["is_active"] is not None:
            team.is_active = update_data["is_active"]

        team = self.team_repo.update(
            team,
            name=update_data.get("name"),
            department=update_data.get("department"),
            description=update_data.get("description"),
            is_active=update_data.get("is_active")
        )
        result = self._enrich_team(team)
        self.cache.delete("v1", "teams:default")
        return result

    def delete_team(self, team_id: UUID) -> dict:
        team = self.team_repo.get_by_id(team_id)
        if not team:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

        team_name = team.name
        self.team_repo.unassign_users(team_id)
        self.team_repo.delete(team)
        self.cache.delete("v1", "teams:default")
        return {"detail": f"Team '{team_name}' successfully deleted"}