"""
Pydantic request/response models for organization admin endpoints.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


# =============================================================================
# Organization
# =============================================================================


class CreateOrganizationBody(BaseModel):
    name: str
    slug: str
    timezone: str = "UTC"


class UpdateOrganizationBody(BaseModel):
    name: str | None = None
    timezone: str | None = None


# =============================================================================
# Org Users
# =============================================================================


class CreateUserBody(BaseModel):
    email: str
    name: str | None = None
    role_id: UUID


class UpdateUserBody(BaseModel):
    action: str | None = None
    role_id: UUID | None = None


class SetAppRoleBody(BaseModel):
    role_id: UUID


class RoleLabelBody(BaseModel):
    label: str = Field(..., max_length=100)
    app_key: str | None = Field(None, max_length=30)


# =============================================================================
# Invitations
# =============================================================================


class InviteUserBody(BaseModel):
    email: str
    role: str = "member"


class AcceptInvitationBody(BaseModel):
    token: str


# =============================================================================
# API Keys
# =============================================================================


class CreateAPIKeyBody(BaseModel):
    name: str
    scopes: list[str]
    expires_in_days: int | None = None


# =============================================================================
# Response Models
# =============================================================================


class RoleOut(BaseModel):
    role_id: str
    role_key: str
    display_name: str
    description: str | None = None


class RolesResponse(BaseModel):
    roles: list[RoleOut]


class RoleLabelOut(BaseModel):
    role_key: str
    display_name: str
    default_name: str
    is_custom: bool


class RoleLabelsResponse(BaseModel):
    role_labels: list[RoleLabelOut]


class AppRoleOut(BaseModel):
    role_id: str
    role_key: str
    role_display_name: str


class OrgUserOut(BaseModel):
    membership_id: str
    user_id: str
    email: str
    name: str | None = None
    role_id: str
    role_key: str
    role_display_name: str
    status: str
    user_status: str
    created_at: str
    app_roles: dict[str, AppRoleOut] | None = None


class OrgUsersResponse(BaseModel):
    organization_id: str
    users: list[OrgUserOut]
    total: int


# =============================================================================
# Additional Response Models
# =============================================================================


class OrganizationOut(BaseModel):
    organization_id: str
    name: str
    slug: str
    timezone: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    message: str | None = None


class TimezoneItem(BaseModel):
    label: str | None = None
    value: str | None = None
    offset: str | None = None


class TimezonesResponse(BaseModel):
    timezones: list[Any]


class StorageUsageDetail(BaseModel):
    used_bytes: int = 0
    used_gb: float = 0
    limit_bytes: int = 0
    limit_gb: int = 0
    remaining_bytes: int = 0
    remaining_gb: float = 0
    usage_percent: float = 0
    media_bytes: int = 0
    db_bytes: int = 0
    search_bytes: int = 0
    metered_at: str | None = None


class OrganizationStorageResponse(BaseModel):
    usage: StorageUsageDetail
    region: str = "us-west-2"


class RegionOut(BaseModel):
    code: str
    name: str
    default: bool = False


class StorageRegionsResponse(BaseModel):
    regions: list[RegionOut]


class RoleLabelSetResponse(BaseModel):
    status: str
    role_key: str
    display_name: str
    is_custom: bool


class RoleLabelResetResponse(BaseModel):
    status: str
    role_key: str
    display_name: str
    is_custom: bool
    was_custom: bool


class UserCreatedOut(BaseModel):
    user_id: str
    email: str
    name: str | None = None
    status: str
    created: bool | None = None


class MembershipCreatedOut(BaseModel):
    membership_id: str
    organization_id: str
    role_id: str
    role_key: str
    status: str
    created_at: str
    created: bool | None = None


class CreateUserResponse(BaseModel):
    user: UserCreatedOut | None = None
    membership: MembershipCreatedOut | None = None
    invitation_sent: bool = False
    message: str | None = None


class UserUpdateResponse(BaseModel):
    message: str
    membership_id: str
    user_id: str
    organization_id: str
    old_role_id: str | None = None
    new_role_id: str | None = None
    new_role_key: str | None = None
    role_id: str | None = None
    status: str | None = None


class UserAppRolesResponse(BaseModel):
    user_id: str
    default_role_id: str
    default_role_key: str
    default_role_display_name: str
    app_roles: Any = None


class SetAppRoleResponse(BaseModel):
    status: str
    user_id: str
    app_key: str
    role_id: str
    role_key: str
    role_display_name: str


class RemoveAppRoleResponse(BaseModel):
    status: str
    user_id: str
    app_key: str
    deleted: bool


class InvitationOut(BaseModel):
    invitation_id: str
    organization_id: str
    email: str
    role: str
    expires_at: str
    created_at: str


class AcceptInvitationResponse(BaseModel):
    membership_id: str
    organization_id: str
    user_id: str
    role: str
    created_at: str


class APIKeyDataOut(BaseModel):
    api_key_id: str
    name: str
    scopes: list[str] = []
    key_prefix: str
    secret_api_key: str | None = None
    status: str
    expires_at: str | None = None
    created_at: str
    last_used_at: str | None = None


class CreateAPIKeyResponse(APIKeyDataOut):
    """Flat response envelope matching the list/revoke endpoints."""
    pass


class APIKeyListOut(BaseModel):
    api_key_id: str
    name: str
    scopes: list[Any] = []
    key_prefix: str
    status: str
    expires_at: str | None = None
    created_at: str
    last_used_at: str | None = None


class APIKeyListResponse(BaseModel):
    api_keys: list[APIKeyListOut]


class RevokeAPIKeyResponse(BaseModel):
    status: str
    message: str
