# Faculty Utilization Logging — Required Data, Statuses & Intended Changes

Reference + implementation plan for the **Log Faculty Utilization** feature (the actual-delivery ledger write path), including three user-requested behavior changes.

## 1. Feature map

- **Frontend entry point:** `Log Utilization` button on a scheduled day in the batch drawer — `frontend/components/BatchDetailDrawer.tsx:2157`; dialog form `frontend/components/BatchDetailDrawer.tsx:3631-4005` (`id="log-utilization-form"`); submit handler `handleLogUtilizationSubmit` at `frontend/components/BatchDetailDrawer.tsx:592`.
- **Backend write path:** `POST /api/v1/sessions` — `backend/app/api/v1/sessions/controller.py:76` → `SessionService.create` at `backend/app/api/v1/sessions/service.py:295`.
- **Schema:** `SessionCreate` at `backend/app/schemas/session.py:82`; **model:** `FacultyUtilization` at `backend/app/models/session.py:73`.
- **Access:** `require_coordinator_or_above` + manager-scope check (`_require_batch_scope`, service.py:456).
- **Tests:** `frontend/components/BatchDetailDrawer.utilization.test.tsx`, `backend/tests/v1/test_session_workflow.py`, `backend/tests/v1/gates/`.

## 2. Required data (form fields)

Read-only context (prefilled, never typed): Batch ID, Client, Category, Coordinator from `activeBatch`; planned module/trainer/hours/window from the selected curriculum day.

| Field | Required | Default / prefill | Notes |
|---|---|---|---|
| Training Topic / Module | Yes | `day.module` | `topic` |
| Training Date | Yes | `day.session_date` | sent as `date_of_training` = `YYYY-MM-DDT00:00:00.000Z` (UTC-anchored day) |
| Start Time | Yes | `day.start_time` or `09:30` | `start_time` |
| End Time | Yes | `day.end_time` or `17:30` | `end_time` |
| Actual Hours Delivered | Yes | `day.duration_hours` or 8 | `no_of_hours`; step 0.5, 0.5–24 |
| Actual Faculty / Trainer | Yes | `day.trainer_name` or batch `faculty_assigned_text` | free text + datalist suggestions; `faculty_name` |
| Faculty Type | **Yes (change 1)** | none | `faculty_type_id` (FK `faculty_types`) |
| Program Type | Yes | none | `program_type_id` (FK `program_types`) |
| Vertical | Yes | none | `vertical` — **name string**, not an id |
| Delivery Mode | Yes | batch delivery mode or `Online` | `mode_of_delivery` |
| Location City | No | `batch.location_city` | `location_city` |
| Venue / Room | No | intentionally empty | `venue`; never auto-invented |
| Delivery Status | Yes | `Scheduled` | **`Scheduled` + `Completed` only (change 2)** |
| Was Feedback Collected? | Yes | none | gates rating + notes |
| Feedback Rating (1–5) | Only if collected | "Not rated" | **two-decimal display (change 3)**; sets `feedback_submitted`/`feedback_rating` |
| Module Feedback | Optional | none | `feedback_notes` |

Payload contract (POST `/sessions`): `batch_id`, `training_session_id`, `date_of_training`, `start_time`, `end_time`, `topic`, `faculty_name`, `no_of_hours`, `venue?`, `location_city?`, `mode_of_delivery`, `status`, `feedback_submitted`, `feedback_rating?`, `feedback_notes?`, `vertical`, `program_type_id`, `faculty_type_id`.

## 3. Statuses

### Backend model (`backend/app/models/session.py:12`)
`SessionStatus` enum (shared by `training_sessions` and `faculty_utilization`): `Scheduled`, `InProgress`, `Completed`, `Cancelled`, `Not Conducted`, `Rescheduled`.
- `TERMINAL_UTILIZATION_STATUSES = {Completed, Cancelled, Not Conducted}` (immutable once reached)
- `ACTIVE_UTILIZATION_STATUSES = {Scheduled, InProgress, Completed}`

### State machine (`backend/app/api/v1/sessions/service.py:33-45`)
- `ALLOWED_TRANSITIONS`: `Scheduled → {Scheduled, InProgress, Cancelled, Not Conducted}`; `InProgress → {InProgress, Cancelled, Not Conducted}`. **Completed is reachable only via Gate 1 (`PATCH /sessions/{id}/complete`) or, after change 2, directly at create.** `Rescheduled` is never persisted — the reschedule endpoint resets rows to `Scheduled`.
- Create with `Cancelled`/`Not Conducted` requires `outcome_reason` ≥ 3 chars (`_record_outcome` stamps `outcome_reason`/`outcome_at`/`outcome_by`).
- Update: completed/terminal rows immutable (409); any transition **to** `Completed` on update stays blocked ("Use Gate 1", service.py:364-365) — do not change this.
- Gate 1 (`gates/service.py:25`): rating 1.0–5.0, non-terminal row, linked `training_session_id` required; sets `Completed` + feedback and cascades to the scheduled day.
- Terminal writes propagate to the linked `training_sessions` row (service.py:324-328, 387-392); `BatchLifecycleService.calculate_batch_avg_feedback` averages rated `Completed` rows (lifecycle_service.py:65-97); `sync_session_statuses` already handles "utilization logged as Completed" (lifecycle_service.py:41).

### Frontend status usage
- Ledger actions: `status !== "Completed"` rows show **Submit Feedback** (Gate 1) + **Cancel** + **Not Conducted** (only for `Scheduled`/`InProgress`) and **Reschedule** (BatchDetailDrawer.tsx:2199-2237). Rows logged as `Completed` get no actions.
- Day chips: `utilization_logged` → green **Delivered** / amber **Pending**; `list_scheduled` reports the ledger's status when a log exists (service.py:144).
- Checkpoint 1: `TERMINAL_DELIVERY_STATUSES = ["Completed","Cancelled","Not Conducted"]` drives planned-vs-closed progress (BatchDetailDrawer.tsx:464-474); Gate 2 unlock requires `batch_avg_feedback != null` AND every planned+logged row terminal (BatchDetailDrawer.tsx:2392-2417).
- Badges: `StatusBadge` tone map at `frontend/components/ui/statusBadge.tsx:30-45` (Cancelled/Not Conducted → red, Completed → green, Scheduled → blue, etc.).

### Validation contract
- **Frontend:** feedback toggle/faculty/topic/vertical/program-type guards; `end > start` AND `|window − hours| ≤ 0.01` (BatchDetailDrawer.tsx:578); rating 1–5; submit disabled when verticals/program_types empty (line 4056).
- **Backend 4xx:** 404 batch; 403 scope; 422 date outside batch window / end ≤ start / faculty name missing / linked session mismatch / outcome reason < 3 / hours bounds; 409 completed-batch edits, illegal transitions, immutability.

## 4. Resolved decision (user-confirmed)

**Completed can be logged directly.** The log form offers `Scheduled` and `Completed`; the backend create-time rejection of `Completed` is lifted. Rationale confirmed by the user over the alternative (Scheduled-only + Gate 1). Supporting machinery already exists (§3), so the change is small. Trade-off accepted: days logged as `Completed` skip Gate 1 feedback capture — the form's feedback section becomes that day's feedback of record, and `batch_avg_feedback` appears once any `Completed` row carries a rating.

## 5. Implementation tasks (ordered)

### Frontend — `frontend/components/BatchDetailDrawer.tsx`
1. **Delivery Status dropdown (lines 3925-3937):** options become `<option value="Scheduled">Scheduled</option>` + `<option value="Completed">Completed</option>`; delete the `InProgress` option. `utilStatus` default stays `Scheduled`.
2. **Faculty Type required (lines 3802-3822):** add `required` to the select; change the placeholder `<option value="">Not specified</option>` to a disabled placeholder (`<option value="" disabled>Select Faculty Type</option>`); add `options.faculty_types.length === 0` to the submit-disable condition (line 4056).
3. **Submit handler (lines 592-688):** add guard `if (!utilFacultyTypeId) { setUtilError("Faculty Type is required"); return; }` next to the `utilProgramTypeId` guard (line 620); change payload to `faculty_type_id: utilFacultyTypeId` (no `|| undefined`, line 665).
4. **Shared payload type (`frontend/lib/api.ts:381-400`):** add `faculty_type_id: string` to `CreateSessionPayload`; then remove the inline intersection `& { faculty_type_id?: string }` at BatchDetailDrawer.tsx:648. (Keep `status?: string` — it already accepts `Completed`.)
5. **Rating two decimals (line 3984):** render the existing half-step list with two-decimal labels/values (`5.00, 4.50, 4.00, … 1.00`); keep the 1–5 parse/validation (lines 640-644) unchanged.
6. **Frontend tests (`BatchDetailDrawer.utilization.test.tsx`):** the two submit tests ("captures the selected program type id on submit" line 257, "requires a program type before logging utilization" line 271) must now also select Faculty Type (`fireEvent.change(field(/Faculty Type/i), { target: { value: "ft-1" } })`) or the new guard blocks submit. Optionally add a test that submitting without Faculty Type shows "Faculty Type is required".

### Backend
7. **`backend/app/schemas/session.py:120-127` (`SessionCreate` validator):** remove the `if self.status == "Completed": raise ValueError("Use Gate 1 to complete a session")` line. Keep the `Cancelled`/`Not Conducted` outcome_reason rule.
8. **Do not touch** the update-path Gate 1 restriction (service.py:364-365) — `test_session_status_patch_cannot_skip_gate1` (tests/v1/test_session_workflow.py:98) depends on it.
9. **Do not remove `InProgress` from the model/enum** — it stays valid for API updates, legacy rows, and analytics (`backend/app/api/v1/analytics/repository.py:108-111` counts `Scheduled`+`InProgress` as today's ongoing). Only the form dropdown changes.
10. **Backend tests:** add coverage for `POST /api/v1/sessions` with `status: "Completed"` + `training_session_id` → 201, linked `training_sessions.status == "Completed"`, and `batch_avg_feedback` written when `feedback_rating` is supplied; existing create-path tests need no changes (none post `Completed` today).

## 6. Risks / notes

- Rows logged as `Completed` are terminal and immutable — coordinators can no longer fix hours/topic after saving; only Reschedule is unavailable too (it requires non-completed). Cancel/Not Conducted/Reschedule/Gate 1 buttons stay hidden for those rows (existing UI gating).
- `date_of_training` must stay UTC-midnight anchored or the stored day shifts by the browser offset.
- `faculty_name` is denormalized free text; the backend prefers a matching active `users` row and falls back to the typed name — typos fork trainer identities in reporting.
- `vertical` stores the **name**; `program_type_id`/`faculty_type_id` are FK ids.
- Hours-vs-window consistency is client-only; the server validates only `end > start`.

## 7. Validation

- Frontend: run the vitest suite (at minimum `BatchDetailDrawer.utilization.test.tsx`) and the TypeScript check (`npm run test`, `npm run typecheck` per package.json scripts).
- Backend: run the sessions and gates pytest suites (`tests/v1/test_session_workflow.py`, `tests/v1/gates/`, `tests/v1/test_session_status_initialization.py`) plus the new create-as-Completed test.
- Manual smoke: log a day as `Completed` with feedback collected + rating → ledger row shows `Completed`, day chip flips to **Delivered**, no ledger action buttons, Checkpoint 1 closed count increments, and (with a rating) `batch_avg_feedback` populates on the Quality Checkpoints tab.
