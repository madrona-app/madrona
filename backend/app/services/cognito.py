"""
AWS Cognito authentication service.

Provides functions for authenticating users via AWS Cognito while maintaining
HttpOnly session cookie flow. Cognito acts as the identity provider, but we
issue our own session cookies after successful authentication.

Environment variables required:
    AWS_REGION: AWS region for Cognito (e.g., 'us-west-2')
    COGNITO_USER_POOL_ID: Cognito User Pool ID
    COGNITO_CLIENT_ID: Cognito App Client ID
    COGNITO_CLIENT_SECRET: (Optional) App client secret if configured
"""

import os
import hmac
import hashlib
import base64
import logging
from dataclasses import dataclass
from typing import Optional, Union, Dict, Any
from enum import Enum

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


class AuthResultType(Enum):
    """Types of authentication results from Cognito."""
    SUCCESS = "SUCCESS"
    MFA_REQUIRED = "MFA_REQUIRED"
    NEW_PASSWORD_REQUIRED = "NEW_PASSWORD_REQUIRED"


@dataclass
class AuthTokens:
    """Tokens returned on successful authentication."""
    id_token: str
    access_token: str
    refresh_token: str
    expires_in: int  # seconds until access_token expires


@dataclass
class AuthSuccess:
    """Successful authentication result."""
    type: AuthResultType = AuthResultType.SUCCESS
    tokens: Optional[AuthTokens] = None


@dataclass
class AuthChallenge:
    """Authentication challenge requiring additional response."""
    type: AuthResultType
    session: str  # Session token to use in challenge response
    challenge_name: str  # e.g., "SMS_MFA", "SOFTWARE_TOKEN_MFA", "NEW_PASSWORD_REQUIRED"
    challenge_parameters: Dict[str, Any]  # Additional info about the challenge


# Union type for all possible auth results
AuthResult = Union[AuthSuccess, AuthChallenge]


class CognitoAuthError(Exception):
    """Base exception for Cognito authentication errors."""
    def __init__(self, message: str, code: Optional[str] = None):
        super().__init__(message)
        self.code = code
        self.message = message


class InvalidCredentialsError(CognitoAuthError):
    """Raised when username/password is invalid."""
    pass


class UserNotFoundError(CognitoAuthError):
    """Raised when user does not exist."""
    pass


class UserNotConfirmedError(CognitoAuthError):
    """Raised when user has not confirmed their account."""
    pass


class PasswordResetRequiredError(CognitoAuthError):
    """Raised when admin has required a password reset."""
    pass


class TooManyRequestsError(CognitoAuthError):
    """Raised when rate limit is exceeded."""
    pass


class CognitoService:
    """
    Service for AWS Cognito authentication operations.

    Usage:
        cognito = CognitoService()
        result = cognito.initiate_auth(username, password)

        if isinstance(result, AuthSuccess):
            # Create session with result.tokens
            pass
        elif result.type == AuthResultType.MFA_REQUIRED:
            # Prompt for MFA code, then call respond_to_auth_challenge
            pass
    """

    def __init__(
        self,
        region: Optional[str] = None,
        user_pool_id: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
    ):
        """
        Initialize Cognito service.

        Args:
            region: AWS region (defaults to AWS_REGION env var)
            user_pool_id: Cognito User Pool ID (defaults to COGNITO_USER_POOL_ID env var)
            client_id: App client ID (defaults to COGNITO_CLIENT_ID env var)
            client_secret: App client secret (defaults to COGNITO_CLIENT_SECRET env var)
        """
        self.region = region or os.environ.get('AWS_REGION', 'us-west-2')
        self.user_pool_id = user_pool_id or os.environ.get('COGNITO_USER_POOL_ID')
        self.client_id = client_id or os.environ.get('COGNITO_CLIENT_ID')
        self.client_secret = client_secret or os.environ.get('COGNITO_CLIENT_SECRET')

        if not self.user_pool_id:
            raise ValueError("COGNITO_USER_POOL_ID environment variable is required")
        if not self.client_id:
            raise ValueError("COGNITO_CLIENT_ID environment variable is required")

        self.client = boto3.client(
            'cognito-idp',
            region_name=self.region,
        )

        logger.info(f"Initialized Cognito service for pool {self.user_pool_id} in {self.region}")

    def _compute_secret_hash(self, username: str) -> Optional[str]:
        """
        Compute SECRET_HASH for app clients with a client secret.

        Args:
            username: The username to compute hash for

        Returns:
            Base64-encoded HMAC-SHA256 hash, or None if no client secret
        """
        if not self.client_secret:
            return None

        message = username + self.client_id
        dig = hmac.new(
            self.client_secret.encode('utf-8'),
            message.encode('utf-8'),
            hashlib.sha256
        ).digest()
        return base64.b64encode(dig).decode()

    def _parse_auth_result(self, response: Dict[str, Any]) -> AuthResult:
        """
        Parse Cognito InitiateAuth/AdminInitiateAuth response into AuthResult.

        Args:
            response: Raw Cognito API response

        Returns:
            AuthSuccess or AuthChallenge based on response
        """
        # Check if authentication succeeded
        if 'AuthenticationResult' in response:
            auth_result = response['AuthenticationResult']
            tokens = AuthTokens(
                id_token=auth_result['IdToken'],
                access_token=auth_result['AccessToken'],
                refresh_token=auth_result.get('RefreshToken', ''),  # May not be present on refresh
                expires_in=auth_result.get('ExpiresIn', 3600),
            )
            return AuthSuccess(tokens=tokens)

        # Authentication requires a challenge
        challenge_name = response.get('ChallengeName', '')
        session = response.get('Session', '')
        challenge_params = response.get('ChallengeParameters', {})

        # Map challenge name to result type
        if challenge_name in ('SMS_MFA', 'SOFTWARE_TOKEN_MFA'):
            result_type = AuthResultType.MFA_REQUIRED
        elif challenge_name == 'NEW_PASSWORD_REQUIRED':
            result_type = AuthResultType.NEW_PASSWORD_REQUIRED
        else:
            # Default to MFA for unknown challenges
            result_type = AuthResultType.MFA_REQUIRED
            logger.warning(f"Unknown Cognito challenge type: {challenge_name}")

        return AuthChallenge(
            type=result_type,
            session=session,
            challenge_name=challenge_name,
            challenge_parameters=challenge_params,
        )

    def _handle_client_error(self, error: ClientError) -> None:
        """
        Convert Cognito ClientError to appropriate exception.

        Args:
            error: boto3 ClientError from Cognito

        Raises:
            Appropriate CognitoAuthError subclass
        """
        error_code = error.response.get('Error', {}).get('Code', '')
        error_message = error.response.get('Error', {}).get('Message', str(error))

        logger.warning(f"Cognito error: {error_code} - {error_message}")

        if error_code == 'NotAuthorizedException':
            raise InvalidCredentialsError(error_message, error_code)
        elif error_code == 'UserNotFoundException':
            raise UserNotFoundError(error_message, error_code)
        elif error_code == 'UserNotConfirmedException':
            raise UserNotConfirmedError(error_message, error_code)
        elif error_code == 'PasswordResetRequiredException':
            raise PasswordResetRequiredError(error_message, error_code)
        elif error_code == 'TooManyRequestsException':
            raise TooManyRequestsError(error_message, error_code)
        else:
            raise CognitoAuthError(error_message, error_code)

    def initiate_auth(self, username: str, password: str) -> AuthResult:
        """
        Initiate authentication with username and password.

        Uses USER_PASSWORD_AUTH flow (choice-based sign-in) which is simpler
        than SRP and works with app client credentials.

        Args:
            username: User's username or email
            password: User's password

        Returns:
            AuthSuccess with tokens on success, or AuthChallenge if MFA/password change required

        Raises:
            InvalidCredentialsError: Username or password is incorrect
            UserNotFoundError: User does not exist
            UserNotConfirmedError: User has not confirmed their account
            PasswordResetRequiredError: Admin has required a password reset
            TooManyRequestsError: Rate limit exceeded
            CognitoAuthError: Other Cognito errors
        """
        auth_params = {
            'USERNAME': username,
            'PASSWORD': password,
        }

        # Add secret hash if client has a secret
        secret_hash = self._compute_secret_hash(username)
        if secret_hash:
            auth_params['SECRET_HASH'] = secret_hash

        try:
            response = self.client.initiate_auth(
                ClientId=self.client_id,
                AuthFlow='USER_PASSWORD_AUTH',
                AuthParameters=auth_params,
            )

            return self._parse_auth_result(response)

        except ClientError as e:
            self._handle_client_error(e)

    def respond_to_auth_challenge(
        self,
        session: str,
        challenge_name: str,
        challenge_responses: Dict[str, str],
        username: Optional[str] = None,
    ) -> AuthResult:
        """
        Respond to an authentication challenge (MFA, new password, etc).

        Args:
            session: Session token from previous auth response
            challenge_name: The challenge being responded to
            challenge_responses: Challenge-specific responses, e.g.:
                - For SMS_MFA: {'SMS_MFA_CODE': '123456'}
                - For SOFTWARE_TOKEN_MFA: {'SOFTWARE_TOKEN_MFA_CODE': '123456'}
                - For NEW_PASSWORD_REQUIRED: {'NEW_PASSWORD': 'newpass123'}
            username: Username (required for secret hash computation)

        Returns:
            AuthSuccess with tokens on success, or another AuthChallenge

        Raises:
            CognitoAuthError: Challenge response failed
        """
        responses = dict(challenge_responses)

        # Add secret hash if needed
        if username:
            secret_hash = self._compute_secret_hash(username)
            if secret_hash:
                responses['SECRET_HASH'] = secret_hash

        try:
            response = self.client.respond_to_auth_challenge(
                ClientId=self.client_id,
                ChallengeName=challenge_name,
                Session=session,
                ChallengeResponses=responses,
            )

            return self._parse_auth_result(response)

        except ClientError as e:
            self._handle_client_error(e)

    def refresh_tokens(self, refresh_token: str, username: Optional[str] = None) -> AuthResult:
        """
        Refresh access and ID tokens using a refresh token.

        Args:
            refresh_token: The refresh token from previous authentication
            username: Username (required for secret hash if client has secret)

        Returns:
            AuthSuccess with new tokens (note: refresh_token may be empty)

        Raises:
            InvalidCredentialsError: Refresh token is invalid or expired
            CognitoAuthError: Other Cognito errors
        """
        auth_params = {
            'REFRESH_TOKEN': refresh_token,
        }

        # Add secret hash if needed
        if username:
            secret_hash = self._compute_secret_hash(username)
            if secret_hash:
                auth_params['SECRET_HASH'] = secret_hash

        try:
            response = self.client.initiate_auth(
                ClientId=self.client_id,
                AuthFlow='REFRESH_TOKEN_AUTH',
                AuthParameters=auth_params,
            )

            return self._parse_auth_result(response)

        except ClientError as e:
            self._handle_client_error(e)

    def get_user(self, access_token: str) -> Dict[str, Any]:
        """
        Get user information using an access token.

        Args:
            access_token: Valid Cognito access token

        Returns:
            Dict with user attributes:
                {
                    'username': 'user@example.com',
                    'sub': 'uuid',
                    'email': 'user@example.com',
                    'email_verified': True,
                    ...other attributes...
                }

        Raises:
            InvalidCredentialsError: Access token is invalid or expired
            CognitoAuthError: Other Cognito errors
        """
        try:
            response = self.client.get_user(
                AccessToken=access_token,
            )

            # Parse user attributes into a dict
            user_data = {
                'username': response.get('Username', ''),
            }

            for attr in response.get('UserAttributes', []):
                name = attr['Name']
                value = attr['Value']

                # Convert known boolean attributes
                if name in ('email_verified', 'phone_number_verified'):
                    value = value.lower() == 'true'

                user_data[name] = value

            return user_data

        except ClientError as e:
            self._handle_client_error(e)

    def global_sign_out(self, access_token: str) -> None:
        """
        Sign out user from all devices (invalidates all refresh tokens).

        Args:
            access_token: Valid Cognito access token

        Raises:
            InvalidCredentialsError: Access token is invalid
            CognitoAuthError: Other Cognito errors
        """
        try:
            self.client.global_sign_out(
                AccessToken=access_token,
            )
            logger.info("User signed out globally")

        except ClientError as e:
            self._handle_client_error(e)

    def get_user_mfa_status(self, username: str) -> Dict[str, Any]:
        """
        Get MFA status for a user using admin API.

        Args:
            username: Cognito username (usually email)

        Returns:
            Dict with:
                - mfa_enabled: bool - True if any MFA method is enabled
                - totp_enabled: bool - True if SOFTWARE_TOKEN_MFA is enabled
                - sms_enabled: bool - True if SMS_MFA is enabled
                - preferred_mfa: str or None - Preferred MFA method

        Raises:
            UserNotFoundError: User does not exist
            CognitoAuthError: Other Cognito errors
        """
        try:
            response = self.client.admin_get_user(
                UserPoolId=self.user_pool_id,
                Username=username,
            )

            mfa_settings = response.get('UserMFASettingList', [])
            preferred_mfa = response.get('PreferredMfaSetting')

            return {
                'mfa_enabled': len(mfa_settings) > 0,
                'totp_enabled': 'SOFTWARE_TOKEN_MFA' in mfa_settings,
                'sms_enabled': 'SMS_MFA' in mfa_settings,
                'email_enabled': 'EMAIL_OTP' in mfa_settings,
                'preferred_mfa': preferred_mfa,
            }

        except ClientError as e:
            self._handle_client_error(e)

    def associate_software_token(self, access_token: str = None, session: str = None) -> Dict[str, str]:
        """
        Start TOTP MFA setup by getting a secret key.

        Can be called with either:
        - access_token: For already authenticated users adding MFA
        - session: For users in MFA_SETUP challenge flow

        Args:
            access_token: Valid Cognito access token (optional)
            session: Session from MFA_SETUP challenge (optional)

        Returns:
            Dict with:
                - secret_code: Base32 secret for TOTP app
                - session: New session token (if session was provided)

        Raises:
            CognitoAuthError: Association failed
        """
        try:
            params = {}
            if access_token:
                params['AccessToken'] = access_token
            if session:
                params['Session'] = session

            response = self.client.associate_software_token(**params)

            result = {
                'secret_code': response['SecretCode'],
            }
            if 'Session' in response:
                result['session'] = response['Session']

            return result

        except ClientError as e:
            self._handle_client_error(e)

    def verify_software_token(
        self,
        user_code: str,
        access_token: str = None,
        session: str = None,
        friendly_device_name: str = None,
    ) -> Dict[str, Any]:
        """
        Complete TOTP MFA setup by verifying a code from the authenticator app.

        Args:
            user_code: 6-digit code from authenticator app
            access_token: Valid Cognito access token (optional)
            session: Session from associate_software_token (optional)
            friendly_device_name: Optional name for the device

        Returns:
            Dict with:
                - status: 'SUCCESS' if verified
                - session: New session token (if session flow)

        Raises:
            CognitoAuthError: Verification failed (invalid code, etc.)
        """
        try:
            params = {
                'UserCode': user_code,
            }
            if access_token:
                params['AccessToken'] = access_token
            if session:
                params['Session'] = session
            if friendly_device_name:
                params['FriendlyDeviceName'] = friendly_device_name

            response = self.client.verify_software_token(**params)

            result = {
                'status': response.get('Status', 'SUCCESS'),
            }
            if 'Session' in response:
                result['session'] = response['Session']

            return result

        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', '')
            if error_code == 'EnableSoftwareTokenMFAException':
                raise CognitoAuthError(
                    code='InvalidMFACode',
                    message='Invalid verification code',
                )
            self._handle_client_error(e)

    def set_user_mfa_preference(
        self,
        access_token: str,
        totp_enabled: bool = False,
        sms_enabled: bool = False,
        email_enabled: bool = False,
        preferred: str = None,
    ) -> None:
        """
        Set MFA preferences for a user.

        Args:
            access_token: Valid Cognito access token
            totp_enabled: Enable SOFTWARE_TOKEN_MFA
            sms_enabled: Enable SMS_MFA
            email_enabled: Enable EMAIL_OTP
            preferred: Preferred method ('SOFTWARE_TOKEN_MFA', 'SMS_MFA', or 'EMAIL_OTP')

        Raises:
            CognitoAuthError: Failed to set preferences
        """
        try:
            params = {
                'AccessToken': access_token,
            }

            if totp_enabled:
                params['SoftwareTokenMfaSettings'] = {
                    'Enabled': True,
                    'PreferredMfa': preferred == 'SOFTWARE_TOKEN_MFA',
                }

            if sms_enabled:
                params['SMSMfaSettings'] = {
                    'Enabled': True,
                    'PreferredMfa': preferred == 'SMS_MFA',
                }

            if email_enabled:
                params['EmailMfaSettings'] = {
                    'Enabled': True,
                    'PreferredMfa': preferred == 'EMAIL_OTP',
                }

            self.client.set_user_mfa_preference(**params)
            logger.info("MFA preferences updated")

        except ClientError as e:
            self._handle_client_error(e)

    def admin_set_user_mfa_preference(
        self,
        email: str,
        *,
        totp_enabled: bool | None = None,
        sms_enabled: bool | None = None,
        email_enabled: bool | None = None,
        preferred: str | None = None,
    ) -> None:
        """
        Backend-side MFA preference update via AdminSetUserMFAPreference.

        Each ``*_enabled`` argument is tri-state:
            None  → omit the settings block (Cognito leaves it unchanged)
            True  → enable the factor
            False → disable the factor

        Omission semantics matter: a setup endpoint that only wants to
        enable email MFA passes ``email_enabled=True`` and leaves TOTP
        alone — Cognito won't touch existing SoftwareTokenMfaSettings.

        ``preferred`` is one of 'SOFTWARE_TOKEN_MFA', 'SMS_MFA',
        'EMAIL_OTP', or None. Within each settings block we passed,
        ``PreferredMfa`` is True only when that factor matches
        ``preferred`` AND that factor is being enabled.

        Args:
            email: User's email (Cognito username)
            totp_enabled: Tri-state for SOFTWARE_TOKEN_MFA
            sms_enabled:  Tri-state for SMS_MFA
            email_enabled: Tri-state for EMAIL_OTP
            preferred: Which factor should be preferred for challenges

        Raises:
            CognitoAuthError: Failed to set preferences
        """
        try:
            params = {
                'UserPoolId': self.user_pool_id,
                'Username': email.lower(),
            }

            if totp_enabled is not None:
                params['SoftwareTokenMfaSettings'] = {
                    'Enabled': bool(totp_enabled),
                    'PreferredMfa': (
                        bool(totp_enabled) and preferred == 'SOFTWARE_TOKEN_MFA'
                    ),
                }
            if sms_enabled is not None:
                params['SMSMfaSettings'] = {
                    'Enabled': bool(sms_enabled),
                    'PreferredMfa': (
                        bool(sms_enabled) and preferred == 'SMS_MFA'
                    ),
                }
            if email_enabled is not None:
                params['EmailMfaSettings'] = {
                    'Enabled': bool(email_enabled),
                    'PreferredMfa': (
                        bool(email_enabled) and preferred == 'EMAIL_OTP'
                    ),
                }

            self.client.admin_set_user_mfa_preference(**params)
            logger.info("Admin MFA preferences updated for %s", email)

        except ClientError as e:
            self._handle_client_error(e)

    def admin_create_user(
        self,
        email: str,
        temporary_password: str,
        suppress_welcome: bool = False,
    ) -> dict:
        """
        Create a new user in Cognito using AdminCreateUser.

        Args:
            email: User's email address (used as username)
            temporary_password: Temporary password (user must change on first login)
            suppress_welcome: If True, don't send Cognito's default welcome email

        Returns:
            Cognito user data dict

        Raises:
            CognitoAuthError: Cognito API error
        """
        try:
            params = {
                'UserPoolId': self.user_pool_id,
                'Username': email.lower(),
                'TemporaryPassword': temporary_password,
                'UserAttributes': [
                    {'Name': 'email', 'Value': email.lower()},
                    {'Name': 'email_verified', 'Value': 'true'},
                ],
            }

            if suppress_welcome:
                params['MessageAction'] = 'SUPPRESS'

            response = self.client.admin_create_user(**params)

            logger.info(f"Created Cognito user: {email}")
            return response['User']

        except ClientError as e:
            self._handle_client_error(e)

    def admin_set_user_password(
        self,
        email: str,
        password: str,
        permanent: bool = True,
    ) -> None:
        """
        Set a user's password using AdminSetUserPassword.

        Args:
            email: User's email (username)
            password: New password
            permanent: If True, password is permanent (no force change)

        Raises:
            CognitoAuthError: Cognito API error
        """
        try:
            self.client.admin_set_user_password(
                UserPoolId=self.user_pool_id,
                Username=email.lower(),
                Password=password,
                Permanent=permanent,
            )

            logger.info(f"Set password for Cognito user: {email} (permanent={permanent})")

        except ClientError as e:
            self._handle_client_error(e)

    def admin_delete_user(self, email: str) -> None:
        """
        Delete a user from Cognito using AdminDeleteUser.

        Used for cleanup if DB creation fails after Cognito creation.

        Args:
            email: User's email (username)

        Raises:
            CognitoAuthError: Cognito API error
        """
        try:
            self.client.admin_delete_user(
                UserPoolId=self.user_pool_id,
                Username=email.lower(),
            )

            logger.info(f"Deleted Cognito user: {email}")

        except ClientError as e:
            self._handle_client_error(e)

    def change_password(
        self,
        access_token: str,
        previous_password: str,
        proposed_password: str,
    ) -> None:
        """
        Change password for an authenticated user.

        Args:
            access_token: Valid Cognito access token
            previous_password: User's current password
            proposed_password: New password to set

        Raises:
            InvalidCredentialsError: Current password is incorrect
            CognitoAuthError: Password change failed (e.g., doesn't meet policy)
        """
        try:
            self.client.change_password(
                PreviousPassword=previous_password,
                ProposedPassword=proposed_password,
                AccessToken=access_token,
            )
            logger.info("Password changed successfully")

        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', '')
            error_message = e.response.get('Error', {}).get('Message', str(e))

            if error_code == 'NotAuthorizedException':
                raise InvalidCredentialsError("Current password is incorrect", error_code)
            elif error_code == 'InvalidPasswordException':
                raise CognitoAuthError(error_message, error_code)
            elif error_code == 'LimitExceededException':
                raise TooManyRequestsError("Too many attempts. Please try again later.", error_code)
            else:
                self._handle_client_error(e)


# Module-level convenience functions using a singleton instance
_cognito_service: Optional[CognitoService] = None


def get_cognito_service() -> CognitoService:
    """Get or create the singleton Cognito service instance."""
    global _cognito_service
    if _cognito_service is None:
        _cognito_service = CognitoService()
    return _cognito_service


def cognito_initiate_auth(username: str, password: str) -> AuthResult:
    """
    Initiate Cognito authentication.

    Convenience wrapper around CognitoService.initiate_auth().
    """
    return get_cognito_service().initiate_auth(username, password)


def cognito_respond_to_auth_challenge(
    session: str,
    challenge_name: str,
    challenge_responses: Dict[str, str],
    username: Optional[str] = None,
) -> AuthResult:
    """
    Respond to Cognito auth challenge.

    Convenience wrapper around CognitoService.respond_to_auth_challenge().
    """
    return get_cognito_service().respond_to_auth_challenge(
        session, challenge_name, challenge_responses, username
    )


def cognito_get_user(access_token: str) -> Dict[str, Any]:
    """
    Get user info from Cognito.

    Convenience wrapper around CognitoService.get_user().
    """
    return get_cognito_service().get_user(access_token)


def cognito_refresh_tokens(refresh_token: str, username: Optional[str] = None) -> AuthResult:
    """
    Refresh Cognito tokens.

    Convenience wrapper around CognitoService.refresh_tokens().
    """
    return get_cognito_service().refresh_tokens(refresh_token, username)


def cognito_global_sign_out(access_token: str) -> None:
    """
    Sign out user globally.

    Convenience wrapper around CognitoService.global_sign_out().
    """
    return get_cognito_service().global_sign_out(access_token)


def cognito_get_user_mfa_status(username: str) -> Dict[str, Any]:
    """
    Get MFA status for a user.

    Convenience wrapper around CognitoService.get_user_mfa_status().
    """
    return get_cognito_service().get_user_mfa_status(username)


def cognito_associate_software_token(
    access_token: str = None,
    session: str = None,
) -> Dict[str, str]:
    """
    Start TOTP MFA setup.

    Convenience wrapper around CognitoService.associate_software_token().
    """
    return get_cognito_service().associate_software_token(access_token, session)


def cognito_verify_software_token(
    user_code: str,
    access_token: str = None,
    session: str = None,
    friendly_device_name: str = None,
) -> Dict[str, Any]:
    """
    Complete TOTP MFA setup.

    Convenience wrapper around CognitoService.verify_software_token().
    """
    return get_cognito_service().verify_software_token(
        user_code, access_token, session, friendly_device_name
    )


def cognito_set_user_mfa_preference(
    access_token: str,
    totp_enabled: bool = False,
    sms_enabled: bool = False,
    email_enabled: bool = False,
    preferred: str = None,
) -> None:
    """
    Set MFA preferences for a user.

    Convenience wrapper around CognitoService.set_user_mfa_preference().
    """
    return get_cognito_service().set_user_mfa_preference(
        access_token, totp_enabled, sms_enabled, email_enabled, preferred
    )


def cognito_admin_set_user_mfa_preference(
    email: str,
    *,
    totp_enabled: bool | None = None,
    sms_enabled: bool | None = None,
    email_enabled: bool | None = None,
    preferred: str | None = None,
) -> None:
    """Backend-side MFA preference update keyed by email.

    Convenience wrapper around CognitoService.admin_set_user_mfa_preference().
    """
    return get_cognito_service().admin_set_user_mfa_preference(
        email,
        totp_enabled=totp_enabled,
        sms_enabled=sms_enabled,
        email_enabled=email_enabled,
        preferred=preferred,
    )


def cognito_change_password(
    access_token: str,
    previous_password: str,
    proposed_password: str,
) -> None:
    """
    Change password for an authenticated user.

    Convenience wrapper around CognitoService.change_password().
    """
    return get_cognito_service().change_password(
        access_token, previous_password, proposed_password
    )


def cognito_admin_create_user(
    email: str,
    temporary_password: str,
    suppress_welcome: bool = False,
) -> dict:
    """
    Create a new user in Cognito.

    Convenience wrapper around CognitoService.admin_create_user().
    """
    return get_cognito_service().admin_create_user(
        email, temporary_password, suppress_welcome
    )


def cognito_admin_set_user_password(
    email: str,
    password: str,
    permanent: bool = True,
) -> None:
    """
    Set a user's password in Cognito.

    Convenience wrapper around CognitoService.admin_set_user_password().
    """
    return get_cognito_service().admin_set_user_password(
        email, password, permanent
    )


def cognito_admin_delete_user(email: str) -> None:
    """
    Delete a user from Cognito.

    Convenience wrapper around CognitoService.admin_delete_user().
    """
    return get_cognito_service().admin_delete_user(email)
