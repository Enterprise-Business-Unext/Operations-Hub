# Manager Dashboard Improvements — Implementation Plan

**Plan file**: `.kilo/plans/manager-dashboard-improvements.md`

## Goal

Apply user-requested changes to the Manager dashboard / Executive view:
1. Manager Board: remove "Urgent Manager Action" KPI card, remove search bar, remove "Requested" kanban stage, add "Schedule Not Updated" count KPI.
2. Executive view: add table showing which coordinator is handling which session today.
3. Project-wide: all displayed times in IST (not UTC), no raw epoch/big-number timestamps popping out.

## Affected files

- `frontend/components/ManagerBoard.tsx` — KPI ribbon, kanban stages, filter bar
- `frontend/components/EnterpriseDashboard.tsx` — executive view (add coordinator-session-today table)
- `frontend/lib/dateUtils.ts` — IST timezone conversion for `formatDate`/`formatDateTime`
- `frontend/app/page.tsx` — data fetching/wiring for new KPI and new table
- `backend/app/api/v1/analytics/service.py` — new `count_schedule_not_updated` repo call
- `backend/app/api/v1/analytics/repository.py` — new `count_schedule_not_updated` method
- `backend/app/api/v1/analytics/repository_interfaces.py` — new interface method
- `backend/app/schemas/analytics.py` — add `schedule_not_updated_count` to `ManagerDashboardSummary`
- `frontend/lib/api.ts` — `ManagerDashboardSummary` interface + (optional) sessions-today-by-coordinator helper

## Scope decisions (documented)

- **"Schedule not updated"** = batches where `schedule_complete = false` (existing column on `batches`, line 157 of `db_scheme/schema.dbml`), scoped to the manager's batch scope (same as dashboard).
- **Coordinator-session-today table** = `FacultyUtilization` rows where `date_of_training` is today (IST), joined to `batches.coordinator_id` → user name. Computed on the frontend from existing `batches` + `facultyUtilizationLedger` data (no new backend endpoint required).
- **IST** = UTC+5:30. `formatDate`/`formatDateTime` will convert input timestamps to IST before rendering.
- **"No big numbers"** = no raw `Date.now()`/epoch millisecond values rendered to the UI; all date math used only for comparisons, never displayed.

## Tasks

### 1. Remove Urgent Manager Action KPI card (ManagerBoard.tsx)

- Delete the "Urgent Manager Action" glass-panel card (lines ~591–604) and its `quickStats.l2Count + quickStats.overdueCount` usage.
- Keep `quickStats.l2Count` if used elsewhere; remove only the KPI card.
- Acceptance: KPI ribbon no longer shows an urgent-action card; no reference to removed JSX remains.

### 2. Remove search bar from ManagerBoard (ManagerBoard.tsx)

- Delete the search input block (lines ~612–627) including `searchQuery` state, `Search` icon import, and `domainSelectId` label if unused.
- Keep domain dropdown and urgent-only toggle.
- Acceptance: no search input rendered in ManagerBoard filter bar; `searchQuery` state removed.

### 3. Remove "Requested" kanban stage (ManagerBoard.tsx)

- Delete the `requested` stage object from `stages` array (lines ~273–281).
- Acceptance: kanban no longer has a "Requested" column; all other stages unchanged.

### 4. Add "Schedule Not Updated" count KPI

**Backend:**
- `repository.py`: add `count_schedule_not_updated(batch_ids)` → count `Batch` where `schedule_complete == False`.
- `repository_interfaces.py`: add abstract method.
- `service.py`: call it in `manager_dashboard`, pass result into `ManagerDashboardSummary`.
- `schemas/analytics.py`: add `schedule_not_updated_count: int` field.

**Frontend:**
- `lib/api.ts`: add `schedule_not_updated_count: number` to `ManagerDashboardSummary` interface.
- `app/page.tsx`: value comes from `dashboardSummary` (already fetched via `getManagerDashboard`); no new fetch needed.
- `ManagerBoard.tsx`: add a new glass-panel KPI card showing `summary?.schedule_not_updated_count ?? 0` with label "Schedules Not Updated".
- Acceptance: new KPI card renders count; backend returns correct count for scoped batches; unit test covers `schedule_complete=False` filtering.

### 5. Add coordinator-session-today table (Executive view)

**Frontend (`EnterpriseDashboard.tsx`):**
- Receive `facultyUtilizationLedger` (already fetched in `page.tsx`) as a new prop, or derive from `batches` + sessions.
- Filter ledger rows where `date_of_training` is today (IST).
- Join each row to its batch via `batch_id` to get `coordinator_id`.
- Look up coordinator `full_name` from `users`/`allUsers` prop (already passed to EnterpriseDashboard).
- Render a table: Coordinator | Session Topic | Time | Batch ID | Status.
- Empty state when no sessions today.
- Acceptance: table shows today's sessions grouped by coordinator; empty state when none; times shown in IST DD-MM-YYYY HH:MM.

**`page.tsx` wiring:**
- Pass `facultyUtilizationLedger` to `EnterpriseDashboard` alongside existing props.
- Acceptance: EnterpriseDashboard receives ledger data; table populates on view switch to analytics.

### 6. IST timezone conversion (dateUtils.ts + affected components)

- Add `IST_OFFSET_MINUTES = 330` constant.
- In `formatDate`/`formatDateTime`: convert input `Date` to IST before extracting day/month/year/hours/minutes.
- Add `formatDateIST` / `formatDateTimeIST` exported helpers (or modify existing functions in place).
- Audit `ManagerBoard.tsx` date comparisons (`new Date(b.end_date).getTime() < Date.now()`) — these are comparison-only, OK as-is, but ensure any *displayed* date uses IST formatter.
- Audit `EnterpriseDashboard.tsx` and other dashboard components for direct `new Date().toISOString()`, `toLocaleString()`, or epoch rendering; replace with IST formatters.
- Acceptance: all rendered dates/times use IST; no raw epoch or UTC strings visible; `dateUtils.test.ts` updated for IST behavior.

### 7. Validation

- Backend: `python -m pytest -q` — analytics scope tests (`tests/v1/analytics/test_analytics_scope.py`), cache tests (`tests/v1/test_cache.py`).
- Frontend: `npm test -- --run`, `npm run build`, typecheck.
- Verify no console errors when switching between manager_board and analytics views.

## Open questions (recommended answers)

1. **Should `schedule_not_updated_count` be a separate KPI card or merged into an existing one?** Recommended: separate card, 5th KPI in ribbon (after Active Batches / Delivered Hours / NPS / Avg Feedback).
2. **Should the coordinator-session table live in EnterpriseDashboard only, or also in ManagerBoard?** Recommended: Executive view only (EnterpriseDashboard), as requested.
3. **Should `formatDate`/`formatDateTime` be changed in place (affecting all callers) or new IST-only functions added?** Recommended: change in place — the whole project should display IST, so all callers benefit.

## Out of scope

- Backend schema changes (no new tables/columns needed).
- New backend endpoint for sessions-today-by-coordinator (computed on frontend from existing data).
- NPS scale mismatch fix (tracked separately in assessment plan).

## Plan file location

`.kilo/plans/manager-dashboard-improvements.md`

---

Ready for implementation. Switch to an implementation-capable agent to execute the tasks above, then run backend tests (`python -m pytest -q`) and frontend tests/build (`npm test -- --run`, `npm run build`).