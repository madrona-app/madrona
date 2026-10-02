"""
Pydantic request/response models for auth endpoints.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


# =============================================================================
# Request models
# =============================================================================


class LoginRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=1)


class MFAVerifyRequest(BaseModel):
    email: str
    code: str = Field(..., min_length=6, max_length=6)
    session: str
    mfaType: str = "totp"


class MFAReverifyRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=6)


class PasswordResetRequestBody(BaseModel):
    email: str


class PasswordResetConfirmBody(BaseModel):
    token: str
    password: str = Field(..., min_length=8)


class MfaRecoveryRequestBody(BaseModel):
    """Start the self-service 'lost your authenticator' flow."""
    email: str


class MfaRecoveryConfirmBody(BaseModel):
    """Confirm MFA recovery: requires the emailed token AND the account
    password, so a reset needs email + password (not email alone)."""
    token: str
    password: str = Field(..., min_length=1)


class EmailVerificationConfirmBody(BaseModel):
    token: str


class EmailVerificationResendBody(BaseModel):
    email: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)


class ChangePasswordMFABody(BaseModel):
    session: str
    mfa_code: str
    current_password: str
    new_password: str = Field(..., min_length=8)


class ActivateAccountBody(BaseModel):
    token: str
    password: str = Field(..., min_length=8)


class MFASetupStartBody(BaseModel):
    email: str
    session: str


class MFASetupVerifyBody(BaseModel):
    email: str
    code: str = Field(..., min_length=6, max_length=6)
    session: str


class MFAEmailSetupVerifyBody(BaseModel):
    code: str = Field(..., min_length=6, max_length=6)


class MFAPreferenceBody(BaseModel):
    # Frontend-facing MFA type strings, matching MFAChallengeResponse.mfaType.
    preferred: str = Field(..., pattern=r"^(totp|sms|email)$")


class MFAFactorsOut(BaseModel):
    totp: bool = False
    sms: bool = False
    email: bool = False
    preferred: str | None = None


class SetActiveOrganizationBody(BaseModel):
    organization_id: UUID


class UpdateProfileBody(BaseModel):
    display_name: str | None = None
    timezone: str | None = None
    locale: str | None = None


class SetOverviewPreferencesBody(BaseModel):
    visible_dataset_ids: list[str] = []
    dataset_order: list[str] = []


class GoogleCallbackBody(BaseModel):
    code: str
    # No user_id. The handler binds the tokens to the authenticated caller.
    # It used to accept one and trust it, so any signed-in user could plant
    # their own Google credentials on another account and redirect that
    # user's Sheets exports into their own Drive. Nothing sent this field.


# =============================================================================
# Response models
# =============================================================================


class CSRFResponse(BaseModel):
    csrf_token: str


class LoginResponse(BaseModel):
    user_id: str
    email: str
    access_token: str
    active_organization_id: str | None = None


class MFAChallengeResponse(BaseModel):
    mfaRequired: bool = True
    mfaType: str
    session: str


class MFASetupRequiredResponse(BaseModel):
    mfaSetupRequired: bool = True
    email: str
    session: str


class PasswordChangeRequiredResponse(BaseModel):
    error: str = "Password change required"
    passwordChangeRequired: bool = True
    session: str


class RefreshResponse(BaseModel):
    access_token: str
    active_organization_id: str | None = None
    mfa_verified: bool = False


class MFAReverifyResponse(BaseModel):
    access_token: str
    mfa_verified: bool = True
    message: str = "MFA verification successful"


class MFAPasswordChallengeResponse(BaseModel):
    mfaRequired: bool = True
    session: str
    challengeType: str


class MFASetupStartResponse(BaseModel):
    secret: str
    otpauthUrl: str
    session: str


class MessageResponse(BaseModel):
    message: str


class OkResponse(BaseModel):
    ok: bool = True


class InvitationVerifyResponse(BaseModel):
    valid: bool = True
    email: str
    user_id: str | None = None
    user_status: str | None = None
    organization_id: str
    role: str
    expires_at: str


class GoogleAuthorizeResponse(BaseModel):
    authorization_url: str


class GoogleStatusResponse(BaseModel):
    authorized: bool
    needs_refresh: bool
    oauth_configured: bool


class SuccessMessageResponse(BaseModel):
    success: bool = True
    message: str


class ActivateAccountResponse(BaseModel):
    user_id: str
    email: str
    access_token: str
    active_organization_id: str | None = None
    message: str | None = None


class UserProfileOrganization(BaseModel):
    organization_id: str
    name: str
    slug: str
    timezone: str | None = None
    role: str | None = None
    role_key: str | None = None
    role_label: str | None = None


class ApplicationOut(BaseModel):
    key: str
    display_name: str
    description: str | None = None
    icon: str | None = None
    status: str | None = None
    enabled: bool = False


class DepartmentMembershipInfo(BaseModel):
    membership_id: str
    department_id: str
    department_name: str | None = None
    department_code: str | None = None
    department_color: str | None = None
    role: str | None = None
    is_primary: bool = False


class CurrentUserResponse(BaseModel):
    user_id: str
    email: str
    email_verified_at: str | None = None
    name: str | None = None
    timezone: str | None = None
    locale: str | None = None
    avatar_url: str | None = None
    active_organization_id: str | None = None
    permissions: list[str] = []
    role_key: str | None = None
    role_label: str | None = None
    role_id: str | None = None
    role_type: str | None = None
    is_platform_admin: bool = False
    role_override: str | None = None
    applications: list[Any] = []
    # Deployment capability, not an org setting. False when AGENT_ENABLED is
    # off, in which case Guide is also reported disabled in `applications`
    # and the UI shows no Ask-Guide affordance.
    agent_enabled: bool = False
    # Media AI capabilities. Deployment-level, like agent_enabled: the UI
    # hides the AI tab rather than offering tabs whose jobs never run.
    ai_tagging_enabled: bool = False
    transcription_enabled: bool = False
    # Org setting: whether "Test Role" (X-Role-Override) is permitted here.
    role_testing_enabled: bool = True
    department_memberships: list[Any] = []
    primary_department_id: str | None = None
    organizations: list[Any] = []
    # Multi-factor authentication factors enrolled for this user and
    # which one Cognito will issue as the default challenge on next
    # login. Frontend uses this to render the account-security UI.
    mfa_factors: MFAFactorsOut | None = None
    # False under AUTH_PROVIDER=local: no MFA provider exists, so the
    # UI must hide enrolment rather than offer controls that 501.
    mfa_available: bool = True


class UpdateProfileResponse(BaseModel):
    user_id: str
    email: str
    name: str | None = None
    timezone: str | None = None
    locale: str | None = None
    avatar_url: str | None = None
    message: str | None = None


class AvatarResponse(BaseModel):
    avatar_url: str | None = None
    message: str


class ActiveOrganizationResponse(BaseModel):
    active_organization_id: str


class OverviewPreferencesResponse(BaseModel):
    visible_dataset_ids: list[str] = []
    dataset_order: list[str] = []
    updated_at: str | None = None
