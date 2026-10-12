# Schedule Ingestion Workflow

## Overview

The schedule ingestion system reads Excel/CSV files and converts them into `TrainingSession` records for a batch. It supports multiple Excel formats and validates all rows before persisting.

## Endpoints

### Ingest (No Persistence)
`POST /api/v1/schedules/ingest`

- Accepts `UploadFile` (max 10MB, extensions: `.xlsx`, `.xls`, `.csv`)
- Returns extracted items and errors without saving to database

### Apply (Persist)
`POST /api/v1/schedules/apply`

- Accepts `ScheduleApplyRequest` with `target_batch_id` and `items`
- Validates and persists all sessions atomically

## Supported Excel Formats

### Format 1: Flat
Standard rows with Date, Topic, Time, Faculty, etc.

**Required columns:** Date of Training, Topic
**Optional columns:** Start Time, End Time, Faculty Name, Hours, Venue, Location City, Mode of Delivery

### Format 2: TOC (Table of Contents)
Day headers with dates, subtopics underneath.

**Required columns:** Date, Subtopic/Topic
**Behavior:** Day header row sets date for subsequent subtopic rows until next date

### Format 3: Curriculum
Module/Subtopic/Hours without dates.

**Behavior:** Assigns sequential dates starting from 2026-01-01

### Format 4: Topic-Column
Date + topic columns with complex names.

**Required columns:** Date
**Behavior:** Each non-metadata column is treated as a topic

## Column Alias Mapping

The system normalizes column headers to canonical field names:

| Canonical Field | Accepted Aliases |
|-----------------|------------------|
| `batch_id` | batch id, batch_id, batch, batch code, batch no |
| `date_of_training` | date of training, training date, date, session date |
| `start_time` | start time, start, session start |
| `end_time` | end time, end, session end |
| `topic` | topic, session topic, module, subject, program, program name |
| `faculty_name` | faculty name, faculty, trainer, instructor |
| `no_of_hours` | no of hours, hours, duration, session hours |
| `venue` | venue, room, location |
| `location_city` | location city, city, location |
| `mode_of_delivery` | mode of delivery, delivery mode, mode, delivery |

## Apply Schedule Conditions

### Preconditions
- Batch must exist
- User has operational scope on batch
- Schedule changes are allowed at any batch status except `Completed`

When more scheduled sessions are needed than the approved `training_days`,
update the batch end date, `training_days`, and `total_hours`; the business-field
edit returns the batch to Approval 1 and records the before/after values for both
approvers. Schedule changes may be added while reapproval is pending. A completed
batch remains read-only for schedule changes; other status values, including
Cancelled, do not block schedule changes.

### Per-Row Validation

The schedule is limited by scheduled session rows, not distinct dates. Each row
in `training_sessions` counts as one session, including multiple modules on the
same date. Applying a schedule or editing the batch is rejected if the resulting
session count would exceed `training_days`.

| Rule | Condition | Error |
|------|-----------|-------|
| Batch match | `item.batch_id` matches target batch or is null | "Row belongs to a different batch" |
| Date lower bound | `item_date >= batch.start_date` | "Training date is before batch start date" |
| Date upper bound | `item_date <= batch.end_date` | "Training date is after batch end date" |
| Faculty required | `faculty_name` or `batch.faculty_assigned_text` present | "Faculty name is required" |
| Duplicate row | Same `(date, start_time, end_time, topic)` in same upload | "Duplicate schedule row in upload" |
| Existing session | Same `(batch_id, session_date, module)` already in DB | "Matching session already exists for this batch" |
| Overlap | Same faculty, same date, overlapping times in same upload | "Overlaps another uploaded session from row X" |

## Missing Session Auto-Generation

If `batch.training_days > number of scheduled sessions`:

1. Requires `batch.faculty_assigned_text` to be set
2. Fills missing session slots using weekdays (Mon-Fri) in the batch date range
3. Creates placeholder sessions with `module="Generated training day - details required"`
4. If not enough weekdays available, returns error

## Persistence Rules

- All sessions created in a single transaction
- `sequence_number` auto-assigned in order
- `day_name` derived from `session_date`
- `status="Scheduled"` for all new sessions
- Unique constraint on `(batch_id, session_date, module)` prevents duplicates

## Effective Status

`TrainingSession.effective_status` is a computed property:
- `status == "Completed"` → `Completed`
- `session_date > today` → `Upcoming`
- `session_date == today` → `Ongoing`
- `session_date < today` → `Overdue`

## TrainingSession Model Fields (from SQLAlchemy)

- `id` (UUID, PK)
- `batch_id` (FK to batches.id, CASCADE delete)
- `sequence_number` (Integer, nullable)
- `week` (String, nullable)
- `session_date` (DATE, not nullable, indexed)
- `day_name` (String, nullable)
- `start_time` (TIME, nullable)
- `end_time` (TIME, nullable)
- `duration_hours` (Numeric(5,2), default: 8.00)
- `module` (Text, not nullable)
- `trainer_name` (String, nullable, indexed)
- `status` (Enum: Scheduled, InProgress, Completed, Cancelled, NotConducted, Rescheduled)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

Unique Constraint: `(batch_id, session_date, module)`

## Validation Details

### Date Parsing
- Handles Excel serial dates, ISO strings, and various date formats
- All dates stored as DATE type (no timezone for session_date)
- `date_of_training` in FacultyUtilization is TIMESTAMPTZ

### Time Parsing
- Accepts HH:MM, H:MM, HH:MM:SS formats
- Stored as TIME type

### Faculty Resolution
During apply, faculty names are resolved:
1. Exact match on User.full_name with role="Faculty"
2. ILIKE match on User.full_name with role="Faculty"
3. Exact match on any active User.full_name
4. ILIKE match on any active User.full_name
5. Falls back to free-text name if no match

### Conflict Detection
- Checks for faculty double-booking on same date with overlapping times
- Checks against existing TrainingSession records in database
- Checks within the same upload for duplicates

## Error Handling

- Ingest endpoint returns extracted rows + validation errors without persisting
- Apply endpoint validates all rows first, then persists atomically
- Any validation failure rolls back entire transaction
- Detailed error messages include row numbers and specific issues