# Notification Workflows

## Overview

The system triggers notifications at key workflow events. Currently, email delivery is only wired for batch approval and session scheduling. Other events are logged but not yet emailed.

## Notification Events

### 1. Approval Requested

**Trigger:** Batch submitted for approval (via `PATCH /batches/{id}/submit`) or approval decision made (via `PATCH /batches/{id}/approve` or `/reject`)

**Recipients:** `approver_1` and `approver_2` email addresses (resolved from `batch.approver_1.email` and `batch.approver_2.email`)

**Current Behavior:** Logs recipient emails but does NOT send actual email (delivery not wired up)

**NotificationService method:** `notify_approval_requested(batch, changed_fields=None, reapproval_count=0)`

**Log Output:**
```
[NOTIFICATION TRIGGERED] Approval Requested: {batch_id}. Approver 1: {approver_1_id}, Approver 2: {approver_2_id}
{body}
Approval email for batch {batch_id}, event: {event_type}, recipients: {emails}
```

When reapproval, subject and body include changed fields details.

### 2. Batch Approved

**Trigger:** Batch schema locked and approved via `PATCH /batches/{id}/approve` (Gate 2 completion)

**Recipients:** `primary_manager.email`, `sales_spoc.email`

**NotificationService method:** `notify_batch_approved(batch_id, approval_id, manager_email, sales_email)`

**Email Content:**
- Subject: `Batch Approved: {batch_id}`
- Body: Batch ID, Approval ID, message to proceed with scheduling
- Sends both HTML and plain-text versions

**Failure Handling:** Individual email failures are caught inside `send_email` (returns `False`), loop continues to next recipient.

### 3. Session Scheduled

**Trigger:** New session created via `POST /api/v1/sessions/scheduled` (trainer assigned to a session)

**Recipients:** `faculty_email` (if available)

**NotificationService method:** `notify_session_scheduled(faculty_name, faculty_email, date_str, topic)`

**Email Content:**
- Subject: `Session Scheduled: {topic} on {date_str}`
- Body: Faculty name, topic, date
- Sends both HTML and plain-text versions

**Conditions:**
- Only sent if `faculty_email` is provided (not None)
- Faculty name is logged even if no email

### 4. Gate Completion

**Trigger:** Quality Gate 1 or Gate 2 completed

**Recipients:** None (logged only)

**NotificationService method:** `notify_gate_completion(batch_id, gate_name, score)` — logs only, no email sent

**Log Output:**
```
[NOTIFICATION TRIGGERED] Quality Gate '{gate_name}' completed for Batch {batch_id} with Score: {score}
```

## Email Service Configuration

**SMTP Settings:**
- `SMTP_HOST`: Default `localhost`
- `SMTP_PORT`: Default `587`
- `SMTP_USER`: SMTP authentication username (required for real delivery)
- `SMTP_PASSWORD`: SMTP authentication password (required for real delivery)
- `SMTP_TLS`: Default `True`
- `EMAIL_FROM`: Default `noreply@enterprise-ops.com`
- `EMAIL_FROM_NAME`: Default `Enterprise Ops Platform`
- `FRONTEND_URL`: Default `http://localhost:3000`

**Fallback Behavior:**
- If SMTP not configured (`SMTP_HOST`, `SMTP_USER`, or `SMTP_PASSWORD` missing): logs `[EMAIL] SMTP not configured. Would send to {email}: {subject}` and returns `False`
- `send_email` requires both `html_content` and `text_content` arguments

## Welcome Email

When admin creates a user via `/auth/users/admin-create`:

**Conditions:**
- `send_welcome_email` flag is true (default)
- SMTP is configured

**Content:**
- Subject: `Welcome to Enterprise Ops Platform - Your Account Credentials`
- Includes auto-generated temporary password
- Contains security notice to change password on first login
- Includes login link: `{FRONTEND_URL}/login`

## Audit Log Integration

All notification events are also recorded in `audit_logs` table with event types:
- `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`
- `PASSWORD_CHANGE`, `PASSWORD_RESET_ADMIN`
- `ACCOUNT_LOCKED`, `ACCOUNT_UNLOCKED`
- `USER_CREATED`, `USER_UPDATED`, `USER_DELETED`
- `ROLE_ASSIGNED`
- `REFRESH_TOKEN_USED`, `REFRESH_TOKEN_FAILED`

## AuditLog Model Fields (from SQLAlchemy)

- `id` (UUID, PK)
- `event_type` (Enum: AuditEventType)
- `user_id` (FK to users.id, SET NULL)
- `user_email` (String, indexed)
- `ip_address` (String, nullable)
- `user_agent` (Text, nullable)
- `details` (Text, nullable)
- `created_at` (TIMESTAMPTZ, indexed)

## EmailService (from backend/app/core/email.py)

The email service provides:
- `send_email(to_email, subject, html_content, text_content, password=None)` - Basic email sending via SMTP; returns `True` if successful, `False` if SMTP not configured or send fails
- `send_welcome_email(to_email, full_name, password)` - Welcome email with credentials template; renders both HTML and plain-text versions using Jinja2 templates

All methods are async. `send_email` catches exceptions internally and returns `False`.

## NotificationService (from backend/app/api/v1/notifications/service.py)

The notification service dispatches emails for key workflow events:
- `notify_approval_requested(batch, changed_fields=None, reapproval_count=0)` — Logs only; calls `_send_approval_emails` which resolves and logs approver emails but does NOT send actual email
- `notify_approval_decision(batch, level, decision)` — Logs only; calls `_send_approval_emails` which logs only
- `notify_batch_approved(batch_id, approval_id, manager_email, sales_email)` — **Actually sends emails** via `send_email` to manager and sales recipients
- `notify_session_scheduled(faculty_name, faculty_email, date_str, topic)` — **Sends email** if `faculty_email` is provided
- `notify_gate_completion(batch_id, gate_name, score)` — Logs only; no email sent
- `_send_approval_emails(batch, event_type)` — Internal method; resolves approver emails from `batch.approver_1` and `batch.approver_2`, logs recipients but does NOT send email