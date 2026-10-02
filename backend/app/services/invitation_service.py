"""
Organization invitation service.

Handles creating and accepting organization invitations with email notifications.
"""

import secrets
import hashlib
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.services.deployment_identity import accounts_from, support_address
from app.config import get_settings
from app.models import Organization, OrganizationInvitation, OrganizationMembership, User, Role
from app.services.email_service import get_email_service

logger = logging.getLogger(__name__)

# Invitation expiry: 7 days
INVITATION_EXPIRY_DAYS = 7


def sanitize_for_ses_tag(value: str) -> str:
    """
    Sanitize a string to be valid for AWS SES email tags.
    SES only allows: alphanumeric ASCII, '_', '-', '.', '@'
    
    Args:
        value: The string to sanitize
        
    Returns:
        Sanitized string safe for SES tags
    """
    # Replace spaces with underscores
    sanitized = value.replace(" ", "_")
    # Remove any character that's not alphanumeric, underscore, hyphen, dot, or @
    sanitized = re.sub(r'[^a-zA-Z0-9_\-\.@]', '', sanitized)
    return sanitized


def generate_invitation_token() -> tuple[str, str]:
    """
    Generate a secure invitation token and its hash.
    
    Returns:
        tuple: (token, token_hash) - token is sent to user, hash is stored in DB
    """
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    return token, token_hash


def create_invitation(
    session: Session,
    organization_id: str,
    email: str,
    role: str,
    invited_by_user_id: str,
) -> tuple[OrganizationInvitation, str]:
    """
    Create an organization invitation and send invitation email.
    
    Strategy for repeated invites: Rotates token for existing pending invitations.
    If a valid (unexpired, unused) invitation already exists, we rotate its token
    and extend the expiry date, then re-send the email.
    
    Args:
        session: Database session
        organization_id: Organization to invite user to
        email: Email address of invitee
        role: Role to assign (admin or member)
        invited_by_user_id: User ID of inviter
    
    Returns:
        tuple: (invitation, token) - invitation record and raw token string
    
    Raises:
        ValueError: If organization not found or role invalid
    """
    # Validate organization
    org = session.query(Organization).filter_by(organization_id=organization_id).first()
    if not org:
        raise ValueError(f"Organization {organization_id} not found")
    
    # Validate role
    if role not in ["admin", "member"]:
        raise ValueError(f"Invalid role: {role}. Must be 'admin' or 'member'")
    
    # Generate token and expiry
    token, token_hash = generate_invitation_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=INVITATION_EXPIRY_DAYS)
    
    # Check for existing invitation
    existing = (
        session.query(OrganizationInvitation)
        .filter_by(organization_id=organization_id, email=email, used_at=None)
        .filter(OrganizationInvitation.expires_at > datetime.now(timezone.utc))
        .first()
    )
    
    if existing:
        # Rotate token for existing invitation
        logger.info(
            "Rotating invitation token for %s to org %s",
            email,
            organization_id
        )
        existing.token_hash = token_hash
        existing.expires_at = expires_at
        existing.role = role  # Update role if changed
        existing.invited_by = invited_by_user_id
        invitation = existing
    else:
        # Create new invitation
        invitation = OrganizationInvitation(
            organization_id=organization_id,
            email=email,
            token_hash=token_hash,
            role=role,
            invited_by=invited_by_user_id,
            expires_at=expires_at,
        )
        session.add(invitation)
    
    session.commit()
    
    # Send invitation email
    _send_invitation_email(email, org.name, role, token)
    
    logger.info(
        "Created/updated invitation for %s to org %s (%s) as %s",
        email,
        organization_id,
        org.name,
        role
    )
    
    return invitation, token


def accept_invitation(
    session: Session,
    token: str,
    user_id: str,
) -> OrganizationMembership:
    """
    Accept an organization invitation and create membership.
    
    Args:
        session: Database session
        token: Invitation token (raw, not hashed)
        user_id: User ID accepting the invitation
    
    Returns:
        OrganizationMembership: Created membership record
    
    Raises:
        ValueError: If token invalid, expired, already used, or user already member
    """
    # Hash token to look up invitation
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    
    invitation = (
        session.query(OrganizationInvitation)
        .filter_by(token_hash=token_hash)
        .first()
    )
    
    if not invitation:
        raise ValueError("Invalid invitation token")
    
    if invitation.used_at:
        raise ValueError("Invitation has already been used")
    
    # Column is timestamptz; guard retained for non-DB sources — coerce
    # before comparing against tz-aware now(). Same fix as /api/auth/activate.
    invitation_expires_at = invitation.expires_at
    if invitation_expires_at.tzinfo is None:
        invitation_expires_at = invitation_expires_at.replace(tzinfo=timezone.utc)
    if invitation_expires_at < datetime.now(timezone.utc):
        raise ValueError("Invitation has expired")
    
    # Verify user email matches invitation
    user = session.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise ValueError("User not found")
    
    if user.email.lower() != invitation.email.lower():
        raise ValueError("Invitation email does not match user email")
    
    # Check if user is already a member
    existing_membership = (
        session.query(OrganizationMembership)
        .filter_by(organization_id=invitation.organization_id, user_id=user_id)
        .first()
    )
    
    if existing_membership:
        raise ValueError("User is already a member of this organization")
    
    # Resolve role_id from the invitation's role string. OrganizationMembership
    # has a NOT NULL role_id FK; the legacy `role` string is kept for back-compat
    # but role_id must be populated or the insert fails. Falls back to `viewer`
    # for any non-admin value (matches the bulk-import convention).
    from app.models import Role
    role_key = invitation.role if invitation.role == "admin" else "viewer"
    role = session.query(Role).filter_by(role_key=role_key).first()
    if not role and role_key != "viewer":
        role = session.query(Role).filter_by(role_key="viewer").first()
    if not role:
        raise ValueError(
            f"System role '{role_key}' is missing; cannot create membership. "
            "Run `python -m seeds.seed_roles_and_permissions`."
        )

    # Create membership
    membership = OrganizationMembership(
        organization_id=invitation.organization_id,
        user_id=user_id,
        role=invitation.role,
        role_id=role.role_id,
    )
    session.add(membership)
    
    # Mark invitation as used
    invitation.used_at = datetime.now(timezone.utc)
    
    session.commit()
    
    logger.info(
        "User %s accepted invitation to org %s with role %s",
        user_id,
        invitation.organization_id,
        invitation.role
    )
    
    return membership


def _send_invitation_email(email: str, org_name: str, role: str, token: str) -> bool:
    """
    Send invitation email via EmailService.
    
    Args:
        email: Recipient email address
        org_name: Organization name
        role: Role label (admin or member)
        token: Raw invitation token
    
    Returns:
        bool: True if email sent successfully
    """
    settings = get_settings()
    email_service = get_email_service()
    
    # Build accept link
    accept_url = f"{settings.app_base_url.rstrip('/')}/accept-invite?token={token}"
    
    # Generate email content
    role_label = "Administrator" if role == "admin" else "Member"
    
    html = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Invitation to Madrona</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #2c5282;">You've been invited to Madrona</h2>
    
    <p>You've been invited to join <strong>{org_name}</strong> on Madrona as a <strong>{role_label}</strong>.</p>
    
    <p>Click the button below to accept your invitation:</p>
    
    <p style="text-align: center; margin: 30px 0;">
        <a href="{accept_url}" 
           style="background-color: #3182ce; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Accept Invitation
        </a>
    </p>
    
    <p style="color: #666; font-size: 14px;">
        Or copy and paste this link into your browser:<br>
        <a href="{accept_url}" style="color: #3182ce;">{accept_url}</a>
    </p>
    
    <p style="color: #666; font-size: 14px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
        This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.
    </p>
</body>
</html>
"""
    
    text = f"""You've been invited to Madrona

You've been invited to join {org_name} on Madrona as a {role_label}.

To accept your invitation, visit:
{accept_url}

This invitation will expire in 7 days. If you didn't expect this invitation, you can safely ignore this email.
"""
    
    # Send email
    success = email_service.send_email(
        channel="accounts",
        to=[email],
        subject=f"You've been invited to {org_name} on Madrona",
        html=html,
        text=text,
        tags={"type": "invitation", "organization": sanitize_for_ses_tag(org_name)},
    )
    
    if success:
        logger.info("Sent invitation email to %s for org %s", email, org_name)
    else:
        logger.error("Failed to send invitation email to %s for org %s", email, org_name)
    
    return success


def create_user_invitation(
    session: Session,
    organization_id: str,
    user_id: str,
    email: str,
    role_id: str,
    invited_by_user_id: str,
) -> tuple[OrganizationInvitation, str]:
    """
    Create an invitation for a newly created user.
    
    This is used in the org-admin user creation flow where:
    1. User account is created (status='invited')
    2. Membership is created (status='active' but user can't access yet)
    3. Invitation binds user_id + org_id + role
    4. User must accept invitation (complete signup) to activate
    
    Args:
        session: Database session
        organization_id: Organization to invite user to
        user_id: User ID (user already created)
        email: User's email address
        role_id: Role ID to assign
        invited_by_user_id: User ID of inviter
    
    Returns:
        tuple: (invitation, token) - invitation record and raw token string
    
    Raises:
        ValueError: If organization or role not found
    """
    # Validate organization
    org = session.query(Organization).filter_by(organization_id=organization_id).first()
    if not org:
        raise ValueError(f"Organization {organization_id} not found")
    
    # Validate role
    role = session.query(Role).filter_by(role_id=role_id).first()
    if not role:
        raise ValueError(f"Role {role_id} not found")
    
    # Generate token and expiry
    token, token_hash = generate_invitation_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=INVITATION_EXPIRY_DAYS)
    
    # Check for existing invitation
    existing = (
        session.query(OrganizationInvitation)
        .filter_by(user_id=user_id, organization_id=organization_id, used_at=None)
        .filter(OrganizationInvitation.expires_at > datetime.now(timezone.utc))
        .first()
    )
    
    if existing:
        # Rotate token for existing invitation
        logger.info(
            "Rotating invitation token for user %s to org %s",
            user_id,
            organization_id
        )
        existing.token_hash = token_hash
        existing.expires_at = expires_at
        existing.role = role.role_key  # Legacy field
        existing.invited_by = invited_by_user_id
        invitation = existing
    else:
        # Create new invitation
        invitation = OrganizationInvitation(
            organization_id=organization_id,
            email=email,
            user_id=user_id,
            token_hash=token_hash,
            role=role.role_key,  # Legacy field
            invited_by=invited_by_user_id,
            expires_at=expires_at,
        )
        session.add(invitation)
    
    session.commit()
    
    # Send invitation email
    _send_user_invitation_email(email, org.name, role.display_name, token)
    
    logger.info(
        "Created/updated invitation for user %s (%s) to org %s (%s) as %s",
        user_id,
        email,
        organization_id,
        org.name,
        role.role_key
    )
    
    return invitation, token


def _send_user_invitation_email(email: str, org_name: str, role_name: str, token: str) -> bool:
    """
    Send invitation email for newly created user.
    
    Args:
        email: Recipient email address
        org_name: Organization name
        role_name: Role display name
        token: Raw invitation token
    
    Returns:
        bool: True if email sent successfully
    """
    settings = get_settings()
    email_service = get_email_service()
    
    # Build activation link - ensure we never use localhost in production emails
    base_url = settings.app_base_url.rstrip('/')
    
    # Warn if localhost is detected in email URL
    if 'localhost' in base_url.lower() or '127.0.0.1' in base_url:
        logger.warning(
            "Activation email using localhost URL: %s - this should only happen in development",
            base_url
        )
    
    activate_url = f"{base_url}/activate?token={token}"
    
    html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account Setup Required</title>
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
                Account Setup Required
            </h2>
            
            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                You are receiving this email because an administrator at <strong>{org_name}</strong> has created a Madrona account for you.
            </p>
            
            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                Your assigned role is <strong>{role_name}</strong>. This role determines your access permissions within {org_name}'s Madrona workspace.
            </p>
            
            <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                To complete your account setup and choose a password, use the button below.
            </p>
            
            <!-- Button -->
            <div style="margin-bottom: 24px;">
                <a href="{activate_url}" 
                   style="display: inline-block; background-color: #6b7280; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 4px; font-size: 15px; font-weight: 500;">
                    Complete Account Setup
                </a>
            </div>
            
            <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                If the button doesn't work, you can copy and paste the link below into your browser:
            </p>
            <p style="margin: 0 0 32px 0; font-size: 13px; line-height: 1.5; color: #6b7280; word-break: break-all;">
                {activate_url}
            </p>
            
            <!-- About this invitation -->
            <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 32px;">
                <h3 style="font-size: 14px; font-weight: 600; color: #374151; margin: 0 0 12px 0;">
                    About this invitation
                </h3>
                
                <p style="margin: 0 0 12px 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                    This invitation link will expire in 7 days. After you complete setup, you will have immediate access to {org_name}'s workspace.
                </p>
                
                <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                    If you did not expect this invitation or believe you received it in error, you may safely disregard this email. No account will be created unless you complete the setup process.
                </p>
            </div>
        </div>
        
        <!-- Footer -->
        <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 40px;">
            <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                This email was sent by Madrona on behalf of {org_name}.
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

Account Setup Required

You are receiving this email because an administrator at {org_name} has created a Madrona account for you.

Your assigned role is {role_name}. This role determines your access permissions within {org_name}'s Madrona workspace.

To complete your account setup and choose a password, visit this link:

{activate_url}

ABOUT THIS INVITATION

This invitation link will expire in 7 days. After you complete setup, you will have immediate access to {org_name}'s workspace.

If you did not expect this invitation or believe you received it in error, you may safely disregard this email. No account will be created unless you complete the setup process.

— 
This email was sent by Madrona on behalf of {org_name}.
Sender: {accounts_from()}
Support: {support_address()}
"""
    
    # Send email
    success = email_service.send_email(
        channel="accounts",
        to=[email],
        subject=f"You've been invited to {org_name}'s Madrona workspace",
        html=html,
        text=text,
        tags={"type": "user_invitation", "organization": sanitize_for_ses_tag(org_name)},
    )
    
    if success:
        logger.info("Sent user invitation email to %s for org %s", email, org_name)
    else:
        logger.error("Failed to send user invitation email to %s for org %s", email, org_name)
    
    return success


def send_invitation_email(email: str, org_name: str, organization_id: str) -> bool:
    """
    Send a simple invitation email for user onboarding.
    
    This is used when org admins create users directly (not via formal invitation flow).
    Users receive an email to set up their account and access the organization.
    
    Args:
        email: Recipient email address
        org_name: Organization name
        organization_id: Organization ID for context
    
    Returns:
        bool: True if email sent successfully
    """
    settings = get_settings()
    email_service = get_email_service()
    
    # For now, use signup link. In the future, this could be a dedicated onboarding flow
    signup_url = f"{settings.app_base_url.rstrip('/')}/signup?org={organization_id}"
    
    html = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Welcome to Madrona</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2 style="color: #2c5282;">Welcome to Madrona</h2>
    
    <p>An administrator has created an account for you at <strong>{org_name}</strong> on Madrona.</p>
    
    <p>Click the button below to complete your account setup:</p>
    
    <p style="text-align: center; margin: 30px 0;">
        <a href="{signup_url}" 
           style="background-color: #3182ce; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Complete Setup
        </a>
    </p>
    
    <p style="color: #666; font-size: 14px;">
        Or copy and paste this link into your browser:<br>
        <a href="{signup_url}" style="color: #3182ce;">{signup_url}</a>
    </p>
    
    <p style="color: #666; font-size: 14px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 20px;">
        If you didn't expect this, please contact your organization administrator.
    </p>
</body>
</html>
"""
    
    text = f"""Welcome to Madrona

An administrator has created an account for you at {org_name} on Madrona.

To complete your account setup, visit:
{signup_url}

If you didn't expect this, please contact your organization administrator.
"""
    
    # Send email
    success = email_service.send_email(
        channel="accounts",
        to=[email],
        subject=f"Welcome to {org_name} on Madrona",
        html=html,
        text=text,
        tags={"type": "user_creation", "organization": sanitize_for_ses_tag(org_name)},
    )
    
    if success:
        logger.info("Sent user creation email to %s for org %s", email, org_name)
    else:
        logger.error("Failed to send user creation email to %s for org %s", email, org_name)
    
    return success
