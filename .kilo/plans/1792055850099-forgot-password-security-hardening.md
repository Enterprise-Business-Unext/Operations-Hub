# Plan: Forgot Password - Security Hardening

## Current State (Already Implemented)
- Generic response prevents email enumeration: "If an account with that email exists, a temporary password has been sent to the registered email address."
- Temporary password meets policy (min 16 chars, uppercase, lowercase, digit, special)
- Account unlock on reset request (clears `failed_login_attempts`, `locked_until`)
- Audit logging: `PASSWORD_RESET_REQUESTED` event with IP/user-agent
- SMTP fallback logs to console in development

---

## Security Hardening Plan

### 1. Rate Limiting on Forgot Password Endpoint
**Problem:** Unlimited requests enable email harvesting, credential stuffing, DoS.

**Solution:** Add rate limiter to `POST /api/v1/auth/forgot-password`
- Config: `FORGOT_PASSWORD_RATE_LIMIT = "5/minute"` per IP (configurable)
- Store in Redis/memory with sliding window
- Return `429 Too Many Requests` with `Retry-After` header
- Burst allowance: 3 requests in 5 minutes, then cooldown

**Files:** `backend/app/api/v1/auth/controller.py`, `backend/app/core/rate_limit.py` (new), `backend/app/core/config.py`

---

### 2. Temporary Password Expiry & Forced Rotation
**Problem:** Temp password is valid indefinitely until changed.

**Solution:** Use the token-based reset flow (see item 3) as the primary mechanism — no new DB columns required.
- Token encodes expiry (TTL 1h) and invalidates on use
- On token reset: force password change immediately in same flow
- If keeping raw temp password flow (legacy): track `must_change_password` in Redis/cache with TTL, keyed by user_id
- No schema migration needed; SQLAlchemy creates columns on init if added to model with defaults

**Files:** `backend/app/core/security.py`, `backend/app/api/v1/auth/service.py`, `backend/app/api/v1/auth/controller.py`, `frontend/app/reset-password/page.tsx`

---

### 3. One-Time Token Instead of Raw Password in Email
**Problem:** Raw temp password in email is exposed in logs, history, forwarding.

**Solution:** Replace with signed, time-limited reset token (JWT or opaque)
- Endpoint: `POST /auth/forgot-password` → generates token, stores hash, emails reset link
- New endpoint: `POST /auth/reset-password` with `{ token, new_password }`
- Token TTL: 1 hour (configurable: `RESET_TOKEN_TTL_HOURS = 1`)
- Invalidate on use; store hash only (bcrypt/argon2)
- Frontend: `/reset-password?token=...` page with new password form

**Files:** `backend/app/core/security.py`, `backend/app/api/v1/auth/service.py`, `backend/app/api/v1/auth/controller.py`, `frontend/app/reset-password/page.tsx`

---

### 4. Audit Event for Non-Existent Email (Abuse Detection)
**Problem:** Current code logs "User not found" without user_id - good for enumeration protection but loses IP context for abuse detection.

**Solution:** Separate audit event `PASSWORD_RESET_REQUESTED_UNKNOWN_EMAIL`
- Log IP, user-agent, email (hashed or truncated)
- Rate limiter can query this for suspicious IP patterns
- Alert if >10 unknown emails/hour from same IP

**Files:** `backend/app/models/user.py` (enum), `backend/app/api/v1/auth/service.py`

---

### 5. CSRF Protection for State-Changing Endpoints
**Problem:** `/forgot-password` is POST but no CSRF check (public endpoint, but still).

**Solution:** Add CSRF token to login/forgot-password forms
- Double-submit cookie pattern (FastAPI `CSRFMiddleware` or manual)
- Include in `forgot-password` page form

**Files:** `backend/app/main.py`, `frontend/app/forgot-password/page.tsx`

---

### 6. Security Headers for Email
**Problem:** HTML email may render in webmail with tracking pixels.

**Solution:** Add email security headers
- `X-Auto-Response-Suppress: OOF, AutoReply`
- `List-Unsubscribe: <mailto:security@company.com>`
- `Precedence: bulk`
- Disable external images (already inline CSS)

**Files:** `backend/app/core/email.py` (`_create_message`)

---

### 7. Configurable Security Policies
**Problem:** Hardcoded values for lockout, TTL, rate limits.

**Solution:** Centralize in `backend/app/core/config.py`
```python
FORGOT_PASSWORD_RATE_LIMIT = "5/minute"
RESET_TOKEN_TTL_HOURS = 1
TEMP_PASSWORD_TTL_HOURS = 24
MAX_FORGOT_PASSWORD_ATTEMPTS_PER_HOUR = 3
```

---

## Validation Plan
1. Unit tests: rate limiter, token generation/validation, expiry logic
2. Integration test: full forgot→reset flow
3. Load test: 100 req/min to `/forgot-password` → verify 429
4. Pen test: SQL injection, XSS in email field, token replay
5. Manual: request reset → check email → use token → verify forced rotation

---

## Rollout
- Phase 1: Rate limiting + audit enhancement (low risk)
- Phase 2: Token-based reset with forced rotation (single flow, no DB migration)
- Phase 3: Deprecate raw temp password email flow

---

## Open Questions
1. **Redis available?** If not, use in-memory with distributed lock fallback for rate limiting + temp password state.
2. **Email template change?** Token link vs raw password - requires user communication.
3. **Legacy temp passwords?** Accept both token and raw password for transition period (configurable flag).