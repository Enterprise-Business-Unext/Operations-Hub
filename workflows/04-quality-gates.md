# Quality Gates

## Overview

There are two quality checkpoints (Gates) that must be completed before a batch can be closed. Gate 1 is per-session feedback. Gate 2 is batch-level NPS closure.

## Gate 1 (Session Feedback)

### Endpoint: `PATCH /api/v1/sessions/{id}/complete`

**Purpose:** Record feedback for a delivered session and mark it as Completed.

**Payload:**
```json
{
  "rating": 4.5,
  "topic_feedback": "Good engagement on async concepts.",
  "faculty_observations": "Students struggled with event loops.",
  "total_students_present": 42
}
```

**Validation Rules:**
- `rating`: Decimal, must be `>= 1.0` and `<= 5.0`
- `topic_feedback`: String, minimum 3 characters
- `total_students_present`: Integer, `>= 0`
- Session must not already be in a terminal status (`Completed`, `Cancelled`, `Not Conducted`)

**Actions:**
1. Set `status="Completed"`
2. Set `feedback_submitted=True`
3. Store `feedback_rating`
4. Store `feedback_notes` = `topic_feedback` + optional `faculty_observations` appended
5. If linked to a `TrainingSession`, mark that session `Completed` too
6. Trigger `batch_avg_feedback` calculation via lifecycle service

**Failure Mode:** If session is terminal, returns 409 Conflict.

## Gate 2 (Batch NPS Closure)

### Endpoint: `POST /api/v1/batches/{id}/close`

**Purpose:** Close the batch by computing NPS from promoter/passive/detractor counts.

**Payload:** `BatchNpsClosureCreate` (defined in `backend/app/schemas/feedback.py`)

```json
{
  "promoters_count": 35,
  "passive_count": 3,
  "detractors_count": 2,
  "nps_available": true,
  "nps_unavailable_reason": null
}
```

**Schema Field Requirements:**
| Field | Type | Default | Constraints |
|-------|------|---------|-------------|
| `promoters_count` | int | 0 | >= 0 |
| `passive_count` | int | 0 | >= 0 |
| `detractors_count` | int | 0 | >= 0 |
| `nps_available` | bool | true | — |
| `nps_unavailable_reason` | str | null | Min 3 chars; required when `nps_available` is false |

**Preconditions (BOTH required):**
1. `batch_avg_feedback` is not None (at least one rated delivery exists)
2. ALL sessions (scheduled + logged) are terminal:
   - All `TrainingSession` rows are `Completed`, `Cancelled`, or `Not Conducted`
   - All `FacultyUtilization` rows are `Completed`, `Cancelled`, or `Not Conducted`

**Validation Rules:**
- `promoters_count`, `passive_count`, `detractors_count`: all `>= 0`
- `nps_unavailable_reason` is required when `nps_available=false` (enforced by Pydantic `model_validator`)
- When `nps_available=true`: `total = promoters + passives + detractors` must be `> 0`
- Client-supplied `nps_score` or `average_feedback_score` are ignored (server computes)

**Actions:**
1. If `nps_available` is false:
   - Set all NPS fields (`batch_nps`, `nps_total_responses`, `nps_promoters`, `nps_passives`, `nps_detractors`) to NULL
   - Append NPS skip reason to `remarks`
   - Set `status="Completed"`, `is_schema_locked=True`
   - Delete batch's `batch_edit_history` rows
2. If `nps_available` is true:
   - Compute `batch_nps = ((promoters - detractors) / total) * 100` (rounded to 2 decimal places)
   - Store `nps_total_responses`, `nps_promoters`, `nps_passives`, `nps_detractors`
3. Set `status="Completed"`, `is_schema_locked=True`
4. Delete batch's `batch_edit_history` rows in the same transaction
5. Trigger notification

**Failure Modes:**
- `batch_avg_feedback is None` → 409 Conflict: "Quality Checkpoint 1 must be completed before batch closure"
- Non-terminal sessions exist → 409 Conflict: "Every session must have a terminal outcome before batch closure"
- `nps_available=true` and total responses = 0 → 422 Unprocessable Entity

## Batch Average Feedback Calculation

### When It Runs

- After any Gate 1 completion
- After any session create/update/cancel/not-conducted/reschedule
- During nightly batch lifecycle sync

### Preconditions for Writing `batch_avg_feedback`

Only ONE condition must hold:

1. **At least one rated delivery:** At least one `Completed` row has `feedback_rating IS NOT NULL`

### Calculation Rules

- Mean is taken over **rated rows only** (Completed sessions with feedback_rating)
- Unrated `Completed` rows are excluded from mean
- `Cancelled` and `Not Conducted` rows are excluded from mean
- Result rounded to 2 decimal places
- Recalculates on every call when at least one rating exists (idempotent)

### Example Scenarios

| Scenario | batch_avg_feedback |
|----------|-------------------|
| All sessions completed, all rated | Written (mean of all ratings) |
| All sessions completed, some unrated | Written (mean of rated only) |
| Some sessions Cancelled, rest completed and rated | Written (Cancelled excluded) |
| Some sessions Not Conducted, rest completed and rated | Written (Not Conducted excluded) |
| Only 1 session completed with rating, others Scheduled | Written (mean of that 1 rating) |
| No rated Completed rows | NOT written (no ratings to average) |

## Gate Sequencing

```
Session Delivery
      ↓
Gate 1 (Session Feedback)
  - rating 1.0-5.0
  - feedback_submitted = True
  - session.status = Completed
      ↓
batch_avg_feedback calculation
  - waits for at least one rated delivery
      ↓
Gate 2 (Batch NPS Closure)
  - requires batch_avg_feedback IS NOT NULL
  - requires ALL sessions terminal
  - computes NPS from promoters/passives/detractors
  - batch.status = Completed
```

## Terminal Statuses

The set `TERMINAL_UTILIZATION_STATUSES = frozenset({"Completed", "Cancelled", "Not Conducted"})` is defined once and used consistently by:
- Session outcome transitions
- Gate 2 precondition check

## Batch Quality Fields (from SQLAlchemy)

The `batches` table includes these quality-related fields:
- `batch_avg_feedback` (Numeric(3,2)) - Average feedback score (1.0-5.0)
- `batch_nps` (Numeric(6,2)) - Calculated NPS (-100 to 100)
- `nps_total_responses` (Integer) - Total feedback responses
- `nps_promoters` (Integer) - Promoter count (score 9-10)
- `nps_passives` (Integer) - Passive count (score 7-8)
- `nps_detractors` (Integer) - Detractor count (score 0-6)
- `remarks` (Text) - Batch remarks including audit trail

## Session Quality Fields (from SQLAlchemy)

### TrainingSession
- No direct quality fields (planned schedule only)

### FacultyUtilization
- `feedback_submitted` (Boolean) - Feedback submitted flag
- `feedback_rating` (Numeric(3,2)) - Feedback score (1.0-5.0)
- `feedback_notes` (Text) - Detailed feedback
- `outcome_reason` (Text) - Outcome explanation for Cancelled/Not Conducted
- `outcome_at` (TIMESTAMPTZ) - Outcome timestamp
- `outcome_by` (FK to users.id) - User who recorded outcome