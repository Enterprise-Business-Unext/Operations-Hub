from sqlalchemy import create_engine, text

from app.db.init_db import _normalize_legacy_session_statuses


def test_normalize_legacy_session_statuses():
    engine = create_engine("sqlite:///:memory:")
    try:
        with engine.begin() as connection:
            connection.execute(text(
                "CREATE TABLE training_sessions (id INTEGER PRIMARY KEY, status VARCHAR(30))"
            ))
            connection.execute(text(
                "CREATE TABLE faculty_utilization (id INTEGER PRIMARY KEY, status VARCHAR(30))"
            ))
            connection.execute(text(
                "INSERT INTO training_sessions (status) VALUES "
                "('Cancelled'), ('NotConducted'), ('Not Conducted'), ('Rescheduled'), "
                "('InProgress'), ('In Progress'), ('Scheduled'), ('Completed')"
            ))
            connection.execute(text(
                "INSERT INTO faculty_utilization (status) VALUES "
                "('Cancelled'), ('InProgress'), ('Completed')"
            ))

            _normalize_legacy_session_statuses(connection)

            training_statuses = connection.execute(text(
                "SELECT status FROM training_sessions ORDER BY id"
            )).scalars().all()
            utilization_statuses = connection.execute(text(
                "SELECT status FROM faculty_utilization ORDER BY id"
            )).scalars().all()

        assert training_statuses == [
            "Cancelled", "NotConducted", "NotConducted", "Rescheduled",
            "InProgress", "InProgress", "Scheduled", "Completed",
        ]
        assert utilization_statuses == ["Cancelled", "InProgress", "Completed"]
    finally:
        engine.dispose()
