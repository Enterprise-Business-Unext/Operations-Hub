import json

import pytest

from app.main import app
from app.api.deps_services import get_cache
from app.core.database import get_db
from app.models.user import User


class FakeCacheService:
    """In-memory stand-in for RedisCacheService used to keep cache tests
    deterministic and independent of a running Redis server."""

    def __init__(self):
        self.store = {}
        self.fail_open = False
        self.hits = 0
        self.misses = 0

    def get(self, namespace, identifier):
        if self.fail_open:
            self.misses += 1
            return None
        result = self.store.get((namespace, identifier))
        if result is not None:
            self.hits += 1
        else:
            self.misses += 1
        return result

    def set(self, namespace, identifier, value, ttl):
        self.store[(namespace, identifier)] = value

    def delete(self, namespace, identifier):
        self.store.pop((namespace, identifier), None)


@pytest.fixture
def fake_cache():
    fake = FakeCacheService()
    previous = app.dependency_overrides.get(get_cache)
    app.dependency_overrides[get_cache] = lambda: fake
    yield fake
    if previous is None:
        app.dependency_overrides.pop(get_cache, None)
    else:
        app.dependency_overrides[get_cache] = previous


def test_batch_options_cache_hit_and_invalidation(client, admin_token_headers, fake_cache):
    create_res = client.post(
        "/api/v1/batch-options/categories",
        headers=admin_token_headers,
        json={"name": "Bootcamp", "description": "Bootcamp track"},
    )
    assert create_res.status_code == 201

    r1 = client.get("/api/v1/batch-options/categories", headers=admin_token_headers)
    assert r1.status_code == 200
    assert len(r1.json()) >= 1

    r2 = client.get("/api/v1/batch-options/categories", headers=admin_token_headers)
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    assert fake_cache.hits >= 1  # second read served from cache

    # Creating another option invalidates the options cache.
    client.post(
        "/api/v1/batch-options/categories",
        headers=admin_token_headers,
        json={"name": "RBT", "description": "RBT track"},
    )
    r3 = client.get("/api/v1/batch-options/categories", headers=admin_token_headers)
    assert r3.status_code == 200
    assert len(r3.json()) == len(r1.json()) + 1


def test_cache_fail_open(client, admin_token_headers, fake_cache):
    fake_cache.fail_open = True
    r = client.get("/api/v1/batch-options/categories", headers=admin_token_headers)
    assert r.status_code == 200  # still served from DB despite cache failure


def test_teams_cache_hit_and_invalidation(client, admin_token_headers, fake_cache):
    client.post(
        "/api/v1/teams",
        headers=admin_token_headers,
        json={"name": "Alpha Team", "department": "Ops", "is_active": True},
    )
    r1 = client.get("/api/v1/teams", headers=admin_token_headers)
    assert r1.status_code == 200
    r2 = client.get("/api/v1/teams", headers=admin_token_headers)
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    assert fake_cache.hits >= 1

    client.post(
        "/api/v1/teams",
        headers=admin_token_headers,
        json={"name": "Beta Team", "department": "Delivery", "is_active": True},
    )
    r3 = client.get("/api/v1/teams", headers=admin_token_headers)
    assert r3.status_code == 200
    assert len(r3.json()) == len(r1.json()) + 1


def test_roles_cache_hit_and_invalidation(client, admin_token_headers, fake_cache):
    client.post(
        "/api/v1/roles",
        headers=admin_token_headers,
        json={"name": "Ops Lead", "system_role": "Coordinator"},
    )
    r1 = client.get("/api/v1/roles", headers=admin_token_headers)
    assert r1.status_code == 200
    r2 = client.get("/api/v1/roles", headers=admin_token_headers)
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    assert fake_cache.hits >= 1

    client.post(
        "/api/v1/roles",
        headers=admin_token_headers,
        json={"name": "Instructor", "system_role": "Faculty"},
    )
    r3 = client.get("/api/v1/roles", headers=admin_token_headers)
    assert r3.status_code == 200
    assert len(r3.json()) == len(r1.json()) + 1


def test_approval_config_cache_and_invalidation(client, admin_token_headers, db_session, fake_cache):
    r1 = client.get("/api/v1/batches/approval-config", headers=admin_token_headers)
    assert r1.status_code == 200
    r2 = client.get("/api/v1/batches/approval-config", headers=admin_token_headers)
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    assert fake_cache.hits >= 1

    manager = db_session.query(User).filter(User.email == "test_manager@ops.com").first()
    admin = db_session.query(User).filter(User.email == "test_admin@ops.com").first()
    put_res = client.put(
        "/api/v1/batches/approval-config",
        headers=admin_token_headers,
        json={"approver_1_id": str(manager.id), "approver_2_id": str(admin.id)},
    )
    assert put_res.status_code == 200
    r3 = client.get("/api/v1/batches/approval-config", headers=admin_token_headers)
    assert r3.status_code == 200  # repopulated from DB after invalidation


def test_faculty_cache_and_invalidation(client, admin_token_headers, fake_cache):
    role_res = client.post(
        "/api/v1/roles",
        headers=admin_token_headers,
        json={"name": "Faculty Role", "system_role": "Faculty"},
    )
    assert role_res.status_code == 201
    role_id = role_res.json()["id"]

    client.post(
        "/api/v1/auth/users",
        headers=admin_token_headers,
        json={
            "email": "faculty.one@ops.com",
            "full_name": "Faculty One",
            "password": "Password123!",
            "role_id": role_id,
        },
    )
    r1 = client.get("/api/v1/faculty", headers=admin_token_headers)
    assert r1.status_code == 200
    assert len(r1.json()) == 1

    r2 = client.get("/api/v1/faculty", headers=admin_token_headers)
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    assert fake_cache.hits >= 1

    client.post(
        "/api/v1/auth/users",
        headers=admin_token_headers,
        json={
            "email": "faculty.two@ops.com",
            "full_name": "Faculty Two",
            "password": "Password123!",
            "role_id": role_id,
        },
    )
    r3 = client.get("/api/v1/faculty", headers=admin_token_headers)
    assert r3.status_code == 200
    assert len(r3.json()) == 2


def test_assignable_users_cache(client, admin_token_headers, fake_cache):
    r1 = client.get(
        "/api/v1/auth/users/assignable",
        headers=admin_token_headers,
        params={"role": "Coordinator"},
    )
    assert r1.status_code == 200
    r2 = client.get(
        "/api/v1/auth/users/assignable",
        headers=admin_token_headers,
        params={"role": "Coordinator"},
    )
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    assert fake_cache.hits >= 1


def test_my_reports_cache(client, manager_token_headers, fake_cache):
    r1 = client.get("/api/v1/auth/my-reports", headers=manager_token_headers)
    assert r1.status_code == 200
    r2 = client.get("/api/v1/auth/my-reports", headers=manager_token_headers)
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    assert fake_cache.hits >= 1


def test_manager_dashboard_cache_per_user(client, manager_token_headers, fake_cache):
    r1 = client.get("/api/v1/analytics/manager-dashboard", headers=manager_token_headers)
    assert r1.status_code == 200
    r2 = client.get("/api/v1/analytics/manager-dashboard", headers=manager_token_headers)
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    assert fake_cache.hits >= 1


def test_cache_fail_open_dashboard(client, manager_token_headers, fake_cache):
    fake_cache.fail_open = True
    r = client.get("/api/v1/analytics/manager-dashboard", headers=manager_token_headers)
    assert r.status_code == 200
