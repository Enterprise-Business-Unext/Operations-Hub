# Fix TrainingSession Model - Remove `sequence_number` and `week`, Compute Dynamically

## Problem Summary

The `TrainingSession` SQLAlchemy model in `backend/app/models/session.py` is missing `sequence_number` and `week` columns that are expected by Pydantic schemas, service layer, repository, and frontend types.

**Error:** `ArgumentError: expected ORM mapped attribute for loader strategy argument; AttributeError: type object 'TrainingSession' has no attribute 'sequence_number'`

## Decision: Remove Columns, Compute Dynamically

Instead of adding the columns, we remove them entirely from the schema and compute values on-the-fly:

- **Ordering:** Sort by `session_date` ascending, then by `module` (or `id`) as tiebreaker for same-date sessions
- **Week:** Calculate as calendar weeks from `batch.start_date`: `((session_date - batch.start_date).days // 7) + 1`

## Affected Files

### Backend - Remove from Schema & Logic
1. `backend/app/models/session.py` - Remove columns from `TrainingSession` model (already absent, confirm)
2. `backend/app/schemas/session.py` - Remove `sequence_number` and `week` from `TrainingSessionBase`, `TrainingSessionCreate`, `TrainingSessionUpdate`, `TrainingSessionResponse`
3. `backend/app/api/v1/sessions/repository.py` - Remove `sequence_number` from `order_by`, remove `get_max_sequence_number()`
4. `backend/app/api/v1/sessions/service.py` - Remove `sequence_number`/`week` from response building, remove auto-assignment logic
5. `backend/app/api/v1/schedules/service.py` - Remove `sequence_number`/`week` from session creation during ingestion/apply
6. `backend/app/api/v1/batches/service.py` - Remove `sequence_number` from batch session exports

### Backend - Tests & Scripts (Update)
7. `backend/tests/v1/batches/test_batches.py` - Remove `sequence_number` from test fixtures
8. `backend/tests/v1/gates/test_feedback_calculation.py` - Remove `sequence_number` from test fixtures
9. `backend/scripts/seed_demo.py` - Remove `sequence_number`/`week` from demo data creation
10. `backend/scripts/migrate_rename_and_create_sessions.py` - Remove columns from migration script
11. `backend/app/db/init_db.py` - Remove `sequence_number` from column introspection

### Frontend - Remove from Types & Components
12. `frontend/lib/api.ts` - Remove `sequence_number` and `week` from `ScheduledSession` interface
13. `frontend/components/BatchDetailDrawer.tsx` - Replace `sequence_number` with computed index, compute week dynamically
14. `frontend/app/dashboard/components/ActiveBatchesView.tsx` - Remove sort/filter on `sequence_number`
15. `frontend/components/forms/batch/ApproveBatchModal.tsx` - Use computed index instead of `sequence_number`
16. `frontend/components/BatchDetailDrawer.tabs.test.tsx` - Update test fixtures
17. `frontend/components/BatchDetailDrawer.editEndDate.test.tsx` - Update test fixtures
18. `frontend/components/BatchDetailDrawer.utilization.test.tsx` - Update test fixtures
19. `frontend/app/dashboard/components/ActiveBatchesView.test.tsx` - Update test fixtures
20. `frontend/components/forms/batch/ApproveBatchModal.test.tsx` - Update test fixtures

## Implementation Plan

### Task 1: Backend - Pydantic Schemas
**File:** `backend/app/schemas/session.py`

Remove `sequence_number` and `week` from:
- `TrainingSessionBase` (lines 19-20)
- `TrainingSessionUpdate` (lines 54-55)
- `TrainingSessionResponse` - keep computed property if needed, or remove entirely

### Task 2: Backend - Repository
**File:** `backend/app/api/v1/sessions/repository.py`

- Line 37: Change `order_by(TrainingSession.session_date.asc(), TrainingSession.sequence_number.asc())` → `order_by(TrainingSession.session_date.asc(), TrainingSession.module.asc())`
- Remove `get_max_sequence_number()` method (lines 42-46)
- Update `IRepositoryInterface` accordingly

### Task 3: Backend - Session Service
**File:** `backend/app/api/v1/sessions/service.py`

- Line 133-134: Build `sequence_number` as enumerate index, compute `week` from batch.start_date
- Line 216-221: Remove `get_max_sequence_number` call and `sequence_number` assignment
- Update `create_scheduled()` to not set sequence_number

### Task 4: Backend - Schedule Ingestion Service
**File:** `backend/app/api/v1/schedules/service.py`

- Line 731: Remove `sequence_number=idx` from session creation
- Line 744: Remove `sequence_number=gen_idx` from generated sessions
- Remove `week` calculation logic

### Task 5: Backend - Batch Service
**File:** `backend/app/api/v1/batches/service.py`

- Line 420, 441: Remove `sequence_number` from session export

### Task 6: Frontend - API Types
**File:** `frontend/lib/api.ts`

- Lines 245, 360-361: Remove `sequence_number` and `week` from `ScheduledSession` interface

### Task 7: Frontend - BatchDetailDrawer
**File:** `frontend/components/BatchDetailDrawer.tsx`

- Line 3708: Replace `selectedScheduleDay?.sequence_number` with computed index (1-based from sorted list)
- Add helper to compute week: `Math.floor((sessionDate - batchStartDate) / (7 * 86400000)) + 1`

### Task 8: Frontend - ActiveBatchesView
**File:** `frontend/app/dashboard/components/ActiveBatchesView.tsx`

- Line 205: Remove `sequence_number` from search accessors
- Line 233: Remove "Sequence" sort option
- Line 255: Remove "Sequence" column
- Lines 499-501, 537: Use computed index instead

### Task 9: Frontend - ApproveBatchModal
**File:** `frontend/components/forms/batch/ApproveBatchModal.tsx`

- Line 370: Use `index + 1` instead of `session.sequence_number`

### Task 10: Update Tests & Scripts
Update all test fixtures and seed scripts to remove `sequence_number` and `week` fields.

## Dynamic Computation Logic

```python
# Python (backend)
def compute_week(batch_start_date: date, session_date: date) -> str:
    if not batch_start_date or not session_date:
        return "—"
    delta = (session_date - batch_start_date).days
    week_num = (delta // 7) + 1
    return f"Week {week_num}"

# TypeScript (frontend)
function computeWeek(batchStartDate: string, sessionDate: string): string {
  const start = new Date(batchStartDate);
  const session = new Date(sessionDate);
  const diffDays = Math.floor((session.getTime() - start.getTime()) / (7 * 86400000));
  return `Week ${diffDays + 1}`;
}
```

## Validation Steps

1. **Backend model:** Import `TrainingSession` - no AttributeError
2. **Schemas:** `TrainingSessionResponse.model_validate(orm_object)` works
3. **API:** `GET /api/v1/sessions/scheduled?batch_id=<id>` returns 200 with computed fields
4. **Frontend:** Batch detail drawer → Sessions tab loads, shows computed sequence/week
5. **Ingestion:** Ingest timetable → Apply creates sessions without sequence_number/week
6. **Sorting:** Sessions ordered by date, then module name
7. **Tests:** All backend and frontend tests pass

## Risk Assessment

- **Medium risk:** Breaking change across backend/frontend
- **No migration needed:** Columns don't exist in DB
- **Compute on read:** Slight performance cost, negligible for typical batch sizes (<100 sessions)
- **Week definition change:** From business weeks (5-day) to calendar weeks (7-day) - verify with stakeholders
- **Explicit ordering lost:** Same-date sessions sort alphabetically by module - acceptable?

## Dependencies

- All backend changes must deploy together
- Frontend changes must match backend API response shape
- No database migration required