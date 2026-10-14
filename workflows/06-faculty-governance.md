# Faculty Governance Workflows

## Faculty Types

| Type | Description |
|------|-------------|
| `Internal Full-time` | Company employees |
| `External Consultant` | Contract faculty |
| `HOP` | Head of Program / guest faculty |

## Domains

| Domain | Description |
|--------|-------------|
| `IT/ITES` | IT and IT Enabled Services |
| `Cloud` | Cloud technologies |
| `DS/ML` | Data Science / Machine Learning |
| `CyberSecurity` | Security focus |
| `FullStack` | Full stack development |

## Faculty Resolution

When logging a utilization record, the system resolves the faculty name:

1. If `faculty_id` provided: look up active user by ID, use `full_name`
2. If `faculty_name` provided:
   - Try exact match on `User.full_name` with `role="Faculty"`
   - Try ilike match on `User.full_name` with `role="Faculty"`
   - Try exact match on `User.full_name` (any active user)
   - Try ilike match on `User.full_name` (any active user)
3. If no match found: use the provided name as free-text
4. If no name provided at all: return 422 error

## Faculty Utilization Overview

### Endpoint: `GET /api/v1/faculty/utilization`

**Computed fields:**
- `total_faculty_count`: Active users with `role="Faculty"`
- `active_deployed_faculty`: Distinct faculty names in Scheduled, InProgress, or Completed utilizations that match the faculty roster (case-insensitive)
- `overall_utilization_percentage`: `(active_deployed / total_faculty) * 100`, rounded to 1 decimal
- `domain_breakdown`: For each domain:
  - `faculty_count`: Distinct faculty names in Scheduled, InProgress, or Completed deliveries for batches with matching domain
  - `hours_scheduled`: Sum of `no_of_hours` for those active deliveries

## Faculty Utilization Export

### Endpoint: `GET /api/v1/faculty/utilization/export`

**Filters:**
- `faculty_type`: Joins `FacultyType` table to filter by name
- `start_date` / `end_date`: Filters `date_of_training` range

**Columns:**
Date, Faculty Name, Faculty Type, Topic, Hours, City, Venue, Mode, Status, Feedback Rating, Feedback Notes, Outcome Reason, Outcome At

## FMS Sync Workflow

### Endpoint: `POST /api/v1/integrations/fms/sync`

**Conditions:**
- User must be Admin

**Current Behavior:**
- Returns mock success response: `{"status": "SUCCESS", "message": "FMS sync event ... dispatched"}`
- Does NOT actually call external FMS API
- `FMS_API_BASE_URL` and `FMS_API_KEY` config vars exist but are unused

## FMS Logs

### Endpoint: `GET /api/v1/integrations/fms/logs`

**Conditions:**
- User must be Admin

**Current Behavior:**
- Returns empty list (no persistence table yet)

## Lookup Tables (from SQLAlchemy)

### faculty_types
- `id` (UUID, PK)
- `name` (String, unique)
- `description` (String, nullable)
- `is_active` (Boolean, default: true)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

### program_types
- `id` (UUID, PK)
- `name` (String, unique)
- `description` (String, nullable)
- `is_active` (Boolean, default: true)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

### verticals
- `id` (UUID, PK)
- `name` (String, unique)
- `description` (String, nullable)
- `is_active` (Boolean, default: true)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

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

## Computed Properties (FacultyUtilization)

- `faculty_type_name`: Resolved display name from the `faculty_type` relationship
- `entity`: Resolved from `batch.entity.name`
- `program`: Resolved from `batch.program_name`
- `client`: Resolved from `batch.client_name`
- `category`: Resolved from `batch.category`
- `batch_code`: Resolved from `batch.batch_id`
- `coordinator`: Property returning `batch.coordinator.full_name` (the `@property` overrides the `coordinator` relationship descriptor; resolves through the batch, not the `coordinator_id` FK directly)
- `coordinator_name`: Alias for the `coordinator` property
- `module_feedback`: Alias for `feedback_notes`

## Faculty Utilization Indexes

- `ix_faculty_utilization_batch_id` on `batch_id`
- `ix_faculty_utilization_training_session_id` on `training_session_id`
- `ix_faculty_utilization_faculty_name` on `faculty_name`
- `ix_faculty_utilization_date_of_training` on `date_of_training`
- `ix_faculty_utilization_status` on `status`
- `ix_faculty_utilization_program_type_id` on `program_type_id`
- `ix_faculty_utilization_faculty_type_id` on `faculty_type_id`