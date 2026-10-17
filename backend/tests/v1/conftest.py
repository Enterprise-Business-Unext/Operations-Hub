import pytest
from decimal import Decimal
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.cache import RedisCacheService
from app.core.security import get_password_hash, create_access_token
from app.models.user import User, UserManagerMapping, Team
from app.models.batch import Batch, ApprovalConfiguration
from app.main import app
from app.api.deps_services import get_cache


class NoOpCache:
    """No-op cache for tests that avoids Redis connection hangs."""
    def get(self, namespace, identifier):
        return None
    def set(self, namespace, identifier, value, ttl=None):
        pass
    def delete(self, namespace, identifier):
        pass


# In-memory SQLite database for fast isolated unit tests
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db_session():
    """Create a fresh database session for each test function."""
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        # Seed test entities
        delivery_team = Team(name="Delivery", department="Delivery")
        db.add(delivery_team)
        db.flush()

        admin = User(
            email="test_admin@ops.com",
            hashed_password=get_password_hash("password123"),
            full_name="Test Administrator",
            role="Admin",
            is_active=True
        )
        manager = User(
            email="test_manager@ops.com",
            hashed_password=get_password_hash("password123"),
            full_name="Test Manager",
            role="Manager",
            is_active=True
        )
        coord = User(
            email="test_coord@ops.com",
            hashed_password=get_password_hash("password123"),
            full_name="Test Coordinator",
            role="Coordinator",
            team_id=delivery_team.id,
            is_active=True
        )
        db.add_all([admin, manager, coord])
        db.flush()

        mapping = UserManagerMapping(coordinator_id=coord.id, manager_id=manager.id)
        db.add(mapping)

        approval_config = ApprovalConfiguration(
            approver_1_id=manager.id,
            approver_2_id=admin.id
        )
        db.add(approval_config)

        batch = Batch(
            batch_id="TEST_BATCH_PYTHON_001",
            approval_id="SOW-TEST-001",
            client_name="Test Enterprise Client",
            category="Bootcamp",
            domain="IT/ITES",
            program_name="Full Stack Python Track",
            delivery_mode="Online",
            location_city="Bengaluru",
            status="Upcoming",
            batch_avg_feedback=Decimal("4.50"),
            primary_manager_id=manager.id,
            coordinator_id=coord.id,
            is_schema_locked=True
        )
        db.add(batch)

        db.commit()
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture(scope="function")
def client(db_session):
    """Test client with overridden get_db dependency."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_cache] = lambda: NoOpCache()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def admin_token_headers(db_session):
    admin = db_session.query(User).filter(User.email == "test_admin@ops.com").first()
    token = create_access_token(subject=str(admin.id), role=admin.role)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def manager_token_headers(db_session):
    manager = db_session.query(User).filter(User.email == "test_manager@ops.com").first()
    token = create_access_token(subject=str(manager.id), role=manager.role)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def coord_token_headers(db_session):
    coord = db_session.query(User).filter(User.email == "test_coord@ops.com").first()
    token = create_access_token(subject=str(coord.id), role=coord.role)
    return {"Authorization": f"Bearer {token}"}
