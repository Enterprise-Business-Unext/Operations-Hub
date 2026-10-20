import sys
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.core.security import get_password_hash, verify_password
from app.models.user import User
from scripts import create_admin


@pytest.fixture
def admin_database(monkeypatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    monkeypatch.setattr(create_admin, "engine", engine)
    monkeypatch.setattr(create_admin, "SessionLocal", session_factory)
    yield session_factory
    engine.dispose()


def run_script(monkeypatch, *args):
    monkeypatch.setattr(sys, "argv", ["create_admin.py", *args])
    return create_admin.main()


def test_if_not_exists_creates_admin_from_environment(admin_database, monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "A-strong-bootstrap-password-2026")
    monkeypatch.setenv("ADMIN_EMAIL", "first.admin@example.com")

    assert run_script(monkeypatch, "--if-not-exists") == 0

    with admin_database() as db:
        admin = db.query(User).filter_by(email="first.admin@example.com").one()
        assert admin.role == "Admin"
        assert admin.role_detail.name == "Admin"
        assert verify_password("A-strong-bootstrap-password-2026", admin.hashed_password)


def test_if_not_exists_does_not_modify_existing_admin(admin_database, monkeypatch):
    original_hash = get_password_hash("existing-password")
    with admin_database() as db:
        admin = User(
            id=uuid.uuid4(),
            email="existing.admin@example.com",
            hashed_password=original_hash,
            full_name="Existing Admin",
            role="Admin",
            is_active=True,
        )
        db.add(admin)
        db.commit()

    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)

    assert run_script(
        monkeypatch,
        "--if-not-exists",
        "--email",
        "existing.admin@example.com",
    ) == 0

    with admin_database() as db:
        admin = db.query(User).filter_by(email="existing.admin@example.com").one()
        assert admin.full_name == "Existing Admin"
        assert admin.hashed_password == original_hash


def test_if_not_exists_requires_password_only_when_admin_is_missing(
    admin_database, monkeypatch, capsys
):
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)

    assert run_script(
        monkeypatch,
        "--if-not-exists",
        "--email",
        "missing.admin@example.com",
    ) == 2

    assert "ADMIN_PASSWORD is required" in capsys.readouterr().err
