"""
Unit tests for Cognito authentication service.

Tests use mocked boto3 client to avoid hitting real AWS.
"""

import pytest
from unittest.mock import MagicMock, patch
from botocore.exceptions import ClientError

from app.services.cognito import (
    CognitoService,
    AuthResult,
    AuthSuccess,
    AuthChallenge,
    AuthTokens,
    AuthResultType,
    CognitoAuthError,
    InvalidCredentialsError,
    UserNotFoundError,
    UserNotConfirmedError,
    PasswordResetRequiredError,
    TooManyRequestsError,
    cognito_initiate_auth,
    cognito_respond_to_auth_challenge,
    cognito_get_user,
)


@pytest.fixture
def mock_env(monkeypatch):
    """Set required environment variables."""
    monkeypatch.setenv("AWS_REGION", "us-west-2")
    monkeypatch.setenv("COGNITO_USER_POOL_ID", "us-west-2_TestPool")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "test-client-id")
    monkeypatch.delenv("COGNITO_CLIENT_SECRET", raising=False)


@pytest.fixture
def mock_boto_client():
    """Create a mock boto3 Cognito client."""
    with patch("boto3.client") as mock_client_ctor:
        mock_cognito = MagicMock()
        mock_client_ctor.return_value = mock_cognito
        yield mock_cognito


@pytest.fixture
def cognito_service(mock_env, mock_boto_client):
    """Create CognitoService with mocked dependencies."""
    return CognitoService()


class TestCognitoServiceInit:
    """Tests for CognitoService initialization."""

    def test_init_with_env_vars(self, mock_env, mock_boto_client):
        """Should initialize from environment variables."""
        service = CognitoService()

        assert service.region == "us-west-2"
        assert service.user_pool_id == "us-west-2_TestPool"
        assert service.client_id == "test-client-id"

    def test_init_with_explicit_params(self, mock_boto_client):
        """Should accept explicit parameters."""
        service = CognitoService(
            region="eu-west-1",
            user_pool_id="eu-west-1_CustomPool",
            client_id="custom-client",
            client_secret="secret123",
        )

        assert service.region == "eu-west-1"
        assert service.user_pool_id == "eu-west-1_CustomPool"
        assert service.client_id == "custom-client"
        assert service.client_secret == "secret123"

    def test_init_missing_user_pool_id(self, mock_boto_client, monkeypatch):
        """Should raise ValueError if user pool ID is missing."""
        monkeypatch.delenv("COGNITO_USER_POOL_ID", raising=False)
        with pytest.raises(ValueError, match="COGNITO_USER_POOL_ID"):
            CognitoService(client_id="test")

    def test_init_missing_client_id(self, mock_boto_client, monkeypatch):
        """Should raise ValueError if client ID is missing."""
        monkeypatch.setenv("COGNITO_USER_POOL_ID", "test-pool")
        monkeypatch.delenv("COGNITO_CLIENT_ID", raising=False)
        with pytest.raises(ValueError, match="COGNITO_CLIENT_ID"):
            CognitoService()


class TestInitiateAuth:
    """Tests for initiate_auth method."""

    def test_successful_auth_returns_tokens(self, cognito_service, mock_boto_client):
        """Should return AuthSuccess with tokens on successful auth."""
        mock_boto_client.initiate_auth.return_value = {
            "AuthenticationResult": {
                "IdToken": "id-token-123",
                "AccessToken": "access-token-456",
                "RefreshToken": "refresh-token-789",
                "ExpiresIn": 3600,
            }
        }

        result = cognito_service.initiate_auth("user@example.com", "password123")

        assert isinstance(result, AuthSuccess)
        assert result.type == AuthResultType.SUCCESS
        assert result.tokens.id_token == "id-token-123"
        assert result.tokens.access_token == "access-token-456"
        assert result.tokens.refresh_token == "refresh-token-789"
        assert result.tokens.expires_in == 3600

    def test_mfa_required_returns_challenge(self, cognito_service, mock_boto_client):
        """Should return AuthChallenge when MFA is required."""
        mock_boto_client.initiate_auth.return_value = {
            "ChallengeName": "SMS_MFA",
            "Session": "session-token-abc",
            "ChallengeParameters": {
                "CODE_DELIVERY_DESTINATION": "+1******1234",
                "CODE_DELIVERY_DELIVERY_MEDIUM": "SMS",
            },
        }

        result = cognito_service.initiate_auth("user@example.com", "password123")

        assert isinstance(result, AuthChallenge)
        assert result.type == AuthResultType.MFA_REQUIRED
        assert result.session == "session-token-abc"
        assert result.challenge_name == "SMS_MFA"
        assert "CODE_DELIVERY_DESTINATION" in result.challenge_parameters

    def test_software_token_mfa_returns_challenge(self, cognito_service, mock_boto_client):
        """Should return AuthChallenge for SOFTWARE_TOKEN_MFA."""
        mock_boto_client.initiate_auth.return_value = {
            "ChallengeName": "SOFTWARE_TOKEN_MFA",
            "Session": "session-totp",
            "ChallengeParameters": {"USER_ID_FOR_SRP": "user@example.com"},
        }

        result = cognito_service.initiate_auth("user@example.com", "password123")

        assert isinstance(result, AuthChallenge)
        assert result.type == AuthResultType.MFA_REQUIRED
        assert result.challenge_name == "SOFTWARE_TOKEN_MFA"

    def test_new_password_required_returns_challenge(self, cognito_service, mock_boto_client):
        """Should return AuthChallenge when new password is required."""
        mock_boto_client.initiate_auth.return_value = {
            "ChallengeName": "NEW_PASSWORD_REQUIRED",
            "Session": "session-token-xyz",
            "ChallengeParameters": {
                "USER_ID_FOR_SRP": "user@example.com",
                "requiredAttributes": "[]",
            },
        }

        result = cognito_service.initiate_auth("user@example.com", "password123")

        assert isinstance(result, AuthChallenge)
        assert result.type == AuthResultType.NEW_PASSWORD_REQUIRED
        assert result.session == "session-token-xyz"
        assert result.challenge_name == "NEW_PASSWORD_REQUIRED"

    def test_invalid_credentials_raises_error(self, cognito_service, mock_boto_client):
        """Should raise InvalidCredentialsError for wrong password."""
        mock_boto_client.initiate_auth.side_effect = ClientError(
            {"Error": {"Code": "NotAuthorizedException", "Message": "Incorrect username or password"}},
            "InitiateAuth",
        )

        with pytest.raises(InvalidCredentialsError):
            cognito_service.initiate_auth("user@example.com", "wrong-password")

    def test_user_not_found_raises_error(self, cognito_service, mock_boto_client):
        """Should raise UserNotFoundError for non-existent user."""
        mock_boto_client.initiate_auth.side_effect = ClientError(
            {"Error": {"Code": "UserNotFoundException", "Message": "User does not exist"}},
            "InitiateAuth",
        )

        with pytest.raises(UserNotFoundError):
            cognito_service.initiate_auth("unknown@example.com", "password")

    def test_user_not_confirmed_raises_error(self, cognito_service, mock_boto_client):
        """Should raise UserNotConfirmedError for unconfirmed user."""
        mock_boto_client.initiate_auth.side_effect = ClientError(
            {"Error": {"Code": "UserNotConfirmedException", "Message": "User not confirmed"}},
            "InitiateAuth",
        )

        with pytest.raises(UserNotConfirmedError):
            cognito_service.initiate_auth("unconfirmed@example.com", "password")

    def test_password_reset_required_raises_error(self, cognito_service, mock_boto_client):
        """Should raise PasswordResetRequiredError."""
        mock_boto_client.initiate_auth.side_effect = ClientError(
            {"Error": {"Code": "PasswordResetRequiredException", "Message": "Password reset required"}},
            "InitiateAuth",
        )

        with pytest.raises(PasswordResetRequiredError):
            cognito_service.initiate_auth("user@example.com", "password")

    def test_rate_limit_raises_error(self, cognito_service, mock_boto_client):
        """Should raise TooManyRequestsError when rate limited."""
        mock_boto_client.initiate_auth.side_effect = ClientError(
            {"Error": {"Code": "TooManyRequestsException", "Message": "Rate exceeded"}},
            "InitiateAuth",
        )

        with pytest.raises(TooManyRequestsError):
            cognito_service.initiate_auth("user@example.com", "password")

    def test_unknown_error_raises_cognito_auth_error(self, cognito_service, mock_boto_client):
        """Should raise CognitoAuthError for unknown error codes."""
        mock_boto_client.initiate_auth.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "Internal error"}},
            "InitiateAuth",
        )

        with pytest.raises(CognitoAuthError):
            cognito_service.initiate_auth("user@example.com", "password")

    def test_auth_params_include_username_and_password(self, cognito_service, mock_boto_client):
        """Should pass USERNAME and PASSWORD in auth parameters."""
        mock_boto_client.initiate_auth.return_value = {
            "AuthenticationResult": {
                "IdToken": "id",
                "AccessToken": "access",
                "RefreshToken": "refresh",
                "ExpiresIn": 3600,
            }
        }

        cognito_service.initiate_auth("user@example.com", "password123")

        call_args = mock_boto_client.initiate_auth.call_args
        auth_params = call_args.kwargs["AuthParameters"]
        assert auth_params["USERNAME"] == "user@example.com"
        assert auth_params["PASSWORD"] == "password123"
        assert call_args.kwargs["AuthFlow"] == "USER_PASSWORD_AUTH"


class TestRespondToAuthChallenge:
    """Tests for respond_to_auth_challenge method."""

    def test_mfa_response_returns_tokens(self, cognito_service, mock_boto_client):
        """Should return tokens after successful MFA response."""
        mock_boto_client.respond_to_auth_challenge.return_value = {
            "AuthenticationResult": {
                "IdToken": "id-token-after-mfa",
                "AccessToken": "access-token-after-mfa",
                "RefreshToken": "refresh-token-after-mfa",
                "ExpiresIn": 3600,
            }
        }

        result = cognito_service.respond_to_auth_challenge(
            session="session-token",
            challenge_name="SMS_MFA",
            challenge_responses={"SMS_MFA_CODE": "123456"},
            username="user@example.com",
        )

        assert isinstance(result, AuthSuccess)
        assert result.tokens.access_token == "access-token-after-mfa"

    def test_new_password_response_returns_tokens(self, cognito_service, mock_boto_client):
        """Should return tokens after setting new password."""
        mock_boto_client.respond_to_auth_challenge.return_value = {
            "AuthenticationResult": {
                "IdToken": "id-token-new-pass",
                "AccessToken": "access-token-new-pass",
                "RefreshToken": "refresh-token-new-pass",
                "ExpiresIn": 3600,
            }
        }

        result = cognito_service.respond_to_auth_challenge(
            session="session-token",
            challenge_name="NEW_PASSWORD_REQUIRED",
            challenge_responses={"NEW_PASSWORD": "NewSecurePass123!"},
            username="user@example.com",
        )

        assert isinstance(result, AuthSuccess)
        assert result.tokens.id_token == "id-token-new-pass"

    def test_invalid_mfa_code_raises_error(self, cognito_service, mock_boto_client):
        """Should raise error for invalid MFA code."""
        mock_boto_client.respond_to_auth_challenge.side_effect = ClientError(
            {"Error": {"Code": "NotAuthorizedException", "Message": "Invalid code"}},
            "RespondToAuthChallenge",
        )

        with pytest.raises(InvalidCredentialsError):
            cognito_service.respond_to_auth_challenge(
                session="session-token",
                challenge_name="SMS_MFA",
                challenge_responses={"SMS_MFA_CODE": "000000"},
            )

    def test_challenge_passes_correct_params(self, cognito_service, mock_boto_client):
        """Should pass correct params to Cognito API."""
        mock_boto_client.respond_to_auth_challenge.return_value = {
            "AuthenticationResult": {
                "IdToken": "id",
                "AccessToken": "access",
                "RefreshToken": "refresh",
                "ExpiresIn": 3600,
            }
        }

        cognito_service.respond_to_auth_challenge(
            session="test-session",
            challenge_name="SOFTWARE_TOKEN_MFA",
            challenge_responses={"SOFTWARE_TOKEN_MFA_CODE": "123456"},
            username="user@example.com",
        )

        call_args = mock_boto_client.respond_to_auth_challenge.call_args
        assert call_args.kwargs["Session"] == "test-session"
        assert call_args.kwargs["ChallengeName"] == "SOFTWARE_TOKEN_MFA"
        assert "SOFTWARE_TOKEN_MFA_CODE" in call_args.kwargs["ChallengeResponses"]


class TestGetUser:
    """Tests for get_user method."""

    def test_returns_user_attributes(self, cognito_service, mock_boto_client):
        """Should return parsed user attributes."""
        mock_boto_client.get_user.return_value = {
            "Username": "user@example.com",
            "UserAttributes": [
                {"Name": "sub", "Value": "uuid-123-456"},
                {"Name": "email", "Value": "user@example.com"},
                {"Name": "email_verified", "Value": "true"},
                {"Name": "name", "Value": "Test User"},
            ],
        }

        user = cognito_service.get_user("valid-access-token")

        assert user["username"] == "user@example.com"
        assert user["sub"] == "uuid-123-456"
        assert user["email"] == "user@example.com"
        assert user["email_verified"] is True
        assert user["name"] == "Test User"

    def test_email_verified_false(self, cognito_service, mock_boto_client):
        """Should parse email_verified=false correctly."""
        mock_boto_client.get_user.return_value = {
            "Username": "user@example.com",
            "UserAttributes": [
                {"Name": "email", "Value": "user@example.com"},
                {"Name": "email_verified", "Value": "false"},
            ],
        }

        user = cognito_service.get_user("valid-token")
        assert user["email_verified"] is False

    def test_invalid_token_raises_error(self, cognito_service, mock_boto_client):
        """Should raise error for invalid access token."""
        mock_boto_client.get_user.side_effect = ClientError(
            {"Error": {"Code": "NotAuthorizedException", "Message": "Invalid token"}},
            "GetUser",
        )

        with pytest.raises(InvalidCredentialsError):
            cognito_service.get_user("invalid-token")


class TestRefreshTokens:
    """Tests for refresh_tokens method."""

    def test_returns_new_tokens(self, cognito_service, mock_boto_client):
        """Should return new tokens on successful refresh."""
        mock_boto_client.initiate_auth.return_value = {
            "AuthenticationResult": {
                "IdToken": "new-id-token",
                "AccessToken": "new-access-token",
                "ExpiresIn": 3600,
                # Note: RefreshToken may not be returned on refresh
            }
        }

        result = cognito_service.refresh_tokens("valid-refresh-token")

        assert isinstance(result, AuthSuccess)
        assert result.tokens.id_token == "new-id-token"
        assert result.tokens.access_token == "new-access-token"

    def test_uses_refresh_token_auth_flow(self, cognito_service, mock_boto_client):
        """Should use REFRESH_TOKEN_AUTH flow."""
        mock_boto_client.initiate_auth.return_value = {
            "AuthenticationResult": {
                "IdToken": "id",
                "AccessToken": "access",
                "ExpiresIn": 3600,
            }
        }

        cognito_service.refresh_tokens("refresh-token-value")

        call_args = mock_boto_client.initiate_auth.call_args
        assert call_args.kwargs["AuthFlow"] == "REFRESH_TOKEN_AUTH"
        assert call_args.kwargs["AuthParameters"]["REFRESH_TOKEN"] == "refresh-token-value"

    def test_expired_refresh_token_raises_error(self, cognito_service, mock_boto_client):
        """Should raise error for expired refresh token."""
        mock_boto_client.initiate_auth.side_effect = ClientError(
            {"Error": {"Code": "NotAuthorizedException", "Message": "Refresh token expired"}},
            "InitiateAuth",
        )

        with pytest.raises(InvalidCredentialsError):
            cognito_service.refresh_tokens("expired-refresh-token")


class TestGlobalSignOut:
    """Tests for global_sign_out method."""

    def test_successful_sign_out(self, cognito_service, mock_boto_client):
        """Should call global_sign_out successfully."""
        mock_boto_client.global_sign_out.return_value = {}

        # Should not raise
        cognito_service.global_sign_out("valid-access-token")

        mock_boto_client.global_sign_out.assert_called_once_with(
            AccessToken="valid-access-token"
        )

    def test_invalid_token_raises_error(self, cognito_service, mock_boto_client):
        """Should raise error for invalid token."""
        mock_boto_client.global_sign_out.side_effect = ClientError(
            {"Error": {"Code": "NotAuthorizedException", "Message": "Invalid token"}},
            "GlobalSignOut",
        )

        with pytest.raises(InvalidCredentialsError):
            cognito_service.global_sign_out("invalid-token")


class TestMFAStatus:
    """Tests for get_user_mfa_status method."""

    def test_returns_mfa_status_enabled(self, cognito_service, mock_boto_client):
        """Should parse MFA enabled status."""
        mock_boto_client.admin_get_user.return_value = {
            "Username": "user@example.com",
            "UserMFASettingList": ["SOFTWARE_TOKEN_MFA"],
            "PreferredMfaSetting": "SOFTWARE_TOKEN_MFA",
        }

        status = cognito_service.get_user_mfa_status("user@example.com")

        assert status["mfa_enabled"] is True
        assert status["totp_enabled"] is True
        assert status["sms_enabled"] is False
        assert status["preferred_mfa"] == "SOFTWARE_TOKEN_MFA"

    def test_returns_mfa_status_disabled(self, cognito_service, mock_boto_client):
        """Should parse MFA disabled status."""
        mock_boto_client.admin_get_user.return_value = {
            "Username": "user@example.com",
            "UserMFASettingList": [],
            "PreferredMfaSetting": None,
        }

        status = cognito_service.get_user_mfa_status("user@example.com")

        assert status["mfa_enabled"] is False
        assert status["totp_enabled"] is False
        assert status["sms_enabled"] is False
        assert status["preferred_mfa"] is None

    def test_user_not_found_raises_error(self, cognito_service, mock_boto_client):
        """Should raise UserNotFoundError for non-existent user."""
        mock_boto_client.admin_get_user.side_effect = ClientError(
            {"Error": {"Code": "UserNotFoundException", "Message": "User does not exist"}},
            "AdminGetUser",
        )

        with pytest.raises(UserNotFoundError):
            cognito_service.get_user_mfa_status("nonexistent@example.com")


class TestAssociateSoftwareToken:
    """Tests for associate_software_token method."""

    def test_returns_secret_code(self, cognito_service, mock_boto_client):
        """Should return TOTP secret code."""
        mock_boto_client.associate_software_token.return_value = {
            "SecretCode": "JBSWY3DPEHPK3PXP",
        }

        result = cognito_service.associate_software_token(access_token="mock-token")

        assert result["secret_code"] == "JBSWY3DPEHPK3PXP"

    def test_returns_session_when_provided(self, cognito_service, mock_boto_client):
        """Should return session token when using session flow."""
        mock_boto_client.associate_software_token.return_value = {
            "SecretCode": "JBSWY3DPEHPK3PXP",
            "Session": "new-session-token",
        }

        result = cognito_service.associate_software_token(session="old-session")

        assert result["secret_code"] == "JBSWY3DPEHPK3PXP"
        assert result["session"] == "new-session-token"


class TestVerifySoftwareToken:
    """Tests for verify_software_token method."""

    def test_returns_success(self, cognito_service, mock_boto_client):
        """Should return success status."""
        mock_boto_client.verify_software_token.return_value = {
            "Status": "SUCCESS",
        }

        result = cognito_service.verify_software_token(
            user_code="123456",
            access_token="mock-token",
        )

        assert result["status"] == "SUCCESS"

    def test_invalid_code_raises_error(self, cognito_service, mock_boto_client):
        """Should raise error for invalid TOTP code."""
        mock_boto_client.verify_software_token.side_effect = ClientError(
            {"Error": {"Code": "EnableSoftwareTokenMFAException", "Message": "Invalid code"}},
            "VerifySoftwareToken",
        )

        with pytest.raises(CognitoAuthError) as exc_info:
            cognito_service.verify_software_token(
                user_code="000000",
                access_token="mock-token",
            )

        assert exc_info.value.code == "InvalidMFACode"


class TestSetUserMfaPreference:
    """Tests for set_user_mfa_preference method."""

    def test_enables_totp(self, cognito_service, mock_boto_client):
        """Should enable TOTP MFA."""
        mock_boto_client.set_user_mfa_preference.return_value = {}

        cognito_service.set_user_mfa_preference(
            access_token="mock-token",
            totp_enabled=True,
            preferred="SOFTWARE_TOKEN_MFA",
        )

        call_args = mock_boto_client.set_user_mfa_preference.call_args
        assert call_args.kwargs["SoftwareTokenMfaSettings"]["Enabled"] is True
        assert call_args.kwargs["SoftwareTokenMfaSettings"]["PreferredMfa"] is True


class TestAdminOperations:
    """Tests for admin operations."""

    def test_admin_create_user(self, cognito_service, mock_boto_client):
        """Should create user in Cognito."""
        mock_boto_client.admin_create_user.return_value = {
            "User": {
                "Username": "new@example.com",
                "UserStatus": "FORCE_CHANGE_PASSWORD",
            }
        }

        result = cognito_service.admin_create_user(
            email="New@Example.Com",
            temporary_password="TempPass123!",
            suppress_welcome=True,
        )

        call_args = mock_boto_client.admin_create_user.call_args
        assert call_args.kwargs["Username"] == "new@example.com"  # lowercased
        assert call_args.kwargs["MessageAction"] == "SUPPRESS"
        assert result["Username"] == "new@example.com"

    def test_admin_set_user_password(self, cognito_service, mock_boto_client):
        """Should set user password."""
        mock_boto_client.admin_set_user_password.return_value = {}

        cognito_service.admin_set_user_password(
            email="User@Example.Com",
            password="NewPass123!",
            permanent=True,
        )

        call_args = mock_boto_client.admin_set_user_password.call_args
        assert call_args.kwargs["Username"] == "user@example.com"  # lowercased
        assert call_args.kwargs["Password"] == "NewPass123!"
        assert call_args.kwargs["Permanent"] is True

    def test_admin_delete_user(self, cognito_service, mock_boto_client):
        """Should delete user from Cognito."""
        mock_boto_client.admin_delete_user.return_value = {}

        cognito_service.admin_delete_user(email="Delete@Example.Com")

        call_args = mock_boto_client.admin_delete_user.call_args
        assert call_args.kwargs["Username"] == "delete@example.com"  # lowercased


class TestChangePassword:
    """Tests for change_password method."""

    def test_successful_change(self, cognito_service, mock_boto_client):
        """Should change password successfully."""
        mock_boto_client.change_password.return_value = {}

        # Should not raise
        cognito_service.change_password(
            access_token="mock-token",
            previous_password="OldPass123!",
            proposed_password="NewPass123!",
        )

        mock_boto_client.change_password.assert_called_once_with(
            PreviousPassword="OldPass123!",
            ProposedPassword="NewPass123!",
            AccessToken="mock-token",
        )

    def test_wrong_current_password_raises_error(self, cognito_service, mock_boto_client):
        """Should raise InvalidCredentialsError for wrong current password."""
        mock_boto_client.change_password.side_effect = ClientError(
            {"Error": {"Code": "NotAuthorizedException", "Message": "Incorrect password"}},
            "ChangePassword",
        )

        with pytest.raises(InvalidCredentialsError):
            cognito_service.change_password(
                access_token="mock-token",
                previous_password="WrongPass",
                proposed_password="NewPass123!",
            )

    def test_rate_limited_raises_error(self, cognito_service, mock_boto_client):
        """Should raise TooManyRequestsError on rate limit."""
        mock_boto_client.change_password.side_effect = ClientError(
            {"Error": {"Code": "LimitExceededException", "Message": "Too many attempts"}},
            "ChangePassword",
        )

        with pytest.raises(TooManyRequestsError):
            cognito_service.change_password(
                access_token="mock-token",
                previous_password="OldPass",
                proposed_password="NewPass123!",
            )


class TestSecretHash:
    """Tests for SECRET_HASH computation."""

    def test_computes_secret_hash_when_secret_present(self, mock_boto_client):
        """Should compute and include SECRET_HASH when client has a secret."""
        service = CognitoService(
            region="us-west-2",
            user_pool_id="test-pool",
            client_id="test-client",
            client_secret="test-secret",
        )

        mock_boto_client.initiate_auth.return_value = {
            "AuthenticationResult": {
                "IdToken": "id",
                "AccessToken": "access",
                "RefreshToken": "refresh",
                "ExpiresIn": 3600,
            }
        }

        service.initiate_auth("user", "pass")

        # Verify SECRET_HASH was included in the call
        call_args = mock_boto_client.initiate_auth.call_args
        auth_params = call_args.kwargs["AuthParameters"]
        assert "SECRET_HASH" in auth_params

    def test_no_secret_hash_when_no_secret(self, cognito_service, mock_boto_client):
        """Should not include SECRET_HASH when no client secret."""
        mock_boto_client.initiate_auth.return_value = {
            "AuthenticationResult": {
                "IdToken": "id",
                "AccessToken": "access",
                "RefreshToken": "refresh",
                "ExpiresIn": 3600,
            }
        }

        cognito_service.initiate_auth("user", "pass")

        call_args = mock_boto_client.initiate_auth.call_args
        auth_params = call_args.kwargs["AuthParameters"]
        assert "SECRET_HASH" not in auth_params

    def test_secret_hash_returns_none_when_no_secret(self, cognito_service):
        """Should return None for _compute_secret_hash when no secret."""
        result = cognito_service._compute_secret_hash("user")
        assert result is None

    def test_secret_hash_returns_base64_when_secret_present(self, mock_boto_client):
        """Should return base64 hash when secret is present."""
        service = CognitoService(
            region="us-west-2",
            user_pool_id="test-pool",
            client_id="test-client",
            client_secret="test-secret",
        )

        result = service._compute_secret_hash("user")
        assert result is not None
        assert isinstance(result, str)
        assert len(result) > 0


class TestConvenienceFunctions:
    """Tests for module-level convenience functions."""

    @patch("app.services.cognito._cognito_service", None)
    def test_cognito_initiate_auth_creates_service(self, mock_env, mock_boto_client):
        """Should create singleton service on first call."""
        mock_boto_client.initiate_auth.return_value = {
            "AuthenticationResult": {
                "IdToken": "id",
                "AccessToken": "access",
                "RefreshToken": "refresh",
                "ExpiresIn": 3600,
            }
        }

        result = cognito_initiate_auth("user", "pass")

        assert isinstance(result, AuthSuccess)

    @patch("app.services.cognito._cognito_service", None)
    def test_cognito_get_user_creates_service(self, mock_env, mock_boto_client):
        """Should create singleton for get_user."""
        mock_boto_client.get_user.return_value = {
            "Username": "user@example.com",
            "UserAttributes": [
                {"Name": "email", "Value": "user@example.com"},
            ],
        }

        result = cognito_get_user("mock-token")

        assert result["email"] == "user@example.com"
