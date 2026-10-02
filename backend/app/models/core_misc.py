"""
Core miscellaneous models: RBAC, Flow/pipelines, canonical data store,
runs, change history, SQL explorer, entity audit, discussions, and notifications.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base
from app.models._helpers import JSONType, uuid_pk, uuid_fk, uuid_fk_nullable, timestamp_now, timestamp_updated

__all__ = [
    # RBAC
    "Permission",
    "Role",
    "RolePermission",
    "RoleProfile",
    "OrgRoleLabel",
    "OrganizationRoleLabel",
    "AppRoleAssignment",
    # Connector Framework
    "ConnectorDefinition",
    "ConnectorInstance",
    "Pipeline",
    "PipelineSource",
    "PipelineDestination",
    "Dataset",
    # Canonical Data Store
    "EntityCurrent",
    "EntityField",
    "EntityRelationship",
    "RelationshipDefinition",
    # Runs & Job Queue
    "Schedule",
    "Job",
    "Run",
    "RunSourceStep",
    "RunDestinationStep",
    # Change History
    "ChangeEvent",
    "FieldDiff",
    "DatasetTransformer",

    # Entity Audit
    "EntityAuditEvent",
    "EntityAuditFieldDiff",
    # Record-Bound Discussions
    "DISCUSSION_ENTITY_TYPES",
    "RecordComment",
    "RecordWatch",
    "Notification",
]


# ============================================================================
# 3. Roles & Permissions (RBAC)
# ============================================================================


class Permission(Base):
    """
    Canonical permission definitions.

    Global, immutable (v1) set of permissions available in the system.
    Permissions are atomic capabilities like 'connectors.edit' or 'runs.execute'.
    """

    __tablename__ = "permissions"

    permission_id: Mapped[uuid.UUID] = uuid_pk()
    permission_key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    scope: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    role_permissions: Mapped[list["RolePermission"]] = relationship(
        back_populates="permission", cascade="all, delete-orphan"
    )


class Role(Base):
    """
    Role definitions — system (global) and custom (org-scoped).

    System roles (is_system=True, organization_id=NULL):
    - admin, registrar, curator, publisher, viewer, platform_admin
    - Permissions resolved via inheritance chain (ROLE_INHERITANCE_MAP)
    - Immutable permission sets, shared across all orgs

    Custom roles (is_system=False, organization_id=<org>):
    - Created by org admins, optionally cloned from a system role
    - Flat permission sets (no inheritance), explicitly assigned
    - Scoped to a single organization
    """

    __tablename__ = "roles"

    role_id: Mapped[uuid.UUID] = uuid_pk()
    role_key: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=True,
    )
    cloned_from: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("roles.role_id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    role_permissions: Mapped[list["RolePermission"]] = relationship(
        back_populates="role", cascade="all, delete-orphan"
    )
    organization: Mapped["Organization | None"] = relationship(
        foreign_keys=[organization_id],
    )

    __table_args__ = (
        Index("ix_roles_organization_id", "organization_id"),
        # System roles (is_system=True) must have globally-unique role_key.
        # Matches alembic uq_role_key constraint and the seed ON CONFLICT target.
        UniqueConstraint("role_key", name="uq_role_key"),
    )


class RolePermission(Base):
    """
    Maps roles to their permissions.

    Global, immutable (v1) mapping defining which permissions each role has.
    """

    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("roles.role_id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("permissions.permission_id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    role: Mapped["Role"] = relationship(back_populates="role_permissions")
    permission: Mapped["Permission"] = relationship(back_populates="role_permissions")

    __table_args__ = (
        Index("ix_role_permissions_role_id", "role_id"),
        Index("ix_role_permissions_permission_id", "permission_id"),
    )


class RoleProfile(Base):
    """
    Industry-specific role label profiles.

    Maps role_key to human-readable labels per profile type (e.g., GLAM, enterprise).
    Used by organizations to select which label set to use for their roles.

    Example profiles:
    - glam_default: "admin" -> "Curator", "member" -> "Staff"
    - enterprise_default: "admin" -> "Manager", "member" -> "Contributor"
    """

    __tablename__ = "role_profiles"

    profile_key: Mapped[str] = mapped_column(String(50), primary_key=True)
    role_key: Mapped[str] = mapped_column(String(50), primary_key=True)
    label: Mapped[str] = mapped_column(String(100), nullable=False)


class OrgRoleLabel(Base):
    """
    Organization-specific custom role labels.

    Allows organizations to override the default profile labels with
    their own custom labels, optionally scoped to a specific application.

    Resolution order (in get_role_label_for_org):
    1. App-specific org override (app_key set)
    2. Org-wide override (app_key is NULL)
    3. Profile default (role_profiles table)
    4. Code fallback (ROLE_LABELS dict)
    """

    __tablename__ = "org_role_labels"

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
    app_key: Mapped[str] = mapped_column(
        String(30),
        default="",
        server_default="",
        primary_key=True,
        comment="Application context ('' = all apps). E.g., 'collections', 'media', 'bridge'",
    )
    # Kept for display/query convenience — no FK, not part of PK
    role_key: Mapped[str] = mapped_column(String(50), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(back_populates="role_labels")
    role: Mapped["Role"] = relationship()

    __table_args__ = (
        Index("ix_org_role_labels_organization_id", "organization_id"),
    )


# Alias for backward compatibility
OrganizationRoleLabel = OrgRoleLabel


class AppRoleAssignment(Base):
    """
    Per-app role overrides for users.

    Allows users to have different roles in different applications within
    the same organization. The organization membership role serves as the
    default, with app-specific overrides taking precedence.

    Permission Resolution:
    1. Check app_role_assignments for user+org+app override
    2. If no override found, use OrganizationMembership.role_id

    Example:
        User has admin role by default in org XYZ.
        User has curator role override for 'collections' app.
        -> In Collections: user has curator permissions
        -> In Media: user has admin permissions (default)

    Valid app_keys:
        - 'bridge': Data integration pipelines
        - 'collections': Museum collection management
        - 'media': Digital asset management
        - 'reports': Reporting system
    """

    __tablename__ = "app_role_assignments"

    assignment_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")
    user_id: Mapped[uuid.UUID] = uuid_fk("users.user_id")
    app_key: Mapped[str] = mapped_column(String(50), nullable=False)
    role_id: Mapped[uuid.UUID] = uuid_fk("roles.role_id", ondelete="RESTRICT")
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = uuid_fk_nullable("users.user_id")
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    role: Mapped["Role"] = relationship(foreign_keys=[role_id])
    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    organization: Mapped["Organization"] = relationship()
    creator: Mapped["User"] = relationship(foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint('organization_id', 'user_id', 'app_key', name='uq_app_role_assignments_org_user_app'),
        Index('ix_app_role_assignments_org_user', 'organization_id', 'user_id'),
        Index('ix_app_role_assignments_org_app', 'organization_id', 'app_key'),
    )

    # Valid app keys
    VALID_APP_KEYS = frozenset({'bridge', 'collections', 'media', 'reports'})

    @classmethod
    def validate_app_key(cls, app_key: str) -> bool:
        """Check if app_key is valid."""
        return app_key in cls.VALID_APP_KEYS


# ============================================================================
# 3. Connector Framework (Data-Driven)
# ============================================================================


class ConnectorDefinition(Base):
    """
    Connector catalog defining available connector types.

    Drives runtime dispatch via implementation_key (e.g., "app.connectors.core.smithsonian_base:SmithsonianBaseConnector").

    Implementation key patterns:
    - Shared connectors: "app.connectors.core.<name>:<ClassName>"
    - Org-specific connectors: "app.connectors.orgs.<org_key>.<name>:<ClassName>"

    Schema versioning (future-ready):
    - config_schema can include "$id" or "x-schema-version" for versioning
    - When updating schemas, increment version to track changes
    - connector_instances can store schema_version_used at creation time

    SECURITY POLICY (Prompt 7):
    - implementation_key must be a module import path, NOT inline Python code
    - Code stored in database is prohibited (prevents arbitrary code execution)
    - Validation enforced at model level via validate_implementation_key()
    """

    __tablename__ = "connector_definitions"

    connector_definition_id: Mapped[uuid.UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    direction: Mapped[str] = mapped_column(String, nullable=False)  # source|target|both
    implementation_key: Mapped[str] = mapped_column(String, nullable=False)
    source_type: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
        comment="Source system type (e.g., 'smithsonian', 'salesforce'). Used for categorization and UI display."
    )
    version: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
        comment="Connector version (e.g., '1.0.0', 'v2024.1'). Defaults to application version if not specified."
    )
    capabilities: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    config_schema: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    default_config: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    category: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        comment="Connector category for UI grouping (e.g., 'database', 'api', 'file', 'cloud')."
    )
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    connector_instances: Mapped[list["ConnectorInstance"]] = relationship(
        back_populates="connector_definition"
    )

    __table_args__ = (
        CheckConstraint(
            "direction IN ('source', 'target', 'both')",
            name="check_connector_direction",
        ),
        {"schema": "flow"},
    )

    def validate_implementation_key(self) -> None:
        """
        Validate that implementation_key is a valid module import path.

        SECURITY: Rejects inline code patterns to prevent Python-in-DB vulnerabilities.
        This is enforced per Prompt 7 security policy.

        Raises:
            ValueError: If implementation_key is invalid or contains code patterns
        """
        if not self.implementation_key:
            raise ValueError("implementation_key cannot be empty")

        # Must contain exactly one colon separator
        if self.implementation_key.count(":") != 1:
            raise ValueError(
                f"Invalid implementation_key format: '{self.implementation_key}'. "
                f"Must be 'package.module:ClassName' with exactly one colon"
            )

        module_path, class_name = self.implementation_key.split(":", 1)

        if not module_path or not class_name:
            raise ValueError(
                f"Invalid implementation_key: module path and class name cannot be empty"
            )

        # Reject inline code indicators (security guardrail)
        inline_code_indicators = [
            "\n",  # Newlines indicate multi-line code
            "def ",  # Function definitions
            "class ",  # Class definitions
            "import ",  # Import statements
            "from ",  # From-import statements
            "lambda ",  # Lambda expressions
            "exec(",  # Exec calls
            "eval(",  # Eval calls
            "compile(",  # Compile calls
            "__import__",  # Dynamic imports
        ]

        for indicator in inline_code_indicators:
            if indicator in self.implementation_key:
                raise ValueError(
                    f"Invalid implementation_key: contains '{indicator.strip()}'. "
                    f"implementation_key must be a module import path like 'app.connectors.core.smithsonian_base:SmithsonianBaseConnector', "
                    f"NOT inline Python code. Store connector code in version-controlled modules, not in the database."
                )


class ConnectorInstance(Base):
    """
    Per-organization configured connector instance.

    References a connector_definition and contains organization-specific configuration.
    """

    __tablename__ = "connector_instances"

    connector_instance_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    connector_definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flow.connector_definitions.connector_definition_id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    config: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        back_populates="connector_instances",
        primaryjoin="ConnectorInstance.organization_id == Organization.organization_id",
    )
    connector_definition: Mapped["ConnectorDefinition"] = relationship(
        back_populates="connector_instances"
    )
    # Note: Connectors connect to pipelines via pipeline_sources and pipeline_destinations tables
    pipeline_sources: Mapped[list["PipelineSource"]] = relationship(back_populates="connector_instance")
    pipeline_destinations: Mapped[list["PipelineDestination"]] = relationship(back_populates="connector_instance")

    __table_args__ = (
        Index("ix_connector_instances_org_status", "organization_id", "status"),
        Index(
            "ix_connector_instances_org_definition",
            "organization_id",
            "connector_definition_id",
        ),
        CheckConstraint(
            "status IN ('active', 'disabled')",
            name="check_connector_instance_status",
        ),
        {"schema": "flow"},
    )


class Pipeline(Base):
    """
    Pipeline defining data flow from source connector.

    Two types of pipelines:
    - Data warehouse pipelines (no destinations): source -> canonical store
    - Integration pipelines (with destinations): source -> canonical store -> target

    Pipelines with destinations are integrations; pipelines without are data warehouse ingestion.

    Pipeline names are derived from their connector instances and not stored in the database.

    Multi-source/destination model: Pipelines use pipeline_sources and pipeline_destinations tables.
    """

    __tablename__ = "pipelines"

    pipeline_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flow.datasets.dataset_id", ondelete="CASCADE"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Delete detection configuration
    delete_detection_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    delete_detection_method: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )  # 'full_sync', 'incremental', or None

    # Profile configuration for data validation
    target_profile: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # Profile name (e.g., 'collections', 'media')
    profile_validation_mode: Mapped[str | None] = mapped_column(
        String(20), nullable=True, default="warn"
    )  # 'strict' (reject invalid), 'warn' (log warnings), 'none' (skip validation)

    # Relationships
    organization: Mapped["Organization"] = relationship(
        back_populates="pipelines",
        primaryjoin="Pipeline.organization_id == Organization.organization_id",
    )
    dataset: Mapped["Dataset | None"] = relationship(
        foreign_keys=[dataset_id],
    )
    schedule: Mapped["Schedule | None"] = relationship(back_populates="pipeline", uselist=False)
    jobs: Mapped[list["Job"]] = relationship(back_populates="pipeline")
    runs: Mapped[list["Run"]] = relationship(back_populates="pipeline")

    # Multi-source/destination relationships
    sources: Mapped[list["PipelineSource"]] = relationship(
        back_populates="pipeline",
        cascade="all, delete-orphan",
        order_by="PipelineSource.ordering"
    )
    destinations: Mapped[list["PipelineDestination"]] = relationship(
        back_populates="pipeline",
        cascade="all, delete-orphan",
        order_by="PipelineDestination.ordering"
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'disabled')",
            name="check_integration_route_status",
        ),
        CheckConstraint(
            "delete_detection_method IS NULL OR delete_detection_method IN ('full_sync', 'incremental')",
            name="check_delete_detection_method",
        ),
        {"schema": "flow"},
    )

    @property
    def name(self) -> str:
        """
        Derive pipeline name from connector instances.

        Format:
        - With destination: "SourceName -> DatasetName -> DestinationName"
        - Without destination: "SourceName -> DatasetName"
        - Fallback: "Source -> Canonical Store"
        """
        source_name = "Source"
        if self.sources and self.sources[0].connector_instance:
            source_name = self.sources[0].connector_instance.name

        dataset_name = self.dataset.name if self.dataset else "Canonical Store"

        if self.destinations and self.destinations[0].connector_instance:
            target_name = self.destinations[0].connector_instance.name
            return f"{source_name} \u2192 {dataset_name} \u2192 {target_name}"
        else:
            return f"{source_name} \u2192 {dataset_name}"



class PipelineSource(Base):
    """
    Normalized source participant for a pipeline.

    Supports multiple sources per pipeline (fan-in), each with its own config.
    """

    __tablename__ = "pipeline_sources"

    source_id: Mapped[uuid.UUID] = uuid_pk()
    pipeline_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.pipelines.pipeline_id", ondelete="CASCADE"), nullable=False
    )
    connector_instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flow.connector_instances.connector_instance_id", ondelete="CASCADE"),
        nullable=False,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)
    ordering: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    pipeline: Mapped["Pipeline"] = relationship(back_populates="sources")
    connector_instance: Mapped["ConnectorInstance"] = relationship()

    __table_args__ = (
        Index("ix_pipeline_sources_pipeline_id", "pipeline_id"),
        Index("ix_pipeline_sources_connector_instance_id", "connector_instance_id"),
        {"schema": "flow"},
    )


class PipelineDestination(Base):
    """
    Normalized destination participant for a pipeline.

    Supports multiple destinations per pipeline (fan-out), each with its own config.
    """

    __tablename__ = "pipeline_destinations"

    destination_id: Mapped[uuid.UUID] = uuid_pk()
    pipeline_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.pipelines.pipeline_id", ondelete="CASCADE"), nullable=False
    )
    connector_instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flow.connector_instances.connector_instance_id", ondelete="CASCADE"),
        nullable=False,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)
    ordering: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Delete handling configuration
    publish_deletes: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    delete_strategy: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )  # 'remove', 'mark', 'archive', or None

    # Relationships
    pipeline: Mapped["Pipeline"] = relationship(back_populates="destinations")
    connector_instance: Mapped["ConnectorInstance"] = relationship()

    __table_args__ = (
        Index("ix_pipeline_destinations_pipeline_id", "pipeline_id"),
        Index("ix_pipeline_destinations_connector_instance_id", "connector_instance_id"),
        CheckConstraint(
            "delete_strategy IS NULL OR delete_strategy IN ('remove', 'mark', 'archive')",
            name="check_delete_strategy",
        ),
        {"schema": "flow"},
    )


class Dataset(Base):
    """
    Dataset abstraction replacing object-specific mental model.

    A dataset represents a collection of records from a source system
    (e.g., "Objects", "Donors", "Transactions"). Each run processes
    exactly one dataset, and all canonical records are tagged with
    the dataset they belong to.

    This enables multi-dataset syncs within a single organization without
    conflating different record types into a single "objects" bucket.
    """

    __tablename__ = "datasets"

    dataset_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)  # e.g. "Museum Collection", "Donors"
    key: Mapped[str] = mapped_column(String, nullable=False)  # e.g. "collection", "donors"
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[str | None] = mapped_column(String, nullable=True)  # e.g. "smithsonian", "salesforce"
    schema: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)  # inferred or user-defined
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        back_populates="datasets",
        primaryjoin="Dataset.organization_id == Organization.organization_id",
    )
    runs: Mapped[list["Run"]] = relationship(back_populates="dataset")
    transformers: Mapped[list["DatasetTransformer"]] = relationship(back_populates="dataset", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_datasets_org_key", "organization_id", "key", unique=True),
        {"schema": "flow"},
    )

    @property
    def role(self) -> str:
        """
        Dataset role label for semantic anchoring.

        Returns:
            'canonical' - Primary ingested datasets from source systems
            'derived' - (Future) Computed/transformed datasets

        All current datasets are canonical. This property provides future-ready
        labeling for when derived datasets are introduced.
        """
        # Future: Check for is_derived flag or derived_from_dataset_id relationship
        return "canonical"


# ============================================================================
# 3. Canonical Data Store (Current Copy, No Per-Run Duplication)
# ============================================================================


# ============================================================================
# MADRONA CANONICAL SCHEMA V1 — DESIGN PRINCIPLES
# ============================================================================
#
# INTERNAL DOCUMENTATION FOR CONTRIBUTORS
# This section describes the architectural design goals and constraints that
# guide the canonical schema implementation. These principles ensure system
# reliability, debuggability, and long-term maintainability.
#
# 1. STABLE DEVELOPER-FACING ENVELOPE
#    The canonical schema (EntityCurrent.payload) provides a stable, predictable
#    structure for all downstream consumers (UI, API, destinations).
#    - Isolates UI/API from source format changes
#    - Version-controlled transformations absorb upstream volatility
#    - Enables consistent querying and filtering across heterogeneous sources
#
# 2. LOSSLESS SOURCE PRESERVATION VIA SourceRecords
#    All original source payloads are preserved verbatim in EntityCurrent.sources
#    - sources: JSON map {connector_instance_id: {raw_payload, last_seen_at, ...}}
#    - Enables debugging, auditing, and schema evolution without data loss
#    - Allows retrospective re-mapping when canonical schema evolves
#    - Multi-source routes store all contributing sources in single entity
#
# 3. REPRODUCIBILITY VIA MAPPING + TRANSFORM VERSIONING
#    Every transformation is versioned and auditable:
#    - Transformer classes define source_format -> target_format mappings
#    - DatasetTransformer links datasets to specific transformer versions
#    - Historical transformations remain available for rollback/comparison
#    - Given same raw_payload + transformer version -> deterministic output
#
# 4. NO FIELD-LEVEL LINEAGE
#    Intentional design decision: we track entity-level changes, not field-level
#    - ChangeEvent records: entity created/updated/deleted
#    - FieldDiff captures: old_value -> new_value at field level
#    - BUT: we do NOT track "this field came from connector X, column Y"
#    - Rationale: Simplifies implementation, reduces storage, most use cases
#      care about "what changed" not "where did this field originate"
#
# 5. DEBUGGABILITY VIA MAPPINGREPORT (FUTURE)
#    When transformations fail or produce unexpected results:
#    - MappingReport will capture: warnings, field-level errors, data quality issues
#    - Currently: errors logged to Run.error_message
#    - Future: Structured mapping reports linked to entities or runs
#    - Enables users to understand why data didn't map as expected
#
# 6. EXTENSIONS FOR DOMAIN/SOURCE-SPECIFIC DATA
#    The canonical schema is intentionally minimal:
#    - Core fields: title, entity_type, canonical_url, etc.
#    - Domain-specific extensions stored in payload.extensions {}
#    - Example: museum-specific fields (accession_number, classification)
#    - Source-specific metadata can live in sources[connector_id].metadata
#    - Allows schema to grow without breaking existing consumers
#
# IMPLEMENTATION NOTES:
# - EntityCurrent is the single source of truth for current entity state
# - EntityField provides lightweight projections for fast filtering/sorting
# - Multi-source merge: last-write-wins based on route.sources ordering
# - Entity uniqueness: (organization_id, entity_key) composite primary key
# - Entity key format: "{source_system}:{connector_instance_id}:{source_id}"
#
# RELATED DOCUMENTATION:
# - Madrona_DB_Schema_v1_1.docx: Full schema specification
# - docs/CONNECTOR_ARCHITECTURE.md: How connectors populate canonical store
# - app/services/canonical_store.py: Core ingestion and merge logic
# - app/transformers/: Format transformation implementations
#
# ============================================================================


class EntityCurrent(Base):
    """
    Canonical current-state record per entity.

    Single system of record for what gets displayed in UI and published to targets.
    No per-run duplication - only current state is maintained.

    Multi-source support (Phase 3):
    - sources: JSON map {connector_instance_id: {raw_payload, last_seen_at, ...}}
    - payload: Merged canonical record (last-write-wins by source ordering)
    - entity_key: Namespaced format {source_system}:{connector_instance_id}:{source_id}
    """

    __tablename__ = "entity_current"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.organization_id", ondelete="CASCADE"), primary_key=True, nullable=False
    )
    entity_key: Mapped[str] = mapped_column(String, primary_key=True, nullable=False)
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.datasets.dataset_id", ondelete="CASCADE"), nullable=True
    )
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, server_default="record")
    source_system: Mapped[str] = mapped_column(String, nullable=False)
    source_id: Mapped[str] = mapped_column(String, nullable=False)
    canonical_url: Mapped[str | None] = mapped_column(String, nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String, nullable=False)
    sources: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict, server_default=text("'{}'"))
    extracted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)  # Updated even on noop
    last_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.runs.run_id", ondelete="SET NULL"), nullable=True
    )  # Which run last processed this entity
    updated_at: Mapped[datetime] = timestamp_updated()

    # Soft delete tracking
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.runs.run_id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        Index(
            "ix_entity_current_org_source",
            "organization_id",
            "source_system",
            "source_id",
            unique=True,
        ),
        Index(
            "ix_entity_current_org_last_seen",
            "organization_id",
            "last_seen_at",
        ),
        Index(
            "ix_entity_current_org_type_seen",
            "organization_id",
            "entity_type",
            text("last_seen_at DESC"),
        ),
        Index(
            "ix_entity_current_last_run_id",
            "last_run_id",
        ),
        Index(
            "ix_entity_current_org_dataset_deleted",
            "organization_id",
            "dataset_id",
            "is_deleted",
        ),
        {"schema": "flow"},
    )


class EntityField(Base):
    """
    Lightweight projections for fast filtering/sorting without parsing JSONB.

    Extracted from entity_current.payload for UI and Sheets mapping.
    """

    __tablename__ = "entity_fields"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.organization_id", ondelete="CASCADE"), primary_key=True, nullable=False
    )
    entity_key: Mapped[str] = mapped_column(String, primary_key=True, nullable=False)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, server_default="record")
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    object_number: Mapped[str | None] = mapped_column(String, nullable=True)
    modified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String, nullable=True)
    last_run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    updated_at: Mapped[datetime] = timestamp_updated()

    __table_args__ = (
        Index(
            "ix_entity_fields_org_type_title",
            "organization_id",
            "entity_type",
            "title",
        ),
        ForeignKeyConstraint(
            ["organization_id", "entity_key"],
            ["flow.entity_current.organization_id", "flow.entity_current.entity_key"],
            ondelete="CASCADE",
        ),
        {"schema": "flow"},
    )


class EntityRelationship(Base):
    """
    Cross-entity relationship linking two entities within or across datasets.

    Relationships connect entities without duplicating data. Each relationship
    has a type (e.g., 'hasMedia', 'inExhibition') and direction (source -> target).

    Creation sources:
    - 'manual': User-created through UI
    - 'migration': Created during Flow migration with configured linking rules
    - 'rule': Created by automated relationship definition rules (future)

    Examples:
    - Object "smithsonian:conn1:obj_123" hasMedia Media "smithsonian:conn2:med_456"
    - Object "obj_789" inExhibition Exhibition "exh_001"

    Bidirectional access:
    - Query by source_entity_key to get "outgoing" relationships
    - Query by target_entity_key to get "incoming" relationships
    - Use relationship_type to filter (e.g., all 'hasMedia' relationships)
    """

    __tablename__ = "entity_relationships"

    relationship_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Source entity (the "from" side of the relationship)
    source_entity_key: Mapped[str] = mapped_column(String, nullable=False)
    source_dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.datasets.dataset_id", ondelete="CASCADE"), nullable=True
    )

    # Target entity (the "to" side of the relationship)
    target_entity_key: Mapped[str] = mapped_column(String, nullable=False)
    target_dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.datasets.dataset_id", ondelete="CASCADE"), nullable=True
    )

    # Relationship type (e.g., 'hasMedia', 'inExhibition', 'hasDonor')
    relationship_type: Mapped[str] = mapped_column(String(100), nullable=False)

    # How was this relationship created?
    created_by_source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="manual",
        comment="Creation source: manual (UI), migration (Flow), rule (automated)"
    )

    # Confidence score for rule-based matches (0.0-1.0, null for manual)
    confidence: Mapped[float | None] = mapped_column(nullable=True)

    # Additional context (e.g., matched_on field, migration_job_id)
    extra_data: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)

    # Reference to the definition that created this relationship (if rule-based)
    definition_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flow.relationship_definitions.definition_id", ondelete="SET NULL"),
        nullable=True
    )

    # Audit
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship()
    source_dataset: Mapped["Dataset | None"] = relationship(foreign_keys=[source_dataset_id])
    target_dataset: Mapped["Dataset | None"] = relationship(foreign_keys=[target_dataset_id])
    definition: Mapped["RelationshipDefinition | None"] = relationship(foreign_keys=[definition_id])
    created_by_user: Mapped["User | None"] = relationship()

    __table_args__ = (
        # Prevent duplicate relationships (same source, target, and type)
        Index(
            "ix_entity_relationships_unique",
            "organization_id", "source_entity_key", "target_entity_key", "relationship_type",
            unique=True
        ),
        # Query by definition (for tracking which definition created relationships)
        Index("ix_entity_relationships_definition", "definition_id"),
        # Query by source entity (outgoing relationships)
        Index("ix_entity_relationships_source", "organization_id", "source_entity_key"),
        # Query by target entity (incoming relationships)
        Index("ix_entity_relationships_target", "organization_id", "target_entity_key"),
        # Query by relationship type within org
        Index("ix_entity_relationships_type", "organization_id", "relationship_type"),
        # Query by dataset (for dataset-level relationship views)
        Index("ix_entity_relationships_source_dataset", "source_dataset_id"),
        Index("ix_entity_relationships_target_dataset", "target_dataset_id"),
        # Query by created_by_user_id (for audit trail)
        Index("ix_entity_relationships_created_by_user", "created_by_user_id"),
        # Cross-dataset queries (e.g., all relationships between two datasets)
        Index(
            "ix_entity_relationships_datasets",
            "organization_id", "source_dataset_id", "target_dataset_id"
        ),
        # Validate creation source
        CheckConstraint(
            "created_by_source IN ('manual', 'migration', 'rule', 'auto_link')",
            name="check_relationship_created_by_source",
        ),
        # Validate confidence range
        CheckConstraint(
            "confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)",
            name="check_relationship_confidence_range",
        ),
        {"schema": "flow"},
    )


class RelationshipDefinition(Base):
    """
    Admin-configured rule for automatically linking entities based on field matching.

    Defines how entities from different datasets should be linked when their
    field values match. Used during pipeline ingestion and migration jobs.

    Example:
        Name: "Objects to Media"
        Source: objects dataset, field "payload.media_refs[*].id"
        Target: media dataset, field "payload.identifiers[scheme=source].value"
        Relationship type: "hasMedia"

    When enabled, the system will:
    1. Extract values from source entities using source_field_path
    2. Find target entities where target_field_path matches those values
    3. Create EntityRelationship records linking matched entities

    Field path syntax:
    - Simple: "payload.title"
    - Nested: "payload.identifiers.accession"
    - Array: "payload.media_refs[*].id" (all elements)
    - Filtered: "payload.identifiers[scheme=isbn].value"
    """

    __tablename__ = "relationship_definitions"

    definition_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Descriptive info
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # The relationship type to create (e.g., "hasMedia", "inExhibition")
    relationship_type: Mapped[str] = mapped_column(String(100), nullable=False)

    # Source side configuration
    source_dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.datasets.dataset_id", ondelete="CASCADE"), nullable=True
    )
    source_entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    source_field_path: Mapped[str] = mapped_column(String(500), nullable=False)

    # Target side configuration
    target_dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.datasets.dataset_id", ondelete="CASCADE"), nullable=True
    )
    target_entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    target_field_path: Mapped[str] = mapped_column(String(500), nullable=False)

    # Matching configuration
    match_transform: Mapped[str] = mapped_column(
        String(30), nullable=False, default="exact",
        comment="Value transform before matching: exact, lowercase, trim, normalize_whitespace"
    )
    case_sensitive: Mapped[bool] = mapped_column(Boolean, default=True)

    # Behavior configuration
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_link_on_ingest: Mapped[bool] = mapped_column(
        Boolean, default=False,
        comment="Automatically evaluate this definition when entities are ingested"
    )
    bidirectional: Mapped[bool] = mapped_column(
        Boolean, default=False,
        comment="Also create inverse relationships (target->source)"
    )
    inverse_relationship_type: Mapped[str | None] = mapped_column(
        String(100), nullable=True,
        comment="Relationship type for inverse direction (if bidirectional)"
    )

    # Audit
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship()
    source_dataset: Mapped["Dataset | None"] = relationship(foreign_keys=[source_dataset_id])
    target_dataset: Mapped["Dataset | None"] = relationship(foreign_keys=[target_dataset_id])
    created_by_user: Mapped["User | None"] = relationship()

    __table_args__ = (
        # Unique definition per org/type/source/target combination
        Index(
            "ix_relationship_definitions_unique",
            "organization_id", "relationship_type",
            "source_dataset_id", "target_dataset_id",
            unique=True,
        ),
        # Query by organization
        Index("ix_relationship_definitions_org", "organization_id"),
        # Query by source dataset
        Index("ix_relationship_definitions_source_dataset", "source_dataset_id"),
        # Query by target dataset
        Index("ix_relationship_definitions_target_dataset", "target_dataset_id"),
        # Query enabled definitions
        Index(
            "ix_relationship_definitions_enabled",
            "organization_id", "enabled",
        ),
        # Validate match_transform
        CheckConstraint(
            "match_transform IN ('exact', 'lowercase', 'trim', 'normalize_whitespace', 'normalize_id')",
            name="check_definition_match_transform",
        ),
        {"schema": "flow"},
    )


# ============================================================================
# 4. Runs & Job Queue
# ============================================================================


class Schedule(Base):
    """
    Scheduled execution configuration for pipelines.

    MVP: Interval-based scheduling only (every N minutes/hours/days).
    MVP: One schedule per pipeline (enforced by unique constraint).

    Future enhancements could add:
    - Cron expressions for complex schedules
    - Multiple schedules per pipeline
    - Day-of-week/month restrictions
    - Blackout windows

    Architecture:
    - Schedule defines WHEN to run
    - Scheduler service creates Job records at scheduled times
    - Jobs create Run records when executed

    Flow: Schedule -> Job -> Run

    Example:
        Schedule: pipeline_id=X, every_n=6, unit='hours', enabled=True
        -> Job created at 00:00, 06:00, 12:00, 18:00 daily
        -> Each job creates a Run when executed
    """

    __tablename__ = "schedules"

    schedule_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    pipeline_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.pipelines.pipeline_id", ondelete="CASCADE"), nullable=False
    )

    # Enabled/disabled toggle (soft delete pattern)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Schedule configuration
    # Supports 'interval' (every N units) or 'time' (daily at specific time)
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="interval")

    # For interval schedules
    every_n: Mapped[int | None] = mapped_column(Integer, nullable=True)  # >=1, validated by check constraint
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)  # 'minutes' | 'hours' | 'days'

    # For time-based schedules (runs daily at specific time)
    time_hour: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0-23
    time_minute: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0-59

    # Timezone for schedule calculation (e.g., "America/New_York", "UTC")
    # Used to determine when "daily at 9am" occurs
    timezone: Mapped[str] = mapped_column(String(50), nullable=False, default="UTC")

    # Audit fields
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        back_populates="schedules",
        primaryjoin="Schedule.organization_id == Organization.organization_id",
    )
    pipeline: Mapped["Pipeline"] = relationship(back_populates="schedule")
    jobs: Mapped[list["Job"]] = relationship(back_populates="schedule", cascade="all, delete-orphan")
    created_by: Mapped["User | None"] = relationship(foreign_keys=[created_by_user_id])
    updated_by: Mapped["User | None"] = relationship(foreign_keys=[updated_by_user_id])

    __table_args__ = (
        # MVP: One schedule per pipeline
        Index("uq_schedule_org_pipeline", "organization_id", "pipeline_id", unique=True),
        # Query patterns
        Index("ix_schedules_org_enabled", "organization_id", "enabled"),
        Index("ix_schedules_pipeline", "pipeline_id"),
        # Validation
        CheckConstraint("type IN ('interval', 'time')", name="check_schedule_type"),
        CheckConstraint("unit IN ('minutes', 'hours', 'days') OR unit IS NULL", name="check_schedule_unit"),
        CheckConstraint("every_n >= 1 OR every_n IS NULL", name="check_schedule_every_n"),
        CheckConstraint("time_hour >= 0 AND time_hour <= 23 OR time_hour IS NULL", name="check_schedule_time_hour"),
        CheckConstraint("time_minute >= 0 AND time_minute <= 59 OR time_minute IS NULL", name="check_schedule_time_minute"),
        # Ensure proper fields are set based on type
        CheckConstraint("(type = 'interval' AND every_n IS NOT NULL AND unit IS NOT NULL) OR (type = 'time' AND time_hour IS NOT NULL AND time_minute IS NOT NULL)", name="check_schedule_fields"),
        {"schema": "flow"},
    )


class Job(Base):
    """
    Job execution tracking for scheduled and ad-hoc runs.

    Updated for scheduling support:
    - Links to Schedule (if scheduled execution)
    - Links to Run (once created)
    - Tracks scheduled_for time
    - Tracks execution lifecycle (started_at, finished_at, error)

    Status flow:
        queued -> running -> succeeded
                           \\-> failed
                           \\-> canceled

    Job lifecycle:
        1. Scheduler creates Job with status='queued', scheduled_for=<time>
        2. Worker picks up Job, sets status='running', started_at=now
        3. Worker creates Run, executes pipeline
        4. Worker updates Job: status='succeeded'/'failed', finished_at=now, run_id=<run>

    De-duplication:
        Unique constraint on (schedule_id, scheduled_for) prevents duplicate jobs
        for the same schedule at the same time.
    """

    __tablename__ = "jobs"

    job_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    pipeline_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.pipelines.pipeline_id", ondelete="SET NULL"), nullable=True
    )
    connector_instance_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.connector_instances.connector_instance_id", ondelete="SET NULL"), nullable=True
    )

    # Link to schedule (if this is a scheduled job)
    schedule_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.schedules.schedule_id", ondelete="SET NULL"), nullable=True
    )

    # When this job should be executed (for scheduled jobs)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    job_type: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    run_at: Mapped[datetime] = timestamp_now()
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_by: Mapped[str | None] = mapped_column(String, nullable=True)

    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)

    payload: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)

    # Execution tracking
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Link to created run
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.runs.run_id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    organization: Mapped["Organization"] = relationship(
        back_populates="jobs",
        primaryjoin="Job.organization_id == Organization.organization_id",
    )
    pipeline: Mapped["Pipeline | None"] = relationship(back_populates="jobs")
    schedule: Mapped["Schedule | None"] = relationship(back_populates="jobs")
    run: Mapped["Run | None"] = relationship(foreign_keys=[run_id], post_update=True)

    __table_args__ = (
        # Original indexes
        Index("ix_jobs_status_run_at", "status", "run_at"),
        Index("ix_jobs_org_status_run_at", "organization_id", "status", "run_at"),
        Index("ix_jobs_pipeline_status_run_at", "pipeline_id", "status", "run_at"),
        # Scheduled job query patterns
        Index("ix_jobs_org_status_scheduled", "organization_id", "status", "scheduled_for"),
        Index("ix_jobs_schedule_scheduled", "schedule_id", "scheduled_for"),
        # De-duplication for scheduled jobs
        Index("ix_jobs_schedule_time_dedup", "schedule_id", "scheduled_for", unique=True,
              postgresql_where=text("schedule_id IS NOT NULL AND scheduled_for IS NOT NULL")),
        # Validation
        CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')",
            name="check_job_status",
        ),
        {"schema": "flow"},
    )


class Run(Base):
    """
    Customer-visible execution run record.

    Tracks pipeline execution with metrics and status for UI display.
    """

    __tablename__ = "runs"

    run_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    pipeline_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.pipelines.pipeline_id", ondelete="SET NULL"), nullable=True
    )
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.datasets.dataset_id", ondelete="SET NULL"), nullable=True
    )
    source_connector_instance_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.connector_instances.connector_instance_id", ondelete="SET NULL"), nullable=True
    )
    target_connector_instance_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.connector_instances.connector_instance_id", ondelete="SET NULL"), nullable=True
    )
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.jobs.job_id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # When external publish completed
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    triggered_by: Mapped[str] = mapped_column(String, nullable=False, default="scheduled")
    parameters: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    processed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = timestamp_now()

    # Error persistence
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_stage: Mapped[str | None] = mapped_column(String(50), nullable=True)
    error_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Rollback fields
    rolled_back_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rolled_back_by_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.runs.run_id", ondelete="SET NULL"), nullable=True
    )
    rollback_of_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.runs.run_id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        back_populates="runs",
        primaryjoin="Run.organization_id == Organization.organization_id",
    )
    pipeline: Mapped["Pipeline | None"] = relationship(back_populates="runs")
    dataset: Mapped["Dataset | None"] = relationship(back_populates="runs")
    job: Mapped["Job | None"] = relationship(foreign_keys=[job_id])
    change_events: Mapped[list["ChangeEvent"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    source_steps: Mapped[list["RunSourceStep"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    destination_steps: Mapped[list["RunDestinationStep"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    # Self-referential relationships for rollback tracking
    rollback_run: Mapped["Run | None"] = relationship(
        "Run",
        foreign_keys=[rolled_back_by_run_id],
        remote_side="Run.run_id",
        uselist=False,
    )
    original_run: Mapped["Run | None"] = relationship(
        "Run",
        foreign_keys=[rollback_of_run_id],
        remote_side="Run.run_id",
        uselist=False,
    )

    __table_args__ = (
        Index("ix_runs_org_started_at", "organization_id", "started_at"),
        Index("ix_runs_org_pipeline_started_at", "organization_id", "pipeline_id", "started_at"),
        Index("ix_runs_org_status", "organization_id", "status"),
        CheckConstraint(
            "status IN ('queued', 'pending', 'running', 'publishing', 'success', 'warning', 'failed', 'failed_publish', 'failed_finalize', 'canceled', 'rolled_back')",
            name="check_run_status",
        ),
        {"schema": "flow"},
    )


class RunSourceStep(Base):
    """
    Per-source execution tracking within a run.

    Tracks status, counts, and errors for each source
    within a run. Created automatically when run is created.
    """

    __tablename__ = "run_source_steps"

    step_id: Mapped[uuid.UUID] = uuid_pk()
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flow.runs.run_id", ondelete="CASCADE"),
        nullable=False,
    )
    pipeline_source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flow.pipeline_sources.source_id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    counts: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    run: Mapped["Run"] = relationship(back_populates="source_steps")
    pipeline_source: Mapped["PipelineSource"] = relationship()

    __table_args__ = (
        Index("ix_run_source_steps_run_id", "run_id"),
        Index("ix_run_source_steps_pipeline_source_id", "pipeline_source_id"),
        CheckConstraint(
            "status IN ('pending', 'running', 'success', 'failed', 'skipped')",
            name="check_run_source_step_status",
        ),
        {"schema": "flow"},
    )


class RunDestinationStep(Base):
    """
    Per-destination execution tracking within a run.

    Tracks status, counts, and errors for each destination
    within a run. Created automatically when run is created.
    """

    __tablename__ = "run_destination_steps"

    step_id: Mapped[uuid.UUID] = uuid_pk()
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flow.runs.run_id", ondelete="CASCADE"),
        nullable=False,
    )
    pipeline_destination_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flow.pipeline_destinations.destination_id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    counts: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    run: Mapped["Run"] = relationship(back_populates="destination_steps")
    pipeline_destination: Mapped["PipelineDestination"] = relationship()

    __table_args__ = (
        Index("ix_run_destination_steps_run_id", "run_id"),
        Index("ix_run_destination_steps_pipeline_destination_id", "pipeline_destination_id"),
        CheckConstraint(
            "status IN ('pending', 'running', 'success', 'failed', 'skipped')",
            name="check_run_destination_step_status",
        ),
        {"schema": "flow"},
    )


# ============================================================================
# 5. Change History (Append-Only)
# ============================================================================


class ChangeEvent(Base):
    """
    Append-only audit ledger of all detected changes.

    Drives UI Change History and Google Sheets Change_Log tab.
    Generated by comparing incoming records to entity_current.
    """

    __tablename__ = "change_events"

    change_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flow.runs.run_id", ondelete="CASCADE"),
        nullable=False,
    )
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.datasets.dataset_id", ondelete="SET NULL"), nullable=True
    )
    pipeline_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("flow.pipelines.pipeline_id", ondelete="SET NULL"), nullable=True
    )
    occurred_at: Mapped[datetime] = timestamp_now()
    entity_key: Mapped[str] = mapped_column(String, nullable=False)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, server_default="record")
    change_type: Mapped[str] = mapped_column(String, nullable=False)
    applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    changed_fields: Mapped[list[str] | None] = mapped_column(JSONType, nullable=True)
    old_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    new_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)

    # Relationships
    run: Mapped["Run"] = relationship(back_populates="change_events")
    field_diffs: Mapped[list["FieldDiff"]] = relationship(
        back_populates="change_event", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_change_events_org_occurred_at", "organization_id", "occurred_at"),
        Index(
            "ix_change_events_org_entity_occurred_at",
            "organization_id",
            "entity_key",
            "occurred_at",
        ),
        Index("ix_change_events_org_run", "organization_id", "run_id"),
        Index(
            "ix_change_events_org_run_change_type",
            "organization_id",
            "run_id",
            "change_type",
        ),
        CheckConstraint(
            "change_type IN ('created', 'updated', 'deleted', 'noop', 'skipped', 'error')",
            name="check_change_type",
        ),
        {"schema": "flow"},
    )


class FieldDiff(Base):
    """
    Field-level diffs for full historical visibility.

    Stores old/new values per field without duplicating full payloads.
    """

    __tablename__ = "field_diffs"

    diff_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    change_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flow.change_events.change_id", ondelete="CASCADE"),
        nullable=False,
    )
    field_name: Mapped[str] = mapped_column(String, nullable=False)
    old_value: Mapped[Any | None] = mapped_column(JSONType, nullable=True)
    new_value: Mapped[Any | None] = mapped_column(JSONType, nullable=True)
    array_delta: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Relationships
    change_event: Mapped["ChangeEvent"] = relationship(back_populates="field_diffs")

    __table_args__ = (
        Index("ix_field_diffs_org_change", "organization_id", "change_id"),
        {"schema": "flow"},
    )


class DatasetTransformer(Base):
    """
    AI-generated transformation code for converting dataset entities to standard formats.

    When a dataset is loaded, the system can analyze sample payloads and generate
    transformation code using AI (Claude API or Ollama). This allows automatic support
    for any source format without manual coding.

    Transformers go through a lifecycle:
    1. Generated as 'draft' - AI creates initial code from samples
    2. User reviews/edits code in UI
    3. User activates transformer - status becomes 'active'
    4. Export API uses active transformers to convert data
    """

    __tablename__ = "dataset_transformers"

    transformer_id: Mapped[uuid.UUID] = uuid_pk()
    dataset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flow.datasets.dataset_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    target_format: Mapped[str] = mapped_column(String(50), nullable=False)  # dublin-core, lido, schema-org, etc.
    transformer_code: Mapped[str] = mapped_column(Text, nullable=False)  # Python code for transform() function
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="draft")  # draft, active, archived
    ai_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)  # claude, ollama, manual
    sample_count: Mapped[int | None] = mapped_column(Integer, nullable=True)  # Number of samples used for generation
    generated_at: Mapped[datetime] = timestamp_now()
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    dataset: Mapped["Dataset"] = relationship(back_populates="transformers")
    organization: Mapped["Organization"] = relationship()
    creator: Mapped["User"] = relationship()

    __table_args__ = (
        Index("ix_transformers_dataset_format", "dataset_id", "target_format"),
        Index("ix_transformers_org_status", "organization_id", "status"),
        # Only one active transformer per dataset/format combination
        Index("ix_transformers_dataset_format_active", "dataset_id", "target_format", unique=True,
              postgresql_where=text("status = 'active'")),
        {"schema": "flow"},
    )


# ============================================================================
# Entity Audit
# ============================================================================


class EntityAuditEvent(Base):
    """
    Entity audit event for tracking field-level changes to Collections/Media entities.

    Records every create, update, or delete operation with full user attribution,
    request context, and a list of changed fields. Field-level diffs are stored
    in the related EntityAuditFieldDiff table.

    Used by platform admins to answer "what happened to this data?"
    """

    __tablename__ = "entity_audit_events"

    event_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Entity identification
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    entity_display_key: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Human-readable identifier (object_number, filename, etc.)",
    )

    # Change details
    change_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="created, updated, or deleted",
    )
    changed_at: Mapped[datetime] = timestamp_now()

    # User attribution (denormalized for deleted users)
    changed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    changed_by_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Request context
    request_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    request_method: Mapped[str | None] = mapped_column(String(10), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Summary of changes
    changed_fields: Mapped[list[str] | None] = mapped_column(
        ARRAY(String),
        nullable=True,
        comment="List of field names that changed",
    )
    summary: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Human-readable summary of the change",
    )

    # Relationships
    organization: Mapped["Organization"] = relationship()
    user: Mapped["User | None"] = relationship(foreign_keys=[changed_by])
    field_diffs: Mapped[list["EntityAuditFieldDiff"]] = relationship(
        back_populates="event",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_entity_audit_events_org_changed_at", "organization_id", "changed_at"),
        Index("idx_entity_audit_events_entity", "entity_type", "entity_id"),
        Index("idx_entity_audit_events_changed_by", "changed_by"),
        Index("idx_entity_audit_events_changed_at", "changed_at"),
        CheckConstraint(
            "change_type IN ('created', 'updated', 'deleted', 'link_added', 'link_removed', 'link_updated')",
            name="check_entity_audit_change_type",
        ),
    )


class EntityAuditFieldDiff(Base):
    """
    Individual field-level change record for entity audit events.

    Stores the old and new values for each field that changed.
    Values are stored as JSONB to handle any data type.
    """

    __tablename__ = "entity_audit_field_diffs"

    diff_id: Mapped[uuid.UUID] = uuid_pk()
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("entity_audit_events.event_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    field_name: Mapped[str] = mapped_column(String(255), nullable=False)
    old_value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(
        JSONType,
        nullable=True,
    )
    new_value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(
        JSONType,
        nullable=True,
    )

    # Relationships
    event: Mapped["EntityAuditEvent"] = relationship(back_populates="field_diffs")
    organization: Mapped["Organization"] = relationship()

    __table_args__ = (
        Index("idx_entity_audit_field_diffs_event_id", "event_id"),
        Index("idx_entity_audit_field_diffs_org", "organization_id"),
    )


# ============================================================================
# Record-Bound Discussions
# ============================================================================


# Valid entity types for discussions - changes require architectural review
DISCUSSION_ENTITY_TYPES = (
    'collection_object',
    'acquisition',
    'loan_in',
    'loan_out',
    'exhibition',
    'event',
    'media',
    'media_rights',
    'constituent',
    'object_entry',
    'object_exit',
)


class RecordComment(Base):
    """
    Record-bound discussion comment.

    This is NOT chat. Comments are:
    - Append-only (no edits after save)
    - Permanently attached to records
    - Auditable and exportable
    - Deleted only when parent record is deleted (CASCADE)

    Part of institutional memory for compliance, provenance, and decision tracking.
    """

    __tablename__ = "record_comments"

    comment_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    entity_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="Record type: collection_object, acquisition, loan_in, loan_out, exhibition, media, media_rights",
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        comment="UUID of the parent record",
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="user",
        comment="Comment kind: user (staff comment) or system (auto-generated)",
    )
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    organization: Mapped["Organization"] = relationship()
    author: Mapped["User"] = relationship()

    __table_args__ = (
        Index("ix_record_comments_entity", "organization_id", "entity_type", "entity_id", "created_at"),
        Index("ix_record_comments_author", "author_id"),
        CheckConstraint("length(content) > 0", name="check_comment_content_not_empty"),
        CheckConstraint(
            "entity_type IN ('collection_object', 'acquisition', 'loan_in', 'loan_out', "
            "'exhibition', 'media', 'media_rights')",
            name="check_comment_entity_type",
        ),
        CheckConstraint("kind IN ('user', 'system')", name="check_comment_kind"),
    )


class RecordWatch(Base):
    """
    Record watch for optional notifications.

    Users can watch records to receive passive notifications when new
    discussion comments are added. No real-time alerts.
    """

    __tablename__ = "record_watches"

    watch_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    )
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    organization: Mapped["Organization"] = relationship()
    user: Mapped["User"] = relationship()

    __table_args__ = (
        Index("ix_record_watches_entity", "organization_id", "entity_type", "entity_id"),
        Index("ix_record_watches_user", "user_id"),
        UniqueConstraint("user_id", "entity_type", "entity_id", name="uq_record_watch_user_entity"),
        CheckConstraint(
            "entity_type IN ('collection_object', 'acquisition', 'loan_in', 'loan_out', "
            "'exhibition', 'media', 'media_rights')",
            name="check_watch_entity_type",
        ),
    )


class Notification(Base):
    """
    In-app notifications for users.

    Notifications are created when events occur that users should know about,
    such as new comments on watched records.
    """

    __tablename__ = "notifications"

    notification_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Notification type: 'comment', 'mention', 'assignment', etc.
    notification_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Human-readable title and message
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Link to the related entity
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Who triggered this notification (e.g., commenter)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Read status
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    organization: Mapped["Organization"] = relationship()
    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    actor: Mapped["User"] = relationship(foreign_keys=[actor_id])

    __table_args__ = (
        Index("ix_notifications_user_unread", "user_id", "is_read"),
        Index("ix_notifications_user_created", "user_id", "created_at"),
    )


# Event listeners for model validation

@event.listens_for(ConnectorDefinition, "before_insert")
@event.listens_for(ConnectorDefinition, "before_update")
def validate_connector_definition_implementation_key(mapper, connection, target):
    """
    Validate ConnectorDefinition.implementation_key before database insert/update.

    Enforces Prompt 7 security policy: reject inline code, require module import paths.
    Raises ValueError with clear message if validation fails.
    """
    target.validate_implementation_key()
