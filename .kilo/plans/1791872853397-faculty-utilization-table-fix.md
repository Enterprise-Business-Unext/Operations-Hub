# Faculty Utilization Table Fix Plan

## Problem Summary

The faculty utilization table has three issues:
1. **Frontend/backend column mismatch**: Frontend defines 27+ columns in `UTILIZATION_COLUMN_DEFS` but some fields (client, category, batch_code, coordinator, entity, program, module_feedback, faculty_type_name) are resolved from relationships in the backend, not direct DB columns
2. **No manager-scoped access for coordinators**: Frontend calls `api.getSessions({ all: true })` which requires manager/admin role, blocking coordinators entirely
3. **Table not "proper"**: Likely refers to missing data, incorrect filtering, or UX issues

## Root Cause Analysis

### Data Flow
- Frontend: `FacultyUtilizationView` uses `TrainingSession` interface (frontend/lib/api.ts:317-355)
- API Call: `fetchFaculty()` calls `api.getSessions({ all: true })` (frontend/app/page.tsx:565)
- Backend: `/sessions` endpoint with `all=true` returns `List[SessionDetailResponse]` (backend/app/api/v1/sessions/controller.py:64-77)
- `SessionDetailResponse` includes relationship-resolved fields: entity, category, client, program, batch_code, coordinator, module_feedback, faculty_type_name
- Scoping: When `all=true`, requires manager/admin. When `all=false`, scopes to user's manager scope (backend/app/api/v1/sessions/service.py:85-110)

### Current Behavior
- Coordinators cannot access faculty utilization view (blocked by `require_manager_or_admin` when `all=true`)
- Managers/admins see all records
- No "team-only" view for coordinators

## Solution Design

### 1. Fix Frontend Role-Based API Call
**File**: `frontend/app/page.tsx`

Modify `fetchFaculty()` to pass `all` parameter based on user role:
- Manager/Admin → `all: true` (see all records)
- Coordinator → `all: false` (see scoped/team records only)
- Finance → `all: true` (per existing logic, finance sees all)

### 2. Verify Backend Scoping Logic
**File**: `backend/app/api/v1/sessions/service.py` (lines 85-110)

Current logic for `all=false`:
- Gets user's manager scope via `get_manager_scope_user_ids()`
- Returns batches where `primary_manager_id` is in scope OR `coordinator_id` is in scope
- This should correctly show "team entries" for coordinators

**Validation needed**: Confirm coordinator can see batches where:
- Their manager is primary_manager, OR
- They are the coordinator, OR
- Another coordinator under same manager is coordinator

### 3. Fix Frontend Column Definitions (if needed)
**File**: `frontend/app/dashboard/components/FacultyUtilizationView.tsx`

The `UTILIZATION_COLUMN_DEFS` already includes all 27 columns that map to `TrainingSession` interface. The `DEFAULT_HIDDEN` hides 22 columns by default, showing only 6 primary columns. This is intentional UX design.

**Action**: Verify all column accessors match `TrainingSession` interface fields. No changes needed if mapping is correct.

### 4. Ensure Backend Returns All Required Fields
**File**: `backend/app/api/v1/sessions/repository.py` (lines 64-86)

The `list_utilizations` query uses `joinedload` for:
- `batch.entity`, `batch.coordinator`
- `faculty_type`
- `coordinator` (direct FK on faculty_utilization)
- `program_type`

This populates all relationship fields needed by `SessionDetailResponse`. Verify no missing joins.

## Implementation Tasks

### Task 1: Update Frontend fetchFaculty() for Role-Based Scoping
- Location: `frontend/app/page.tsx` ~line 561
- Change: Pass `all` parameter based on `user.role` and `user.team_name`
- Logic:
  ```typescript
  const isManagerOrAdmin = user.role?.toLowerCase() === 'manager' || user.role?.toLowerCase() === 'admin';
  const isFinance = user.team_name?.trim().toLowerCase() === 'finance';
  const shouldSeeAll = isManagerOrAdmin || isFinance;
  const ledger = await api.getSessions({ all: shouldSeeAll });
  ```

### Task 2: Verify Backend Scoping for Coordinators
- Location: `backend/app/api/v1/sessions/service.py` lines 85-110
- Test: Coordinator user should see utilization records for batches in their manager scope
- If gaps found, adjust `list_scoped_batch_ids` or scoping logic

### Task 3: Validate Column Mapping
- Location: `frontend/app/dashboard/components/FacultyUtilizationView.tsx` lines 100-199
- Verify each `UTILIZATION_COLUMN_DEFS` accessor matches `TrainingSession` interface
- Key fields to verify: `batchCode` → `batch_code`, `coordinator` → `coordinator`, `facultyTypeName` → `faculty_type_name`

### Task 4: Add Coordinator Access Test
- Create test verifying coordinator can access `/sessions` without `all=true`
- Verify returned records are correctly scoped to their team

## Acceptance Criteria

1. **Coordinators can access Faculty Utilization view** - No 403 error when coordinator navigates to faculty view
2. **Coordinators see only team entries** - Records limited to batches where their manager is primary_manager or coordinator is in their scope
3. **Managers/Admins see all entries** - `all=true` returns full ledger
4. **Finance team sees all entries** - Existing behavior preserved
5. **All 27 columns render correctly** - Frontend columns map to backend response fields
6. **Default 6-column view works** - `DEFAULT_HIDDEN` shows date, faculty, batch, topic, hours, status by default

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Scoping logic returns empty for coordinators | Test with seeded data; verify `get_manager_scope_user_ids` returns correct IDs |
| Breaking change for managers | Keep `all=true` for managers/admins; only change coordinator behavior |
| Missing relationship data in response | Verify all `joinedload` options in `list_utilizations` query |
| Frontend type mismatch | Ensure `TrainingSession` interface matches `SessionDetailResponse` schema |

## Testing Strategy

1. **Unit**: Test `get_manager_scope_user_ids` for coordinator role
2. **Integration**: Test `/sessions` endpoint with `all=false` for coordinator user
3. **E2E**: Login as coordinator → navigate to Faculty Utilization → verify records visible
4. **Regression**: Login as manager → verify all records visible

## Open Questions

1. Should coordinators see batches where they are `sales_spoc`? (Currently not in scope)
2. Should the view show "My Team" vs "All" toggle for managers? (Future enhancement)
3. Is `vertical` column ever populated? (Currently never seeded, hidden by default)