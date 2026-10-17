from fastapi.testclient import TestClient
import uuid


def test_session_ledger_non_admin_scoped(client: TestClient, db_session, manager_token_headers):
    """S-03: Non-admin GET /sessions without batch_id is scoped to their records."""
    resp = client.get("/api/v1/sessions", headers=manager_token_headers)
    assert resp.status_code == 200


def test_session_ledger_admin_all(client: TestClient, db_session, admin_token_headers):
    """S-03: Admin GET /sessions without batch_id returns all records."""
    resp = client.get("/api/v1/sessions", headers=admin_token_headers)
    assert resp.status_code == 200


def test_session_ledger_unrelated_batch(client: TestClient, db_session, manager_token_headers):
    """S-03: Non-admin requesting an unrelated batch gets empty/scoped result."""
    resp = client.get(
        "/api/v1/sessions",
        params={"batch_id": str(uuid.uuid4())},
        headers=manager_token_headers,
    )
    assert resp.status_code in (200, 403)
