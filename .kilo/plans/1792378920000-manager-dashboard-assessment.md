# Manager Dashboard / DB Schema Usefulness Assessment

**Goal**: Determine whether the existing DB schema + `ManagerBoard`/analytics API is actually useful for a Manager user, and scope any remediation.

## Context reviewed

- `db_scheme/schema.dbml` (derived from SQLAlchemy models) + `db_scheme/README.md`
- `backend/app/api/v1/analytics/` (service, controller, repository, interfaces, schemas)
- `frontend/components/ManagerBoard.tsx`, `frontend/app/page.tsx`, `frontend/lib/api.ts`
- `workflows/08-rbac-conditions.md`, `workflows/09-scheduler.md`, `README.md` bug-fix plan (items 10–12)
- `project_data/docs/PROJECT_SPECIFICATION_3_WORKFLOW_PLATFORM.md` (§5.5)

## Verdict

**Yes — partially useful for a Manager today.** It covers daily managerial triage: which batches need the manager's L2 sign-off, which are due for NPS/Gate-2 closure, delivered hours, team load (direct reports + batches handled), vertical/domain distribution, and a scoped MBR Excel export.

**Not yet sufficient as a standalone management cockpit.** The schema supports it; the API/UI have meaningful gaps.

## Schema assessment (no schema change required)

Sufficient and well-indexed for manager queries:

- `batches`: `primary_manager_id`, `coordinator_id`, `sales_spoc_id`, `approver_1/2_id`; `status` lifecycle; `batch_nps`, `batch_avg_feedback`; indexes on `(status)`, `(start_date)`, `(primary_manager_id)`, `(coordinator_id)`
- `training_sessions`: planned timetable linked to `batch_id`
- `faculty_utilization`: actual delivery with `status`, `feedback_rating`, `date_of_training`, `faculty_name`; indexes on `(batch_id)`, `(status)`, `(date_of_training)`, `(faculty_name)`
- `users` + `user_manager_mappings` + self-referential `manager_id` → hierarchy for scope

## Dashboard API findings (`GET /api/v1/analytics/manager-dashboard`, Manager/Admin)

- Scoped KPIs: active batches (Approved/Upcoming/Ongoing), ongoing sessions today, delivered hours, avg NPS, avg feedback, faculty utilization ratio, pending Gate-1 feedbacks, pending Gate-2 closures, vertical distribution
- Scope = batches where caller is `primary_manager_id` OR any coordinator in their hierarchy is `coordinator_id` (BFS over `manager_id`/`UserManagerMapping`). Unassigned manager → empty list (safe); Admin → unrestricted
- MBR export (`GET /api/v1/analytics/mbr-export`) is scoped to the same set; Redis cache TTL 60s per user
- `ManagerBoard`: kanban by lifecycle stage with urgency flags (L2 sign-off, >3d pending, past-end no NPS), KPI ribbon, domain/search filters, personnel table, MBR export

## Gaps limiting usefulness

P0:
1. **NPS scale mismatch** — `batch_nps` is stored on a -100..100 scale (Gate-2 formula), but the frontend labels `overall_avg_nps` as "/ 10" (`ManagerBoard.tsx:572`, `EnterpriseDashboard.tsx:2961`).
2. **`pending_gate2_closures` overcounts** — `repository.py:49` counts every `Ongoing` batch as pending closure even before its `end_date`; the kanban correctly uses `past end date && no NPS` (`ManagerBoard.tsx:317`).
3. **Session "today" boundary** — `count_ongoing_sessions` compares UTC `date.today()` to timestamptz `date_of_training`; scheduler docs note an IST/UTC off-by-one risk (`workflows/09-scheduler.md:114`).

P1:
4. **No per-coordinator / per-faculty breakdown** — personnel table shows only batch counts; `faculty_utilization_ratio` ignores hours vs capacity and internal vs external split despite `faculty_type_id` existing.
5. **No weekly/monthly outlook** — only "sessions today".
6. **No trends** — `MetricCard.trend_percentage` is unused.
7. **Scope mismatch vs batch RBAC** — analytics scope excludes `sales_spoc_id` and pending-approver visibility that `GET /batches` includes (`workflows/08-rbac-conditions.md:133`).

## Proposed tasks (if approved)

1. Fix NPS display scale (label /100 or convert consistently /10) — backend service + frontend
2. Fix `count_pending_gate2` to count only active batches past `end_date` without NPS
3. Align session "today" boundary to IST (document UTC behavior at minimum)
4. Add per-coordinator breakdown + weekly upcoming-session outlook to the dashboard API
5. Add simple prior-period trend to KPIs
6. Add tests: empty manager scope, Gate-2 boundary, NPS scale

## Validation

- Backend: `python -m pytest -q` (analytics scope tests: `backend/tests/v1/analytics/test_analytics_scope.py`, `backend/tests/v1/test_cache.py`)
- Frontend: `npm test -- --run`, `npm run build`, typecheck per repo tooling

## Open question

Shall I finalize this as an implementation plan closing the P0/P1 gaps above?

**Recommended answer: Yes.** If yes, I will write the finalized implementation plan (task list + acceptance criteria) and call `plan_exit`. If no, this file stands as the assessment record and no source changes are planned.