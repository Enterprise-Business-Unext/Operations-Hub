import logging
from typing import List, Optional, Dict, Any
from uuid import UUID

from app.core.email import get_email_service

logger = logging.getLogger(__name__)


class NotificationService:

    @classmethod
    async def notify_approval_requested(cls, batch, changed_fields: Optional[Dict[str, Dict[str, Any]]] = None, reapproval_count: int = 0):
        is_reapproval = reapproval_count > 0
        
        if is_reapproval:
            subject = f"Reapproval Required: {batch.batch_id} (Reapproval #{reapproval_count})"
            body = (
                f"This batch was previously approved and has been modified.\n"
                f"Changes requiring reapproval:\n"
            )
            if changed_fields:
                for field, changes in changed_fields.items():
                    before = changes.get("before", "N/A")
                    after = changes.get("after", "N/A")
                    body += f"  - {field}: {before} → {after}\n"
        else:
            subject = f"Approval Requested: {batch.batch_id}"
            body = f"Batch {batch.batch_id} submitted for approval."
        
        logger.info(
            f"[NOTIFICATION TRIGGERED] {subject}. "
            f"Approver 1: {batch.approver_1_id}, Approver 2: {batch.approver_2_id}\n{body}"
        )
        await cls._send_approval_emails(batch, "requested")

    @classmethod
    async def notify_approval_decision(cls, batch, level: int, decision: str):
        logger.info(
            f"[NOTIFICATION TRIGGERED] Batch {batch.batch_id} approval level {level}: {decision}. "
            f"Current status: {batch.status}"
        )
        await cls._send_approval_emails(batch, f"level_{level}_{decision}")

    @classmethod
    async def notify_batch_approved(cls, batch_id: str, approval_id: str, manager_email: Optional[str], sales_email: Optional[str]):
        """Dispatches automated notifications when a batch schema is locked and approved."""
        logger.info(
            f"[NOTIFICATION TRIGGERED] Batch {batch_id} Approved with SOW ID {approval_id}. "
            f"Recipients: Manager ({manager_email}), Sales ({sales_email})"
        )
        email_service = get_email_service()
        
        subject = f"Batch Approved: {batch_id}"
        html = f"""
        <h2>Batch Approved</h2>
        <p>Batch <strong>{batch_id}</strong> has been approved and schema locked.</p>
        <p>Approval ID: <strong>{approval_id}</strong></p>
        <p>You can now proceed with scheduling and delivery.</p>
        """
        
        for email in [manager_email, sales_email]:
            if email:
                await email_service.send_email(
                    to_email=email,
                    subject=subject,
                    html_content=html,
                    text_content=f"Batch {batch_id} approved with Approval ID {approval_id}"
                )

    @classmethod
    async def notify_session_scheduled(cls, faculty_name: str, faculty_email: Optional[str], date_str: str, topic: str):
        """Dispatches calendar invite/alert when trainer is assigned to a session."""
        logger.info(
            f"[NOTIFICATION TRIGGERED] Session Scheduled for {faculty_name} ({faculty_email}) on {date_str} - Topic: {topic}"
        )
        if faculty_email:
            email_service = get_email_service()
            subject = f"Session Scheduled: {topic} on {date_str}"
            html = f"""
            <h2>New Session Scheduled</h2>
            <p>Hello <strong>{faculty_name}</strong>,</p>
            <p>A new training session has been scheduled for you:</p>
            <ul>
                <li><strong>Topic:</strong> {topic}</li>
                <li><strong>Date:</strong> {date_str}</li>
            </ul>
            <p>Please check the platform for full details.</p>
            """
            await email_service.send_email(
                to_email=faculty_email,
                subject=subject,
                html_content=html,
                text_content=f"New session scheduled: {topic} on {date_str}"
            )

    @classmethod
    async def notify_gate_completion(cls, batch_id: str, gate_name: str, score: str):
        """Notifies stakeholders when Quality Gate 1 or 2 is passed."""
        logger.info(
            f"[NOTIFICATION TRIGGERED] Quality Gate '{gate_name}' completed for Batch {batch_id} with Score: {score}"
        )

    @classmethod
    async def _send_approval_emails(cls, batch, event_type: str):
        """Resolve the assigned approvers for a batch.

        Delivery is not wired up yet - this only resolves and logs the
        recipients so the approver assignment is observable.
        """
        approver_emails = [
            approver.email
            for approver in (batch.approver_1, batch.approver_2)
            if approver is not None and approver.email
        ]
        logger.info(
            f"Approval email for batch {batch.batch_id}, event: {event_type}, "
            f"recipients: {approver_emails or 'none'}"
        )
