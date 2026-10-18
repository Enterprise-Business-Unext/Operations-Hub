# Manager Scope Changes — Implementation Plan

**Plan file**: `.kilo\plans\1792380000000-manager-scope-changes.md`

## Goal

Apply three manager-scope changes to the dashboard:
1. **Faculty utilisation is manager scoped** — a manager sees only utilization records for batches in their manager scope (primary_manager == me, or coordinator is a subordinate), not every record.
2. **"Batches Assigned To The Team" table** — inside the My Batches view ("Batches Assigned To You"), add a second table showing manager-scoped team batches.
3. **Top-level manager sees all tabs except Approval** — a manager with no manager above them gets every sidebar tab except the Approval Queue.

## Decisions already verified against code

**Faculty util scoping** (`frontend/app/page.tsx:565-582` `fetchFaculty`):
- Today: `shouldSeeAll = isManagerOrAdmin || isFinance` → managers pass `all: true` → backend returns ALL utilization records (sessions/controller.py:65-78 bypasses RBAC when `all=true`).
- Backend `service.list` (sessions/service.py:73) scopes server-side only when `user_id` set AND `all=false`. It uses `get_manager_scope_user_ids` + `list_scoped_batch_ids` → `primary_manager_id == current_user OR coordinator_id in subordinate coordinators`.
- Decision: managers must NOT pass `all: true`. `shouldSeeAll = (role === "admin") || (team_name === "finance")`. Managers call `api.getSessions()` with no `all` → server scopes. Coordinators unchanged (already scoped). Admin/finance keep `all: true`.
- `get_manager_scope_user_ids` (auth/repository.py:135-141) returns `{manager.id} + managed coordinator ids` for a manager — exactly the team scope.

**Team table data source** (`frontend/app/page.tsx` + `frontend/lib/api.ts:956`):
- Reuse `api.getBatches()` with no `mine` param. For a manager, backend `_scope` (batches/service.py:105-115) + `_apply_scope` (batches/repository.py:54-68) returns RBAC scope: `primary_manager_id == me OR coordinator_id in subordinate coordinators (+ approver-pending)`. That is the manager's team scope — no new endpoint needed.
- Only managers receive `teamData`; non-managers never see the team table.

**Top-level manager** (`frontend/components/Sidebar.tsx`):
- Defined as `user.role === "manager" && !user.manager_id` (a manager with no manager above).
- Admins are redirected to `/admin` before this dashboard (page.tsx:394), so they never reach the sidebar.
- `canSeeAllBatches` (renders "All Batches" nav item) becomes `isFinance || isApprover || isTopLevelManager`.
- Approval Queue tab becomes `isApprover && !isTopLevelManager`.
- Result: top-level manager sees All Batches, My Batches, Active Batches, Manager Board, Faculty Utilization, Team Analytics — every tab except Approval Queue.
- `canSeeMyBatches = !isFinance && !isAdmin` → top-level manager keeps My Batches (their own batches) plus the new team table.

## Affected files

- `frontend/app/page.tsx` — `fetchFaculty` scoping; add `teamBatches` state + `fetchTeamBatches`; pass `teamData` to MyBatchesView
- `frontend/app/dashboard/components/MyBatchesView.tsx` — optional `teamData` prop; second "Batches Assigned To The Team" table with own pagination
- `frontend/components/Sidebar.tsx` — top-level manager tab gating
- `frontend/lib/api.ts` — no change required (existing `getBatches`/`getSessions` suffice)

## Tasks

### 1. Faculty utilisation manager scoped (page.tsx)

In `fetchFaculty`, change `shouldSeeAll` so managers are excluded:
- `const shouldSeeAll = (user?.role?.toLowerCase() === "admin") || (user?.team_name?.trim().toLowerCase() === "finance");`
- Managers now call `api.getSessions()` without `all` → server-side manager scope.

Edge: a manager who is also on the Finance team still sees all (isFinance short-circuits) — acceptable, finance intent wins.

### 2. "Batches Assigned To The Team" table (page.tsx + MyBatchesView.tsx)

**page.tsx**
- Add `teamBatches` state (`Batch[]`), `isLoadingTeamBatches`, `teamBatchesError`.
- Add `fetchTeamBatches()` → `api.getBatches()` (no `mine`) when user is a manager.
- In the `activeView === "my_batches"` branch of the view-switch effect, call `fetchMyBatches()` and, when manager, `fetchTeamBatches()`.
- Pass `teamData={teamBatches}` to `MyBatchesView`.

**MyBatchesView.tsx**
- Add optional prop `teamData?: Batch[]`.
- When `teamData` is provided, render a second `FullscreenTable` below the existing table, titled **"Batches Assigned To The Team"**, reusing `BATCH_COLUMN_DEFS` and `EXPORT_COLUMNS`, with its own local pagination state (page/pageSize, reset when `teamData` changes).
- Existing "Batches Assigned To You" table unchanged (uses `data` = `myBatches`, already `mine=true` owner scope).

### 3. Top-level manager: all tabs except Approval (Sidebar.tsx)

- Add `const isTopLevelManager = user?.role?.toLowerCase() === "manager" && !user?.manager_id;`
- `canSeeAllBatches = isFinance || isApprover || isTopLevelManager;`
- Approval Queue tab: `...(isApprover && !isTopLevelManager ? [{ id: "approvals", ... }] : [])`
- All other nav items keep existing gating.

## Validation

- Frontend: `cd frontend && npm test -- --run` — existing suites (MyBatchesView.test.tsx, FacultyUtilizationView.test.tsx, Sidebar.test.tsx) must pass; add cases for the new team table and top-level-manager tab gating.
- `npm run lint` (next lint) and `npm run build` (Next.js typecheck).
- No backend changes required; existing RBAC scoping already implements both scopes. Optionally run `python -m pytest -q` to confirm no regression.

## Edge cases / notes

- A coordinator viewing Faculty Utilization is unchanged (already scoped to their batches).
- The `facultyUtilizationLedger` is also passed to `EnterpriseDashboard` (analytics view) for the sessions-today table. `fetchFaculty` only runs when `activeView === "faculty"`, so a manager going straight to analytics gets an empty ledger there — pre-existing gap, out of scope for this plan.
- Top-level manager sees both "Batches Assigned To You" (owner scope) and "Batches Assigned To The Team" (team scope).
