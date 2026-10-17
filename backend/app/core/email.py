import secrets
import string
import logging
from typing import Optional
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import aiosmtplib
from jinja2 import Template

logger = logging.getLogger(__name__)


def _get_settings():
    """Lazy load settings to avoid import-time validation errors."""
    from app.core.config import settings
    return settings


def generate_random_password(length: int = 16) -> str:
    """Generate a secure random password meeting policy requirements."""
    settings = _get_settings()
    if length < settings.MIN_PASSWORD_LENGTH:
        length = settings.MIN_PASSWORD_LENGTH
    
    uppercase = string.ascii_uppercase
    lowercase = string.ascii_lowercase
    digits = string.digits
    special = "!@#$%^&*()_+-=[]{}|;':\",.<>?/"
    
    all_chars = uppercase + lowercase + digits + special
    
    password = [
        secrets.choice(uppercase),
        secrets.choice(lowercase),
        secrets.choice(digits),
        secrets.choice(special),
    ]
    
    for _ in range(length - 4):
        password.append(secrets.choice(all_chars))
    
    secrets.SystemRandom().shuffle(password)
    return "".join(password)


WELCOME_EMAIL_TEMPLATE = Template("""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Enterprise Ops Platform</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .container { background: #ffffff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
        .content { padding: 30px; }
        .welcome-text { font-size: 16px; color: #4b5563; margin-bottom: 24px; }
        .credentials-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; margin: 24px 0; }
        .credentials-box h3 { margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.5px; }
        .credential-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e2e8f0; }
        .credential-row:last-child { border-bottom: none; }
        .credential-label { font-weight: 500; color: #6b7280; font-size: 14px; }
        .credential-value { font-family: 'Monaco', 'Menlo', monospace; font-size: 14px; color: #111827; background: #fff; padding: 8px 12px; border-radius: 4px; border: 1px solid #d1d5db; word-break: break-all; }
        .password-value { font-family: 'Monaco', 'Menlo', monospace; font-size: 14px; color: #dc2626; background: #fef2f2; padding: 8px 12px; border-radius: 4px; border: 1px solid #fecaca; word-break: break-all; }
        .important-notice { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 24px 0; }
        .important-notice h4 { margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #92400e; }
        .important-notice p { margin: 0; font-size: 14px; color: #78350f; }
        .action-button { display: inline-block; background: #1e40af; color: white; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: 600; font-size: 14px; margin-top: 16px; }
        .action-button:hover { background: #1e3a8a; }
        .footer { background: #f9fafb; border-top: 1px solid #e5e7eb; padding: 20px 30px; text-align: center; font-size: 12px; color: #9ca3af; }
        .footer a { color: #6b7280; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Welcome to Enterprise Ops Platform</h1>
        </div>
        <div class="content">
            <p class="welcome-text">Hello <strong>{{ full_name }}</strong>,</p>
            <p class="welcome-text">Your account has been created by an administrator. You can now access the Enterprise Ops Platform using the credentials below:</p>
            
            <div class="credentials-box">
                <h3>Your Login Credentials</h3>
                <div class="credential-row">
                    <span class="credential-label">Email</span>
                    <span class="credential-value">{{ email }}</span>
                </div>
                <div class="credential-row">
                    <span class="credential-label">Temporary Password</span>
                    <span class="password-value">{{ password }}</span>
                </div>
            </div>
            
            <div class="important-notice">
                <h4>⚠ Important Security Notice</h4>
                <p>For your security, please <strong>change your password immediately</strong> after your first login. This temporary password will expire and must be updated on first use.</p>
            </div>
            
            <div style="text-align: center;">
                <a href="{{ frontend_url }}/login" class="action-button">Login to Platform</a>
            </div>
            
            <p style="margin-top: 32px; font-size: 14px; color: #6b7280;">If you did not request this account or have any questions, please contact your system administrator.</p>
        </div>
        <div class="footer">
            <p>This is an automated message from <strong>{{ email_from_name }}</strong>.<br>
            Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
""")

WELCOME_EMAIL_TEXT_TEMPLATE = Template("""
Welcome to Enterprise Ops Platform

Hello {{ full_name }},

Your account has been created by an administrator. You can now access the Enterprise Ops Platform using the credentials below:

=======================================
Your Login Credentials
=======================================
Email: {{ email }}
Temporary Password: {{ password }}
=======================================

⚠ IMPORTANT SECURITY NOTICE:
For your security, please change your password immediately after your first login. This temporary password will expire and must be updated on first use.

Login here: {{ frontend_url }}/login

If you did not request this account or have any questions, please contact your system administrator.

---
This is an automated message from {{ email_from_name }}.
Please do not reply to this email.
""")

FORGOT_PASSWORD_EMAIL_TEMPLATE = Template("""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset - Enterprise Ops Platform</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .container { background: #ffffff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
        .content { padding: 30px; }
        .reset-text { font-size: 16px; color: #4b5563; margin-bottom: 24px; }
        .reset-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; margin: 24px 0; }
        .reset-box h3 { margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.5px; }
        .action-button { display: inline-block; background: #1e40af; color: white; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: 600; font-size: 14px; margin-top: 16px; }
        .action-button:hover { background: #1e3a8a; }
        .important-notice { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 24px 0; }
        .important-notice h4 { margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #92400e; }
        .important-notice p { margin: 0; font-size: 14px; color: #78350f; }
        .footer { background: #f9fafb; border-top: 1px solid #e5e7eb; padding: 20px 30px; text-align: center; font-size: 12px; color: #9ca3af; }
        .footer a { color: #6b7280; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Password Reset Request</h1>
        </div>
        <div class="content">
            <p class="reset-text">Hello <strong>{{ full_name }}</strong>,</p>
            <p class="reset-text">You requested a password reset for your Enterprise Ops Platform account. Click the button below to set a new password:</p>
            
            <div style="text-align: center;">
                <a href="{{ reset_link }}" class="action-button">Reset Password</a>
            </div>
            
            <div class="important-notice">
                <h4>⚠ Important Security Notice</h4>
                <p>This link will expire in <strong>{{ ttl_hours }} hour(s)</strong>. For security reasons, this link can only be used once.</p>
            </div>
            
            <p style="margin-top: 32px; font-size: 14px; color: #6b7280;">If you did not request a password reset, please ignore this email or contact your system administrator.</p>
        </div>
        <div class="footer">
            <p>This is an automated message from <strong>{{ email_from_name }}</strong>.<br>
            Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>
""")

FORGOT_PASSWORD_EMAIL_TEXT_TEMPLATE = Template("""
Password Reset - Enterprise Ops Platform

Hello {{ full_name }},

You requested a password reset for your Enterprise Ops Platform account. Click the link below to set a new password:

{{ reset_link }}

⚠ IMPORTANT SECURITY NOTICE:
This link will expire in {{ ttl_hours }} hour(s). For security reasons, this link can only be used once.

If you did not request a password reset, please ignore this email or contact your system administrator.

---
This is an automated message from {{ email_from_name }}.
Please do not reply to this email.
""")


class EmailService:
    def __init__(self):
        settings = _get_settings()
        self.smtp_host = settings.SMTP_HOST
        self.smtp_port = settings.SMTP_PORT
        self.smtp_user = settings.SMTP_USER
        self.smtp_password = settings.SMTP_PASSWORD
        self.smtp_tls = settings.SMTP_TLS
        self.email_from = settings.EMAIL_FROM
        self.email_from_name = settings.EMAIL_FROM_NAME
        self.frontend_url = settings.FRONTEND_URL

    def _create_message(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        text_content: str
    ) -> MIMEMultipart:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{self.email_from_name} <{self.email_from}>"
        msg["To"] = to_email
        
        # Security headers to prevent tracking and auto-replies
        msg["X-Auto-Response-Suppress"] = "OOF, AutoReply"
        msg["List-Unsubscribe"] = f"<mailto:{self.email_from}>"
        msg["Precedence"] = "bulk"
        
        msg.attach(MIMEText(text_content, "plain", "utf-8"))
        msg.attach(MIMEText(html_content, "html", "utf-8"))
        
        return msg

    async def send_email(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        text_content: str,
    ) -> bool:
        """Send an email via SMTP. Returns True if successful."""
        if not self.smtp_host or not self.smtp_user or not self.smtp_password:
            logger.error("Email delivery is not configured; message was not sent")
            return False
        
        try:
            message = self._create_message(to_email, subject, html_content, text_content)
            
            await aiosmtplib.send(
                message,
                hostname=self.smtp_host,
                port=self.smtp_port,
                username=self.smtp_user,
                password=self.smtp_password,
                start_tls=self.smtp_tls,
                timeout=30
            )
            return True
        except Exception:
            logger.exception("Email delivery failed")
            return False

    async def send_welcome_email(
        self,
        to_email: str,
        full_name: str,
        password: str
    ) -> bool:
        """Send welcome email with credentials to new user."""
        subject = "Welcome to Enterprise Ops Platform - Your Account Credentials"
        
        html_content = WELCOME_EMAIL_TEMPLATE.render(
            full_name=full_name,
            email=to_email,
            password=password,
            frontend_url=self.frontend_url,
            email_from_name=self.email_from_name
        )
        
        text_content = WELCOME_EMAIL_TEXT_TEMPLATE.render(
            full_name=full_name,
            email=to_email,
            password=password,
            frontend_url=self.frontend_url,
            email_from_name=self.email_from_name
        )
        
        return await self.send_email(to_email, subject, html_content, text_content)

    async def send_forgot_password_email(
        self,
        to_email: str,
        full_name: str,
        reset_token: str
    ) -> bool:
        """Send forgot password email with reset link."""
        settings = _get_settings()
        subject = "Password Reset - Enterprise Ops Platform"
        reset_link = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"
        ttl_hours = settings.RESET_TOKEN_TTL_HOURS
        
        html_content = FORGOT_PASSWORD_EMAIL_TEMPLATE.render(
            full_name=full_name,
            email=to_email,
            reset_link=reset_link,
            ttl_hours=ttl_hours,
            frontend_url=settings.FRONTEND_URL,
            email_from_name=settings.EMAIL_FROM_NAME
        )
        
        text_content = FORGOT_PASSWORD_EMAIL_TEXT_TEMPLATE.render(
            full_name=full_name,
            email=to_email,
            reset_link=reset_link,
            ttl_hours=ttl_hours,
            frontend_url=settings.FRONTEND_URL,
            email_from_name=settings.EMAIL_FROM_NAME
        )
        
        return await self.send_email(to_email, subject, html_content, text_content)


def get_email_service() -> EmailService:
    """Lazy getter for email service."""
    return EmailService()


# For backwards compatibility - lazy property
_email_service_instance = None

def _get_email_service_instance():
    global _email_service_instance
    if _email_service_instance is None:
        _email_service_instance = EmailService()
    return _email_service_instance


# Create a property-like object for backwards compatibility
class _EmailServiceProxy:
    def __getattr__(self, name):
        return getattr(_get_email_service_instance(), name)

email_service = _EmailServiceProxy()