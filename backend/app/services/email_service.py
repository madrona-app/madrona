"""
Email service using AWS SES v2 for sending transactional emails.

Supports two channels:
- accounts: For account management emails (verification, password reset, etc.)
- notifications: For process/run notifications

Uses AWS default credential chain (environment variables, IAM roles, etc.).
"""

import logging
import re
from typing import Literal, Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.config import get_settings
from app.services.deployment_identity import (
    accounts_from,
    notifications_from,
    support_address,
)

logger = logging.getLogger(__name__)

EmailChannel = Literal["accounts", "notifications"]

# SES SendEmail MessageTag rules: tag names and values must match
# /^[A-Za-z0-9_\-.@]+$/ (no spaces, no most punctuation). Tags carry
# free-form caller-supplied values like org names — sanitize at the
# SES boundary so the whole send doesn't 400 because the org name has
# a space in it. Reference: AWS API docs for MessageTag.
_SES_TAG_FORBIDDEN = re.compile(r"[^A-Za-z0-9_\-.@]")


def _sanitize_ses_tag(value: str) -> str:
    """Replace SES-forbidden characters with `_` so a freeform string is
    a valid SES MessageTag value. Empty after sanitization → `_`."""
    cleaned = _SES_TAG_FORBIDDEN.sub("_", value or "")
    return cleaned or "_"


class EmailService:
    """
    Service for sending emails via AWS SES v2.
    
    Automatically selects the appropriate From address based on channel.
    """

    def __init__(self):
        """Initialize SES client with configuration from settings."""
        self.settings = get_settings()
        self._client = None

    @property
    def client(self):
        """Lazy-load SES v2 client."""
        if self._client is None:
            self._client = boto3.client(
                "sesv2",
                region_name=self.settings.aws_region,
            )
        return self._client

    def _get_from_address(self, channel: EmailChannel) -> str:
        """Get the From email address for the specified channel."""
        if channel == "accounts":
            return accounts_from()
        elif channel == "notifications":
            return notifications_from()
        else:
            raise ValueError(f"Unknown email channel: {channel}")

    def _send_via_smtp(
        self,
        from_address: str,
        recipients: list[str],
        subject: str,
        html: str,
        text: str,
        reply_to: Optional[list[str]] = None,
    ) -> bool:
        """Send via plain SMTP (self-hosted deployments; EMAIL_PROVIDER=smtp)."""
        import smtplib
        from email.message import EmailMessage

        if not self.settings.smtp_host:
            logger.error("EMAIL_PROVIDER=smtp but SMTP_HOST is not configured")
            return False

        msg = EmailMessage()
        msg["From"] = from_address
        msg["To"] = ", ".join(recipients)
        msg["Subject"] = subject
        if reply_to:
            msg["Reply-To"] = ", ".join(reply_to)
        msg.set_content(text)
        msg.add_alternative(html, subtype="html")

        try:
            with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port, timeout=15) as smtp:
                if self.settings.smtp_starttls:
                    smtp.starttls()
                if self.settings.smtp_user:
                    smtp.login(self.settings.smtp_user, self.settings.smtp_password)
                smtp.send_message(msg)
            logger.info(
                "Email sent via SMTP: to_count=%d, subject='%s'",
                len(recipients), subject,
            )
            return True
        except (smtplib.SMTPException, OSError) as e:
            logger.error("SMTP send failed: %s", e)
            return False

    def send_email(
        self,
        channel: EmailChannel,
        to: list[str],
        subject: str,
        html: str,
        text: str,
        reply_to: Optional[list[str]] = None,
        tags: Optional[dict[str, str]] = None,
    ) -> bool:
        """
        Send an email via AWS SES v2.

        Args:
            channel: Email channel ("accounts" or "notifications")
            to: List of recipient email addresses
            subject: Email subject line
            html: HTML body content
            text: Plain text body content
            reply_to: Optional list of reply-to addresses
            tags: Optional key-value tags for SES email tagging

        Returns:
            bool: True if email sent successfully, False otherwise

        Example:
            email_service = EmailService()
            email_service.send_email(
                channel="notifications",
                to=["user@example.com"],
                subject="Run Completed",
                html="<p>Your run has completed successfully.</p>",
                text="Your run has completed successfully.",
                tags={"run_id": "123", "status": "completed"}
            )
        """
        if not self.settings.email_enabled:
            logger.info(
                "Email sending disabled. Would send to %d recipient(s) via %s channel: %s",
                len(to),
                channel,
                subject,
            )
            # Log activation/invitation links for development
            if "activation" in subject.lower() or "invite" in subject.lower():
                # Try to extract activation link from HTML
                import re
                link_match = re.search(r'href="([^"]*(?:activate|accept-invite)[^"]*)"', html)
                if link_match:
                    logger.warning(
                        "🔗 DEVELOPMENT MODE - Activation/Invitation link for %s:\n   %s",
                        ", ".join(to),
                        link_match.group(1)
                    )
            return True
        
        # Filter out undeliverable recipients
        from app.services.email_event_service import check_email_deliverable
        
        deliverable_recipients = []
        skipped_recipients = []
        
        for email in to:
            if check_email_deliverable(email):
                deliverable_recipients.append(email)
            else:
                skipped_recipients.append(email)
        
        if skipped_recipients:
            logger.warning(
                "Skipping undeliverable recipients: %s",
                ", ".join(skipped_recipients)
            )
        
        if not deliverable_recipients:
            logger.info(
                "No deliverable recipients after filtering. Skipping email send."
            )
            return False

        from_address = self._get_from_address(channel)

        if self.settings.email_provider == "smtp":
            return self._send_via_smtp(
                from_address, deliverable_recipients, subject, html, text, reply_to
            )

        try:
            # Build email content
            content = {
                "Simple": {
                    "Subject": {"Data": subject, "Charset": "UTF-8"},
                    "Body": {
                        "Text": {"Data": text, "Charset": "UTF-8"},
                        "Html": {"Data": html, "Charset": "UTF-8"},
                    },
                }
            }

            # Build destination
            destination = {"ToAddresses": deliverable_recipients}

            # Build request parameters
            params = {
                "FromEmailAddress": from_address,
                "Destination": destination,
                "Content": content,
            }

            if reply_to:
                params["ReplyToAddresses"] = reply_to

            if tags:
                params["EmailTags"] = [
                    {
                        "Name": _sanitize_ses_tag(key),
                        "Value": _sanitize_ses_tag(value),
                    }
                    for key, value in tags.items()
                ]

            # Send email
            response = self.client.send_email(**params)
            message_id = response.get("MessageId", "unknown")

            logger.info(
                "Email sent successfully: channel=%s, to_count=%d, subject='%s', message_id=%s",
                channel,
                len(deliverable_recipients),
                subject,
                message_id,
            )

            return True

        except (BotoCoreError, ClientError) as e:
            logger.error(
                "Failed to send email: channel=%s, to_count=%d, subject='%s', error=%s",
                channel,
                len(deliverable_recipients),
                subject,
                str(e),
                exc_info=True,
            )
            return False
        except Exception as e:
            logger.error(
                "Unexpected error sending email: channel=%s, to_count=%d, error=%s",
                channel,
                len(to),
                str(e),
                exc_info=True,
            )
            return False

    def send_mfa_email_setup_code(self, email: str, code: str) -> bool:
        """One-time 6-digit code emailed during EMAIL_OTP MFA enrollment.

        Sent before flipping the Cognito preference so the user proves
        they actually receive mail at this address. Distinct from the
        ongoing Cognito-issued EMAIL_OTP challenge sent on each login.
        """
        html = f"""<!DOCTYPE html>
<html lang=\"en\">
<head><meta charset=\"UTF-8\"><title>Confirm email two-factor</title></head>
<body style=\"margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background-color:#ffffff;\">
  <div style=\"max-width:600px;margin:0 auto;padding:40px 20px;\">
    <h1 style=\"font-family:Georgia,'Times New Roman',serif;font-weight:600;font-size:24px;color:#111827;margin:0 0 24px 0;\">Madrona</h1>
    <h2 style=\"font-size:20px;font-weight:600;color:#111827;margin:0 0 16px 0;\">Confirm email two-factor authentication</h2>
    <p style=\"margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151;\">Enter this code in Madrona to finish enrolling email as a second factor:</p>
    <div style=\"font-family:'SF Mono',Menlo,Consolas,monospace;font-size:32px;letter-spacing:6px;font-weight:600;color:#1f3a2e;padding:16px 0;\">{code}</div>
    <p style=\"margin:8px 0 0 0;font-size:14px;line-height:1.5;color:#6b7280;\">This code expires in 5 minutes. If you didn't request it, ignore this email — no changes have been made.</p>
  </div>
</body>
</html>"""
        text = (
            "Madrona — confirm email two-factor authentication\n\n"
            f"Your confirmation code: {code}\n\n"
            "This code expires in 5 minutes. If you didn't request it, "
            "ignore this email — no changes have been made.\n"
        )
        return self.send_email(
            channel="accounts",
            to=[email],
            subject="Your Madrona email two-factor confirmation code",
            html=html,
            text=text,
            tags={"type": "mfa_email_setup"},
        )

    def send_password_reset_email(self, email: str, reset_url: str) -> bool:
        """
        Send password reset email with reset link.

        Args:
            email: Recipient email address
            reset_url: Full URL with reset token

        Returns:
            bool: True if email sent successfully
        """
        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #ffffff;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

        <!-- Header -->
        <div style="margin-bottom: 32px;">
            <h1 style="font-family: Georgia, 'Times New Roman', serif; font-weight: 600; font-size: 24px; color: #111827; margin: 0;">
                Madrona
            </h1>
            <div style="height: 1px; background-color: #e5e7eb; margin-top: 16px;"></div>
        </div>

        <!-- Body -->
        <div style="margin-bottom: 32px;">
            <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 24px 0;">
                Reset your password
            </h2>

            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                We received a request to reset your password. Click the button below to choose a new password.
            </p>

            <!-- Button -->
            <div style="margin: 32px 0;">
                <a href="{reset_url}"
                   style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 4px; font-size: 15px; font-weight: 500;">
                    Reset Password
                </a>
            </div>

            <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                Or copy and paste this link into your browser:
            </p>
            <p style="margin: 0 0 32px 0; font-size: 13px; line-height: 1.5; color: #6b7280; word-break: break-all;">
                {reset_url}
            </p>

            <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                This link will expire in 1 hour for security reasons.
            </p>

            <p style="margin: 12px 0 0 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.
            </p>
        </div>

        <!-- Footer -->
        <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 40px;">
            <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                This email was sent by Madrona.
            </p>
            <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                Sender: {accounts_from()}
            </p>
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                Support: {support_address()}
            </p>
        </div>

    </div>
</body>
</html>
"""

        text = f"""Madrona

Reset your password

We received a request to reset your password. Visit the link below to choose a new password:

{reset_url}

This link will expire in 1 hour for security reasons.

If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.

—
This email was sent by Madrona.
Sender: {accounts_from()}
Support: {support_address()}
"""

        return self.send_email(
            channel="accounts",
            to=[email],
            subject="Reset your Madrona password",
            html=html,
            text=text,
            tags={"type": "password_reset"},
        )

    def send_mfa_recovery_email(self, email: str, recovery_url: str) -> bool:
        """Send the 'lost your authenticator' MFA recovery link."""
        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recover access to your account</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #ffffff;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="margin-bottom: 32px;">
            <h1 style="font-family: Georgia, 'Times New Roman', serif; font-weight: 600; font-size: 24px; color: #111827; margin: 0;">
                Madrona
            </h1>
            <div style="height: 1px; background-color: #e5e7eb; margin-top: 16px;"></div>
        </div>
        <div style="margin-bottom: 32px;">
            <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 24px 0;">
                Recover access to your account
            </h2>
            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                We received a request to reset the two-factor authentication on your
                account because you no longer have access to your authenticator app.
                Click below and enter your password to remove the current authenticator
                so you can set up a new one.
            </p>
            <div style="margin: 32px 0;">
                <a href="{recovery_url}"
                   style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 4px; font-size: 15px; font-weight: 500;">
                    Recover account access
                </a>
            </div>
            <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                Or copy and paste this link into your browser:
            </p>
            <p style="margin: 0 0 32px 0; font-size: 13px; line-height: 1.5; color: #6b7280; word-break: break-all;">
                {recovery_url}
            </p>
            <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                This link will expire in 1 hour for security reasons.
            </p>
            <p style="margin: 12px 0 0 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                If you didn't request this, you can safely ignore this email — your
                two-factor authentication will remain unchanged.
            </p>
        </div>
        <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 40px;">
            <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                This email was sent by Madrona.
            </p>
            <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                Sender: {accounts_from()}
            </p>
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                Support: {support_address()}
            </p>
        </div>
    </div>
</body>
</html>
"""
        text = f"""Madrona

Recover access to your account

We received a request to reset the two-factor authentication on your account.
Visit the link below and enter your password to remove the current authenticator
so you can set up a new one:

{recovery_url}

This link will expire in 1 hour for security reasons.

If you didn't request this, you can safely ignore this email — your two-factor
authentication will remain unchanged.

—
This email was sent by Madrona.
Sender: {accounts_from()}
Support: {support_address()}
"""
        return self.send_email(
            channel="accounts",
            to=[email],
            subject="Recover access to your Madrona account",
            html=html,
            text=text,
            tags={"type": "mfa_recovery"},
        )

    def send_email_verification_email(
        self, email: str, verify_url: str, display_name: str | None = None
    ) -> bool:
        """
        Send an email-verification email with a confirmation link.

        Args:
            email: Recipient email address
            verify_url: Full URL with the verification token
            display_name: Optional display name for the greeting

        Returns:
            bool: True if the email was sent successfully.
        """
        greeting = f"Hi {display_name}," if display_name else "Hi there,"

        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirm your email</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #ffffff;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

        <div style="margin-bottom: 32px;">
            <h1 style="font-family: Georgia, 'Times New Roman', serif; font-weight: 600; font-size: 24px; color: #111827; margin: 0;">
                Madrona
            </h1>
            <div style="height: 1px; background-color: #e5e7eb; margin-top: 16px;"></div>
        </div>

        <div style="margin-bottom: 32px;">
            <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 24px 0;">
                Confirm your email
            </h2>

            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                {greeting} thanks for creating a Madrona Guide workspace. Confirm this email
                address so we can reach you about your account.
            </p>

            <div style="margin: 32px 0;">
                <a href="{verify_url}"
                   style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 4px; font-size: 15px; font-weight: 500;">
                    Confirm email
                </a>
            </div>

            <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                Or copy and paste this link into your browser:
            </p>
            <p style="margin: 0 0 32px 0; font-size: 13px; line-height: 1.5; color: #6b7280; word-break: break-all;">
                {verify_url}
            </p>

            <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                This link expires in 24 hours. If you didn't request this,
                you can safely ignore this email.
            </p>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 40px;">
            <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                This email was sent by Madrona.
            </p>
            <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                Sender: {accounts_from()}
            </p>
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                Support: {support_address()}
            </p>
        </div>

    </div>
</body>
</html>
"""

        text = f"""Madrona

Confirm your email

{greeting} please confirm this email address so we can reach you about your account:

{verify_url}

This link expires in 24 hours. If you didn't request this, you can safely ignore this email.

—
This email was sent by Madrona.
Sender: {accounts_from()}
Support: {support_address()}
"""

        return self.send_email(
            channel="accounts",
            to=[email],
            subject="Confirm your Madrona Guide email",
            html=html,
            text=text,
            tags={"type": "email_verification"},
        )

    def send_membership_deactivated_email(
        self,
        email: str,
        org_name: str,
    ) -> bool:
        """
        Notify user that their membership has been deactivated.

        Args:
            email: User's email address
            org_name: Name of the organization

        Returns:
            bool: True if email sent successfully
        """
        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Membership Update</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #ffffff;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

        <div style="margin-bottom: 32px;">
            <h1 style="font-family: Georgia, 'Times New Roman', serif; font-weight: 600; font-size: 24px; color: #111827; margin: 0;">
                Madrona
            </h1>
            <div style="height: 1px; background-color: #e5e7eb; margin-top: 16px;"></div>
        </div>

        <div style="margin-bottom: 32px;">
            <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 24px 0;">
                Your access has been updated
            </h2>

            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                Your membership in <strong>{org_name}</strong> has been deactivated by an administrator.
            </p>

            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                You will no longer have access to this organization's data and pipelines in Madrona.
            </p>

            <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                If you believe this was done in error, please contact your organization's administrator.
            </p>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 40px;">
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                This email was sent by Madrona. Support: {support_address()}
            </p>
        </div>

    </div>
</body>
</html>
"""

        text = f"""Madrona

Your access has been updated

Your membership in {org_name} has been deactivated by an administrator.

You will no longer have access to this organization's data and pipelines in Madrona.

If you believe this was done in error, please contact your organization's administrator.

—
This email was sent by Madrona. Support: {support_address()}
"""

        return self.send_email(
            channel="accounts",
            to=[email],
            subject=f"Your access to {org_name} has been updated",
            html=html,
            text=text,
            tags={"type": "membership_deactivated"},
        )

    def send_role_changed_email(
        self,
        email: str,
        org_name: str,
        old_role: str,
        new_role: str,
    ) -> bool:
        """
        Notify user that their role has been changed.

        Args:
            email: User's email address
            org_name: Name of the organization
            old_role: Previous role display name
            new_role: New role display name

        Returns:
            bool: True if email sent successfully
        """
        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Role Update</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #ffffff;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

        <div style="margin-bottom: 32px;">
            <h1 style="font-family: Georgia, 'Times New Roman', serif; font-weight: 600; font-size: 24px; color: #111827; margin: 0;">
                Madrona
            </h1>
            <div style="height: 1px; background-color: #e5e7eb; margin-top: 16px;"></div>
        </div>

        <div style="margin-bottom: 32px;">
            <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 24px 0;">
                Your role has been updated
            </h2>

            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                Your role in <strong>{org_name}</strong> has been changed by an administrator.
            </p>

            <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin: 24px 0;">
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #6b7280;">
                    Previous role: <span style="color: #374151;">{old_role}</span>
                </p>
                <p style="margin: 0; font-size: 14px; color: #6b7280;">
                    New role: <strong style="color: #111827;">{new_role}</strong>
                </p>
            </div>

            <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                Your permissions may have changed. If you have questions about your new role, please contact your organization's administrator.
            </p>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 40px;">
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                This email was sent by Madrona. Support: {support_address()}
            </p>
        </div>

    </div>
</body>
</html>
"""

        text = f"""Madrona

Your role has been updated

Your role in {org_name} has been changed by an administrator.

Previous role: {old_role}
New role: {new_role}

Your permissions may have changed. If you have questions about your new role, please contact your organization's administrator.

—
This email was sent by Madrona. Support: {support_address()}
"""

        return self.send_email(
            channel="accounts",
            to=[email],
            subject=f"Your role in {org_name} has been updated",
            html=html,
            text=text,
            tags={"type": "role_changed"},
        )

    def send_invitation_accepted_email(
        self,
        admin_email: str,
        org_name: str,
        accepted_user_email: str,
        accepted_user_name: str | None,
        role_name: str,
    ) -> bool:
        """
        Notify the inviting admin that their invitation was accepted.

        Args:
            admin_email: Email of the admin who sent the invitation
            org_name: Name of the organization
            accepted_user_email: Email of the user who accepted
            accepted_user_name: Display name of the user (if set)
            role_name: Role the user was assigned

        Returns:
            bool: True if email sent successfully
        """
        user_display = accepted_user_name or accepted_user_email

        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invitation Accepted</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #ffffff;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

        <div style="margin-bottom: 32px;">
            <h1 style="font-family: Georgia, 'Times New Roman', serif; font-weight: 600; font-size: 24px; color: #111827; margin: 0;">
                Madrona
            </h1>
            <div style="height: 1px; background-color: #e5e7eb; margin-top: 16px;"></div>
        </div>

        <div style="margin-bottom: 32px;">
            <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 24px 0;">
                Invitation accepted
            </h2>

            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                Good news! <strong>{user_display}</strong> has accepted your invitation to join <strong>{org_name}</strong>.
            </p>

            <div style="background-color: #f0fdf4; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #22c55e;">
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #166534;">
                    <strong>New team member</strong>
                </p>
                <p style="margin: 0 0 4px 0; font-size: 14px; color: #374151;">
                    {accepted_user_email}
                </p>
                <p style="margin: 0; font-size: 13px; color: #6b7280;">
                    Role: {role_name}
                </p>
            </div>

            <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                They now have access to the organization's data and pipelines based on their assigned role.
            </p>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 40px;">
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                This email was sent by Madrona. Support: {support_address()}
            </p>
        </div>

    </div>
</body>
</html>
"""

        text = f"""Madrona

Invitation accepted

Good news! {user_display} has accepted your invitation to join {org_name}.

New team member:
{accepted_user_email}
Role: {role_name}

They now have access to the organization's data and pipelines based on their assigned role.

—
This email was sent by Madrona. Support: {support_address()}
"""

        return self.send_email(
            channel="accounts",
            to=[admin_email],
            subject=f"{user_display} has joined {org_name}",
            html=html,
            text=text,
            tags={"type": "invitation_accepted"},
        )


    def send_task_assignment_email(
        self,
        email: str,
        assigned: bool,
        task_title: str,
        actor_name: str,
        task_description: str | None = None,
        task_priority: str | None = None,
        task_due_date: str | None = None,
        task_url: str | None = None,
    ) -> bool:
        """
        Notify user that a task has been assigned to or unassigned from them.

        Args:
            email: Recipient email address
            assigned: True if assigned, False if unassigned
            task_title: Title of the task
            actor_name: Display name of the person who made the change
            task_description: Optional task description
            task_priority: Optional priority label (e.g. "High", "Urgent")
            task_due_date: Optional due date string (e.g. "2026-03-25")
            task_url: Optional URL to view the task in the app

        Returns:
            bool: True if email sent successfully
        """
        if assigned:
            heading = f"{actor_name} assigned you a task"
            subject = f"Task assigned: {task_title}"
        else:
            heading = f"{actor_name} unassigned you from a task"
            subject = f"Task unassigned: {task_title}"

        # Build details rows
        details_rows_html = ""
        details_rows_text = ""

        if task_priority and task_priority.lower() != "normal":
            details_rows_html += f"""
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #6b7280;">
                    Priority: <strong style="color: #374151;">{task_priority}</strong>
                </p>"""
            details_rows_text += f"Priority: {task_priority}\n"

        if task_due_date:
            details_rows_html += f"""
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #6b7280;">
                    Due: <strong style="color: #374151;">{task_due_date}</strong>
                </p>"""
            details_rows_text += f"Due: {task_due_date}\n"

        # Description block
        description_html = ""
        description_text = ""
        if task_description:
            # Truncate long descriptions
            desc = task_description[:500] + ("..." if len(task_description) > 500 else "")
            description_html = f"""
            <p style="margin: 16px 0 0 0; font-size: 14px; line-height: 1.6; color: #374151;">
                {desc}
            </p>"""
            description_text = f"\n{desc}\n"

        # CTA button (only for assignment)
        button_html = ""
        button_text = ""
        if assigned and task_url:
            button_html = f"""
            <div style="margin: 32px 0;">
                <a href="{task_url}"
                   style="display: inline-block; background-color: #8E3B2F; color: #F6F2EC; padding: 14px 32px; text-decoration: none; border-radius: 4px; font-size: 15px; font-weight: 500;">
                    View Task
                </a>
            </div>"""
            button_text = f"\nView task: {task_url}\n"

        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #ffffff;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

        <div style="margin-bottom: 32px;">
            <h1 style="font-family: Georgia, 'Times New Roman', serif; font-weight: 600; font-size: 24px; color: #111827; margin: 0;">
                Madrona
            </h1>
            <div style="height: 1px; background-color: #e5e7eb; margin-top: 16px;"></div>
        </div>

        <div style="margin-bottom: 32px;">
            <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 24px 0;">
                {heading}
            </h2>

            <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin: 0 0 24px 0;">
                <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #111827;">
                    {task_title}
                </p>
                {details_rows_html}
            </div>
            {description_html}
            {button_html}
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 40px;">
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                This email was sent by Madrona. Support: {support_address()}
            </p>
        </div>

    </div>
</body>
</html>
"""

        text = f"""Madrona

{heading}

{task_title}
{details_rows_text}{description_text}{button_text}
—
This email was sent by Madrona. Support: {support_address()}
"""

        return self.send_email(
            channel="notifications",
            to=[email],
            subject=subject,
            html=html,
            text=text,
            tags={"type": "task_assigned" if assigned else "task_unassigned"},
        )

    def send_welcome_email(
        self,
        email: str,
        user_name: str,
        org_name: str,
        products: list[str],
        activation_url: str,
        onboarding_datetime: Optional[str] = None,
        csm_name: Optional[str] = None,
        csm_email: Optional[str] = None,
    ) -> bool:
        """
        Send welcome email for newly provisioned enterprise organization.

        Args:
            email: Recipient email address
            user_name: User's display name
            org_name: Organization name
            products: List of enabled product names (e.g., ["Collections", "Media"])
            activation_url: URL to set password and activate account
            onboarding_datetime: Optional formatted datetime for onboarding call
            csm_name: Optional Customer Success Manager name
            csm_email: Optional CSM email for contact

        Returns:
            bool: True if email sent successfully
        """
        products_html = "".join(f"<li style=\"margin: 4px 0; color: #374151;\">{p}</li>" for p in products)
        products_text = "\n".join(f"  - {p}" for p in products)

        # Onboarding section (if scheduled)
        onboarding_html = ""
        onboarding_text = ""
        if onboarding_datetime:
            csm_info = f" with {csm_name}" if csm_name else ""
            csm_contact = f"<br><span style=\"color: #6b7280;\">Contact: {csm_email}</span>" if csm_email else ""
            onboarding_html = f"""
            <div style="background-color: #f0fdf4; border-radius: 8px; padding: 16px; margin: 24px 0; border-left: 4px solid #22c55e;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #166534;">
                    Onboarding Call Scheduled
                </p>
                <p style="margin: 0; font-size: 14px; color: #374151;">
                    {onboarding_datetime}{csm_info}{csm_contact}
                </p>
            </div>
"""
            onboarding_text = f"""
ONBOARDING CALL SCHEDULED
{onboarding_datetime}{csm_info}
{f"Contact: {csm_email}" if csm_email else ""}
"""

        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Madrona</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #ffffff;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

        <!-- Header -->
        <div style="margin-bottom: 32px;">
            <h1 style="font-family: Georgia, 'Times New Roman', serif; font-weight: 600; font-size: 24px; color: #111827; margin: 0;">
                Madrona
            </h1>
            <div style="height: 1px; background-color: #e5e7eb; margin-top: 16px;"></div>
        </div>

        <!-- Body -->
        <div style="margin-bottom: 32px;">
            <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 24px 0;">
                Welcome to Madrona, {user_name}
            </h2>

            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                Your <strong>{org_name}</strong> workspace is ready. You've been set up as the primary administrator.
            </p>

            <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin: 24px 0;">
                <p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #374151;">
                    Your enabled products:
                </p>
                <ul style="margin: 0; padding-left: 20px;">
                    {products_html}
                </ul>
            </div>

            {onboarding_html}

            <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                To get started, set your password and sign in:
            </p>

            <!-- Button -->
            <div style="margin-bottom: 24px;">
                <a href="{activation_url}"
                   style="display: inline-block; background-color: #166534; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 4px; font-size: 15px; font-weight: 500;">
                    Set Password &amp; Sign In
                </a>
            </div>

            <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                Or copy and paste this link into your browser:
            </p>
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #6b7280; word-break: break-all;">
                {activation_url}
            </p>
        </div>

        <!-- Footer -->
        <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 40px;">
            <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                Questions? Reply to this email or reach us at {support_address()}
            </p>
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                — The Madrona Team
            </p>
        </div>

    </div>
</body>
</html>
"""

        text = f"""Madrona

Welcome to Madrona, {user_name}

Your {org_name} workspace is ready. You've been set up as the primary administrator.

YOUR ENABLED PRODUCTS:
{products_text}
{onboarding_text}

To get started, set your password and sign in:
{activation_url}

Questions? Reply to this email or reach us at {support_address()}

— The Madrona Team
"""

        return self.send_email(
            channel="accounts",
            to=[email],
            subject=f"Welcome to Madrona — Your {org_name} workspace is ready",
            html=html,
            text=text,
            tags={"type": "welcome", "organization": org_name[:50]},  # SES tag limit
        )


# Global instance
_email_service: Optional[EmailService] = None


def get_email_service() -> EmailService:
    """Get or create the global email service instance."""
    global _email_service
    if _email_service is None:
        _email_service = EmailService()
    return _email_service
