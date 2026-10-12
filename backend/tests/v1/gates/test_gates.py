from decimal import Decimal
from datetime import date, datetime, timezone

from app.models.batch import Batch
from app.models.batch_edit import BatchEditHistory
from app.models.session import FacultyUtilization, SessionStatus, TrainingSession


def test_gate1_session_feedback_success(client, coord_token_headers, db_session):
    batch = db_session.query(Batch).filter(Batch.batch_id == "TEST_BATCH_PYTHON_001").first()
    scheduled = TrainingSession(
        batch_id=batch.id,
        session_date=date.today(),
        module="AsyncIO",
        trainer_name="Test Faculty",
        status=SessionStatus.Scheduled,
    )
    db_session.add(scheduled)
    db_session.flush()
    utilization = FacultyUtilization(
        batch_id=batch.id,
        training_session_id=scheduled.id,
        faculty_name="Test Faculty",
        date_of_training=datetime.now(timezone.utc),
        topic="AsyncIO",
        no_of_hours=Decimal("8.0"),
        mode_of_delivery="Online",
        status=SessionStatus.Scheduled,
    )
    db_session.add(utilization)
    db_session.commit()

    feedback_payload = {
        "rating": "4.8",
        "topic_feedback": "Excellent engagement on AsyncIO coroutines.",
        "faculty_observations": "Class grasped event loops well.",
        "total_students_present": 42
    }

    response = client.patch(
        f"/api/v1/sessions/{utilization.id}/complete",
        json=feedback_payload,
        headers=coord_token_headers
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "Completed"
    assert data["feedback_submitted"] is True
    assert data["topic_feedback"].startswith("Excellent engagement")
    db_session.refresh(scheduled)
    assert scheduled.status == SessionStatus.Completed


def test_gate1_invalid_rating_rejected(client, coord_token_headers):
    invalid_feedback = {
        "rating": "6.5",  # Exceeds max 5.0
        "topic_feedback": "Invalid rating test",
        "total_students_present": 20
    }

    response = client.patch(
        "/api/v1/sessions/mock-session-id-123/complete",
        json=invalid_feedback,
        headers=coord_token_headers
    )

    assert response.status_code == 422


def test_gate2_batch_nps_closure(client, coord_token_headers, db_session):
    """Gate 2 derives the NPS index from the three category counts. The
    fixture batch already carries batch_avg_feedback=4.50, so the
    Checkpoint 1 precondition is satisfied and the average must be left
    untouched."""
    batch = db_session.query(Batch).filter(Batch.batch_id == "TEST_BATCH_PYTHON_001").first()
    db_session.add(BatchEditHistory(
        batch_id=batch.id,
        edited_by=batch.coordinator_id,
        changed_fields={"training_days": {"before": 4, "after": 5}},
    ))
    db_session.commit()

    nps_payload = {
        "promoters_count": 35,
        "passive_count": 3,
        "detractors_count": 2,
    }

    response = client.post(
        f"/api/v1/batches/{batch.id}/close",
        json=nps_payload,
        headers=coord_token_headers
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "Completed"
    assert data["is_schema_locked"] is True
    # (35 - 2) / 40 * 100 = 82.5
    assert float(data["batch_nps"]) == 82.5
    assert data["nps_total_responses"] == 40
    assert data["nps_promoters"] == 35
    assert data["nps_passives"] == 3
    assert data["nps_detractors"] == 2
    # Gate 2 is sequenced after Gate 1 but never writes the average.
    assert float(data["batch_avg_feedback"]) == 4.5
    assert db_session.query(BatchEditHistory).filter_by(batch_id=batch.id).count() == 0


def test_gate2_blocked_until_gate1_complete(client, coord_token_headers, db_session):
    """A batch with no average feedback has not cleared Checkpoint 1, so
    closure is rejected with 409."""
    batch = db_session.query(Batch).filter(Batch.batch_id == "TEST_BATCH_PYTHON_001").first()
    batch.batch_avg_feedback = None
    db_session.commit()

    response = client.post(
        f"/api/v1/batches/{batch.id}/close",
        json={"promoters_count": 10, "passive_count": 5, "detractors_count": 5},
        headers=coord_token_headers
    )

    assert response.status_code == 409
    assert "Quality Checkpoint 1" in response.json()["detail"]


def test_gate2_rejects_zero_responses(client, coord_token_headers, db_session):
    """An NPS index over zero responses is undefined, so the closure is
    rejected with 422."""
    batch = db_session.query(Batch).filter(Batch.batch_id == "TEST_BATCH_PYTHON_001").first()

    response = client.post(
        f"/api/v1/batches/{batch.id}/close",
        json={"promoters_count": 0, "passive_count": 0, "detractors_count": 0},
        headers=coord_token_headers
    )

    assert response.status_code == 422


def test_gate2_accepts_cancelled_and_not_conducted_sessions(client, coord_token_headers, db_session):
    batch = db_session.query(Batch).filter(Batch.batch_id == "TEST_BATCH_PYTHON_001").first()
    db_session.add(TrainingSession(
        batch_id=batch.id,
        session_date=date.today(),
        module="Cancelled module",
        status=SessionStatus.Cancelled,
    ))
    db_session.add(FacultyUtilization(
        batch_id=batch.id,
        faculty_name="Test Faculty",
        date_of_training=datetime.now(timezone.utc),
        topic="Not conducted module",
        no_of_hours=Decimal("8.0"),
        mode_of_delivery="Online",
        status=SessionStatus.NotConducted,
    ))
    db_session.commit()

    response = client.post(
        f"/api/v1/batches/{batch.id}/close",
        json={"promoters_count": 1, "passive_count": 0, "detractors_count": 0},
        headers=coord_token_headers,
    )

    assert response.status_code == 200
    assert response.json()["status"] == "Completed"


def test_gate2_rejects_nonterminal_sessions(client, coord_token_headers, db_session):
    batch = db_session.query(Batch).filter(Batch.batch_id == "TEST_BATCH_PYTHON_001").first()
    db_session.add(TrainingSession(
        batch_id=batch.id,
        session_date=date.today(),
        module="Still scheduled",
        status=SessionStatus.Scheduled,
    ))
    db_session.commit()

    response = client.post(
        f"/api/v1/batches/{batch.id}/close",
        json={"promoters_count": 1, "passive_count": 0, "detractors_count": 0},
        headers=coord_token_headers,
    )

    assert response.status_code == 409
    assert "terminal outcome" in response.json()["detail"]


def test_gate2_rejects_client_supplied_nps(client, coord_token_headers, db_session):
    """The index is server-side only: a client-supplied nps_score is
    ignored rather than trusted."""
    batch = db_session.query(Batch).filter(Batch.batch_id == "TEST_BATCH_PYTHON_001").first()

    response = client.post(
        f"/api/v1/batches/{batch.id}/close",
        json={
            "promoters_count": 35,
            "passive_count": 3,
            "detractors_count": 2,
            "nps_score": "9.2",
            "average_feedback_score": "1.0",
            "retrospective_notes": "Client supplied values must be ignored.",
        },
        headers=coord_token_headers
    )

    assert response.status_code == 200
    data = response.json()
    assert float(data["batch_nps"]) == 82.5
    assert float(data["batch_avg_feedback"]) == 4.5


def test_feedback_import_endpoint_removed(client, coord_token_headers, db_session):
    """The workbook import surface is gone; closure is the only path."""
    batch = db_session.query(Batch).filter(Batch.batch_id == "TEST_BATCH_PYTHON_001").first()

    response = client.post(
        f"/api/v1/batches/{batch.id}/feedback-import",
        headers=coord_token_headers
    )

    assert response.status_code == 404
