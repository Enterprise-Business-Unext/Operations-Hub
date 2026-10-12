import csv
from datetime import date, datetime, timezone
from decimal import Decimal

from app.models.batch import Batch
from app.models.session import FacultyUtilization, SessionStatus, TrainingSession
from app.api.v1.faculty.repository import FacultyRepository


def _create_linked_session(db_session):
    batch = db_session.query(Batch).filter(
        Batch.batch_id == "TEST_BATCH_PYTHON_001"
    ).first()
    scheduled = TrainingSession(
        batch_id=batch.id,
        session_date=date(2026, 10, 10),
        module="Workflow module",
        trainer_name="Test Faculty",
        status=SessionStatus.Scheduled,
    )
    db_session.add(scheduled)
    db_session.flush()
    utilization = FacultyUtilization(
        batch_id=batch.id,
        training_session_id=scheduled.id,
        faculty_name="Test Faculty",
        date_of_training=datetime(2026, 10, 10, tzinfo=timezone.utc),
        topic="Workflow module",
        no_of_hours=Decimal("8.0"),
        mode_of_delivery="Online",
        status=SessionStatus.Scheduled,
    )
    db_session.add(utilization)
    db_session.commit()
    return batch, scheduled, utilization


def test_cancel_session_records_reason_and_updates_timetable(client, coord_token_headers, db_session):
    _batch, scheduled, utilization = _create_linked_session(db_session)

    response = client.post(
        f"/api/v1/sessions/{utilization.id}/cancel",
        json={"reason": "Trainer unavailable"},
        headers=coord_token_headers,
    )

    assert response.status_code == 200
    assert response.json()["status"] == "Cancelled"
    assert response.json()["outcome_reason"] == "Trainer unavailable"
    assert response.json()["outcome_at"] is not None
    assert response.json()["outcome_by"] is not None
    db_session.refresh(scheduled)
    assert scheduled.status == SessionStatus.Cancelled


def test_not_conducted_outcome_does_not_auto_complete_batch(client, coord_token_headers, db_session):
    batch, scheduled, utilization = _create_linked_session(db_session)

    response = client.post(
        f"/api/v1/sessions/{utilization.id}/not-conducted",
        json={"reason": "Client cancelled class"},
        headers=coord_token_headers,
    )

    assert response.status_code == 200
    assert response.json()["status"] == "Not Conducted"
    db_session.refresh(scheduled)
    db_session.refresh(batch)
    assert scheduled.status == SessionStatus.NotConducted
    assert batch.status == "Upcoming"


def test_session_reschedule_updates_delivery_and_timetable(client, coord_token_headers, db_session):
    _batch, scheduled, utilization = _create_linked_session(db_session)

    response = client.post(
        f"/api/v1/sessions/{utilization.id}/reschedule",
        json={
            "date_of_training": "2026-10-12T00:00:00Z",
            "start_time": "10:00:00",
            "end_time": "12:00:00",
            "reason": "Faculty availability changed",
        },
        headers=coord_token_headers,
    )

    assert response.status_code == 200
    assert response.json()["status"] == "Scheduled"
    assert response.json()["date_of_training"].startswith("2026-10-12")
    assert response.json()["outcome_reason"] == "Faculty availability changed"
    db_session.refresh(scheduled)
    assert scheduled.session_date == date(2026, 10, 12)
    assert scheduled.start_time.isoformat() == "10:00:00"
    assert scheduled.end_time.isoformat() == "12:00:00"
    assert scheduled.status == SessionStatus.Scheduled


def test_session_status_patch_cannot_skip_gate1(client, coord_token_headers, db_session):
    _batch, _scheduled, utilization = _create_linked_session(db_session)

    response = client.patch(
        f"/api/v1/sessions/{utilization.id}",
        json={"status": "Completed"},
        headers=coord_token_headers,
    )

    assert response.status_code == 409
    assert "Gate 1" in response.json()["detail"]


def test_create_session_can_be_logged_directly_as_completed(client, coord_token_headers, db_session):
    batch, scheduled, _utilization = _create_linked_session(db_session)
    batch.batch_avg_feedback = None
    db_session.commit()

    response = client.post(
        "/api/v1/sessions",
        json={
            "batch_id": str(batch.id),
            "training_session_id": str(scheduled.id),
            "date_of_training": "2026-10-10T00:00:00.000Z",
            "start_time": "09:30:00",
            "end_time": "17:30:00",
            "topic": "Workflow module",
            "faculty_name": "Test Faculty",
            "no_of_hours": "8.0",
            "mode_of_delivery": "Online",
            "status": "Completed",
            "feedback_submitted": True,
            "feedback_rating": "4.5",
            "vertical": "IT/ITES",
        },
        headers=coord_token_headers,
    )

    assert response.status_code == 201, response.text
    assert response.json()["status"] == "Completed"
    db_session.refresh(scheduled)
    assert scheduled.status == SessionStatus.Completed
    db_session.refresh(batch)
    assert batch.batch_avg_feedback == Decimal("4.50")


def test_create_session_still_requires_outcome_reason_for_cancelled(client, coord_token_headers, db_session):
    batch, _scheduled, _utilization = _create_linked_session(db_session)

    response = client.post(
        "/api/v1/sessions",
        json={
            "batch_id": str(batch.id),
            "date_of_training": "2026-10-10T00:00:00.000Z",
            "topic": "Cancelled module",
            "faculty_name": "Test Faculty",
            "no_of_hours": "8.0",
            "mode_of_delivery": "Online",
            "status": "Cancelled",
        },
        headers=coord_token_headers,
    )

    assert response.status_code == 422
    assert "outcome_reason" in response.text


def test_scheduled_timetable_cannot_exceed_training_days(client, coord_token_headers, db_session):
    batch, scheduled, _utilization = _create_linked_session(db_session)
    batch.training_days = 2
    db_session.commit()

    same_day = client.post(
        "/api/v1/sessions/scheduled",
        json={
            "batch_id": str(batch.id),
            "session_date": "2026-10-10",
            "module": "Second module on the same day",
            "duration_hours": "2.0",
        },
        headers=coord_token_headers,
    )
    assert same_day.status_code == 201, same_day.text

    over_limit = client.post(
        "/api/v1/sessions/scheduled",
        json={
            "batch_id": str(batch.id),
            "session_date": "2026-10-10",
            "module": "Third session on the same day",
        },
        headers=coord_token_headers,
    )
    assert over_limit.status_code == 422
    assert "scheduled sessions" in over_limit.json()["detail"]

    update_existing = client.patch(
        f"/api/v1/sessions/scheduled/{scheduled.id}",
        json={"module": "Updated existing session"},
        headers=coord_token_headers,
    )
    assert update_existing.status_code == 200, update_existing.text


def test_manual_timetable_changes_are_allowed_while_reapproval_is_pending(
    client, coord_token_headers, db_session
):
    batch, scheduled, _utilization = _create_linked_session(db_session)
    batch.training_days = 2
    batch.status = "Approval 1 Pending"
    db_session.commit()

    create_response = client.post(
        "/api/v1/sessions/scheduled",
        json={
            "batch_id": str(batch.id),
            "session_date": "2026-10-11",
            "module": "Additional day",
        },
        headers=coord_token_headers,
    )
    assert create_response.status_code == 201, create_response.text

    update_response = client.patch(
        f"/api/v1/sessions/scheduled/{scheduled.id}",
        json={"module": "Changed while pending"},
        headers=coord_token_headers,
    )
    assert update_response.status_code == 200, update_response.text
    assert update_response.json()["module"] == "Changed while pending"


def test_manual_timetable_creation_is_blocked_for_completed_batch(
    client, coord_token_headers, db_session
):
    batch, _scheduled, _utilization = _create_linked_session(db_session)
    batch.status = "Completed"
    db_session.commit()

    response = client.post(
        "/api/v1/sessions/scheduled",
        json={
            "batch_id": str(batch.id),
            "session_date": "2026-10-11",
            "module": "Not allowed after completion",
        },
        headers=coord_token_headers,
    )
    assert response.status_code == 409
    assert "Completed batches" in response.json()["detail"]


def test_scheduled_session_can_be_deleted_and_schedule_completion_is_recalculated(
    client, coord_token_headers, db_session
):
    batch, scheduled, _utilization = _create_linked_session(db_session)
    # Remove the linked delivery row so this test exercises a pending timetable item.
    db_session.delete(_utilization)
    batch.training_days = 1
    batch.schedule_complete = True
    db_session.commit()

    response = client.delete(
        f"/api/v1/sessions/scheduled/{scheduled.id}",
        headers=coord_token_headers,
    )

    assert response.status_code == 204
    assert db_session.get(TrainingSession, scheduled.id) is None
    db_session.refresh(batch)
    assert batch.schedule_complete is False


def test_scheduled_session_with_delivery_record_cannot_be_deleted(
    client, coord_token_headers, db_session
):
    _batch, scheduled, _utilization = _create_linked_session(db_session)

    response = client.delete(
        f"/api/v1/sessions/scheduled/{scheduled.id}",
        headers=coord_token_headers,
    )

    assert response.status_code == 409
    assert "linked delivery record" in response.json()["detail"]
    assert db_session.get(TrainingSession, scheduled.id) is not None


def test_faculty_utilization_excludes_non_delivery_outcomes(db_session):
    batch, _scheduled, _utilization = _create_linked_session(db_session)
    db_session.add_all([
        FacultyUtilization(
            batch_id=batch.id,
            faculty_name="Cancelled Faculty",
            date_of_training=datetime(2026, 10, 10, tzinfo=timezone.utc),
            topic="Cancelled session",
            no_of_hours=Decimal("8.0"),
            mode_of_delivery="Online",
            status=SessionStatus.Cancelled,
        ),
        FacultyUtilization(
            batch_id=batch.id,
            faculty_name="Not Conducted Faculty",
            date_of_training=datetime(2026, 10, 10, tzinfo=timezone.utc),
            topic="Not conducted session",
            no_of_hours=Decimal("8.0"),
            mode_of_delivery="Online",
            status=SessionStatus.NotConducted,
        ),
        FacultyUtilization(
            batch_id=batch.id,
            faculty_name="In Progress Faculty",
            date_of_training=datetime(2026, 10, 10, tzinfo=timezone.utc),
            topic="Active session",
            no_of_hours=Decimal("8.0"),
            mode_of_delivery="Online",
            status=SessionStatus.InProgress,
        ),
    ])
    db_session.commit()

    repo = FacultyRepository(db_session)
    active_names = set(repo.get_distinct_deployed_faculty_names())
    active_rows = repo.list_non_cancelled_deliveries()

    assert active_names == {"Test Faculty", "In Progress Faculty"}
    assert {row.faculty_name for row in active_rows} == active_names


def test_faculty_utilization_export_includes_outcome_columns(
    client, coord_token_headers, db_session
):
    _batch, _scheduled, utilization = _create_linked_session(db_session)
    utilization.status = SessionStatus.Cancelled
    utilization.outcome_reason = "Trainer unavailable"
    utilization.outcome_at = datetime(2026, 10, 10, tzinfo=timezone.utc)
    db_session.commit()

    response = client.get(
        "/api/v1/faculty/utilization/export",
        headers=coord_token_headers,
    )

    assert response.status_code == 200
    rows = list(csv.reader(response.text.splitlines()))
    assert rows[0][-2:] == ["Outcome Reason", "Outcome At"]
    assert rows[1][-2] == "Trainer unavailable"
    assert rows[1][-1].startswith("2026-10-10T00:00:00")
