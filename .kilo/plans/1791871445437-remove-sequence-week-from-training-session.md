# Plan: Remove sequence_number and week from TrainingSession Model

## Goal
Remove `sequence_number` and `week` columns from the `TrainingSession` SQLAlchemy model in `backend/app/models/session.py` without creating a database migration.

## Current State
The `TrainingSession` class in `backend/app/models/session.py` has these two columns (lines 42-43):
```python
sequence_number = Column(Integer, nullable=True)
week = Column(String(50), nullable=True)
```

## Tasks
1. **Edit `backend/app/models/session.py`** - Remove the two column definitions from the `TrainingSession` class
2. **Verify the change** - Confirm the columns are removed from the model

## Notes
- No migration needed - this only affects the SQLAlchemy model definition
- The database columns will remain in the database but will no longer be mapped by the ORM
- If the columns need to be dropped from the database, that would require a separate migration (out of scope)

## Validation
After the change, the `TrainingSession` model should have these columns in order:
- id
- batch_id
- session_date
- day_name
- start_time
- end_time
- duration_hours
- module
- trainer_name
- status
- created_at
- updated_at