"""
Pydantic schemas for Platform Admin API.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field
from uuid import UUID


class UpdateOrganizationBody(BaseModel):
    name: str | None = None
    slug: str | None = None
    status: str | None = None
    is_demo: bool | None = None
    timezone: str | None = None


class EnableAppBody(BaseModel):
    application_key: str
    contract_start_date: str | None = None
    contract_end_date: str | None = None


class UpdateStorageBody(BaseModel):
    storage_limit_gb: int | None = None


class ProvisionOrganizationBody(BaseModel):
    organization: dict
    applications: list[dict] = []
    contract: dict | None = None
    admin: dict
    onboarding: dict | None = None
    # When true, runs the post-provisioning sandbox-seed steps (Met +
    # Smithsonian + Rijksmuseum collections, procedure records,
    # synthetic media). Marks organization.is_demo=True. The saga is
    # dispatched to Celery in this mode because seeding takes minutes.
    with_demo_data: bool = False


class BulkImportUsersBody(BaseModel):
    users: list[dict] = Field(..., min_length=1, max_length=500)
    send_invitations: bool = True


class SSOConfigBody(BaseModel):
    provider: str | None = None
    enabled: bool = False
    idp_entity_id: str | None = None
    idp_sso_url: str | None = None
    idp_certificate: str | None = None
    sp_entity_id: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    discovery_url: str | None = None
    auto_provision_users: bool | None = None
    default_app_roles: dict | None = None
    allowed_domains: list[str] | None = None


class SSOTestBody(BaseModel):
    idp_certificate: str | None = None
    idp_sso_url: str | None = None


class RolePermissionBody(BaseModel):
    role_id: str
    permission_id: str


# =============================================================================
# Response models
# =============================================================================


class ApplicationOut(BaseModel):
    application_id: str
    key: str
    display_name: str
    description: str | None = None
    icon: str | None = None
    default_enabled: bool | None = None
    requires_contract: bool | None = None
    sort_order: int | None = None
    status: str | None = None


class ApplicationsListResponse(BaseModel):
    applications: list[ApplicationOut]


class OrgStorageInfo(BaseModel):
    media_bytes: int = 0
    db_bytes: int = 0
    search_bytes: int = 0
    total_used_bytes: int = 0
    used_gb: float = 0
    limit_gb: int = 0
    usage_percent: float = 0
    metered_at: str | None = None


class OrgAppInfo(BaseModel):
    key: str
    display_name: str
    contract_start_date: str | None = None
    contract_end_date: str | None = None


class PlatformOrganizationOut(BaseModel):
    organization_id: str
    name: str
    slug: str
    created_at: str | None = None
    user_count: int = 0
    storage: OrgStorageInfo
    apps: list[OrgAppInfo] = []
    contract_end_date: str | None = None
    status: str = "active"


class PlatformOrganizationsResponse(BaseModel):
    organizations: list[PlatformOrganizationOut]


class UpdateOrganizationResponse(BaseModel):
    message: str
    organization_id: str
    name: str
    slug: str
    status: str | None = None
    is_demo: bool | None = None
    timezone: str | None = None


class OrgApplicationOut(BaseModel):
    application_id: str
    key: str
    display_name: str
    status: str | None = None
    enabled: bool = False
    enabled_at: str | None = None
    enabled_by: str | None = None
    contract_start_date: str | None = None
    contract_end_date: str | None = None


class OrgApplicationsResponse(BaseModel):
    organization_id: str
    organization_name: str
    applications: list[OrgApplicationOut]


class EnableAppResponse(BaseModel):
    message: str
    application_key: str
    enabled: bool


class DisableAppResponse(BaseModel):
    message: str
    application_key: str
    enabled: bool


class OrgStorageOut(BaseModel):
    organization_id: str
    name: str
    slug: str
    storage_limit_gb: int | None = None
    usage: Any = None
    region: str = "us-west-2"


class OrgStorageListResponse(BaseModel):
    organizations: list[OrgStorageOut]


class UpdateStorageResponse(BaseModel):
    message: str
    organization_id: str
    storage_limit_gb: int | None = None


class ProvisionSuccessResponse(BaseModel):
    message: str
    job_id: str
    organization_id: str | None = None
    organization_slug: str | None = None
    admin_user_id: str | None = None
    enabled_applications: list[str] = []
    welcome_email_sent: bool = False
    retry_count: int | None = None


class ProvisioningJobOut(BaseModel):
    job_id: str
    status: str
    organization_slug: str | None = None
    organization_id: str | None = None
    admin_email: str | None = None
    current_step: str | None = None
    error_step: str | None = None
    retry_count: int | None = None
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str | None = None


class ProvisioningJobListResponse(BaseModel):
    items: list[ProvisioningJobOut]
    total: int
    limit: int
    offset: int


class TimelineStepOut(BaseModel):
    step: str
    status: str
    started_at: str | None = None
    completed_at: str | None = None
    duration_ms: int | None = None
    error: str | None = None


class ProvisioningJobDetailResponse(BaseModel):
    job_id: str
    status: str
    organization_id: str | None = None
    organization_slug: str | None = None
    admin_user_id: str | None = None
    current_step: str | None = None
    error_message: str | None = None
    error_step: str | None = None
    retry_count: int | None = None
    max_retries: int | None = None
    steps: Any = None
    timeline: list[TimelineStepOut] = []
    event_log: list[Any] = []
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str | None = None


class ResendInviteResponse(BaseModel):
    # Pydantic strict-filters fields; this schema must include every field
    # the service returns so clients see them. Keep optional: different
    # code paths in provisioning_service.resend_invite populate different
    # subsets (already_active path, dedupe_skipped path, success path).
    message: str
    job_id: str
    already_active: bool | None = None
    dedupe_skipped: bool | None = None
    email_sent: bool | None = None
    token_rotated: bool | None = None
    new_expiry: str | None = None
    admin_email: str | None = None
    organization_id: str | None = None
    admin_user_id: str | None = None
    email: str | None = None
    invitation_id: str | None = None
    sent_at: str | None = None
    reused_token: bool | None = None
    expires_at: str | None = None
    cognito_created: bool | None = None
    last_sent_at: str | None = None


class ReconcileResponse(BaseModel):
    # Service returns cognito_user, actions, etc. — surface them.
    message: str
    job_id: str
    cognito_created: bool | None = None
    invitation_created: bool | None = None
    membership_created: bool | None = None
    cognito_user: str | None = None
    invitation: str | None = None
    actions: list[str] | None = None
    admin_user_id: str | None = None
    email: str | None = None
    organization_id: str | None = None


class BulkImportResultCounts(BaseModel):
    created: int = 0
    skipped: int = 0
    errors: int = 0


class BulkImportResponse(BaseModel):
    message: str
    organization_id: str
    results: BulkImportResultCounts
    users: list[Any] = []


class ProvisioningLogOut(BaseModel):
    id: str
    action: str
    performed_by: str | None = None
    performer_name: str | None = None
    performer_email: str | None = None
    organization_id: str | None = None
    organization_name: str | None = None
    organization_slug: str | None = None
    details: Any = None
    ip_address: str | None = None
    user_agent: str | None = None
    created_at: str | None = None


class ProvisioningLogPage(BaseModel):
    limit: int
    offset: int
    has_more: bool


class ProvisioningLogsResponse(BaseModel):
    items: list[ProvisioningLogOut]
    total: int
    page: ProvisioningLogPage


class DayCount(BaseModel):
    date: str
    count: int


class ProvisioningStatsResponse(BaseModel):
    total_events: int
    events_today: int
    events_this_week: int
    by_action: dict[str, int] = {}
    by_day: list[DayCount] = []


class SSOConfigOut(BaseModel):
    id: str
    provider: str | None = None
    enabled: bool = False
    idp_entity_id: str | None = None
    idp_sso_url: str | None = None
    idp_certificate: str | None = None
    sp_entity_id: str | None = None
    client_id: str | None = None
    discovery_url: str | None = None
    auto_provision_users: bool | None = None
    default_app_roles: Any = None
    allowed_domains: list[str] | None = None
    created_at: str | None = None
    updated_at: str | None = None


class SPMetadata(BaseModel):
    entity_id: str
    acs_url: str


class AvailableRoleOut(BaseModel):
    role_id: str
    role_key: str
    display_name: str


class EnabledAppOut(BaseModel):
    app_key: str
    display_name: str


class SSOConfigResponse(BaseModel):
    organization_id: str
    organization_name: str
    sso_config: SSOConfigOut | None = None
    sp_metadata: SPMetadata
    available_roles: list[AvailableRoleOut] = []
    enabled_apps: list[EnabledAppOut] = []


class SSOUpdateResponse(BaseModel):
    message: str
    sso_config: Any = None


class SSOTestDetails(BaseModel):
    certificate_valid: bool = False
    certificate_expires: str | None = None
    certificate_error: str | None = None
    idp_reachable: bool | None = None


class SSOTestResponse(BaseModel):
    success: bool
    message: str
    details: SSOTestDetails


class EntityAuditEventOut(BaseModel):
    event_id: str
    organization_id: str
    entity_type: str
    entity_id: str
    entity_display_key: str | None = None
    change_type: str | None = None
    changed_at: str | None = None
    changed_by: str | None = None
    changed_by_name: str | None = None
    changed_by_email: str | None = None
    changed_fields: Any = None
    summary: str | None = None


class EntityAuditEventsResponse(BaseModel):
    items: list[EntityAuditEventOut]
    total: int
    limit: int
    offset: int


class FieldDiffOut(BaseModel):
    diff_id: str
    field_name: str
    old_value: Any = None
    new_value: Any = None


class EntityAuditEventDetailOut(BaseModel):
    event_id: str
    organization_id: str
    entity_type: str
    entity_id: str
    entity_display_key: str | None = None
    change_type: str | None = None
    changed_at: str | None = None
    changed_by: str | None = None
    changed_by_name: str | None = None
    changed_by_email: str | None = None
    request_path: str | None = None
    request_method: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    changed_fields: Any = None
    summary: str | None = None
    field_diffs: list[FieldDiffOut] = []


class EntityAuditEventDetailResponse(BaseModel):
    event: EntityAuditEventDetailOut


class EntityAuditHistoryEventOut(BaseModel):
    event_id: str
    organization_id: str
    entity_display_key: str | None = None
    change_type: str | None = None
    changed_at: str | None = None
    changed_by: str | None = None
    changed_by_name: str | None = None
    changed_by_email: str | None = None
    changed_fields: Any = None
    summary: str | None = None
    field_diffs: list[FieldDiffOut] | None = None


class EntityAuditHistoryResponse(BaseModel):
    entity_type: str
    entity_id: str
    items: list[EntityAuditHistoryEventOut]
    total: int
    limit: int
    offset: int


class OrgAuditCount(BaseModel):
    organization_id: str
    name: str
    count: int


class UserAuditCount(BaseModel):
    user_id: str | None = None
    name: str | None = None
    email: str | None = None
    count: int


class AuditStatsDetail(BaseModel):
    total_events: int
    by_entity_type: dict[str, int] = {}
    by_change_type: dict[str, int] = {}
    by_organization: list[OrgAuditCount] = []
    by_user: list[UserAuditCount] = []
    events_last_24h: int = 0
    events_last_7d: int = 0
    events_last_30d: int = 0


class EntityAuditStatsResponse(BaseModel):
    stats: AuditStatsDetail


class RLSCheckOut(BaseModel):
    check: str
    passed: bool
    expected: Any = None
    actual: Any = None
    error: str | None = None
    skipped: bool | None = None
    reason: str | None = None


class RLSCanaryResponse(BaseModel):
    status: str
    checks: list[RLSCheckOut] = []
    total: int = 0
    passed: int = 0
    failed: int = 0
    reason: str | None = None


class MessageResponse(BaseModel):
    message: str


class OkResponse(BaseModel):
    ok: bool = True


class PermissionEntryOut(BaseModel):
    permission_id: str
    permission_key: str
    display_name: str
    description: str = ""
    roles: list[str] = []


class PermissionScopeOut(BaseModel):
    scope: str
    permissions: list[PermissionEntryOut] = []


class RoleOut(BaseModel):
    role_id: str
    role_key: str
    display_name: str


class PermissionsMatrixResponse(BaseModel):
    roles: list[RoleOut] = []
    scopes: list[PermissionScopeOut] = []


