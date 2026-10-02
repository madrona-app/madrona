"""
Core organization models: Organization, branding, storage, applications, and related tables.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import JSONType, uuid_pk, uuid_fk, uuid_fk_nullable, timestamp_now, timestamp_updated

__all__ = [
    "Organization",
    "OrganizationBranding",
    "OrganizationCollectionProfile",
    "OrganizationStorageConfig",
    "Application",
    "OrganizationApplication",
    "FieldAccessPolicy",
    "RoleFieldAccess",
    "DocumentTemplate",
    "OrgScopedDoc",
]


class Organization(Base):
    """Organization table for multi-organization support."""

    __tablename__ = "organizations"

    organization_id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    timezone: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="UTC",
        server_default="UTC",
        comment="IANA timezone identifier (e.g., 'America/New_York', 'Europe/London')"
    )
    display_projections: Mapped[dict[str, Any] | None] = mapped_column(
        JSONType,
        nullable=True,
        default=None,
        comment="Org-level projection config for entity display. Schema: {version, profiles: {entity_detail, entities_list, search}}"
    )

    # procedure compliance enforcement — per-procedure toggle
    # Shape: {"acquisition": true, "object_entry": false, ...}
    # Missing key = not enforced (default off)
    procedure_enforcement: Mapped[dict[str, Any] | None] = mapped_column(
        JSONType,
        nullable=True,
        default=dict,
        server_default="{}",
        comment="Per-procedure enforcement toggles. Key = procedure_type, value = boolean."
    )

    # Media-rights download enforcement.
    # When False (default): the /media/{id}/download endpoint serves any media
    # the user can MEDIA_VIEW, no rights check, no unpublished-perm check,
    # no derivative-perm check. Preserves pre-2026-05 behavior.
    # When True: downloads are gated by compute_download_access (rights-based),
    # unpublished media requires MEDIA_VIEW_UNPUBLISHED, derivatives require
    # MEDIA_DOWNLOAD_DERIVATIVES. Orgs opt in once their MediaRights data is
    # populated.
    # Role testing ("Test Role"): lets a platform admin view the app as
    # another role via the X-Role-Override header, to verify permission
    # configuration. Defaults on to preserve existing behavior; orgs that
    # would rather not have a permission-swapping affordance available in
    # production can turn it off here.
    role_testing_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

    media_rights_enforcement: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="If true, /media/{id}/download enforces rights-based + unpublished + derivative permission checks."
    )

    # Media AI configuration — per-org overrides for AI features
    # Shape: {"visual_search_threshold": 0.20, ...}
    media_ai_config: Mapped[dict[str, Any] | None] = mapped_column(
        JSONType,
        nullable=True,
        default=dict,
        server_default="{}",
        comment="Per-org media AI settings. Keys: visual_search_threshold (0.0-1.0)."
    )

    # Storage configuration — 10 TB (10,240 GB) unified quota covers S3 media,
    # PostgreSQL database, and OpenSearch index storage.
    DEFAULT_STORAGE_LIMIT_GB = 10_240

    storage_limit_gb: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        # No pricing here. What an operator charges for exceeding this — if
        # anything — is a commercial decision that belongs wherever that
        # operator keeps commercial decisions, not in the schema of software
        # other people run. This column is the limit; enforcement is in
        # services/uploads.check_storage_limit().
        comment="Storage limit in GB. NULL uses DEFAULT_STORAGE_LIMIT_GB."
    )
    storage_region: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="us-west-2",
        server_default="us-west-2",
        comment="AWS region for media storage (e.g., us-west-2, ca-central-1)"
    )
    storage_used_bytes: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
        comment="S3 media storage usage in bytes (updated by trigger on media.media)"
    )
    db_used_bytes: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
        comment="PostgreSQL storage usage in bytes (updated daily by metering task)"
    )
    search_used_bytes: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
        server_default="0",
        comment="OpenSearch storage usage in bytes (updated daily by metering task)"
    )
    storage_metered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Timestamp of last storage metering run"
    )

    # Headquarters location for GIS features
    headquarters_latitude: Mapped[float | None] = mapped_column(
        Numeric(10, 7),
        nullable=True,
        comment="Headquarters latitude for loan network and GIS visualizations"
    )
    headquarters_longitude: Mapped[float | None] = mapped_column(
        Numeric(10, 7),
        nullable=True,
        comment="Headquarters longitude for loan network and GIS visualizations"
    )

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships to flow schema tables (require explicit primaryjoin for cross-schema)
    connector_instances: Mapped[list["ConnectorInstance"]] = relationship(
        "ConnectorInstance",
        back_populates="organization",
        cascade="all, delete-orphan",
        primaryjoin="Organization.organization_id == foreign(ConnectorInstance.organization_id)",
    )
    pipelines: Mapped[list["Pipeline"]] = relationship(
        "Pipeline",
        back_populates="organization",
        cascade="all, delete-orphan",
        primaryjoin="Organization.organization_id == foreign(Pipeline.organization_id)",
    )
    datasets: Mapped[list["Dataset"]] = relationship(
        "Dataset",
        back_populates="organization",
        cascade="all, delete-orphan",
        primaryjoin="Organization.organization_id == foreign(Dataset.organization_id)",
    )
    schedules: Mapped[list["Schedule"]] = relationship(
        "Schedule",
        back_populates="organization",
        cascade="all, delete-orphan",
        primaryjoin="Organization.organization_id == foreign(Schedule.organization_id)",
    )
    jobs: Mapped[list["Job"]] = relationship(
        "Job",
        back_populates="organization",
        cascade="all, delete-orphan",
        primaryjoin="Organization.organization_id == foreign(Job.organization_id)",
    )
    runs: Mapped[list["Run"]] = relationship(
        "Run",
        back_populates="organization",
        cascade="all, delete-orphan",
        primaryjoin="Organization.organization_id == foreign(Run.organization_id)",
    )
    memberships: Mapped[list["OrganizationMembership"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    role_labels: Mapped[list["OrgRoleLabel"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    applications: Mapped[list["OrganizationApplication"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    branding: Mapped["OrganizationBranding | None"] = relationship(
        back_populates="organization", uselist=False, cascade="all, delete-orphan"
    )
    collection_profile: Mapped["OrganizationCollectionProfile | None"] = relationship(
        back_populates="organization", uselist=False, cascade="all, delete-orphan"
    )
    sso_config: Mapped["SSOConfiguration | None"] = relationship(
        back_populates="organization", uselist=False, cascade="all, delete-orphan"
    )
    storage_config: Mapped["OrganizationStorageConfig | None"] = relationship(
        back_populates="organization", uselist=False, cascade="all, delete-orphan"
    )


class OrganizationStorageConfig(Base):
    """
    Storage configuration for BYOB (Bring Your Own Bucket) customers.

    Allows organizations to use their own cloud storage instead of
    Madrona's managed S3 buckets. Supports:
    - AWS S3
    - Azure Blob Storage
    - Google Cloud Storage
    - Any other S3-compatible service (custom endpoint)

    Credentials are stored encrypted using Fernet symmetric encryption.
    The encryption key is stored in AWS Secrets Manager.
    """

    __tablename__ = "organization_storage_configs"

    id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )

    # Storage provider type
    provider: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="managed",
        comment="Storage provider: 'managed', 's3', 'azure', 'gcs', 's3_compatible'"
    )

    # Provider-specific configuration (Fernet-encrypted JSON)
    # For S3: {bucket, region, access_key_id, secret_access_key}
    # For s3_compatible: {bucket, region, endpoint_url, access_key_id, secret_access_key}
    # For Azure: {container, account_name, account_key or sas_token}
    # For GCS: {bucket, project_id, service_account_json}
    config_encrypted: Mapped[bytes | None] = mapped_column(
        "config_encrypted",
        nullable=True,
        comment="Fernet-encrypted JSON configuration"
    )

    # CDN configuration (optional for BYOB customers)
    cdn_domain: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Custom CDN domain (e.g., 'cdn.customer.com')"
    )
    cdn_signing_key_id: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        comment="CDN signing key ID (for CloudFront, etc.)"
    )
    cdn_signing_key_encrypted: Mapped[bytes | None] = mapped_column(
        "cdn_signing_key_encrypted",
        nullable=True,
        comment="Fernet-encrypted CDN signing private key (PEM)"
    )

    # Verification status
    is_verified: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="True if connection has been tested successfully"
    )
    verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Timestamp of last successful connection test"
    )
    verification_error: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Last verification error message (if any)"
    )

    # Migration tracking
    migration_task_id: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        comment="Celery task ID for current/last migration"
    )
    migration_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Timestamp when migration was started"
    )

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(back_populates="storage_config")

    __table_args__ = (
        Index("ix_org_storage_configs_organization_id", "organization_id"),
        CheckConstraint(
            "provider IN ('managed', 's3', 'azure', 'gcs', 's3_compatible')",
            name="check_storage_provider",
        ),
    )


class Application(Base):
    """
    Registry of available applications in the Madrona platform.

    Applications define the major modules available:
    - flow: Data integration pipeline management
    - collections: procedure-compliant collection management
    - media: Digital asset management
    - publish: Public website publishing

    Platform admins control which applications each organization has access to.
    """

    __tablename__ = "applications"

    application_id: Mapped[uuid.UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    default_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    requires_contract: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    organization_subscriptions: Mapped[list["OrganizationApplication"]] = relationship(
        back_populates="application", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'deprecated', 'coming_soon')",
            name="check_application_status",
        ),
    )


class OrganizationApplication(Base):
    """
    Tracks which applications each organization has access to.

    Access control flow:
    1. Platform admin grants org access to applications (this table)
    2. Org admin assigns users to roles (existing RBAC)
    3. Role determines permissions within each application

    Contract dates are optional metadata for tracking subscription periods.
    """

    __tablename__ = "organization_applications"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        primary_key=True,
    )
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("applications.application_id", ondelete="CASCADE"),
        primary_key=True,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enabled_at: Mapped[datetime] = timestamp_now()
    enabled_by: Mapped[uuid.UUID | None] = uuid_fk_nullable("users.user_id")
    contract_start_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    contract_end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    config: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)

    # Relationships
    organization: Mapped["Organization"] = relationship(back_populates="applications")
    application: Mapped["Application"] = relationship(back_populates="organization_subscriptions")
    enabled_by_user: Mapped["User | None"] = relationship(foreign_keys=[enabled_by])

    __table_args__ = (
        Index("ix_org_apps_org_id", "organization_id"),
        Index("ix_org_apps_app_id", "application_id"),
    )


class FieldAccessPolicy(Base):
    """
    System-wide definitions of field-level access policies.

    Defines which fields in Collections/Media are considered sensitive, restricted,
    or internal. Each policy specifies:
    - entity_type: Which model (collection_object, media_asset, location)
    - field_path: The field name or path
    - policy_type: sensitive (financial), restricted (can grant), internal (notes)
    - default_visible: Whether visible by default
    - minimum_permission: Permission a role must hold to see it by default

    These are global definitions. Per-org customization is in role_field_access.
    """

    __tablename__ = "field_access_policies"

    policy_id: Mapped[uuid.UUID] = uuid_pk()
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("applications.application_id", ondelete="CASCADE"),
        nullable=False,
    )
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    field_path: Mapped[str] = mapped_column(String(255), nullable=False)
    policy_type: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_visible: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    # Permission key (e.g. "collections.edit"), not a role name. Roles are
    # customizable per org, so field gating resolves through permissions —
    # see field_access_service.can_view_field.
    minimum_permission: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    application: Mapped["Application"] = relationship()
    role_grants: Mapped[list["RoleFieldAccess"]] = relationship(
        back_populates="policy", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_field_policies_app_entity", "application_id", "entity_type"),
        Index("ix_field_policies_type", "policy_type"),
        # Composite uniqueness so seeds can safely upsert on (app, entity, field).
        UniqueConstraint(
            "application_id", "entity_type", "field_path",
            name="uq_field_policy_app_entity_field",
        ),
        CheckConstraint(
            "policy_type IN ('sensitive', 'restricted', 'internal')",
            name="check_policy_type",
        ),
    )


class RoleFieldAccess(Base):
    """
    Per-organization role grants for field-level access.

    Allows org admins to customize which roles can see/edit restricted fields.
    This table stores org-specific overrides to the default field policies.

    Example: An org might grant 'curator' role access to 'acquisition_cost'
    even though the default requires 'admin'.
    """

    __tablename__ = "role_field_access"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        primary_key=True,
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("roles.role_id", ondelete="CASCADE"),
        primary_key=True,
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("field_access_policies.policy_id", ondelete="CASCADE"),
        primary_key=True,
    )
    can_view: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_edit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    granted_by: Mapped[uuid.UUID | None] = uuid_fk_nullable("users.user_id")
    granted_at: Mapped[datetime] = timestamp_now()

    # Relationships
    organization: Mapped["Organization"] = relationship()
    role: Mapped["Role"] = relationship()
    policy: Mapped["FieldAccessPolicy"] = relationship(back_populates="role_grants")
    granted_by_user: Mapped["User | None"] = relationship(foreign_keys=[granted_by])

    __table_args__ = (
        Index("ix_role_field_access_org", "organization_id"),
        Index("ix_role_field_access_policy", "policy_id"),
    )


# =============================================================================
# APPROVAL WORKFLOWS
# =============================================================================

class ApprovalRule(Base):
    """
    Defines when approval is required for a procedure.

    Each rule specifies: when entity_type + trigger_action occurs,
    someone with approver_permission must approve before it proceeds.

    procedure-aligned: loans, acquisitions, deaccessions have default rules.
    Orgs can add, modify, or disable rules via admin UI.
    """

    __tablename__ = "approval_rules"

    rule_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    trigger_action: Mapped[str] = mapped_column(String(50), nullable=False)
    trigger_condition: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    approver_permission: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = timestamp_now()

    organization: Mapped["Organization"] = relationship()

    __table_args__ = (
        Index("ix_approval_rules_org", "organization_id"),
    )


class ApprovalRequest(Base):
    """
    A pending approval for a specific entity action.

    Created when a user performs an action that requires approval.
    Reviewed by someone with the approver_permission from the rule.
    """

    __tablename__ = "approval_requests"

    request_id: Mapped[uuid.UUID] = uuid_pk()
    rule_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("approval_rules.rule_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    requested_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=False,
    )
    requested_action: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='pending')
    # Directed approval: when set, this request is addressed to a specific user
    # (who must hold the rule's approver_permission), not just "anyone with it".
    assigned_to_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True,
    )
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = timestamp_now()

    rule: Mapped["ApprovalRule"] = relationship()
    requester: Mapped["User"] = relationship(foreign_keys=[requested_by])
    reviewer: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by])

    __table_args__ = (
        Index("ix_approval_requests_org", "organization_id"),
        Index("ix_approval_requests_entity", "entity_type", "entity_id"),
        Index("ix_approval_requests_status", "organization_id", "status"),
        Index(
            "ix_approval_requests_assignee",
            "organization_id", "assigned_to_user_id", "status",
        ),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'cancelled')",
            name="check_approval_request_status",
        ),
    )


class OrganizationBranding(Base):
    """
    Organization branding settings for document generation.

    Stores branding assets (logo, colors) and document templates
    for generating branded PDF documents like loan agreements,
    receipts, packing lists, and condition reports.

    Each organization has at most one branding record. If none exists,
    documents are generated with default/minimal branding.
    """

    __tablename__ = "organization_branding"

    branding_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Logo (stored in S3)
    logo_s3_key: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="S3 key for organization logo image (PNG/SVG)"
    )
    logo_width_px: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Logo display width in pixels for PDF generation"
    )

    # Letterhead information
    letterhead_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Institution name for document headers"
    )
    letterhead_address_line1: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    letterhead_address_line2: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    letterhead_city_state_zip: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    letterhead_country: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )
    letterhead_phone: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )
    letterhead_email: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    letterhead_website: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    # Footer
    footer_text: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Custom footer text (e.g., charity number, registration info)"
    )

    # Brand colors (hex codes)
    primary_color: Mapped[str | None] = mapped_column(
        String(7),
        nullable=True,
        default="#1a365d",
        comment="Primary brand color as hex (e.g., #1a365d)"
    )
    secondary_color: Mapped[str | None] = mapped_column(
        String(7),
        nullable=True,
        default="#2d3748",
        comment="Secondary brand color as hex"
    )
    accent_color: Mapped[str | None] = mapped_column(
        String(7),
        nullable=True,
        default="#3182ce",
        comment="Accent color for highlights as hex"
    )

    # Digital signature (optional)
    signature_s3_key: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="S3 key for default signature image (PNG)"
    )
    signature_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Name to display below signature"
    )
    signature_title: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Title/position to display below signature"
    )

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(back_populates="branding")

    __table_args__ = (
        Index("ix_org_branding_organization_id", "organization_id", unique=True),
    )


class OrganizationCollectionProfile(Base):
    """
    Per-organization "collection scope profile" — what the collection covers,
    how complete it is, and what is knowingly missing or excluded.

    Motivation (issue #77): AI/RAG interfaces should disclose the scope and
    limitations of the holdings they answer over, rather than presenting a
    partial or selectively-digitized collection as comprehensive. This profile
    is rendered into a compact "Collection Scope" block injected into the
    Guide's system prompt so it can answer coverage questions and proactively
    flag partial digitization and known gaps.

    One profile per organization (org-level v1; Department/Dataset scope may be
    layered on later). When absent, the Guide simply has no scope to disclose.
    """

    __tablename__ = "organization_collection_profiles"

    profile_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Narrative scope of the collection (free text, archival "scope and content").
    scope_note: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Narrative description of what the collection covers",
    )

    # Structured coverage: date_range, record_types, geography, languages, etc.
    coverage: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Structured coverage: {date_range, record_types, geography, languages}",
    )

    # How complete the holdings are relative to what could exist.
    completeness: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
        comment="comprehensive | representative | partial | unknown",
    )
    extent_note: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Free-text note on extent/size and what completeness means here",
    )

    # What is knowingly missing, excluded, or under-represented, and why.
    known_gaps: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Known gaps / excluded content and the reason (e.g. not digitized, legal, curatorial)",
    )

    # Degree to which the physical collection has been digitized.
    digitization_status: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
        comment="full | partial | minimal | none | unknown",
    )

    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    organization: Mapped["Organization"] = relationship(back_populates="collection_profile")

    __table_args__ = (
        Index("ix_org_collection_profile_organization_id", "organization_id", unique=True),
        CheckConstraint(
            "completeness IS NULL OR completeness IN "
            "('comprehensive', 'representative', 'partial', 'unknown')",
            name="ck_collection_profile_completeness",
        ),
        CheckConstraint(
            "digitization_status IS NULL OR digitization_status IN "
            "('full', 'partial', 'minimal', 'none', 'unknown')",
            name="ck_collection_profile_digitization",
        ),
    )


class DocumentTemplate(Base):
    """
    Customizable document templates for collections management.

    Templates define the structure and content for generated documents.
    Each organization can have custom templates per document type,
    falling back to system defaults if none exist.

    Template types:
    - loan_agreement_out: Outgoing loan agreement
    - loan_agreement_in: Incoming loan agreement
    - object_receipt: Receipt for deposited objects
    - packing_list: Packing list for shipments
    - condition_report: Printable condition report
    - facility_report: Facility report for loan requests
    """

    __tablename__ = "document_templates"

    template_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=True,
        comment="NULL for system default templates"
    )

    template_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="Document type: loan_agreement_out, loan_agreement_in, object_receipt, packing_list, condition_report, facility_report"
    )
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Display name for the template"
    )
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    is_default: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="If true, this is the default template for this org+type"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    # Template configuration as JSON
    # Contains: sections to include, field mappings, custom text blocks
    config: Mapped[dict[str, Any]] = mapped_column(
        JSONType,
        nullable=False,
        default=dict,
        comment="Template configuration: sections, field mappings, custom text"
    )

    # Custom terms and conditions text
    terms_and_conditions: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Custom terms and conditions for agreements"
    )

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    created_by: Mapped[uuid.UUID | None] = uuid_fk_nullable("users.user_id")
    updated_by: Mapped[uuid.UUID | None] = uuid_fk_nullable("users.user_id")

    # Relationships
    organization: Mapped["Organization | None"] = relationship()

    __table_args__ = (
        Index("ix_doc_templates_org_type", "organization_id", "template_type"),
        Index("ix_doc_templates_type", "template_type"),
        # Ensure only one default per org+type
        Index(
            "ix_doc_templates_default",
            "organization_id", "template_type",
            unique=True,
            postgresql_where=text("is_default = TRUE")
        ),
        CheckConstraint(
            "template_type IN ('loan_agreement_out', 'loan_agreement_in', 'object_receipt', 'packing_list', 'condition_report', 'facility_report')",
            name="check_template_type"
        ),
    )


class OrgScopedDoc(Base):
    """
    Organization-scoped page documentation for inline help.

    Each organization can have custom documentation per page/route.
    Content is keyed by a stable page key (e.g., "pipelines.detail", "runs.list")
    and optionally filtered by audience role.

    Audience enum:
    - all: Visible to all users
    - viewer: Visible to viewers and above
    - engineer: Visible to engineers and admins
    - admin: Visible only to org admins
    """

    __tablename__ = "org_scoped_docs"

    doc_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    page_key: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="Stable route key like 'pipelines.detail', 'runs.list'"
    )
    title: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="Documentation title"
    )
    summary: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Short summary (optional)"
    )
    body_markdown: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="Full documentation content in Markdown"
    )
    audience: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="all",
        comment="Target audience: all, viewer, engineer, admin"
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship()
    author: Mapped["User | None"] = relationship()

    __table_args__ = (
        Index("ix_org_scoped_docs_org_page", "organization_id", "page_key", unique=True),
        CheckConstraint(
            "audience IN ('all', 'viewer', 'engineer', 'admin')",
            name="ck_org_scoped_docs_audience"
        ),
        {"schema": "flow"},
    )
