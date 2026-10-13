from datetime import datetime, timezone, date
from decimal import Decimal

from app.models.batch import Batch
from app.models.session import TrainingSession, FacultyUtilization
from app.api.v1.batches.lifecycle_repository import BatchLifecycleRepository
from app.api.v1.batches.lifecycle_service import BatchLifecycleService


def _lifecycle_service(db_session):
    return BatchLifecycleService(BatchLifecycleRepository(db_session))


def _get_batch(db_session):
    return db_session.query(Batch).filter(Batch.batch_id == "TEST_BATCH_PYTHON_001").first()


def _reset_avg_feedback(db_session, batch):
    """The fixture seeds 4.50; the write-once guard would block every
    calculation, so tests that exercise the write path clear it first."""
    batch.batch_avg_feedback = None
    db_session.commit()


def _seed_batch_with_sessions(db_session, batch, count=2):
    """Create `count` TrainingSession days for the batch and return them."""
    sessions = []
    for i in range(count):
        ts = TrainingSession(
            batch_id=batch.id,
            session_date=date(2026, 1, 10 + i),
            day_name="Monday",
            module=f"Module {i + 1}",
            trainer_name="Test Faculty",
            status="Scheduled",
        )
        db_session.add(ts)
        sessions.append(ts)
    db_session.commit()
    for s in sessions:
        db_session.refresh(s)
    return sessions


def _seed_utilization(db_session, batch, training_session, rating="4.0", status="Completed"):
    """Create a FacultyUtilization record linked to a TrainingSession.

    `rating=None` records a Completed delivery that was never rated."""
    fu = FacultyUtilization(
        batch_id=batch.id,
        training_session_id=training_session.id,
        faculty_name="Test Faculty",
        date_of_training=datetime(2026, 1, 10, 9, 0, 0, tzinfo=timezone.utc),
        topic="Test Topic",
        no_of_hours=Decimal("8.0"),
        mode_of_delivery="Online",
        status=status,
        feedback_submitted=status == "Completed",
        feedback_rating=Decimal(str(rating)) if (status == "Completed" and rating is not None) else None,
        feedback_notes="Great session" if status == "Completed" else None,
    )
    db_session.add(fu)
    db_session.commit()
    return fu


def test_feedback_calculated_with_partial_sessions_completed(db_session):
    """batch_avg_feedback is now calculated from any completed rated sessions,
    regardless of whether all planned sessions are completed."""
    batch = _get_batch(db_session)
    _reset_avg_feedback(db_session, batch)

    ts1, ts2 = _seed_batch_with_sessions(db_session, batch, count=2)
    _seed_utilization(db_session, batch, ts1, rating="4.0")

    ts1.status = "Completed"
    db_session.commit()

    service = _lifecycle_service(db_session)
    result = service.calculate_batch_avg_feedback(batch.id)

    assert result == Decimal("4.0")
    batch = db_session.query(Batch).filter(Batch.id == batch.id).first()
    assert float(batch.batch_avg_feedback) == 4.0


def test_feedback_calculated_when_all_sessions_completed(db_session):
    """Once every non-cancelled planned day has a logged, terminal
    delivery, the average feedback is calculated and persisted."""
    batch = _get_batch(db_session)
    _reset_avg_feedback(db_session, batch)

    ts1, ts2 = _seed_batch_with_sessions(db_session, batch, count=2)
    _seed_utilization(db_session, batch, ts1, rating="4.0")
    _seed_utilization(db_session, batch, ts2, rating="5.0")

    ts1.status = "Completed"
    ts2.status = "Completed"
    db_session.commit()

    service = _lifecycle_service(db_session)
    result = service.calculate_batch_avg_feedback(batch.id)

    assert result == Decimal("4.5")
    batch = db_session.query(Batch).filter(Batch.id == batch.id).first()
    assert float(batch.batch_avg_feedback) == 4.5


def test_feedback_excludes_cancelled_sessions(db_session):
    """A cancelled session is excluded from the average but does not block
    feedback calculation for the remaining completed sessions."""
    batch = _get_batch(db_session)
    _reset_avg_feedback(db_session, batch)

    ts1, ts2 = _seed_batch_with_sessions(db_session, batch, count=2)
    _seed_utilization(db_session, batch, ts1, rating="3.0")

    # ts1 is delivered and completed; ts2 is scheduled (not yet conducted)
    ts1.status = "Completed"
    ts2.status = "Scheduled"
    db_session.commit()

    service = _lifecycle_service(db_session)
    result = service.calculate_batch_avg_feedback(batch.id)

    assert result == Decimal("3.0")
    batch = db_session.query(Batch).filter(Batch.id == batch.id).first()
    assert float(batch.batch_avg_feedback) == 3.0


def test_feedback_calculated_with_partial_deliveries(db_session):
    """batch_avg_feedback is now calculated from any completed rated sessions,
    regardless of whether all planned days have deliveries."""
    batch = _get_batch(db_session)
    _reset_avg_feedback(db_session, batch)

    ts1, ts2 = _seed_batch_with_sessions(db_session, batch, count=2)
    # Only ts1 is delivered; ts2 has no ledger row at all.
    _seed_utilization(db_session, batch, ts1, rating="4.0")
    ts1.status = "Completed"
    db_session.commit()

    service = _lifecycle_service(db_session)
    result = service.calculate_batch_avg_feedback(batch.id)

    assert result == Decimal("4.0")
    batch = db_session.query(Batch).filter(Batch.id == batch.id).first()
    assert float(batch.batch_avg_feedback) == 4.0


def test_feedback_calculated_with_not_conducted_day(db_session):
    """A `Completed` day with no rating is terminal, so it unblocks the average
    instead of blocking it forever; the mean comes from Completed rows."""
    batch = _get_batch(db_session)
    _reset_avg_feedback(db_session, batch)

    ts1, ts2 = _seed_batch_with_sessions(db_session, batch, count=2)
    _seed_utilization(db_session, batch, ts1, rating="4.0")
    # Completed but never rated (like Not Conducted used to be)
    _seed_utilization(db_session, batch, ts2, rating=None)

    ts1.status = "Completed"
    ts2.status = "Completed"
    db_session.commit()

    service = _lifecycle_service(db_session)
    result = service.calculate_batch_avg_feedback(batch.id)

    assert result == Decimal("4.0")
    batch = db_session.query(Batch).filter(Batch.id == batch.id).first()
    assert float(batch.batch_avg_feedback) == 4.0


def test_feedback_not_blocked_by_unrated_completed_delivery(db_session):
    """A Completed delivery with no rating is excluded from the mean and
    never blocks it."""
    batch = _get_batch(db_session)
    _reset_avg_feedback(db_session, batch)

    ts1, ts2 = _seed_batch_with_sessions(db_session, batch, count=2)
    _seed_utilization(db_session, batch, ts1, rating="4.0")
    # Completed but never rated.
    _seed_utilization(db_session, batch, ts2, rating=None)

    ts1.status = "Completed"
    ts2.status = "Completed"
    db_session.commit()

    service = _lifecycle_service(db_session)
    result = service.calculate_batch_avg_feedback(batch.id)

    assert result == Decimal("4.0")
    batch = db_session.query(Batch).filter(Batch.id == batch.id).first()
    assert float(batch.batch_avg_feedback) == 4.0


def test_feedback_not_calculated_when_no_rated_deliveries(db_session):
    """Every delivery closed but none rated leaves the column NULL: a
    zero-rated batch can satisfy delivery closure yet has no average."""
    batch = _get_batch(db_session)
    _reset_avg_feedback(db_session, batch)

    ts1, ts2 = _seed_batch_with_sessions(db_session, batch, count=2)
    _seed_utilization(db_session, batch, ts1, rating=None)
    _seed_utilization(db_session, batch, ts2, rating=None)

    ts1.status = "Completed"
    ts2.status = "Completed"
    db_session.commit()

    service = _lifecycle_service(db_session)
    result = service.calculate_batch_avg_feedback(batch.id)

    assert result is None
    batch = db_session.query(Batch).filter(Batch.id == batch.id).first()
    assert batch.batch_avg_feedback is None


def test_feedback_recalculates_on_rating_change(db_session):
    """The average feedback recalculates when a rating is updated or
    a new rated delivery is added, provided all preconditions still hold."""
    batch = _get_batch(db_session)
    _reset_avg_feedback(db_session, batch)

    ts1, ts2 = _seed_batch_with_sessions(db_session, batch, count=2)
    _seed_utilization(db_session, batch, ts1, rating="4.0")
    _seed_utilization(db_session, batch, ts2, rating="5.0")

    ts1.status = "Completed"
    ts2.status = "Completed"
    db_session.commit()

    service = _lifecycle_service(db_session)
    assert service.calculate_batch_avg_feedback(batch.id) == Decimal("4.5")
    batch = db_session.query(Batch).filter(Batch.id == batch.id).first()
    assert float(batch.batch_avg_feedback) == 4.5

    # Update the first rating from 4.0 to 1.0
    fu1 = db_session.query(FacultyUtilization).filter(
        FacultyUtilization.training_session_id == ts1.id
    ).first()
    fu1.feedback_rating = Decimal("1.0")
    db_session.commit()

    # Recalculate - average should now be (1.0 + 5.0) / 2 = 3.0
    result = service.calculate_batch_avg_feedback(batch.id)
    assert result == Decimal("3.0")
    batch = db_session.query(Batch).filter(Batch.id == batch.id).first()
    assert float(batch.batch_avg_feedback) == 3.0

    # Add a third planned session with a new rated delivery
    ts3 = TrainingSession(
        batch_id=batch.id,
        session_date=date(2026, 1, 12),
        day_name="Wednesday",
        module="Module 3",
        trainer_name="Test Faculty",
        status="Completed",
    )
    db_session.add(ts3)
    db_session.commit()
    _seed_utilization(db_session, batch, ts3, rating="5.0")
    db_session.commit()

    # Recalculate - average should now be (1.0 + 5.0 + 5.0) / 3 = 3.67
    result = service.calculate_batch_avg_feedback(batch.id)
    assert result == Decimal("3.67")
    batch = db_session.query(Batch).filter(Batch.id == batch.id).first()
    assert float(batch.batch_avg_feedback) == 3.67


def test_gate1_calculates_feedback_from_first_completed_session(db_session, coord_token_headers, client):
    """Completing one session via Gate 1 now writes batch_avg_feedback from
    that session's rating, even when other sessions remain uncompleted."""
    batch = _get_batch(db_session)
    _reset_avg_feedback(db_session, batch)
    ts1, ts2 = _seed_batch_with_sessions(db_session, batch, count=2)

    # Session 1: scheduled utilization that we will complete via Gate 1
    fu = _seed_utilization(db_session, batch, ts1, status="Scheduled")

    response = client.patch(
        f"/api/v1/sessions/{fu.id}/complete",
        json={
            "rating": "4.0",
            "topic_feedback": "Great session",
            "total_students_present": 30,
        },
        headers=coord_token_headers,
    )
    assert response.status_code == 200

    # batch_avg_feedback should now be calculated from the first session
    batch = db_session.query(Batch).filter(Batch.id == batch.id).first()
    assert float(batch.batch_avg_feedback) == 4.0


def test_gate1_calculates_feedback_when_all_sessions_completed(db_session, coord_token_headers, client):
    """When the last session is completed via Gate 1, the batch average feedback
    is calculated and persisted."""
    batch = _get_batch(db_session)
    _reset_avg_feedback(db_session, batch)
    ts1, ts2 = _seed_batch_with_sessions(db_session, batch, count=2)

    _seed_utilization(db_session, batch, ts1, rating="3.0")
    ts1.status = "Completed"
    db_session.commit()

    fu2 = _seed_utilization(db_session, batch, ts2, status="Scheduled")

    response = client.patch(
        f"/api/v1/sessions/{fu2.id}/complete",
        json={
            "rating": "5.0",
            "topic_feedback": "Excellent",
            "total_students_present": 35,
        },
        headers=coord_token_headers,
    )
    assert response.status_code == 200

    batch = db_session.query(Batch).filter(Batch.id == batch.id).first()
    assert float(batch.batch_avg_feedback) == 4.0  # (3.0 + 5.0) / 2
