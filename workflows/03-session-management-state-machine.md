# Session Management State Machine

## Models

### TrainingSession (Curriculum Timetable)
| Field | Description |
|-------|-------------|
| `batch_id` | FK to Batch |
| `sequence_number` | Computed at runtime (not a DB column) |
| `week` | Computed at runtime from batch start_date (not a DB column) |
| `session_date` | Date of training (DATE type) |
| `day_name` | Day of week |
| `start_time` / `end_time` | Time window |
| `duration_hours` | Hours for this session |
| `module` | Topic/module name |
| `trainer_name` | Assigned faculty |
| `status` | Scheduled, InProgress, Completed, Cancelled, "Not Conducted", Rescheduled |

### FacultyUtilization (Delivery Ledger)
| Field | Description |
|-------|-------------|
| `batch_id` | FK to Batch |
| `training_session_id` | Optional link to planned day |
| `faculty_name` | Actual faculty who delivered |
| `date_of_training` | TIMESTAMPTZ UTC |
| `start_time` / `end_time` | Actual time window |
| `topic` | Topic delivered |
| `no_of_hours` | Hours logged |
| `venue` / `location_city` | Delivery location |
| `mode_of_delivery` | Online, Offline, F2F, Blended |
| `status` | Scheduled, InProgress, Completed, Cancelled, Not Conducted, Rescheduled |
| `feedback_submitted` | Boolean flag |
| `feedback_rating` | 1.0 - 5.0 |
| `feedback_notes` | Module feedback text |
| `outcome_reason` | Reason for Cancelled/Not Conducted |
| `outcome_at` / `outcome_by` | Outcome tracking |
| `vertical` | Delivery vertical |
| `program_type_id` / `faculty_type_id` | Lookup FKs |
| `coordinator_id` | FK to users.id (nullable) |

## States

| Model | States |
|-------|--------|
| TrainingSession | Scheduled, InProgress, Completed, Cancelled, Not Conducted, Rescheduled |
| FacultyUtilization | Scheduled, InProgress, Completed, Cancelled, Not Conducted, Rescheduled |
| TERMINAL_UTILIZATION_STATUSES | Completed, Cancelled, Not Conducted |

## State Transitions

### TrainingSession
- `Scheduled` → `Completed` (when linked utilization is completed through Gate 1)
- `Scheduled`/`InProgress` → `Cancelled` / `Not Conducted` (batch cancellation cascade)
- Status changes are NOT permitted via `update_scheduled` — the endpoint blocks any status change and returns 409.

### FacultyUtilization
- `Scheduled` → `InProgress`
- `InProgress` → `Completed` (via Gate 1)
- `Scheduled`/`InProgress` → `Cancelled` (with outcome_reason)
- `Scheduled`/`InProgress` → `Not Conducted` (with outcome_reason)
- `Scheduled` → `Scheduled` (reschedule: date/time change)
- `Completed` → **cannot change** (409 conflict)

## Create Scheduled Session (Timetable Row)

### Endpoint: `POST /api/v1/sessions/scheduled`

**Conditions:**
- Batch must exist
- User has operational scope on batch

**Flow:**
1. Validate batch exists
2. If `day_name` not provided, infer from `session_date`
3. Create `TrainingSession` with `status="Scheduled"`
4. `sequence_number` and `week` are NOT stored — they are computed at read time in `SessionService.list_scheduled()`

## Create Utilization (Actual Delivery)

### Endpoint: `POST /api/v1/sessions`

**Conditions:**
- Batch must exist
- User has operational scope on batch
- New delivery starts in `Scheduled`; a session can only become `Completed` through Gate 1
- `training_session_id` required to complete a delivery
- Time window valid: `end_time > start_time`
- `outcome_reason` required if status is `Cancelled` or `Not Conducted`

**Flow:**
1. Resolve faculty name:
   - Try exact user lookup by `faculty_name`
   - Try ilike match on `User.full_name` with Faculty role first
   - Fallback to any active user match
   - If no match, use provided free-text name
2. Validate time window
3. If `outcome_reason` provided without `outcome_by`, auto-set `outcome_by=user_id`, `outcome_at=now`
4. Create `FacultyUtilization` record
5. Keep linked timetable outcomes synchronized; only Gate 1 may mark a delivery Completed
6. Trigger `batch_avg_feedback` calculation

## Update Session

### Endpoint: `PATCH /api/v1/sessions/{id}`

**Conditions:**
- Session must exist
- Batch must not be `Completed`
- User has operational scope on batch
- If updating `start_time`/`end_time`: `end_time > start_time`
- If changing status to `Cancelled` or `Not Conducted`: `outcome_reason` required
- Session date must be within batch `start_date` to `end_date`

**Flow:**
1. Validate and apply permitted updates (`Completed` is reserved for Gate 1)
2. Synchronize linked timetable outcome for Cancelled or Not Conducted
3. Trigger `batch_avg_feedback` calculation

## Cancel Session

### Endpoint: `POST /api/v1/sessions/{id}/cancel`

**Conditions:**
- Session must not be `Completed`
- Reason required (min 3 chars)

**Flow:**
1. Set `status="Cancelled"`
2. Set `outcome_reason`, `outcome_at=now`, `outcome_by=user_id`
3. Sync linked `TrainingSession` to `Cancelled`
4. Recalculate batch feedback; batch closure remains subject to Gate 2

## Mark Not Conducted

### Endpoint: `POST /api/v1/sessions/{id}/not-conducted`

Same as Cancel but sets `status="Not Conducted"`.

## Reschedule Session

### Endpoint: `POST /api/v1/sessions/{id}/reschedule`

**Conditions:**
- Session must not be `Completed`
- New date/time provided

**Flow:**
1. Update `date_of_training`, `start_time`, `end_time`
2. Reset `status="Scheduled"`
3. Set `outcome_reason`, `outcome_at=now`, `outcome_by=user_id`

## Gate 1 (Complete Session)

### Endpoint: `PATCH /api/v1/sessions/{id}/complete`

**Conditions:**
- Session must not be in terminal status
- `rating`: 1.0 <= rating <= 5.0
- `topic_feedback`: min 3 chars
- `total_students_present`: >= 0

**Flow:**
1. Set `status="Completed"`, `feedback_submitted=True`
2. Store `feedback_rating`, `feedback_notes` (append `faculty_observations` if provided)
3. Sync linked `TrainingSession` to `Completed`
4. Trigger `batch_avg_feedback` calculation (calculates if at least one rating exists)

## Batch Completion

Session outcomes do not automatically complete a batch. Once all scheduled and logged sessions have terminal outcomes and at least one rated delivery has populated `batch_avg_feedback`, an authorized user must complete Gate 2 with NPS response counts to set the batch to `Completed`.

## Validation Rules Summary

| Rule | Condition | Error |
|------|-----------|-------|
| Time window | `end_time > start_time` | 422 |
| Outcome reason | Required for Cancelled/Not Conducted | 422 |
| Batch date bounds | Session date within batch start/end | 422 |
| Completed immutability | Cannot edit completed batches/sessions | 409 |
| Faculty name | Required for utilization | 422 |
| Training session linkage | Required when status is Completed | 422 |

## TrainingSession Model Fields (from SQLAlchemy)

- `id` (UUID, PK)
- `batch_id` (FK to batches.id, CASCADE delete)
- `session_date` (DATE, not nullable, indexed)
- `day_name` (String, nullable)
- `start_time` (TIME, nullable)
- `end_time` (TIME, nullable)
- `duration_hours` (Numeric(5,2), default: 8.00)
- `module` (Text, not nullable)
- `trainer_name` (String, nullable, indexed)
- `status` (Enum: Scheduled, InProgress, Completed, Cancelled, "Not Conducted", Rescheduled)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

**Unique Constraint:** `(batch_id, session_date, module)`

**Computed Properties (not persisted columns):**
- `sequence_number`: Sequential order, computed at runtime in `SessionService.list_scheduled()` as `enumerate(start=1)` ordered by `session_date, module`
- `week`: Week label string (e.g. "Week 1"), computed at runtime from `batch.start_date` as `(delta_days // 7) + 1`
- `effective_status`: Returns Completed/Upcoming/Ongoing/Overdue based on date

## FacultyUtilization Model Fields (from SQLAlchemy)

- `id` (UUID, PK)
- `batch_id` (FK to batches.id, CASCADE delete)
- `training_session_id` (FK to training_sessions.id, SET NULL)
- `faculty_name` (String, not nullable, indexed)
- `date_of_training` (TIMESTAMPTZ, not nullable, indexed)
- `start_time` (TIME, nullable)
- `end_time` (TIME, nullable)
- `topic` (Text, not nullable)
- `no_of_hours` (Numeric(5,2), default: 8.00)
- `venue` (String, nullable)
- `location_city` (String, nullable)
- `mode_of_delivery` (String, default: 'Online')
- `status` (Enum: Scheduled, InProgress, Completed, Cancelled, "Not Conducted", Rescheduled)
- `feedback_submitted` (Boolean, default: false)
- `feedback_rating` (Numeric(3,2), nullable)
- `feedback_notes` (Text, nullable)
- `outcome_reason` (Text, nullable)
- `outcome_at` (TIMESTAMPTZ, nullable)
- `outcome_by` (FK to users.id, nullable)
- `vertical` (String, nullable)
- `program_type_id` (FK to program_types.id, SET NULL, indexed)
- `faculty_type_id` (FK to faculty_types.id, SET NULL, indexed)
- `coordinator_id` (FK to users.id, nullable, indexed)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

Computed properties (not stored):
- `faculty_type_name` - resolved from the `faculty_type` relationship
- `entity` - resolved from `batch.entity.name`
- `program` - resolved from `batch.program_name`
- `client`, `category`, `batch_code` - resolved from batch relationship
- `coordinator` - property returning `batch.coordinator.full_name` (the `@property` overrides the `coordinator` relationship descriptor; resolves through the batch, not the `coordinator_id` FK directly)
- `coordinator_name` - alias for the `coordinator` property
- `module_feedback` - alias for `feedback_notes`