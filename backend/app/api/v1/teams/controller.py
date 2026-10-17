from typing import List, Optional, Any
from uuid import UUID
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user import User
from app.schemas.user import TeamCreate, TeamUpdate, TeamResponse
from app.api.deps import get_current_user, require_admin
from app.api.deps_services import get_cache
from app.api.v1.teams.repository import TeamRepository
from app.api.v1.teams.repository_interfaces import ITeamRepository
from app.api.v1.teams.service import TeamService
from app.core.cache import RedisCacheService

router = APIRouter()


def get_team_repository(db: Session = Depends(get_db)) -> ITeamRepository:
    return TeamRepository(db)


def get_team_service(team_repo: ITeamRepository = Depends(get_team_repository), cache: RedisCacheService = Depends(get_cache)) -> TeamService:
    return TeamService(team_repo, cache)


@router.get("", response_model=List[TeamResponse])
def list_teams(
    department: Optional[str] = Query(None, description="Filter by department (e.g. Ops)"),
    is_active: Optional[bool] = Query(None),
    service: TeamService = Depends(get_team_service),
    current_user: User = Depends(get_current_user)
) -> Any:
    """List all configured organizational teams."""
    return service.list_teams(department=department, is_active=is_active)


@router.post("", response_model=TeamResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_admin)])
def create_team(
    team_in: TeamCreate,
    service: TeamService = Depends(get_team_service),
    current_user: User = Depends(require_admin)
) -> Any:
    """Admin Only: Add a new organizational team."""
    return service.create_team(team_in)


@router.get("/{id}", response_model=TeamResponse)
def get_team_by_id(
    id: UUID,
    service: TeamService = Depends(get_team_service),
    current_user: User = Depends(get_current_user)
) -> Any:
    """Fetch details of a specific team by ID."""
    return service.get_team(id)


@router.patch("/{id}", response_model=TeamResponse, dependencies=[Depends(require_admin)])
def update_team(
    id: UUID,
    team_in: TeamUpdate,
    service: TeamService = Depends(get_team_service),
    current_user: User = Depends(require_admin)
) -> Any:
    """Admin Only: Update team name, department, description, or active status."""
    return service.update_team(id, team_in)


@router.delete("/{id}", dependencies=[Depends(require_admin)])
def delete_team(
    id: UUID,
    service: TeamService = Depends(get_team_service),
    current_user: User = Depends(require_admin)
) -> Any:
    """Admin Only: Delete a team (unassigns users from team)."""
    return service.delete_team(id)
