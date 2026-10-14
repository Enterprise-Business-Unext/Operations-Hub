# Data Models

## Core Entities

### User
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `email` | String(255) | Unique, indexed |
| `hashed_password` | String(255) | Bcrypt hash |
| `full_name` | String(255) | Display name |
| `role` | String(50) | Admin, Manager, Coordinator, Sales, Faculty |
| `role_id` | UUID | FK to `roles.id` |
| `team_id` | UUID | FK to `teams.id` |
| `manager_id` | UUID | Self-referential FK to `users.id` |
| `is_active` | Boolean | Default True |
| `failed_login_attempts` | Integer | Default 0 |
| `locked_until` | TIMESTAMPTZ | Null if not locked |
| `last_login_at` | TIMESTAMPTZ | Last successful login |
| `created_at` | TIMESTAMPTZ | Audit timestamp |

**Relationships:**
- `role_detail` → Role
- `team_detail` → Team
- `manager` → User (self-referential)
- `direct_reports` → User (self-referential back-populates)
- `managed_coordinators` → UserManagerMapping
- `assigned_managers` → UserManagerMapping
- `primary_managed_batches` → Batch
- `coordinated_batches` → Batch
- `sales_batches` → Batch

### Batch
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `batch_id` | String(255) | Unique immutable ID |
| `sow_number` | String(100) | Client-side SOW |
| `approval_id` | String(100) | Financial SOW reference |
| `category` | String(100) | Bootcamp, RBT, PJP, Workshop |
| `entity_id` | UUID | FK to `entities.id` |
| `category_id` | UUID | FK to `batch_categories.id` |
| `delivery_mode_id` | UUID | FK to `delivery_modes.id` |
| `accommodation_id` | UUID | FK to `accommodations.id` |
| `program_name` | String(255) | Indexed |
| `technology` | String(255) | PySpark, Databricks, etc. |
| `domain` | String(100) | IT/ITES, Cloud, DS/ML, etc. |
| `client_name` | String(255) | Indexed |
| `location_city` | String(100) | Bengaluru, Hyderabad, etc. |
| `start_date` | TIMESTAMPTZ | Indexed |
| `end_date` | TIMESTAMPTZ | Indexed |
| `batch_request_date` | TIMESTAMPTZ | Auto-set on creation |
| `training_days` | Integer | Default 0 |
| `calendar_days` | Integer | Derived from dates |
| `total_hours` | Numeric(8,2) | Default 0.00 |
| `total_enrollments` | Integer | Default 0 |
| `status` | String(50) | Default "Requested", indexed |
| `is_schema_locked` | Boolean | Default False |
| `schedule_complete` | Boolean | Default False |
| `approver_1_id` | UUID | FK to `users.id` |
| `approver_2_id` | UUID | FK to `users.id` |
| `approver_1_status` | String(20) | Default "Pending" (ApprovalStatus enum) |
| `approver_2_status` | String(20) | Default "Pending" (ApprovalStatus enum) |
| `approver_1_approved_at` | TIMESTAMPTZ | Nullable |
| `approver_2_approved_at` | TIMESTAMPTZ | Nullable |
| `reapproval_count` | Integer | Default 0 |
| `last_reapproval_at` | TIMESTAMPTZ | Nullable |
| `last_reapproval_by` | UUID | FK to `users.id`, nullable |
| `reapproval_changes` | JSON | Before/after field values, nullable |
| `primary_manager_id` | UUID | FK to `users.id` |
| `coordinator_id` | UUID | FK to `users.id` |
| `sales_spoc_id` | UUID | FK to `users.id` |
| `faculty_members` | JSON | Array of faculty objects |
| `faculty_assigned_text` | String(500) | Legacy raw names |
| `finance_status` | String(50) | Default "Pending" (values: "Pending", "Cleared") |
| `finance_status_check_date` | Date | Nullable |
| `batch_avg_feedback` | Numeric(3,2) | Nullable |
| `batch_nps` | Numeric(6,2) | Nullable |
| `nps_total_responses` | Integer | Nullable |
| `nps_promoters` | Integer | Nullable |
| `nps_passives` | Integer | Nullable |
| `nps_detractors` | Integer | Nullable |
| `remarks` | Text | Audit trail |
| `created_at` | TIMESTAMPTZ | Audit timestamp |
| `updated_at` | TIMESTAMPTZ | Audit timestamp |

**Relationships:**
- `primary_manager` → User
- `coordinator` → User
- `sales_spoc` → User
- `entity` → Entity
- `delivery_mode_detail` → DeliveryMode
- `scheduled_sessions` → TrainingSession (cascade delete)
- `faculty_utilizations` → FacultyUtilization (cascade delete)
- `approver_1` → User
- `approver_2` → User
- `last_reapproval_by_user` → User

**Computed Properties:**
- `is_reapproval`: True if `reapproval_count > 0`
- `delivery_mode`: Returns `delivery_mode_detail.name` or fallback
- `sessions_conducted`: Returns `training_days` if Completed, else estimated
- `completion_rate`: Computed from `sessions_conducted / training_days`
- `scheduled_session_count`: Number of `TrainingSession` rows

**Status Enum Values (BatchStatus):**
- `Requested`, `Approval 1 Pending`, `Approval 2 Pending`, `Upcoming`, `Ongoing`, `Pending for Closure`, `Completed`, `OnHold`, `Cancelled`, `Rejected`

**Approval Status Enum Values (ApprovalStatus):**
- `Pending`, `Approved`, `Rejected`

> **Note:** `Approved` is NOT a BatchStatus value. It exists only as an ApprovalStatus value on `approver_1_status` / `approver_2_status`. When both approvers approve, the batch auto-transitions to `Upcoming` or `Ongoing`.

### BatchEditHistory
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `batch_id` | UUID | FK to `batches.id`, indexed, cascade delete |
| `edited_by` | UUID | Nullable FK to `users.id` |
| `changed_fields` | JSON | Changed business/schedule fields with before/after values |
| `created_at` | TIMESTAMPTZ | Indexed edit timestamp |

The table is created for existing and new databases by `init_db()` (no Alembic migration). Gate 2 completion deletes a batch's history in the same transaction as the completion update.

### TrainingSession
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `batch_id` | UUID | FK to `batches.id`, indexed |
| `session_date` | Date | Indexed |
| `day_name` | String(20) | Nullable |
| `start_time` | Time | Nullable |
| `end_time` | Time | Nullable |
| `duration_hours` | Numeric(5,2) | Default 8.00 |
| `module` | Text | Topic name |
| `trainer_name` | String(255) | Nullable, indexed |
| `status` | Enum(SessionStatus) | Default "Scheduled", indexed |
| `created_at` | TIMESTAMPTZ | Audit timestamp |
| `updated_at` | TIMESTAMPTZ | Audit timestamp |

**Unique Constraints:**
- `uq_batch_date_module` on `(batch_id, session_date, module)`

**Relationships:**
- `batch` → Batch
- `utilizations` → FacultyUtilization

**Computed Properties (not persisted columns):**
- `sequence_number`: Sequential order, computed at runtime in `SessionService.list_scheduled()` as `enumerate(start=1)` ordered by `session_date, module`
- `week`: Week label string (e.g. "Week 1"), computed at runtime from `batch.start_date` as `(delta_days // 7) + 1`
- `effective_status`: Returns Completed/Upcoming/Ongoing/Overdue based on date

> **Note:** `sequence_number` and `week` are NOT database columns. They are computed at runtime by the service layer (`sessions/service.py`, `list_scheduled()` method). The `schema.dbml` listing them as columns is stale and does not match the SQLAlchemy model.

**Status Enum Values (SessionStatus):**
- `Scheduled`, `InProgress`, `Completed`, `Cancelled`, `Not Conducted`, `Rescheduled`

> **Note:** `InProgress` is stored as `"InProgress"` (no space). `NotConducted` is stored as `"Not Conducted"` (with space).

### FacultyUtilization
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `batch_id` | UUID | FK to `batches.id`, indexed |
| `training_session_id` | UUID | FK to `training_sessions.id`, nullable, indexed |
| `faculty_name` | String(255) | Indexed |
| `date_of_training` | TIMESTAMPTZ | Indexed |
| `start_time` | Time | Nullable |
| `end_time` | Time | Nullable |
| `topic` | Text | Topic delivered |
| `no_of_hours` | Numeric(5,2) | Default 8.00 |
| `venue` | String(255) | Nullable |
| `location_city` | String(100) | Nullable |
| `mode_of_delivery` | String(50) | Default "Online" |
| `status` | Enum(SessionStatus) | Default "Scheduled", indexed |
| `feedback_submitted` | Boolean | Default False |
| `feedback_rating` | Numeric(3,2) | Nullable |
| `feedback_notes` | Text | Nullable |
| `outcome_reason` | Text | Nullable, required for Cancelled/Not Conducted |
| `outcome_at` | TIMESTAMPTZ | Nullable |
| `outcome_by` | UUID | FK to `users.id`, nullable |
| `vertical` | String(50) | Nullable |
| `program_type_id` | UUID | FK to `program_types.id`, nullable, indexed |
| `faculty_type_id` | UUID | FK to `faculty_types.id`, nullable, indexed |
| `coordinator_id` | UUID | FK to `users.id`, nullable, indexed |
| `created_at` | TIMESTAMPTZ | Audit timestamp |
| `updated_at` | TIMESTAMPTZ | Audit timestamp |

**Relationships:**
- `batch` → Batch
- `training_session` → TrainingSession
- `program_type` → ProgramType
- `faculty_type` → FacultyType
- `coordinator` → User (note: overridden by a `@property` below that resolves through the batch relationship)

**Computed Properties:**
- `faculty_type_name`: Resolved display name from `faculty_type` relationship
- `client`: Resolved from `batch.client_name`
- `category`: Resolved from `batch.category`
- `batch_code`: Resolved from `batch.batch_id`
- `coordinator`: Property returning `batch.coordinator.full_name` (resolves through the batch, not the `coordinator_id` FK directly)
- `coordinator_name`: Alias for `coordinator` property
- `entity`: Resolved from `batch.entity.name`
- `program`: Resolved from `batch.program_name`
- `module_feedback`: Alias for `feedback_notes`

**Status Enum Values:**
- Same as TrainingSession: `Scheduled`, `InProgress`, `Completed`, `Cancelled`, `Not Conducted`, `Rescheduled`

## Lookup Tables

| Table | Fields | Seeded Values |
|-------|--------|---------------|
| `roles` | name, system_role, is_active | Admin, Manager, Coordinator, Sales, Faculty |
| `teams` | name, department, description, is_active | Delivery, Sales, Finance |
| `batch_categories` | name, description, is_active | Bootcamp, RBT, PJP, Workshop |
| `delivery_modes` | name, description, is_active, max_hours_per_day | Online (8), F2F (8), Blended (8) |
| `accommodations` | name, description, is_active | Residential, Non-Residential |
| `entities` | name, description, is_active | Unext, Unext BSFI |
| `verticals` | name, description, is_active | CG&O, DS/ITES, ET/BFSI, ET/ITES, ET/Merittrac, IT/ITES |
| `program_types` | name, description, is_active | RBT, Bootcamp, RGT |
| `faculty_types` | name, description, is_active | Internal Full-time, External Consultant, HOP |
| `approval_configurations` | approver_1_id, approver_2_id, updated_at | Singleton row |

## Junction / Mapping Tables

### UserManagerMapping
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `coordinator_id` | UUID | FK to `users.id` |
| `manager_id` | UUID | FK to `users.id` |
| `assigned_at` | TIMESTAMPTZ | Auto-set |

**Relationships:**
- `coordinator` → User
- `manager` → User

## Audit Log

### AuditLog
| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `event_type` | AuditEventType enum | Indexed |
| `user_id` | UUID | FK to `users.id`, nullable, indexed |
| `user_email` | String(255) | Indexed |
| `ip_address` | String(45) | Nullable |
| `user_agent` | Text | Nullable |
| `details` | Text | Nullable |
| `created_at` | TIMESTAMPTZ | Indexed |

**AuditEventType Values:**
- `login_success`, `login_failed`, `logout`, `password_change`, `password_reset_admin`
- `account_locked`, `account_unlocked`
- `user_created`, `user_updated`, `user_deleted`
- `role_assigned`
- `refresh_token_used`, `refresh_token_failed`

## Key Constraints

- `batches.batch_id`: UNIQUE, NOT NULL
- `training_sessions`: UNIQUE constraint on `(batch_id, session_date, module)`
- `users.email`: UNIQUE, NOT NULL
- `roles.name`: UNIQUE
- `teams.name`: UNIQUE
- All lookup table `name` fields: UNIQUE

## Indexes

**Batches:**
- `ix_batches_batch_id` on `batch_id` (unique)
- `ix_batches_sow_number` on `sow_number`
- `ix_batches_approval_id` on `approval_id`
- `ix_batches_program_name` on `program_name`
- `ix_batches_client_name` on `client_name`
- `ix_batches_status` on `status`
- `ix_batches_start_date` on `start_date`
- `ix_batches_end_date` on `end_date`
- `ix_batches_approver_1_id` on `approver_1_id`
- `ix_batches_approver_2_id` on `approver_2_id`
- `ix_batches_primary_manager_id` on `primary_manager_id`
- `ix_batches_coordinator_id` on `coordinator_id`
- `ix_batches_sales_spoc_id` on `sales_spoc_id`

**TrainingSessions:**
- `ix_training_sessions_batch_id` on `batch_id`
- `ix_training_sessions_session_date` on `session_date`
- `ix_training_sessions_status` on `status`
- `ix_training_sessions_trainer_name` on `trainer_name`
- `uq_batch_date_module` on `(batch_id, session_date, module)` (unique)

**FacultyUtilization:**
- `ix_faculty_utilization_batch_id` on `batch_id`
- `ix_faculty_utilization_training_session_id` on `training_session_id`
- `ix_faculty_utilization_faculty_name` on `faculty_name`
- `ix_faculty_utilization_date_of_training` on `date_of_training`
- `ix_faculty_utilization_status` on `status`
- `ix_faculty_utilization_program_type_id` on `program_type_id`
- `ix_faculty_utilization_faculty_type_id` on `faculty_type_id`

**Users:**
- `ix_users_email` on `email` (unique)
- `ix_users_role_id` on `role_id`
- `ix_users_team_id` on `team_id`
- `ix_users_manager_id` on `manager_id`

**AuditLogs:**
- `ix_audit_logs_event_type` on `event_type`
- `ix_audit_logs_user_id` on `user_id`
- `ix_audit_logs_user_email` on `user_email`
- `ix_audit_logs_created_at` on `created_at`

**UserManagerMappings:**
- `ix_user_manager_mappings_coordinator_id` on `coordinator_id`
- `ix_user_manager_mappings_manager_id` on `manager_id`

## Foreign Key Relationships

```
users.role_id → roles.id
users.team_id → teams.id
users.manager_id → users.id (self-referential)

user_manager_mappings.coordinator_id → users.id
user_manager_mappings.manager_id → users.id

audit_logs.user_id → users.id

batches.entity_id → entities.id
batches.category_id → batch_categories.id
batches.delivery_mode_id → delivery_modes.id
batches.accommodation_id → accommodations.id
batches.primary_manager_id → users.id
batches.coordinator_id → users.id
batches.sales_spoc_id → users.id
batches.approver_1_id → users.id
batches.approver_2_id → users.id

approval_configurations.approver_1_id → users.id
approval_configurations.approver_2_id → users.id

training_sessions.batch_id → batches.id

faculty_utilization.batch_id → batches.id
faculty_utilization.training_session_id → training_sessions.id
faculty_utilization.outcome_by → users.id
faculty_utilization.program_type_id → program_types.id
faculty_utilization.faculty_type_id → faculty_types.id
```