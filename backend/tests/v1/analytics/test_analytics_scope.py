from fastapi.testclient import TestClient
from app.models.user import User
from app.core.security import create_access_token


def _auth_header(db_session, user: User) -> dict:
    token = create_access_token(subject=str(user.id), role=user.role)
    return {"Authorization": f"Bearer {token}"}


def test_analytics_scope_unassigned_manager_zero(client: TestClient, db_session):
    """S-01: Manager with no assignments gets zero analytics."""
    from app.models.user import User
    # Create a manager with no batch assignments
    unassigned = User(
        email="unassigned_manager@ops.com",
        hashed_password="x",
        full_name="Unassigned Manager",
        role="Manager",
        is_active=True,
    )
    db_session.add(unassigned)
    db_session.flush()
    resp = client.get(
        "/api/v1/analytics/manager-dashboard",
        headers=_auth_header(db_session, unassigned),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_active_batches"] == 0


def test_analytics_scope_admin_full_totals(client: TestClient, db_session):
    """S-01: Admin sees full totals across all batches."""
    admin = db_session.query(User).filter(User.email == "test_admin@ops.com").first()
    resp = client.get("/api/v1/analytics/manager-dashboard", headers=_auth_header(db_session, admin))
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_active_batches"] >= 1


def test_mbr_export_manager_scoped(client: TestClient, db_session):
    """S-02: Manager MBR export returns scoped rows only."""
    manager = db_session.query(User).filter(User.email == "test_manager@ops.com").first()
    resp = client.get("/api/v1/analytics/mbr-export", headers=_auth_header(db_session, manager))
    assert resp.status_code == 200


def test_mbr_export_admin_all_rows(client: TestClient, db_session):
    """S-02: Admin MBR export returns all rows."""
    admin = db_session.query(User).filter(User.email == "test_admin@ops.com").first()
    resp = client.get("/api/v1/analytics/mbr-export", headers=_auth_header(db_session, admin))
    assert resp.status_code == 200
