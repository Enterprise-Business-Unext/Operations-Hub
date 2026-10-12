# Scheduled Jobs

## Overview

The backend uses APScheduler with a daily cron job at 00:30 IST (19:00 UTC previous day).

## Batch Lifecycle Sync Job

### Schedule
- **Frequency:** Daily at 00:30 IST
- **Job ID:** `batch_lifecycle_sync`
- **Trigger:** `CronTrigger(hour=0, minute=30, timezone=ist)`

### What It Does

**1. Sync Batch Statuses**
- `Upcoming` batches where `start_date <= today` → `Ongoing`
- `Ongoing` batches where `end_date < today` → `Pending for Closure`

**2. Sync Session Statuses**
- For each `FacultyUtilization` with `status="Completed"` and `training_session_id` set:
  - If linked `TrainingSession` is not `Completed`, mark it `Completed`

**3. Recalculate Batch Average Feedback**
- For every batch where `batch_avg_feedback IS NULL`:
  - Attempt to calculate average feedback
  - Only writes if at least one rated delivery exists

### Return Value
```python
{
    "batch_status_updates": int,
    "session_status_updates": int,
    "batch_feedback_calculated": int
}
```

## Manual Trigger

### Endpoint: `POST /api/v1/batches/{id}/sync-status`

**Conditions:**
- User must be Admin

**Flow:**
1. Calls `lifecycle_service.sync_all()`
2. Returns the updated batch

## Startup Behavior

- Runs `init_db()` in every environment to ensure required schema columns and
  enum values exist
- Production skips optional base-data seeding

On shutdown:
- Stops the scheduler cleanly

## Scheduler Configuration (from backend/app/core/scheduler.py)

The scheduler is initialized in `main.py` on startup:
- Uses `AsyncIOScheduler` from APScheduler
- Timezone: `Asia/Kolkata` (IST)
- Job store: In-memory (default)

## Lifecycle Service (from backend/app/api/v1/batches/lifecycle_service.py)

The `BatchLifecycleService` handles:
- `sync_all()` - Runs all sync operations
- `sync_batch_statuses()` - Auto-transitions batch statuses based on dates
- `sync_session_statuses()` - Syncs TrainingSession status from FacultyUtilization
- `recalculate_batch_feedback()` - Calculates batch_avg_feedback for batches without it
- `calculate_batch_avg_feedback(batch_id)` - Calculates average for a single batch

## Batch Status Auto-Transition Logic

The following transitions happen automatically:

| Current Status | Condition | New Status |
|----------------|-----------|------------|
| `Upcoming` | `start_date <= today` | `Ongoing` |
| `Ongoing` | `end_date < today` | `Pending for Closure` |

Note: These transitions only happen if the batch is not already in a terminal state (`Completed`, `Cancelled`, `OnHold`).

## Session Status Sync Logic

For each `FacultyUtilization` record:
- If `status == "Completed"` AND `training_session_id` is set
- And the linked `TrainingSession.status != "Completed"`
- Then set `TrainingSession.status = "Completed"`

This ensures the planned timetable reflects actual delivery.

## Feedback Recalculation Logic

For batches where `batch_avg_feedback IS NULL`:
1. Query all `FacultyUtilization` for the batch where:
   - `status == "Completed"`
   - `feedback_rating IS NOT NULL`
2. If count > 0:
   - Compute mean of `feedback_rating`
   - Round to 2 decimal places
   - Update `batch.batch_avg_feedback`

This runs nightly to catch any batches that had rated deliveries but weren't updated via the Gate 1 trigger.

## Timezone Handling

- All timestamps stored as `TIMESTAMPTZ` in UTC
- Scheduler runs in IST (Asia/Kolkata)
- Date comparisons use `datetime.now(IST).date()` for "today"
- Batch `start_date` and `end_date` are compared as dates (time component ignored for status transitions)

## Development vs Production

| Environment | Schema initialization | Base-data seeding | Scheduler |
|-------------|-----------------------|-------------------|-----------|
| Development | Yes (`init_db()`) | Yes | Yes |
| Production | Yes (`init_db()`) | No | Yes |

## Monitoring

The scheduler job logs:
- Number of batch status updates
- Number of session status updates
- Number of batch feedback calculations

These metrics are returned by the job and can be monitored via logs.