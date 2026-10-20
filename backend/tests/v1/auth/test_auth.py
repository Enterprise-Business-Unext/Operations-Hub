import pytest
from app.core.config import settings
from app.models.user import User


def test_login_success(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "test_admin@ops.com", "password": "password123"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "test_admin@ops.com"
    assert data["user"]["role"] == "Admin"


def test_login_invalid_password(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "test_admin@ops.com", "password": "wrongpassword"}
    )
    assert response.status_code == 401


def test_refresh_uses_httponly_cookie_when_request_body_is_empty(client, db_session):
    from app.core.security import create_refresh_token

    admin = db_session.query(User).filter_by(email="test_admin@ops.com").one()
    refresh_token = create_refresh_token(subject=str(admin.id))

    response = client.post(
        "/api/v1/auth/refresh",
        cookies={"refresh_token": refresh_token},
    )

    assert response.status_code == 200
    assert response.json()["user"]["email"] == admin.email
    assert "auth_token" in response.cookies


def test_refresh_without_body_or_cookie_returns_unauthorized(client):
    response = client.post("/api/v1/auth/refresh")

    assert response.status_code == 401


def test_tenth_failed_login_attempt_locks_account(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "MAX_FAILED_LOGIN_ATTEMPTS", 10)

    for _ in range(9):
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "test_admin@ops.com", "password": "wrongpassword"},
        )
        assert response.status_code == 401

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "test_admin@ops.com", "password": "wrongpassword"},
    )

    assert response.status_code == 423
    assert "locked after 10 unsuccessful sign-in attempts" in response.json()["detail"]
    assert "IST" in response.json()["detail"]

    admin = db_session.query(User).filter_by(email="test_admin@ops.com").one()
    assert admin.failed_login_attempts == 10
    assert admin.locked_until is not None


def test_locked_login_returns_retry_time_in_ist(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from types import SimpleNamespace
    from unittest.mock import Mock

    from fastapi import HTTPException

    from app.api.v1.auth.service import AuthService
    from app.schemas.user import UserLogin

    locked_until = datetime.now(timezone.utc) + timedelta(hours=1)
    user_repo = Mock()
    user_repo.get_by_email.return_value = SimpleNamespace(
        id="locked-user",
        email="locked@example.com",
        locked_until=locked_until,
    )
    service = AuthService(user_repo)

    with pytest.raises(HTTPException) as error:
        service.authenticate(UserLogin(email="locked@example.com", password="unused"))

    expected_ist = locked_until.astimezone(timezone(timedelta(hours=5, minutes=30)))
    assert error.value.status_code == 423
    assert error.value.detail.endswith(expected_ist.strftime("%H:%M:%S IST"))


def test_get_me_authenticated(client, admin_token_headers):
    response = client.get("/api/v1/auth/me", headers=admin_token_headers)
    assert response.status_code == 200
    assert response.json()["email"] == "test_admin@ops.com"


def test_get_me_unauthorized(client):
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 403 or response.status_code == 401
