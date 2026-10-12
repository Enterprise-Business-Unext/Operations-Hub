from datetime import date, datetime, timezone
from decimal import Decimal
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pandas as pd
import pytest
from fastapi import HTTPException

from app.api.v1.schedules.service import ExcelIngestionService
from app.schemas.schedule import ExtractedScheduleItem


def test_extracts_schedule_rows_from_all_excel_sheets():
    workbook = BytesIO()
    with pd.ExcelWriter(workbook, engine="openpyxl") as writer:
        pd.DataFrame([
            {
                "Batch ID": "BATCH-001",
                "Training Date": "2026-10-15",
                "Start Time": "09:00",
                "End Time": "17:00",
                "Session Topic": "Python Fundamentals",
                "Faculty": "Dr. Jane Smith",
                "Hours": 8,
                "City": "Bengaluru",
            }
        ]).to_excel(writer, sheet_name="Schedule", index=False)
        pd.DataFrame([
            {
                "Date": "2026-10-16",
                "Topic": "SQL Workshop",
                "Mode": "F2F",
            }
        ]).to_excel(writer, sheet_name="Day 2", index=False)
    workbook.seek(0)

    result = ExcelIngestionService.ingest_schedule_file(
        file_contents=workbook.getvalue(),
        filename="schedule.xlsx",
        target_batch_id="BATCH-DEFAULT",
    )

    assert result.success is True
    assert result.sheets_processed == ["Schedule", "Day 2"]
    assert result.total_rows == 2
    assert result.extracted_rows == 2
    assert result.failed_rows == 0
    assert result.items[0].batch_id == "BATCH-001"
    assert result.items[0].topic == "Python Fundamentals"
    assert result.items[0].faculty_name == "Dr. Jane Smith"
    assert str(result.items[0].start_time) == "09:00:00"
    assert result.items[1].batch_id == "BATCH-DEFAULT"
    assert result.items[1].mode_of_delivery == "F2F"


def test_reports_invalid_rows_without_discarding_valid_rows():
    csv_contents = b"Date,Topic,Faculty\n2026-10-15,Valid topic,Dr. Smith\nnot-a-date,,\n"

    result = ExcelIngestionService.ingest_schedule_file(
        file_contents=csv_contents,
        filename="schedule.csv",
    )

    assert result.success is False
    assert result.total_rows == 2
    assert result.extracted_rows == 1
    assert result.failed_rows == 1
    assert result.items[0].topic == "Valid topic"
    assert result.errors[0].source_sheet == "CSV"
    assert result.errors[0].source_row == 3


def test_missing_date_column_marks_rows_as_failed():
    csv_contents = b"Topic,Faculty\nSQL Workshop,Dr. Smith\n"

    result = ExcelIngestionService.ingest_schedule_file(
        file_contents=csv_contents,
        filename="schedule.csv",
    )

    assert result.success is False
    assert result.extracted_rows == 0
    assert result.failed_rows == 1
    assert "training date column" in result.errors[0].message


def test_schedule_autofill_accounts_for_preexisting_training_dates():
    batch_id = uuid4()
    first_date = date(2026, 10, 12)
    batch = SimpleNamespace(
        id=batch_id,
        batch_id="BATCH-001",
        status="Upcoming",
        training_days=2,
        start_date=datetime(2026, 10, 12, tzinfo=timezone.utc),
        end_date=datetime(2026, 10, 16, tzinfo=timezone.utc),
        faculty_assigned_text="Dr. Faculty",
    )
    existing = SimpleNamespace(session_date=first_date)
    schedule_repo = MagicMock()
    schedule_repo.get_batch_by_batch_id.return_value = batch
    schedule_repo.list_scheduled_sessions_for_batch.return_value = [existing]
    schedule_repo.find_existing_session.return_value = None
    def persist_sessions(sessions):
        for session in sessions:
            session.id = uuid4()
        return sessions

    schedule_repo.persist_sessions.side_effect = persist_sessions
    schedule_repo.get_scheduled_session_count.return_value = 2

    item = ExtractedScheduleItem(
        source_sheet="Schedule",
        source_row=2,
        date_of_training=datetime(2026, 10, 13, tzinfo=timezone.utc),
        topic="New module",
        faculty_name="Dr. Faculty",
        no_of_hours=Decimal("8.0"),
    )

    result = ExcelIngestionService.apply_schedule_items(
        schedule_repo=schedule_repo,
        user_repo=MagicMock(),
        target_batch_id="BATCH-001",
        items=[item],
    )

    created_sessions = schedule_repo.persist_sessions.call_args.args[0]
    assert result.applied_rows == 1
    assert len(created_sessions) == 1
    assert created_sessions[0].session_date == date(2026, 10, 13)


def test_schedule_ingestion_is_allowed_while_reapproval_is_pending():
    batch = SimpleNamespace(
        id=uuid4(),
        batch_id="BATCH-001",
        status="Approval 1 Pending",
        training_days=1,
        start_date=datetime(2026, 10, 12, tzinfo=timezone.utc),
        end_date=datetime(2026, 10, 12, tzinfo=timezone.utc),
        faculty_assigned_text="Dr. Faculty",
    )
    schedule_repo = MagicMock()
    schedule_repo.get_batch_by_batch_id.return_value = batch
    schedule_repo.list_scheduled_sessions_for_batch.return_value = []
    schedule_repo.find_existing_session.return_value = None
    schedule_repo.persist_sessions.side_effect = lambda sessions: [
        setattr(session, "id", uuid4()) or session for session in sessions
    ]
    schedule_repo.get_scheduled_session_count.return_value = 1
    item = ExtractedScheduleItem(
        source_sheet="Schedule",
        source_row=2,
        date_of_training=datetime(2026, 10, 12, tzinfo=timezone.utc),
        topic="Approved-pending day",
        faculty_name="Dr. Faculty",
        no_of_hours=Decimal("8.0"),
    )

    result = ExcelIngestionService.apply_schedule_items(
        schedule_repo=schedule_repo,
        user_repo=MagicMock(),
        target_batch_id="BATCH-001",
        items=[item],
    )
    assert result.success is True
    schedule_repo.persist_sessions.assert_called_once()


def test_schedule_ingestion_is_blocked_for_completed_batch():
    batch = SimpleNamespace(id=uuid4(), batch_id="BATCH-001", status="Completed")
    schedule_repo = MagicMock()
    schedule_repo.get_batch_by_batch_id.return_value = batch

    with pytest.raises(HTTPException) as exc_info:
        ExcelIngestionService.apply_schedule_items(
            schedule_repo=schedule_repo,
            user_repo=MagicMock(),
            target_batch_id="BATCH-001",
            items=[],
        )
    assert exc_info.value.status_code == 409
    assert "completed batch" in exc_info.value.detail


def test_schedule_ingestion_over_capacity_requires_batch_edit_and_reapproval():
    batch_id = uuid4()
    batch = SimpleNamespace(
        id=batch_id,
        batch_id="BATCH-001",
        status="Upcoming",
        training_days=2,
        start_date=datetime(2026, 10, 12, tzinfo=timezone.utc),
        end_date=datetime(2026, 10, 16, tzinfo=timezone.utc),
        faculty_assigned_text="Dr. Faculty",
    )
    schedule_repo = MagicMock()
    schedule_repo.get_batch_by_batch_id.return_value = batch
    schedule_repo.list_scheduled_sessions_for_batch.return_value = [
        SimpleNamespace(session_date=date(2026, 10, 12)),
        SimpleNamespace(session_date=date(2026, 10, 12)),
    ]
    schedule_repo.find_existing_session.return_value = None

    item = ExtractedScheduleItem(
        source_sheet="Schedule",
        source_row=4,
        date_of_training=datetime(2026, 10, 14, tzinfo=timezone.utc),
        topic="Additional training day",
        faculty_name="Dr. Faculty",
        no_of_hours=Decimal("8.0"),
    )
    with pytest.raises(HTTPException) as exc_info:
        ExcelIngestionService.apply_schedule_items(
            schedule_repo=schedule_repo,
            user_repo=MagicMock(),
            target_batch_id="BATCH-001",
            items=[item],
        )

    assert exc_info.value.status_code == 422
    message = exc_info.value.detail["errors"][0]["message"]
    assert "end date" in message
    assert "training days" in message
    assert "total hours" in message
    assert "reapproval" in message
    schedule_repo.persist_sessions.assert_not_called()