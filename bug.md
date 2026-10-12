# Local Review — Uncommitted Changes

## Summary

The working tree contains a large body of uncommitted work (72 tracked files, +2569/−3758, plus 8 untracked files) spanning the batch lifecycle/reapproval refactor, session workflow endpoints, schedule ingestion, DB init, and the Log Faculty Utilization feature. Auth/scope checks and the new service logic held up under review, but two substantive defects exist: a production-startup path that now runs a destructive schema migration against live data, and a schedule-ingestion guard regression that allows schedules into dead batches.

## Issues Found

| Severity | File:Line | Issue |
|---|---|---|
| CRITICAL | backend/app/main.py:159 | Production startup now runs `init_db()`, which drops/renames `batches.status` columns on live data |
| WARNING | backend/app/api/v1/schedules/service.py:617 | Ingestion allowlist removed — schedules can be applied to Cancelled/pre-approval batches |
| WARNING | frontend/app/page.tsx:1205 | Reapproval numbering rule in 3 places despite shared `approvalReapprovalLabel` helper |
| WARNING | frontend/components/BatchDetailDrawer.tsx:3287 | `deletable` predicate duplicates `deletableBlockers` filter (line 440) |
| WARNING | backend/app/api/v1/batches/service.py:611 | Update-path hours ceiling re-implements create-path rule (line 152) |
| SUGGESTION | backend/app/api/v1/sessions/service.py:165 | Duplicate unreachable `Completed batches cannot be edited` guard added |
| SUGGESTION | backend/app/db/init_db.py:259 | `"Rescheduled"` added to enum but unreachable via `ALLOWED_TRANSITIONS` |
| SUGGESTION | backend/app/api/v1/batches/service.py:686 | Redundant `ist_tz` reassignment (already set at line 672) |
| SUGGESTION | backend/app/models/batch.py:92 | `last_reapproval_by_user` relationship has zero readers |
| SUGGESTION | frontend/components/BatchDetailDrawer.tsx:464 | `TERMINAL_DELIVERY_STATUSES` hardcodes backend terminal-status set |
| SUGGESTION | frontend/components/BatchDetailDrawer.tsx:1031 | Reason ≥3-chars check duplicated at line 1065; backend splits the same rule |

## Detailed Findings

### 1. [CRITICAL] `backend/app/main.py:159`: Destructive schema migration now runs at production boot

**Confidence:** 95%

**Problem:** The diff replaces the production guard (`if settings.ENVIRONMENT != "production": init_db()` / `else: print("Production mode: Skipping auto-migration...")`) with an unconditional `init_db(seed_base_data=settings.ENVIRONMENT != "production")`. Only the *seed data* is gated — the migration path now runs in every environment. When `init_db` detects a legacy VARCHAR `batches.status` column (`backend/app/db/init_db.py:164`), it executes `ALTER TABLE "batches" DROP COLUMN "status"` + `RENAME COLUMN "status_new" TO "status"` (init_db.py:226-232), plus a table-wide `UPDATE batches SET status_new = CASE ... ELSE 'Requested'` that silently rewrites any unrecognized status, and `_normalize_legacy_session_statuses` sweeps (init_db.py:265). This is irreversible DDL that previously was explicitly deferred to an operator-run `alembic upgrade head`, now firing automatically on production boot during an upgrade of existing data — with no backup or confirmation step.

**Suggestion:** Keep destructive DDL out of the lifespan boot path, e.g. `if settings.ENVIRONMENT != "production": init_db(...)` as before, or gate the migration behind an explicit opt-in flag (`settings.RUN_SCHEMA_MIGRATION`) and document a required backup.

### 2. [WARNING] `backend/app/api/v1/schedules/service.py:617`: Ingestion guard lost its status allowlist

**Confidence:** 95%

**Problem:** The diff replaces both an allowlist (`allowed_statuses = {"Approval 1 Pending", "Approval 2 Pending", "Upcoming", "Ongoing"}`) and a terminal-state block (`status in {"Completed", "Cancelled"}`) with a single `if batch.status == "Completed"`. Applying a schedule/timetable is therefore now permitted to `Cancelled` batches (which can never validly receive sessions again) and to pre-approval states like `Requested`, `On Hold`, and `Rejected` — states the removed allowlist deliberately excluded. The narrowed error message ("completed batch") confirms the `Cancelled` block was dropped rather than merged.

**Suggestion:** Restore the terminal-state block at minimum — `if batch.status in {"Completed", "Cancelled"}:` — and consider re-adding the allowlist so ingestion requires at least `Approval 1 Pending`.

### 3. [WARNING] `frontend/app/page.tsx:1205`: Reapproval numbering rule defined three times

**Confidence:** 90%

**Problem:** `frontend/lib/approvalQueue.ts:8-12` was created to own the label (`Reapproval #${batch.reapproval_count ?? 1}`) so the filter dropdown and CSV export cannot disagree. The table cell at page.tsx:1205 inlines `REAPPROVAL #{b.reapproval_count ?? 1}` and `ApproveBatchModal.tsx:404` inlines a third copy `#${batch.reapproval_count ?? 1}`. All three are new lines in this diff. Any change to the numbering fallback or format will be applied to only one of them.

**Suggestion:** Reuse the helper for the cell/badge text (e.g. expose a `reapprovalBadgeText(batch)` variant in `lib/approvalQueue.ts`) instead of inlining the format.

### 4. [WARNING] `frontend/components/BatchDetailDrawer.tsx:3287`: Blocker `deletable` predicate duplicated

**Confidence:** 90%

**Problem:** `const deletable = session.status !== "Completed" && !session.utilization_logged;` (line 3287) restates the exact predicate already used by the `deletableBlockers` memo (lines 437-443). The inline copy drives the "Already delivered — cannot be deleted" badge while the memo drives the Delete button, so a one-sided edit to the delete rule leaves the badge and the button disagreeing about the same session.

**Suggestion:** Compute one list of blocker rows carrying a `deletable` flag (or a single `isSessionDeletable(session)` helper) and consume it in both places.

### 5. [WARNING] `backend/app/api/v1/batches/service.py:611`: Hours ceiling validated on two paths with different rules

**Confidence:** 85%

**Problem:** The create path validates `batch_in.total_hours > batch_in.training_days * max_hours_per_day` (line 152, with `or 8` fallback and one error message). The new update-path check re-implements the same ceiling as `eff_hours > eff_days * max_hours` (line 611) with its own Decimal coercion, defaults, and different wording. Changing the formula or fallback on one path leaves create and edit validating differently for the same batch.

**Suggestion:** Extract a single `_validate_hours_ceiling(training_days, total_hours, delivery_mode_id, delivery_mode)` helper and call it from both `create` and `update`.

### 6. [SUGGESTION] `backend/app/api/v1/sessions/service.py:165`: Unreachable duplicate guard

**Confidence:** 95%

**Problem:** The diff inserts a second, byte-identical `if batch.status == "Completed": raise HTTPException(409, "Completed batches cannot be edited")` immediately after the existing guard at lines 163-164. The added copy can never execute; if one copy is later edited or deleted the pair drifts.

**Suggestion:** Delete the duplicated two lines (keep the original check at 163-164).

### 7. [SUGGESTION] `backend/app/db/init_db.py:259`: Unreachable `Rescheduled` status value

**Confidence:** 85%

**Problem:** The diff adds `"Rescheduled"` to the PostgreSQL `sessionstatus` enum, the `SessionStatus` Literal (`backend/app/schemas/session.py:10`), and the frontend `TrainingSession.status` union (`frontend/lib/api.ts:335`). No code path sets it: `ALLOWED_TRANSITIONS` (sessions/service.py:33-45) never permits it, the reschedule endpoint resets rows to `Scheduled`, and no UI renders it — it is a dead-end state. (It is technically reachable only through a raw `POST /sessions` payload, which then becomes uneditable.)

**Suggestion:** Either allow `Scheduled → Rescheduled` in `ALLOWED_TRANSITIONS` or drop the value from the enum migration, Literal, and union.

### 8. [SUGGESTION] `backend/app/api/v1/batches/service.py:686`: Redundant `ist_tz` reassignment

**Confidence:** 90%

**Problem:** `ist_tz = timezone(timedelta(hours=5, minutes=30))` is assigned at line 672 and reassigned the identical value at line 686 (added by this diff) with no mutation in between — a no-op that suggests two timestamp zones were intended.

**Suggestion:** Remove line 686 and reuse the binding from line 672.

### 9. [SUGGESTION] `backend/app/models/batch.py:92`: Unused `last_reapproval_by_user` relationship

**Confidence:** 90%

**Problem:** The relationship added by this diff has no readers anywhere in `backend/` or `frontend/` — no query, `joinedload`/`selectinload`, or serialization references it (verified by grep). The edit-history payload serializes the editor through `BatchEditHistory`, not through `Batch`.

**Suggestion:** Drop the relationship unless a serializer is planned for it.

### 10. [SUGGESTION] `frontend/components/BatchDetailDrawer.tsx:464`: Terminal-status set duplicated across the API boundary

**Confidence:** 85%

**Problem:** `TERMINAL_DELIVERY_STATUSES = ["Completed", "Cancelled", "Not Conducted"]` hardcodes the backend `TERMINAL_UTILIZATION_STATUSES` set (`backend/app/models/session.py:21-25`), and both were changed in this diff to encode the same Gate 2 rule. Adding a terminal status on the backend silently leaves the frontend close button gated on stale data.

**Suggestion:** Return the terminal-status set from the batch detail API, or add a test asserting the frontend list matches the backend enum members.

### 11. [SUGGESTION] `frontend/components/BatchDetailDrawer.tsx:1031`: Reason-length rule duplicated

**Confidence:** 85%

**Problem:** `handleSessionOutcome` (line 1031) and `handleRescheduleSession` (line 1065) inline the identical trim + `length < 3` check and message, both added in this diff. The backend additionally splits the same rule: schema `min_length=3` (untrimmed) vs `SessionService._record_outcome` (trimmed), which already disagree for input like `"  a  "`.

**Suggestion:** Add a single `requireReason(reason)` helper on the frontend and validate the trimmed minimum once on the backend (e.g. a `field_validator` on the request schemas).

## Recommendation

**NEEDS CHANGES** - The CRITICAL production-boot migration path and the ingestion guard regression should be fixed before committing; the remaining duplication/dead-code items are non-blocking.
