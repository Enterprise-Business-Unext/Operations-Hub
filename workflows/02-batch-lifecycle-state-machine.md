# Batch Lifecycle State Machine

## States

| State | Description |
|-------|-------------|
| `Requested` | Initial draft before submission |
| `Approval 1 Pending` | Awaiting first approver decision |
| `Approval 2 Pending` | Awaiting second approver decision |
| `Upcoming` | Both approvers approved, start date in the future |
| `Ongoing` | Both approvers approved, start date has arrived |
| `Pending for Closure` | End date passed, awaiting Gate 2 |
| `Completed` | Gate 2 closed, batch finished |
| `OnHold` | Temporarily paused |
| `Cancelled` | Terminal state, no further transitions |
| `Rejected` | Rejected during approval process |

> **Note:** `Approved` is NOT a BatchStatus value. When both approvers approve, the batch auto-transitions to `Upcoming` (future start) or `Ongoing` (start date arrived). `Approved` exists only as an `ApprovalStatus` value on `approver_1_status` / `approver_2_status`.

## Valid Transitions Matrix

```
Requested            → Approval 1 Pending, OnHold, Cancelled
Approval 1 Pending   → Approval 2 Pending, Rejected, OnHold, Cancelled
Approval 2 Pending   → Upcoming, Ongoing, Rejected, OnHold, Cancelled
Upcoming             → Ongoing, OnHold, Cancelled
Ongoing              → Pending for Closure, OnHold, Cancelled
Pending for Closure  → Completed, OnHold, Cancelled
Completed            → OnHold
OnHold               → Requested, Approval 1 Pending, Approval 2 Pending, Upcoming, Ongoing, Cancelled
Cancelled            → {} (terminal)
Rejected             → Approval 1 Pending
```

Source: `VALID_TRANSITIONS` dict in `backend/app/api/v1/batches/service.py` (lines 713-724).

## Approval Required Statuses

`{Upcoming, Ongoing, Pending for Closure, Completed}`

These statuses cannot be entered unless both approver levels have approved.
Source: `APPROVAL_REQUIRED_STATUSES` in `backend/app/api/v1/batches/service.py` (line 727).

## Batch Model Fields (from SQLAlchemy)

The `batches` table includes:
- `id` (UUID, PK)
- `batch_id` (String, unique, indexed) - Immutable locked ID
- `sow_number` (String, nullable, indexed) - Client-side SOW number
- `approval_id` (String, nullable, indexed) - Financial SOW Reference
- `category` (String, default: 'Bootcamp')
- `entity_id` (FK to entities.id)
- `category_id` (FK to batch_categories.id)
- `delivery_mode_id` (FK to delivery_modes.id)
- `accommodation_id` (FK to accommodations.id)
- `program_name` (String, indexed)
- `technology` (String)
- `domain` (String)
- `client_name` (String, indexed)
- `location_city` (String)
- `start_date` (TIMESTAMPTZ, indexed)
- `end_date` (TIMESTAMPTZ, indexed)
- `batch_request_date` (TIMESTAMPTZ, default: now)
- `training_days` (Integer, default: 0)
- `calendar_days` (Integer, nullable, default: 0)
- `total_hours` (Numeric(8,2), default: 0.00)
- `total_enrollments` (Integer, default: 0)
- `status` (Enum: Requested, Approval 1 Pending, Approval 2 Pending, Upcoming, Ongoing, Pending for Closure, Completed, OnHold, Cancelled, Rejected)
- `is_schema_locked` (Boolean, default: false)
- `schedule_complete` (Boolean, default: false)
- `approver_1_id` (FK to users.id)
- `approver_2_id` (FK to users.id)
- `approver_1_status` (Enum: Pending, Approved, Rejected)
- `approver_2_status` (Enum: Pending, Approved, Rejected)
- `approver_1_approved_at` (TIMESTAMPTZ)
- `approver_2_approved_at` (TIMESTAMPTZ)
- `reapproval_count` (Integer, default: 0)
- `last_reapproval_at` (TIMESTAMPTZ, nullable)
- `last_reapproval_by` (FK to users.id, nullable)
- `reapproval_changes` (JSON, nullable — before/after field values)
- `primary_manager_id` (FK to users.id)
- `coordinator_id` (FK to users.id)
- `sales_spoc_id` (FK to users.id)
- `faculty_members` (JSON)
- `faculty_assigned_text` (String, legacy)
- `finance_status` (String, default: 'Pending' — values: Pending, Cleared)
- `finance_status_check_date` (Date, nullable)
- `batch_avg_feedback` (Numeric(3,2))
- `batch_nps` (Numeric(6,2))
- `nps_total_responses` (Integer)
- `nps_promoters` (Integer)
- `nps_passives` (Integer)
- `nps_detractors` (Integer)
- `remarks` (Text)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

## Create Batch Workflow

### Endpoint: `POST /api/v1/batches`

**Conditions:**
- User must be authenticated
- User role must NOT be Admin
- User team must be "Delivery"
- Both approvers must be configured in `ApprovalConfiguration`
- `batch_id` must be unique
- `start_date >= today`
- `end_date >= start_date`
- `training_days > 0` and `<= calendar_days`
- `total_hours > 0` and `<= training_days * max_hours_per_day`
- `total_enrollments >= 1`
- At least 1 faculty member in `faculty_members`

**Flow:**
1. Validate all business rules
2. Resolve foreign keys: `category_id`, `delivery_mode_id`, `accommodation_id`, `entity_id`
3. Auto-assign `approver_1_id` and `approver_2_id` from global config
4. Set initial status: `Approval 1 Pending`
5. Auto-assign `coordinator_id` if Coordinator creates; `sales_spoc_id` if Sales creates
6. If `delivery_mode` is "Online", clear `location_city`
7. Store `faculty_members` as JSON
8. Create batch record

## Submit for Approval Workflow

### Endpoint: `POST /api/v1/batches/{id}/submit`

**Conditions:**
- Batch must exist and user has operational scope
- Both approvers must be configured
- `start_date` must not have passed

**Flow:**
1. Set `approver_1_id` and `approver_2_id` from config
2. Reset both approver statuses to `Pending`
3. Transition to `Approval 1 Pending`

## Level 1 Approval Workflow

### Endpoint: `POST /api/v1/batches/{id}/approve-level-1`

**Conditions:**
- Current user must be `approver_1` for this batch
- Batch must be in `Approval 1 Pending`

**Flow:**
- `approve`: Set `approver_1_status="Approved"`, `approver_1_approved_at=now`, transition to `Approval 2 Pending`
- `reject`: Set `approver_1_status="Rejected"`, transition to `Rejected`, record reason in `remarks` as `Approval 1 rejected: {reason}`

## Level 2 Approval Workflow

### Endpoint: `POST /api/v1/batches/{id}/approve-level-2`

**Conditions:**
- Current user must be `approver_2` for this batch
- `approver_1_status` must be `Approved`
- Batch must be in `Approval 2 Pending`

**Flow:**
- `approve`: Set `approver_2_status="Approved"`, `approver_2_approved_at=now`, `is_schema_locked=True`, set `approval_id` from reason (if <= 100 chars), auto-transition to `Upcoming` or `Ongoing` based on `start_date`
- `reject`: Set `approver_2_status="Rejected"`, transition to `Rejected`, record reason in `remarks`

## Manager Direct Approval Workflow

### Endpoint: `POST /api/v1/batches/{id}/approve`

**Conditions:**
- User must be Manager or Admin
- If not Admin: `approver_1_status` must be `Approved`

**Flow:**
1. Set `approval_id` from request
2. Set `is_schema_locked=True`
3. Auto-transition to `Upcoming` or `Ongoing` based on `start_date`
4. Set `primary_manager_id` to current user if not set

## Lifecycle Status Update Workflow

### Endpoint: `POST /api/v1/batches/{id}/lifecycle-status`

**Conditions:**
- User has operational scope on batch
- Target status is in `VALID_TRANSITIONS` from current status
- If target requires approval (`APPROVAL_REQUIRED_STATUSES`), both approvers must have approved
- Reason is provided (min 3 chars)

**Flow:**
1. Validate transition against `VALID_TRANSITIONS`
2. If target requires approval but not complete, redirect to correct pending status
3. Create audit entry: `[timestamp - Status changed from 'X' to 'Y' by Actor (Role)]: reason`
4. Append to `batch.remarks`
5. If target is `Cancelled`, cascade to all non-terminal sessions (FacultyUtilization and TrainingSession)

## Resume from OnHold Workflow

**Special case:** `POST /api/v1/batches/{id}/lifecycle-status` with `status="Resume"`

**Conditions:**
- Batch must currently be `OnHold`

**Flow:**
- Determines target status based on approval state:
  - `approver_1_status == "Pending"` → `Approval 1 Pending`
  - `approver_1 == "Approved"` and `approver_2 == "Pending"` → `Approval 2 Pending`
  - Any rejected → `Rejected`
  - Both approved → `Upcoming`

## Close Batch (Gate 2) Workflow

### Endpoint: `POST /api/v1/batches/{id}/close`

**Preconditions:**
- `batch_avg_feedback` is not None (at least one rated delivery exists)
- ALL sessions (scheduled + logged) are terminal (`Completed`, `Cancelled`, or `Not Conducted`)

**Payload:** `BatchNpsClosureCreate` (see `backend/app/schemas/feedback.py`)
- `promoters_count` (int, default 0, >= 0)
- `passive_count` (int, default 0, >= 0)
- `detractors_count` (int, default 0, >= 0)
- `nps_available` (bool, default true) — false when NPS responses are not collected
- `nps_unavailable_reason` (str, optional, min 3 chars) — required when `nps_available=false`

**Flow:**
1. If `nps_available` is false: set all NPS fields to NULL, append reason to `remarks`, set `status="Completed"`, `is_schema_locked=True`, delete edit history
2. If `nps_available` is true:
   1. Compute `NPS = ((promoters - detractors) / total) * 100` (total must be > 0)
   2. Store `batch_nps`, `nps_total_responses`, `nps_promoters`, `nps_passives`, `nps_detractors`
3. Set `status="Completed"`, `is_schema_locked=True`
4. Delete batch's `batch_edit_history` rows in the same transaction
5. Trigger notification

## Auto-Transition Rules (Scheduler)

### Daily at 00:30 IST

- `Upcoming` + `start_date <= today` → `Ongoing`
- `Ongoing` + `end_date < today` → `Pending for Closure`

## Schema Lock Conditions

Once `is_schema_locked=True`:
- Only Admin, Manager, or Coordinator can modify
- Restricted fields for non-admin/manager: `client_name`, `category`, `program_name`, `technology`, `domain`
- Finance team can update finance fields regardless

## Reapproval After Batch Edits

Changes to batch identity, classification, client, delivery, schedule, enrollment, ownership, or faculty fields require both approval levels again. The update is recorded in `batch_edit_history` with the editor, timestamp, and JSON before/after values; assigned approvers can review these diffs in the approval dialog. Notes (`remarks`) and finance-only fields do not trigger reapproval or create history; unchanged values are ignored.

For a qualifying change, the batch returns to `Approval 1 Pending`, both approver statuses reset to `Pending`, approval timestamps are cleared, the configured approvers are assigned, and the schema is unlocked. Approval notifications are sent to the first approver. Completed and cancelled batches cannot be changed through this edit flow.

The edit-history table is created by the startup `init_db()` schema initialization. On successful Gate 2 completion, its rows for that batch are deleted in the same database transaction that marks the batch `Completed`.

## Finance Status Conditions

Only Finance team or Admin can update:
- `finance_status` (Pending or Cleared)
- `finance_status_check_date`

## Reapproval Fields

The `REAPPROVAL_FIELDS` set in `backend/app/api/v1/batches/service.py` (lines 29-51) lists the fields that, when changed, trigger a reapproval cycle:

```
sow_number, category, entity_id, category_id, delivery_mode_id,
accommodation_id, program_name, technology, domain, client_name,
location_city, start_date, end_date, training_days, total_hours,
total_enrollments, primary_manager_id, coordinator_id, sales_spoc_id,
faculty_assigned_text, faculty_members
```

`batch_avg_feedback`, `batch_nps`, `nps_*`, `remarks`, `finance_status`, and other non-listed fields do NOT trigger reapproval.

## Approval Configuration

The `approval_configurations` table stores global approver settings:
- `approver_1_id` (FK to users.id)
- `approver_2_id` (FK to users.id)
- `updated_at` (TIMESTAMPTZ)