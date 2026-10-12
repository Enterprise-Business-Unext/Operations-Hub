# Batch Lifecycle State Machine

## States

| State | Description |
|-------|-------------|
| `Requested` | Initial draft before submission |
| `Approval 1 Pending` | Awaiting first approver decision |
| `Approval 2 Pending` | Awaiting second approver decision |
| `Approved` | Both approval levels completed |
| `Upcoming` | Approved, start date in the future |
| `Ongoing` | Approved, start date has arrived |
| `Pending for Closure` | End date passed, awaiting Gate 2 |
| `Completed` | Gate 2 closed, batch finished |
| `OnHold` | Temporarily paused |
| `Cancelled` | Terminal state, no further transitions |
| `Rejected` | Rejected during approval process |

## Valid Transitions Matrix

```
Requested           → Approval 1 Pending, OnHold, Cancelled
Approval 1 Pending  → Approval 2 Pending, Requested, OnHold, Cancelled
Approval 2 Pending  → Approved, Upcoming, Ongoing, Requested, OnHold, Cancelled
Approved            → Upcoming, Ongoing, OnHold, Cancelled
Upcoming            → Ongoing, OnHold, Cancelled, Approved
Ongoing             → Pending for Closure, OnHold, Cancelled
Pending for Closure → Completed, OnHold, Cancelled
Completed           → OnHold (reopen for corrections)
OnHold              → Requested, Approval 1 Pending, Approval 2 Pending, Approved, Upcoming, Ongoing, Cancelled
Cancelled           → {} (terminal)
Rejected            → Requested, OnHold, Cancelled
```

## Approval Required Statuses

`{Approved, Upcoming, Ongoing, Pending for Closure, Completed}`

These statuses cannot be entered unless both approver levels have approved.

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
- `status` (Enum: Requested, Approval1Pending, Approval2Pending, Upcoming, Ongoing, PendingForClosure, Completed, OnHold, Cancelled, Rejected)
- `is_schema_locked` (Boolean, default: false)
- `schedule_complete` (Boolean, default: false)
- `approver_1_id` (FK to users.id)
- `approver_2_id` (FK to users.id)
- `approver_1_status` (Enum: Pending, Approved, Rejected)
- `approver_2_status` (Enum: Pending, Approved, Rejected)
- `approver_1_approved_at` (TIMESTAMPTZ)
- `approver_2_approved_at` (TIMESTAMPTZ)
- `primary_manager_id` (FK to users.id)
- `coordinator_id` (FK to users.id)
- `sales_spoc_id` (FK to users.id)
- `faculty_members` (JSON)
- `faculty_assigned_text` (String, legacy)
- `finance_status` (String, default: 'Pending')
- `finance_status_check_date` (Date)
- `finance_check` (Integer)
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
- `reject`: Set `approver_1_status="Rejected"`, transition to `Requested`, record reason in remarks

## Level 2 Approval Workflow

### Endpoint: `POST /api/v1/batches/{id}/approve-level-2`

**Conditions:**
- Current user must be `approver_2` for this batch
- `approver_1_status` must be `Approved`
- Batch must be in `Approval 2 Pending`

**Flow:**
- `approve`: Set `approver_2_status="Approved"`, `approver_2_approved_at=now`, `is_schema_locked=True`, set `approval_id` from reason (if <= 100 chars), auto-transition to `Upcoming` or `Ongoing` based on `start_date`
- `reject`: Set `approver_2_status="Rejected"`, transition to `Requested`

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
  - Any rejected → `Requested`
  - Both approved → `Approved`

## Close Batch (Gate 2) Workflow

### Endpoint: `POST /api/v1/batches/{id}/close`

**Preconditions:**
- `batch_avg_feedback` is not None (at least one rated delivery exists)
- ALL sessions (scheduled + logged) are terminal (`Completed`, `Cancelled`, or `Not Conducted`)

**Flow:**
1. Compute `NPS = ((promoters - detractors) / total) * 100`
2. Store `batch_nps`, `nps_total_responses`, `nps_promoters`, `nps_passives`, `nps_detractors`
3. Set `status="Completed"`, `is_schema_locked=True`
4. Trigger notification

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
- `finance_check`

## Approval Configuration

The `approval_configurations` table stores global approver settings:
- `approver_1_id` (FK to users.id)
- `approver_2_id` (FK to users.id)
- `updated_at` (TIMESTAMPTZ)