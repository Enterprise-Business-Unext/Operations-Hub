from typing import Optional

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.cache import RedisCacheService
from app.core.database import get_db

from app.api.v1.auth.repository import UserRepository
from app.api.v1.auth.repository_interfaces import IUserRepository
from app.api.v1.auth.service import AuthService
from app.api.v1.batches.lifecycle_repository import BatchLifecycleRepository
from app.api.v1.batches.lifecycle_service import BatchLifecycleService
from app.api.v1.batches.repository import BatchRepository
from app.api.v1.batches.repository_interfaces import IBatchLifecycleRepository, IBatchRepository
from app.api.v1.batches.service import BatchService
from app.api.v1.gates.repository import GateRepository
from app.api.v1.gates.repository_interfaces import IGateRepository
from app.api.v1.gates.service import GatekeeperService
from app.api.v1.analytics.repository import AnalyticsRepository
from app.api.v1.analytics.repository_interfaces import IAnalyticsRepository
from app.api.v1.analytics.service import AnalyticsService
from app.api.v1.sessions.repository import SessionRepository
from app.api.v1.sessions.repository_interfaces import ISessionRepository
from app.api.v1.sessions.service import SessionService
from app.api.v1.faculty.repository import FacultyRepository
from app.api.v1.faculty.repository_interfaces import IFacultyRepository
from app.api.v1.faculty.service import FacultyService
from app.api.v1.fms_sync.repository import FmsSyncRepository
from app.api.v1.fms_sync.repository_interfaces import IFmsSyncRepository
from app.api.v1.fms_sync.service import FmsSyncService
from app.api.v1.schedules.repository import ScheduleRepository
from app.api.v1.schedules.repository_interfaces import IScheduleRepository
from app.api.v1.schedules.service import ExcelIngestionService

_cache_service: Optional[RedisCacheService] = None


def get_cache() -> RedisCacheService:
    global _cache_service
    if _cache_service is None:
        _cache_service = RedisCacheService()
    return _cache_service


# --- Repositories ---

def get_user_repository(db: Session = Depends(get_db)) -> IUserRepository:
    return UserRepository(db)


def get_batch_repository(db: Session = Depends(get_db)) -> IBatchRepository:
    return BatchRepository(db)


def get_batch_lifecycle_repository(db: Session = Depends(get_db)) -> IBatchLifecycleRepository:
    return BatchLifecycleRepository(db)


def get_gate_repository(db: Session = Depends(get_db)) -> IGateRepository:
    return GateRepository(db)


def get_session_repository(db: Session = Depends(get_db)) -> ISessionRepository:
    return SessionRepository(db)


def get_faculty_repository(db: Session = Depends(get_db)) -> IFacultyRepository:
    return FacultyRepository(db)


def get_analytics_repository(db: Session = Depends(get_db)) -> IAnalyticsRepository:
    return AnalyticsRepository(db)


def get_schedule_repository(db: Session = Depends(get_db)) -> IScheduleRepository:
    return ScheduleRepository(db)


def get_fms_sync_repository(db: Session = Depends(get_db)) -> IFmsSyncRepository:
    return FmsSyncRepository(db)


# --- Services ---

def get_batch_lifecycle_service(
    lifecycle_repo: IBatchLifecycleRepository = Depends(get_batch_lifecycle_repository),
) -> BatchLifecycleService:
    return BatchLifecycleService(lifecycle_repo)


def get_gatekeeper_service(
    gate_repo: IGateRepository = Depends(get_gate_repository),
    lifecycle_service: BatchLifecycleService = Depends(get_batch_lifecycle_service),
) -> GatekeeperService:
    return GatekeeperService(gate_repo, lifecycle_service)


def get_auth_service(user_repo: IUserRepository = Depends(get_user_repository), cache: RedisCacheService = Depends(get_cache)) -> AuthService:
    return AuthService(user_repo, cache)


def get_batch_service(
    batch_repo: IBatchRepository = Depends(get_batch_repository),
    user_repo: IUserRepository = Depends(get_user_repository),
    gatekeeper: GatekeeperService = Depends(get_gatekeeper_service),
    cache: RedisCacheService = Depends(get_cache),
) -> BatchService:
    return BatchService(batch_repo, user_repo, gatekeeper, cache)


def get_analytics_service(
    analytics_repo: IAnalyticsRepository = Depends(get_analytics_repository),
    user_repo: IUserRepository = Depends(get_user_repository),
    cache: RedisCacheService = Depends(get_cache),
) -> AnalyticsService:
    return AnalyticsService(analytics_repo, user_repo, cache)


def get_session_service(
    session_repo: ISessionRepository = Depends(get_session_repository),
    user_repo: IUserRepository = Depends(get_user_repository),
    lifecycle_service: BatchLifecycleService = Depends(get_batch_lifecycle_service),
    gatekeeper: GatekeeperService = Depends(get_gatekeeper_service),
) -> SessionService:
    return SessionService(session_repo, user_repo, lifecycle_service, gatekeeper)


def get_faculty_service(faculty_repo: IFacultyRepository = Depends(get_faculty_repository), cache: RedisCacheService = Depends(get_cache)) -> FacultyService:
    return FacultyService(faculty_repo, cache)


def get_fms_sync_service(fms_repo: IFmsSyncRepository = Depends(get_fms_sync_repository)) -> FmsSyncService:
    return FmsSyncService(fms_repo)

def get_excel_ingestion_service() -> ExcelIngestionService:
    return ExcelIngestionService()