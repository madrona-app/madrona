"""
Core user models: User, memberships, auth tokens, audit logs, and related tables.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import JSONType, uuid_pk, uuid_fk, uuid_fk_nullable, timestamp_now, timestamp_updated

__all__ = [
    "User",
    "EmailEvent",
    "OrganizationMembership",
    "RefreshToken",
    "PasswordResetToken",
    "MfaResetToken",
    "EmailVerificationToken",
    "OrganizationInvitation",
    "APIKey",
    "AuditLog",
    "ProvisioningAuditLog",
    "MfaRecoveryCode",
    "UserOverviewPreference",
    "GuideUserPreference",
]


class User(Base):
    """User table for authentication and authorization."""

    __tablename__ = "users"

    user_id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)  # Nullable for Cognito-only users
    cognito_sub: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)  # Cognito user ID
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)  # User's preferred display name
    timezone: Mapped[str | None] = mapped_column(String(50), nullable=True, default='America/New_York')  # User's timezone preference
    locale: Mapped[str | None] = mapped_column(String(35), nullable=True)  # BCP 47 locale tag (e.g. "fr-FR"); null = browser default
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # URL to user's profile picture
    status: Mapped[str] = mapped_column(
        String, nullable=False, default="active"
    )  # active, suspended, deleted
    email_status: Mapped[str] = mapped_column(
        String, nullable=False, default="active"
    )  # active, bounced, complaint
    # Email verification (NULL until the user clicks the link in the
    # verification email). Distinct from email_status, which is SES
    # deliverability state, not user-confirmed ownership.
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Google OAuth tokens for Sheets access
    google_access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    google_refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    google_token_expiry: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # MFA recovery code tracking
    recovery_codes_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recovery_codes_required: Mapped[bool] = mapped_column(default=False)
    mfa_version: Mapped[int] = mapped_column(default=0)  # Incremented on MFA setup/reset

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    memberships: Mapped[list["OrganizationMembership"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    recovery_codes: Mapped[list["MfaRecoveryCode"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class EmailEvent(Base):
    """Email events (bounces, complaints) from AWS SES."""

    __tablename__ = "email_events"

    event_id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String, nullable=False)  # bounce, complaint
    bounce_type: Mapped[str | None] = mapped_column(String, nullable=True)
    bounce_subtype: Mapped[str | None] = mapped_column(String, nullable=True)
    complaint_feedback_type: Mapped[str | None] = mapped_column(String, nullable=True)
    message_id: Mapped[str | None] = mapped_column(String, nullable=True)
    sns_message_id: Mapped[str | None] = mapped_column(String, nullable=True)
    raw_message: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    created_at: Mapped[datetime] = timestamp_now()

    __table_args__ = (
        Index("idx_email_events_email_type", "email", "event_type"),
        Index("idx_email_events_sns_message", "sns_message_id", unique=True),
    )


class OrganizationMembership(Base):
    """
    Links users to organizations with roles.

    Note: In transition to RBAC system.
    - Old: role (string) - 'admin', 'member'
    - New: role_id (FK) - references roles table

    Migration will add role_id, backfill from role string, then drop role column.
    """

    __tablename__ = "organization_memberships"

    membership_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")
    user_id: Mapped[uuid.UUID] = uuid_fk("users.user_id")

    # Legacy role column (to be removed after RBAC migration)
    role: Mapped[str] = mapped_column(String, nullable=False)  # admin, member

    # New RBAC role_id column (added in migration)
    role_id: Mapped[uuid.UUID] = uuid_fk("roles.role_id", ondelete="RESTRICT")

    # Membership status: active (can access org) or deactivated (revoked access)
    status: Mapped[str] = mapped_column(
        String, nullable=False, default="active"
    )  # active, deactivated

    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    organization: Mapped["Organization"] = relationship(back_populates="memberships")
    user: Mapped["User"] = relationship(back_populates="memberships")
    # role: Mapped["Role"] = relationship(back_populates="memberships")  # Uncomment after migration

    __table_args__ = (
        Index("idx_org_membership_org_user", "organization_id", "user_id", unique=True),
        Index("idx_org_membership_user", "user_id"),
    )


class RefreshToken(Base):
    """Refresh tokens for authentication (AUTH-BE1)."""

    __tablename__ = "refresh_tokens"

    token_id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = uuid_fk("users.user_id")
    token_hash: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    active_organization_id: Mapped[uuid.UUID | None] = uuid_fk_nullable("organizations.organization_id")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()

    # MFA session metadata
    mfa_verified: Mapped[bool] = mapped_column(default=False, nullable=False)
    mfa_method: Mapped[str | None] = mapped_column(String(20), nullable=True)  # 'totp', 'sms', or null
    mfa_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    user: Mapped["User"] = relationship(back_populates="refresh_tokens")


class PasswordResetToken(Base):
    """
    Password reset tokens for forgot password flow.

    Tokens are sent via email and allow users to set a new password.
    They are single-use and expire after 1 hour for security.
    """

    __tablename__ = "password_reset_tokens"

    token_id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = uuid_fk("users.user_id")
    token_hash: Mapped[str] = mapped_column(String, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    user: Mapped["User"] = relationship()


class MfaResetToken(Base):
    """
    MFA reset tokens for the self-service "lost your authenticator" flow.

    Emailed as a single-use link; confirming it (together with the account
    password) disables the user's TOTP MFA so they can sign in and re-enroll.
    Single-use, 1-hour expiry — same security envelope as password reset.
    """

    __tablename__ = "mfa_reset_tokens"

    token_id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = uuid_fk("users.user_id")
    token_hash: Mapped[str] = mapped_column(String, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    user: Mapped["User"] = relationship()


class EmailVerificationToken(Base):
    """
    Email verification tokens.

    Sent at signup (and via the resend endpoint) so users can confirm they
    own the email address on the account. Single-use; 24-hour expiry.
    Independent of password reset and SES deliverability state.
    """

    __tablename__ = "email_verification_tokens"

    token_id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = uuid_fk("users.user_id")
    token_hash: Mapped[str] = mapped_column(String, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    user: Mapped["User"] = relationship()

    __table_args__ = (
        Index("ix_email_verification_tokens_user_id", "user_id"),
    )


class OrganizationInvitation(Base):
    """
    Organization invitations for adding new members.

    Invitations bind a specific user (by email or user_id) to an organization
    with a designated role. They are single-use and expire after a configurable period.

    Invitation states:
    - pending: Created, not yet accepted (used_at is NULL, expires_at in future)
    - used: Accepted and membership created (used_at is set)
    - expired: Not accepted before expires_at (expires_at in past, used_at is NULL)
    """

    __tablename__ = "organization_invitations"

    invitation_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")

    # User identification: either email (before user created) or user_id (after)
    email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=True
    )

    # Security token (hashed)
    token_hash: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)

    # Role assignment (legacy string field, will migrate to role_id)
    role: Mapped[str] = mapped_column(String, nullable=False)  # admin, member
    # role_id: Mapped[uuid.UUID] = uuid_fk("roles.role_id")  # Future: RBAC role

    # Invitation metadata
    invited_by: Mapped[uuid.UUID] = uuid_fk("users.user_id", ondelete="RESTRICT")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()

    __table_args__ = (
        Index("idx_org_invitation_org_email", "organization_id", "email"),
        Index("idx_org_invitation_email", "email"),
        Index("idx_org_invitation_user", "user_id"),
    )


class APIKey(Base):
    """API keys for customer API authentication (ORG3)."""

    __tablename__ = "api_keys"

    api_key_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")
    name: Mapped[str] = mapped_column(String, nullable=False)
    key_prefix: Mapped[str] = mapped_column(String(8), nullable=False)  # First 8 chars for display
    key_hash: Mapped[str] = mapped_column(String, nullable=False, index=True)
    scopes: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")  # active, revoked
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # NULL = never expires
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    organization: Mapped["Organization"] = relationship()
    created_by: Mapped["User | None"] = relationship()

    __table_args__ = (
        Index("idx_api_keys_org_name", "organization_id", "name", unique=True),
        Index("idx_api_keys_org_status", "organization_id", "status"),
    )


class AuditLog(Base):
    """
    Audit log for tracking user management actions.

    Records all administrative actions (user invitations, role changes, deactivations, etc.)
    for compliance and security monitoring.

    Visible to:
    - admin: View logs for their organization
    - platform.admin: View all audit logs across all organizations
    """

    __tablename__ = "audit_logs"

    audit_log_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID | None] = uuid_fk_nullable("organizations.organization_id", ondelete="CASCADE")

    # Who performed the action (nullable for pre-auth events like login failures)
    acting_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True
    )

    # Who was affected (for user management actions)
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # What happened
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    # Actions: user.invited, user.role_changed, user.deactivated, user.reactivated,
    #          api_key.created, api_key.revoked, etc.

    # Additional context (JSONB for flexibility)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    # Examples:
    # - user.invited: {email, role_id, role_key}
    # - user.role_changed: {old_role_id, new_role_id, old_role_key, new_role_key}
    # - user.deactivated: {membership_id}
    # - api_key.created: {api_key_id, name, scopes}

    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    organization: Mapped["Organization"] = relationship()
    acting_user: Mapped["User"] = relationship(foreign_keys=[acting_user_id])
    target_user: Mapped["User | None"] = relationship(foreign_keys=[target_user_id])

    __table_args__ = (
        Index("idx_audit_logs_org_created", "organization_id", "created_at"),
        Index("idx_audit_logs_action", "action"),
        Index("idx_audit_logs_target_user", "target_user_id"),
        Index("idx_audit_logs_acting_user", "acting_user_id"),
    )


class ProvisioningAuditLog(Base):
    """
    Audit log for tracking platform-level provisioning actions.

    Records all provisioning events (organization creation, bulk user imports,
    app enabling/disabling, tier changes, SSO configuration, contract events, etc.)
    for compliance and platform administration monitoring.

    Visible to:
    - platform.admin: View all provisioning logs across all organizations
    """

    __tablename__ = "provisioning_audit_logs"

    id: Mapped[uuid.UUID] = uuid_pk()

    # What happened
    action: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        comment="Action type: org_created, user_added, user_bulk_imported, app_enabled, app_disabled, tier_changed, sso_configured, contract_created, contract_renewed"
    )

    # Who performed the action
    performed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    # Target organization (nullable for platform-wide actions)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.organization_id", ondelete="SET NULL"), nullable=True
    )

    # Action-specific details (JSONB for flexibility)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    # Examples:
    # - org_created: {org_name, admin_email, apps_enabled}
    # - user_bulk_imported: {count, organization_id}
    # - tier_changed: {app, old_tier, new_tier}
    # - app_enabled: {app_key, tier_key}
    # - app_disabled: {app_key}

    # Request context
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    performer: Mapped["User | None"] = relationship(foreign_keys=[performed_by])
    organization: Mapped["Organization | None"] = relationship()

    __table_args__ = (
        Index("idx_provisioning_logs_created", "created_at"),
        Index("idx_provisioning_logs_action", "action"),
        Index("idx_provisioning_logs_org", "organization_id"),
        Index("idx_provisioning_logs_performer", "performed_by"),
    )


class MfaRecoveryCode(Base):
    """
    MFA recovery codes for account recovery when TOTP device is lost.

    Security properties:
    - Codes are stored as Argon2id hashes (never plaintext)
    - Each code can only be used once (used_at tracks consumption)
    - Codes are tied to mfa_version to auto-invalidate on MFA reset
    - Atomic consumption prevents race conditions
    """

    __tablename__ = "mfa_recovery_codes"

    code_id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = uuid_fk("users.user_id")
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    mfa_version: Mapped[int] = mapped_column(nullable=False)  # Must match user.mfa_version
    label: Mapped[str | None] = mapped_column(String(50), nullable=True)  # e.g. "initial"
    created_at: Mapped[datetime] = timestamp_now()
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    used_session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Relationships
    user: Mapped["User"] = relationship(back_populates="recovery_codes")

    __table_args__ = (
        # Partial index for efficient lookup of unused codes
        Index(
            "ix_mfa_recovery_codes_user_unused",
            "user_id", "mfa_version",
            postgresql_where=text("used_at IS NULL")
        ),
    )


class UserOverviewPreference(Base):
    """
    Per-user preferences for the Overview page dataset visibility and primary selection.

    Controls which datasets are displayed in the Overview ReactFlow diagram
    and which dataset is positioned centrally as the "primary" dataset.

    This is UI state only - does not affect routes, permissions, or data model.
    If no preference exists, defaults to first 5 datasets by created_at desc.
    """

    __tablename__ = "user_overview_prefs"

    pref_id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = uuid_fk("users.user_id")
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")
    visible_dataset_ids: Mapped[list[str]] = mapped_column(
        JSONType, nullable=False, default=list
    )  # Array of dataset UUIDs as strings
    # Persisted ordering for datasets as chosen by the user in the Overview UI
    dataset_order: Mapped[list[str]] = mapped_column(
        JSONType, nullable=False, default=list
    )  # Array of dataset UUIDs in user-specified order
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    user: Mapped["User"] = relationship()
    organization: Mapped["Organization"] = relationship()

    __table_args__ = (
        Index("ix_user_overview_prefs_user_org", "user_id", "organization_id", unique=True),
    )


class GuideUserPreference(Base):
    """
    Per-user, per-org personalization for the Guide assistant.

    A user's own freeform "things to keep in mind" note plus a verbosity
    preference. These are injected BELOW the org/platform system prompt as
    subordinate stylistic preferences — they shape tone/length/emphasis but
    never override org rules, persona, or guardrails (see
    prompt_service.get_user_preferences and agent_service._build_ollama_messages).

    Private to the user: the RLS policy is keyed on user_id = current_user_id(),
    so other members (incl. org admins) cannot read another user's preferences.
    No row == no personalization (empty resolves to ""), so this is purely
    additive for users who never set anything.
    """

    __tablename__ = "guide_user_prefs"

    pref_id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = uuid_fk("users.user_id")
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")
    # Freeform standing instructions the Guide should keep in mind for this user.
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Preferred answer length: "terse" | "normal" | "detailed". NULL = unset.
    verbosity: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    user: Mapped["User"] = relationship()
    organization: Mapped["Organization"] = relationship()

    __table_args__ = (
        CheckConstraint(
            "verbosity IS NULL OR verbosity IN ('terse', 'normal', 'detailed')",
            name="check_guide_user_pref_verbosity",
        ),
        Index("ix_guide_user_prefs_user_org", "user_id", "organization_id", unique=True),
    )
