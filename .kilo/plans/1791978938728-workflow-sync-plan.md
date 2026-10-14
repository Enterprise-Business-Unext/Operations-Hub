# Plan: Sync Workflow Documentation to Actual Backend Implementation

## Goal
Update all 10 workflow documentation files in `workflows/` to match the actual backend code. **No code changes — only `.md` workflow file edits.**

## Source of Truth
The backend code under `backend/app/` is authoritative. Documentation that conflicts with code must be rewritten to match code.

---

## 1. `01-authentication-authorization.md`
### Discrepancies
- **Login flow ordering** unclear; should reflect: rate limiting (5 attempts → 15 min lockout), password verified via `pwd_context` + email, role scope filtering, JWT access token (30 min) + refresh token (7 days), `user_session` row created, audit log entry
- **RBAC endpoint matrix** is incomplete. Missing routes:
  - `GET /auth/my-reports`, `GET /auth/users/assignable`, `GET /auth/hierarchy`, `GET/DELETE /auth/coordinator-mappings`, `GET /auth/audit-logs`
  - `GET/POST /roles`, `GET/PATCH/DELETE /roles/{id}`
  - `GET/POST/PATCH/DELETE /teams`, `GET/PATCH/DELETE /teams/{id}`
  - `GET/PUT /batches/approval-config`, `GET /batches/active`
  - `GET/PATCH/DELETE /batches/{id}/edit-history`, `GET /batches/{id}/lifecycle-history`
  - `GET /batches/finance/export`
  - `GET /sessions/scheduled`, `POST/PATCH/DELETE /sessions/scheduled/{id}`
  - `GET /analytics/mbr-export`
- **RBAC helper functions** in `deps.py` not documented: `get_all_subordinate_ids`, `get_managed_coordinator_ids`, `get_manager_scope_user_ids`, `is_manager_or_lead`

### Required Changes
- Add missing endpoints to RBAC matrix with role column (Admin, Lead, Coordinator, etc.)
- Document the 4 RBAC helper functions and their scope logic
- Correct login flow to match `auth/service.py` → `authenticate_user` → `create_token_response`

---

## 2. `02-batch-lifecycle-state-machine.md`
### Discrepancies
- **Enum string values** missing spaces: docs say `"Approval1Pending"`, `"PendingForClosure"`, `"Approved"` — code uses `"Approval 1 Pending"`, `"Pending for Closure"`, NO `"Approved"` state
- **`finance_check` field** documented — does NOT exist in code; actual fields: `finance_status` (enum: Pending/Checked/Rejected), `finance_status_check_date`, `finance_status_checked_by`, `financial_documents`
- **Missing reapproval fields** on Batch model: `reapproval_count` (int, default 0), `last_reapproval_at` (datetime), `last_reapproval_by` (FK → users), `reapproval_changes` (JSON/text)
- **`VALID_TRANSITIONS` matrix errors** in docs:
  - `Rejected → {Requested, OnHold, Cancelled}` — actual: `Rejected → {Approval 1 Pending}` only
  - `OnHold → Cancelled` — actual: `OnHold → {Requested, OnHold, Cancelled}` (self-loop allowed)
  - Matrix does NOT include nonexistent `Approved` or `Rejected` as terminal from wrong parent
- **`REAPPROVAL_FIELDS` set** (`batch_service.py`) lists editable fields: `title, description, course_details, duration, start_month, end_month, faculty_id, batch_strength, center, location, coordinator_id`

### Required Changes
- Fix all enum string values to include spaces (match `batch.py` `BatchStatus`)
- Remove `finance_check` references; document `finance_status` fields
- Add reapproval fields to data model section
- Replace state transition matrix with `VALID_TRANSITIONS` from `service.py` lines ~713-724

---

## 3. `03-session-management-state-machine.md`
### Discrepancies
- **`sequence_number` and `week`** documented as DB columns on `TrainingSession` — they are **computed properties** (computed via SQL window function / Python property, not stored)
- **Missing `coordinator_id` and `coordinator`** fields on `FacultyUtilization` (actual model)
- **`Rescheduled` transition** documented on `TrainingSession` — does NOT exist; `update_scheduled` endpoint blocks any status change

### Required Changes
- Mark `sequence_number` and `week` as computed (not persisted); show actual DB columns from `schema.dbml`
- Add `coordinator_id` FK + `coordinator` relationship to `FacultyUtilization`
- Remove `Rescheduled` transition; document that `update_scheduled` only modifies scheduling fields, never status

---

## 4. `04-quality-gates.md`
### Discrepancies
- **Gate 2 payload** missing `nps_available` (bool) and `nps_unavailable_reason` (str) — required by `BatchNpsClosureCreate` schema (`feedback.py`)

### Required Changes
- Add `nps_available` and `nps_unavailable_reason` to Gate 2 payload
- Document `BatchNpsClosureCreate` schema field requirements

---

## 5. `05-schedule-ingestion.md`
### Discrepancies
- **`sequence_number` and `week`** on `TrainingSession` — computed properties, not DB columns
- **Faculty overlap checking** documented as enforced — NOT implemented; README states: "Faculty double-booking across batches is not checked"
- **Schedule ingestion auto-updating batch fields** (title, duration, etc.) — NOT implemented

### Required Changes
- Mark `sequence_number`/`week` as computed
- Clarify faculty overlap is NOT checked during ingestion
- Remove claims about auto-updating batch fields from ingestion

---

## 6. `06-faculty-governance.md`
### Discrepancies
- **Missing `coordinator_id` and `coordinator`** fields and computed properties (`entity`, `program`, `coordinator_name`) on `FacultyUtilization`

### Required Changes
- Add `coordinator_id` FK, `coordinator` relationship, and computed properties (`entity`, `program`, `coordinator_name`) to `FacultyUtilization` data model

---

## 7. `07-notifications.md`
### Discrepancies
- **SMTP config** missing `SMTP_USER` and `SMTP_PASSWORD` (present in `config.py` and `.env.example`)
- **Email service function signatures** don't match:
  - Docs describe methods that don't match `EmailService.send_email(to_email, subject, html_content, text_content, password=None)` and `send_welcome_email(to_email, full_name, password)`
- **`NotificationService` class methods** don't match actual method names (`session_scheduled`, `session_updated`, `gate_passed`, `gate_failed`, etc.)

### Required Changes
- Add `SMTP_USER` and `SMTP_PASSWORD` to email config section
- Fix `EmailService` method signatures to match `core/email.py`
- Fix `NotificationService` method names and signatures to match `notifications/service.py`

---

## 8. `08-rbac-conditions.md`
### Discrepancies
- **Permission/role matrix** is incomplete — missing ~20 endpoints (see Section 1 above)
- **RBAC helper functions** not documented

### Required Changes
- Add all missing endpoints to matrix
- Document the 4 RBAC helper functions with their scope logic

---

## 9. `09-scheduler.md`
### Discrepancies
- Need to **verify** `batch_avg_feedback` recalculation logic matches `lifecycle_service.py`
- Scheduler config is mostly accurate (`CronTrigger(hour=0, minute=30, timezone=ist)`, job ID `batch_lifecycle_sync`)

### Required Changes
- Verify `batch_avg_feedback` calculation matches `lifecycle_service.process_batches` / `recompute_batch_feedback`
- Confirm scheduler config matches `core/scheduler.py`

---

## 10. `10-data-models.md`
### Discrepancies
- **Status enum values** missing spaces: `"NotConducted"` should be `"Not Conducted"`, all `BatchStatus` values need spaces
- **Missing reapproval fields** on Batch (`reapproval_count`, `last_reapproval_at`, `last_reapproval_by`, `reapproval_changes`)
- **`finance_check`** documented — doesn't exist; actual: `finance_status`, `finance_status_check_date`, `finance_status_checked_by`, `financial_documents`
- **`sequence_number` and `week`** on `TrainingSession` — computed, not persisted
- **Missing `coordinator_id`/`coordinator`** on `FacultyUtilization`
- **Missing `nps_available`/`nps_unavailable_reason`** on Batch NPS closure model
- **`FinancialDocuments`** — verify actual model exists (`financial_documents` relationship on Batch)

### Required Changes
- Fix all enum string values to include spaces
- Add reapproval fields to Batch
- Replace `finance_check` with `finance_status` fields
- Mark `sequence_number`/`week` as computed on TrainingSession
- Add `coordinator_id`/`coordinator` to FacultyUtilization
- Add `nps_available`/`nps_unavailable_reason` to relevant model
- Cross-check against `schema.dbml` for exact column names/types

---

## Validation Plan
After each workflow file is updated:
1. Grep the workflow file for enum strings — confirm they match code (`.py` model files) exactly
2. Grep code for any field mentioned in workflow — confirm field exists in schema/model/service
3. Cross-reference endpoint lists in workflow against `main.py` route registrations
4. Spot-check state transitions against `VALID_TRANSITIONS` in `service.py`

## Out of Scope
- Code changes (explicitly forbidden by user)
- Frontend workflow files (none exist in `workflows/`)
- `README.md` — has same errors, but user said workflow files only
