"""
Core SSO/auth models: SSOConfiguration and related authentication tables.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated

__all__ = [
    "SSOConfiguration",
]


class SSOConfiguration(Base):
    """
    SSO/SAML configuration for enterprise organizations.

    Supports SAML 2.0 identity provider integration with options for:
    - SAML settings (IdP entity ID, SSO URL, certificate)
    - OIDC settings (for future support)
    - User provisioning settings (auto-provision, default role, allowed domains)

    Each organization can have at most one SSO configuration (unique constraint on organization_id).
    """

    __tablename__ = "sso_configurations"

    id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="saml",
        comment="SSO provider type: 'saml' or 'oidc'"
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # SAML settings
    idp_entity_id: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Identity Provider Entity ID (e.g., https://idp.example.com/metadata)"
    )
    idp_sso_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Identity Provider Single Sign-On URL"
    )
    idp_certificate: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="IdP X.509 certificate in PEM format"
    )
    sp_entity_id: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Service Provider Entity ID (our entity ID for the customer to configure)"
    )

    # OIDC settings (for future)
    client_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # client_secret is Fernet-encrypted at rest, matching OrganizationStorageConfig pattern.
    # Application code must encrypt before writing and decrypt after reading.
    client_secret_encrypted: Mapped[bytes | None] = mapped_column(
        "client_secret_encrypted",
        nullable=True,
        comment="Fernet-encrypted OIDC client secret"
    )
    discovery_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="OIDC Discovery URL (e.g., https://idp.example.com/.well-known/openid-configuration)"
    )

    # User provisioning settings
    auto_provision_users: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="Automatically create user accounts on first SSO login"
    )
    default_app_roles: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Per-app default roles for auto-provisioned users: {app_key: role_key}"
    )
    allowed_domains: Mapped[list[str] | None] = mapped_column(
        ARRAY(String),
        nullable=True,
        comment="Allowed email domains for SSO users (e.g., ['company.com', 'corp.company.com'])"
    )

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(back_populates="sso_config")

    __table_args__ = (
        Index("ix_sso_configurations_organization_id", "organization_id"),
        CheckConstraint(
            "provider IN ('saml', 'oidc')",
            name="check_sso_provider",
        ),
    )
