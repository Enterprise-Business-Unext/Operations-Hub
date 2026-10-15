# Plan: Forgot Password Feature (Generate Temporary Password & Email)

## Problem statement recap
"i wan to implement forgot ppassword feature it is supposed to send an mail with creating an temporary password"

User wants forgot password that sends an email with creating a temporary password. No existing implementation found (no forgot/reset endpoints in backend, no frontend UI, no API methods).

## Current state analysis
- Backend auth: login, refresh, change-password (self), admin reset password, create user by admin (auto-generates password + can email). 
- Auth controller has admin reset only (line ~142 in controller). Service has `admin_reset_user_password`. 
- Email service exists with `send_welcome_email` and templates; can send emails (falls back to print if SMTP not configured).
- Password policy exists in security/config (min length, char requirements).
- Audit logging exists with event types - has `PASSWORD_RESET_ADMIN`. Need to consider audit event for forgot password (self-initiated reset). Check AuditEventType enum.
- Frontend: login page exists, no forgot password link/UI. API client has login/changePassword/adminChangeUserPassword.

## Design decisions (key questions to resolve)

### 1) Endpoint design (public vs protected)
Forgot password is typically public (user can't login). Need to add public endpoint like `POST /api/v1/auth/forgot-password` that takes email, generates temp password, sets it, emails it. Must not leak info (don't reveal if user exists) - security best practice. But easier to be helpful? Need to decide behavior on non-existent email.

### 2) Password generation & policy
Reuse `generate_random_password()` from email/core? Yes - same as admin user creation. Ensure meets policy. Also when we set it via `admin_reset_user_password` logic, it validates strength. Our generator should satisfy policy.

### 3) Security behavior
- Generate strong temporary password
- Hash and store it (overwrite current)
- Should we force password change on next login? Or just let them use temp password to login then change? The welcome email says "temporary password will expire and must be updated on first use" - suggests forcing password change. Check if system has "must change password" flag? Look up User model - no such field visible. May need to add `must_change_password` (bool, default False) or set `password_changed_at`? Or simpler: track via audit? Or just document - maybe follow existing pattern (admin reset doesn't force change). But requirement says "temporary password" - maybe just generate and email. Let us look up how others might expect. But better to be explicit.
- Also account lockout - if account locked, should forgot password unlock? Admin reset does unlock (sets failed_attempts=0, locked_until=None). Forgot password is legitimate user request - probably should unlock account too? That makes sense.

### 4) Audit logging
Add audit event type like `PASSWORD_RESET_REQUESTED` or `PASSWORD_RESET_SELF`? Current has `PASSWORD_RESET_ADMIN`. Need to add to AuditEventType enum. Also log IP/user agent.

### 5) Rate limiting / abuse
Should prevent abuse (email enumeration, spam). But not specified. May note as consideration. But implement basic - maybe not required for now.

### 6) Email template
Need separate email template for forgot password (different wording than welcome). Create FORGOT_PASSWORD_EMAIL_TEMPLATE (HTML + text). Similar structure - include temp password, login link, security notice.

### 7) API contract (request/response)
Request: `{ email: EmailStr }`
Response: Success message like `{ "detail": "If an account with that email exists, a temporary password has been sent." }` (to avoid enumeration). Or just success. Better to not leak existence.

### 8) Frontend changes
- Add "Forgot password?" link on login page (below password or near submit)
- Create forgot password page/modal? Or simple modal on login? Or dedicated page /forgot-password. Simpler: add link that opens a modal or navigates to /forgot-password page. Check existing patterns - login is a page. Maybe add /forgot-password page similar to login.
- API method: add `forgotPassword(email)` to api client.

## Implementation plan

### Backend changes

1. **Models** (`backend/app/models/user.py`)
- Add `PASSWORD_RESET_REQUESTED = "password_reset_requested"` to `AuditEventType` enum

2. **Schemas** (`backend/app/schemas/user.py`)
- Add `ForgotPasswordRequest(BaseModel)`: `email: EmailStr`
- Add `ForgotPasswordResponse(BaseModel)` or just return dict? Keep consistent with other endpoints.

3. **Email** (`backend/app/core/email.py`)
- Add `FORGOT_PASSWORD_EMAIL_TEMPLATE` (HTML)
- Add `FORGOT_PASSWORD_EMAIL_TEXT_TEMPLATE` (text)
- Add `send_forgot_password_email(to_email, full_name, password)` method in EmailService (similar to send_welcome_email)
- Update proxy if needed (already dynamic)

4. **Security/Service** (`backend/app/api/v1/auth/service.py`)
- Add method `forgot_password(self, email: str, ip_address=None, user_agent=None) -> dict`
  - Look up user by email (case-insensitive like login does? login does `login_data.email` as-is but may be lowercased by client; better to normalize)
  - If not found: log audit? maybe not (to avoid enumeration) or log without user_id. Better to not reveal - still return success. But log IP for abuse detection? Optional.
  - If found: validate account not deleted? is_active - if inactive, maybe still don't reveal; or treat as no-op? But better to be safe - return generic success regardless.
  - If found and active: generate password via `generate_random_password()`, validate strength (generator should be fine), hash with `get_password_hash()`, update user: set hashed_password, reset failed attempts and lockout (unlock account), maybe set `last_login_at` unchanged. Also log audit `PASSWORD_RESET_REQUESTED`.
  - Send email via `email_service.send_forgot_password_email()`. If email fails, still return success? Or handle? But we don't want to leak. Better to attempt and return generic success.
  - Return `{"detail": "If an account with that email exists, a temporary password has been sent to the registered email address."}`

5. **Controller** (`backend/app/api/v1/auth/controller.py`)
- Add request schema import: `ForgotPasswordRequest` from schemas
- Add endpoint `@router.post("/forgot-password")` (public, no auth dependency)
  - Takes `ForgotPasswordRequest`, Request for client info, service via Depends
  - Calls service.forgot_password
  - Returns dict

### Frontend changes

1. **API client** (`frontend/lib/api.ts`)
- Add method `async forgotPassword(email: string): Promise<{ detail: string }>` that POSTs to `/auth/forgot-password`

2. **Login page** (`frontend/app/login/page.tsx`)
- Add "Forgot password?" link (maybe below password field, right-aligned)
- Could link to a new page or show modal. Simpler to create new page `/forgot-password` for cleaner UX? Or inline modal. Let us look up existing patterns - login is standalone page. Maybe add link to `/forgot-password` route.

But need to create new page: `frontend/app/forgot-password/page.tsx` similar to login page.
- Form to enter email
- Submit calls api.forgotPassword
- Show success message
- Link back to login

Also add route to middleware? Public paths - middleware currently has `PUBLIC_PATHS = ["/login"]`. Need to add "/forgot-password".

3. **Middleware** (`frontend/middleware.ts`)
- Add "/forgot-password" to PUBLIC_PATHS

### Tests (optional but good practice)
- Backend test for forgot password endpoint - success case, non-existent email (should still return 200 with generic message), inactive user behavior? Let us look for existing test patterns. There might be tests for auth.

But user says "implement" - maybe just implement. Let us also add the endpoint to API docs if needed, but not specified.

## Validation plan
1. Backend: Python syntax check, import test
2. Try to start backend? Maybe not possible in this environment, but verify code compiles
3. Frontend: TypeScript check (tsc) if available
4. Manual flow: submit forgot password with existing user email -> email sent (or logged), temp password works for login

## Open questions (minimal)
- Should inactive accounts get reset? Probably return generic success to not leak info.
- Force password change on first login with temp password? No field exists. Could add later, but not specified. Keep simple as per requirement.
- Rate limiting? Not specified - skip for now.
- Case sensitivity of email? Normalize to lowercase like login does.

## Risks
- Email enumeration if we reveal user exists - mitigate by generic response
- SMTP not configured - service logs to console (as designed) - acceptable for dev
- No DB migration needed for enum addition (SQLAlchemy Enum creates type on first use in Postgres; existing code may handle)

## Final plan
This is implementation-ready. Write full plan to specified location and call plan_exit.