# Authentication & Authorization Workflows

## Overview

The backend implements JWT-based authentication with role-based access control (RBAC). There are 5 system roles: Admin, Manager, Coordinator, Sales, and Faculty.

## Login Workflow

### Endpoint: `POST /api/v1/auth/login`

**Conditions:**
- Email and password are required
- Account must be active (`is_active = True`)
- Account must not be locked (`locked_until` must be null or in the past)

**Flow:**
1. User submits email + password
2. System checks if account is locked (locked_until > now)
   - If locked: return 423 with lockout expiry time
3. Verify password hash
   - If invalid: increment `failed_login_attempts`
   - If `failed_login_attempts >= MAX_FAILED_LOGIN_ATTEMPTS` (default: 10): lock account for `LOCKOUT_DURATION_MINUTES` (default: 15 minutes)
   - Return 401
4. If valid:
   - Reset `failed_login_attempts` to 0
   - Clear `locked_until`
   - Set `last_login_at` to now
   - Generate access token (expires in 30 minutes by default)
   - Generate refresh token (expires in 7 days by default)
   - Log audit event: `LOGIN_SUCCESS`

**Audit Events Logged (AuditEventType enum values):**
- `login_failed` - on invalid password or inactive account
- `account_locked` - when max failed attempts reached
- `account_unlocked` - when locked account logs in successfully
- `login_success` - on successful login

Additional audit events exist but are not auth-specific:
- `password_change`, `password_reset_admin`, `logout`, `user_created`, `user_updated`, `user_deleted`, `role_assigned`, `refresh_token_used`, `refresh_token_failed`

## Token Refresh Workflow

### Endpoint: `POST /api/v1/auth/refresh`

**Conditions:**
- Valid refresh token required
- User must still be active

**Flow:**
1. Decode refresh token
2. If invalid/expired: log `REFRESH_TOKEN_FAILED`, return 401
3. Look up user by ID from token payload
4. If user not found or inactive: log `REFRESH_TOKEN_FAILED`, return 404
5. Generate new access token + refresh token pair
6. Log `REFRESH_TOKEN_USED`

## Password Change Workflow

### Endpoint: `POST /api/v1/auth/change-password`

**Conditions:**
- User must be authenticated
- Current password must be correct
- New password must meet policy:
  - Minimum 12 characters
  - At least 1 uppercase letter
  - At least 1 lowercase letter
  - At least 1 number
  - At least 1 special character

**Flow:**
1. Verify current password
2. Validate new password strength
3. Hash and store new password
4. Log `PASSWORD_CHANGE` audit event

## Admin Password Reset Workflow

### Endpoint: `POST /api/v1/auth/users/{id}/change-password`

**Conditions:**
- Caller must be Admin
- Target user must exist
- New password must meet policy

**Flow:**
1. Validate new password strength
2. Hash and store new password
3. Reset `failed_login_attempts` to 0
4. Clear `locked_until` (unlocks account if locked)
5. Log `PASSWORD_RESET_ADMIN` audit event

## Account Lockout Conditions

| Condition | Action |
|-----------|--------|
| `failed_login_attempts >= 5` | Lock account for 15 minutes |
| Account locked + login attempt | Return 423 |
| Successful login while locked | Unlock immediately, reset counters |
| `is_active = False` | Reject login with 400 |

## RBAC Role Hierarchy

```
Admin         - Full access to everything
Manager       - View/edit batches in their scope, view analytics
Coordinator   - Create/edit batches they own, log sessions
Sales         - Limited batch ownership (sales_spoc)
Faculty       - View assigned sessions, receive notifications
```

> Note: "Finance" is a **team** (not a role). Users on the Finance team can have any role, but Finance team membership grants elevated access to batch finance fields (`finance_status`, `finance_status_check_date`) regardless of role.

## Permission Dependencies

| Dependency | Allowed Roles |
|------------|---------------|
| `get_current_user` | Any authenticated user (JWT validated) |
| `require_roles(allowed_roles)` | Factory that returns a dependency checking `current_user.role` against the allowed list (case-insensitive); raises 403 otherwise |
| `require_admin` | Admin only |
| `require_manager_or_admin` | Admin, Manager |
| `require_coordinator_or_above` | Admin, Manager, Coordinator |

### Service-layer RBAC Helpers (from backend/app/api/deps.py)

- `get_all_subordinate_ids(manager_id, db)` — Returns all direct and indirect subordinate UUIDs via BFS over `User.manager_id` and `UserManagerMapping` table
- `get_managed_coordinator_ids(manager_id, db)` — Returns only coordinators under a manager (excludes other managers)
- `get_manager_scope_user_ids(user, db)` — Returns the operational ownership scope for a user
- `is_manager_or_lead(user, db)` — Returns `True` if user role is Admin/Manager, or if user `has_direct_reports`

### Token Claims

- `sub`: User UUID (string)
- `role`: User's system role (e.g., "Admin", "Manager", "Coordinator", "Sales", "Faculty")
- `type`: "access" or "refresh" — used to distinguish token types during validation
- `exp`: Expiration timestamp (30 min for access, 7 days for refresh)

### Rate Limiting

- Applied only to auth endpoints (`/api/v1/auth/*`) via `RedisRateLimitMiddleware`
- `RATE_LIMIT_REQUESTS`: 100 requests per window
- `RATE_LIMIT_WINDOW_SECONDS`: 60 seconds
- `RATE_LIMIT_ENABLED`: `True` by default
- Returns 429 with `Retry-After` header when exceeded

## Login Endpoint RBAC Matrix (Auth Controller)

| Endpoint | Auth | Notes |
|----------|------|-------|
| `POST /auth/login` | None | Email/password required |
| `POST /auth/refresh` | None | Valid refresh token |
| `GET /auth/me` | Any authenticated | - |
| `POST /auth/change-password` | Any authenticated | Current password correct |
| `GET /auth/my-reports` | Any authenticated | Direct reports of caller |
| `GET /auth/users` | Manager or Admin | - |
| `POST /auth/users` | Admin | - |
| `PATCH /auth/users/{id}` | Admin | - |
| `DELETE /auth/users/{id}` | Admin | Cannot delete self |
| `POST /auth/users/admin-create` | Admin | Auto-generates password, optional welcome email |
| `POST /auth/users/{id}/change-password` | Admin | Admin resets user password |
| `GET /auth/users/assignable` | Any authenticated | Query: `role` (Sales/Coordinator/Manager), optional `team_name` |
| `GET /auth/hierarchy` | Any authenticated | Full org tree |
| `GET /auth/users/coordinators` | Coordinator or above | Scoped to caller's managed coordinators |
| `POST /auth/users/coordinator-mapping` | Admin | - |
| `GET /auth/coordinator-mappings` | Admin | - |
| `DELETE /auth/coordinator-mappings/{mapping_id}` | Admin | - |
| `GET /auth/audit-logs` | Admin | Pagination: `skip`, `limit` (max 500) |

## Manager Scope Resolution

A user's operational scope determines which batches they can view/edit:

**Manager scope includes:**
- Their own user ID
- All direct and indirect reports (coordinators) under them
- Resolved via both `User.manager_id` hierarchy and `UserManagerMapping` table

**Coordinator scope includes:**
- Their own user ID
- Their manager's ID
- All coordinators under the same manager
- Resolved via `UserManagerMapping` if `manager_id` is not set

**Unrestricted callers (see everything):**
- Admin role
- Finance team

## User Model Fields (from SQLAlchemy)

The `users` table includes:
- `id` (UUID, PK)
- `email` (unique, indexed)
- `hashed_password`
- `full_name`
- `role` (string: Admin, Manager, Coordinator, Sales, Faculty)
- `role_id` (FK to roles.id)
- `team_id` (FK to teams.id)
- `manager_id` (self-referential FK to users.id)
- `is_active` (boolean)
- `failed_login_attempts` (integer, default 0)
- `locked_until` (TIMESTAMPTZ, nullable)
- `last_login_at` (TIMESTAMPTZ, nullable)
- `created_at` (TIMESTAMPTZ)

## Role & Team Models

**roles table:**
- `id` (UUID, PK)
- `name` (unique)
- `system_role` (default: 'Coordinator')
- `is_active`
- `created_at`

**teams table:**
- `id` (UUID, PK)
- `name` (unique)
- `department` (default: 'Ops')
- `description`
- `is_active`
- `created_at`

**user_manager_mappings table:**
- `id` (UUID, PK)
- `coordinator_id` (FK to users.id)
- `manager_id` (FK to users.id)
- `assigned_at` (TIMESTAMPTZ)