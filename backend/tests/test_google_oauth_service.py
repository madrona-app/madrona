"""Unit tests for app/services/google_oauth.py."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

import pytest

from app.services.google_oauth import GoogleOAuthService


def _settings(client_id="cid", client_secret="csecret", redirect_uri="https://app/cb"):
    s = MagicMock()
    s.google_oauth_client_id = client_id
    s.google_oauth_client_secret = client_secret
    s.google_oauth_redirect_uri = redirect_uri
    return s


@pytest.fixture
def configured_service():
    with patch(
        "app.services.google_oauth.get_settings",
        return_value=_settings(),
    ):
        yield GoogleOAuthService()


class TestIsConfigured:
    def test_returns_true_when_id_and_secret_set(self, configured_service):
        assert configured_service.is_configured() is True

    def test_returns_false_when_id_missing(self):
        with patch(
            "app.services.google_oauth.get_settings",
            return_value=_settings(client_id=""),
        ):
            assert GoogleOAuthService().is_configured() is False

    def test_returns_false_when_secret_missing(self):
        with patch(
            "app.services.google_oauth.get_settings",
            return_value=_settings(client_secret=""),
        ):
            assert GoogleOAuthService().is_configured() is False


class TestGetAuthorizationUrl:
    def test_includes_required_params(self, configured_service):
        url = configured_service.get_authorization_url()
        parsed = urlparse(url)
        assert parsed.netloc == "accounts.google.com"
        params = parse_qs(parsed.query)
        assert params["client_id"] == ["cid"]
        assert params["redirect_uri"] == ["https://app/cb"]
        assert params["response_type"] == ["code"]
        assert params["access_type"] == ["offline"]
        assert params["prompt"] == ["consent"]
        # State omitted by default
        assert "state" not in params

    def test_scopes_concatenated_with_space(self, configured_service):
        url = configured_service.get_authorization_url()
        params = parse_qs(urlparse(url).query)
        scope = params["scope"][0]
        assert "spreadsheets" in scope
        assert "drive.file" in scope
        # Single string with space separator
        assert " " in scope

    def test_state_passed_through(self, configured_service):
        url = configured_service.get_authorization_url(state="xyz-csrf")
        params = parse_qs(urlparse(url).query)
        assert params["state"] == ["xyz-csrf"]


class TestExchangeCodeForTokens:
    def test_posts_to_token_uri_with_authorization_code_grant(self, configured_service):
        response = MagicMock()
        response.json.return_value = {
            "access_token": "at",
            "refresh_token": "rt",
            "expires_in": 3600,
        }
        response.raise_for_status = MagicMock()
        with patch("app.services.google_oauth.requests.post", return_value=response) as p:
            result = configured_service.exchange_code_for_tokens("auth-code")
        # Called the right URL
        assert p.call_args.args[0] == "https://oauth2.googleapis.com/token"
        body = p.call_args.kwargs["data"]
        assert body["grant_type"] == "authorization_code"
        assert body["code"] == "auth-code"
        assert body["client_id"] == "cid"
        assert body["client_secret"] == "csecret"
        # Result includes computed expiry
        assert result["access_token"] == "at"
        assert result["refresh_token"] == "rt"
        assert result["expires_in"] == 3600
        assert isinstance(result["token_expiry"], datetime)

    def test_token_expiry_is_in_the_future_by_expires_in_seconds(self, configured_service):
        response = MagicMock()
        response.json.return_value = {"access_token": "at", "expires_in": 7200}
        response.raise_for_status = MagicMock()
        with patch("app.services.google_oauth.requests.post", return_value=response):
            result = configured_service.exchange_code_for_tokens("c")
        delta = result["token_expiry"] - datetime.now(timezone.utc)
        assert 7100 < delta.total_seconds() < 7300

    def test_defaults_expires_in_to_3600_when_missing(self, configured_service):
        response = MagicMock()
        response.json.return_value = {"access_token": "at"}
        response.raise_for_status = MagicMock()
        with patch("app.services.google_oauth.requests.post", return_value=response):
            result = configured_service.exchange_code_for_tokens("c")
        assert result["expires_in"] == 3600

    def test_refresh_token_is_optional(self, configured_service):
        response = MagicMock()
        response.json.return_value = {"access_token": "at"}
        response.raise_for_status = MagicMock()
        with patch("app.services.google_oauth.requests.post", return_value=response):
            result = configured_service.exchange_code_for_tokens("c")
        assert result["refresh_token"] is None

    def test_raises_on_http_error(self, configured_service):
        response = MagicMock()
        response.raise_for_status.side_effect = Exception("400")
        with patch("app.services.google_oauth.requests.post", return_value=response):
            with pytest.raises(Exception, match="400"):
                configured_service.exchange_code_for_tokens("bad")


class TestRefreshAccessToken:
    def test_uses_refresh_token_grant(self, configured_service):
        response = MagicMock()
        response.json.return_value = {"access_token": "new-at", "expires_in": 3600}
        response.raise_for_status = MagicMock()
        with patch("app.services.google_oauth.requests.post", return_value=response) as p:
            result = configured_service.refresh_access_token("rt-1")
        body = p.call_args.kwargs["data"]
        assert body["grant_type"] == "refresh_token"
        assert body["refresh_token"] == "rt-1"
        assert result["access_token"] == "new-at"
        assert result["expires_in"] == 3600
        assert isinstance(result["token_expiry"], datetime)

    def test_does_not_return_refresh_token(self, configured_service):
        # refresh_access_token's contract returns access_token + expiry only
        response = MagicMock()
        response.json.return_value = {"access_token": "new-at", "expires_in": 60}
        response.raise_for_status = MagicMock()
        with patch("app.services.google_oauth.requests.post", return_value=response):
            result = configured_service.refresh_access_token("rt-1")
        assert "refresh_token" not in result


class TestGetCredentials:
    def test_builds_credentials_with_token(self, configured_service):
        creds = configured_service.get_credentials(access_token="at")
        assert creds.token == "at"
        assert creds.client_id == "cid"
        assert creds.client_secret == "csecret"
        assert creds.token_uri == "https://oauth2.googleapis.com/token"

    def test_passes_through_refresh_token_and_expiry(self, configured_service):
        expiry = datetime.now(timezone.utc) + timedelta(hours=1)
        creds = configured_service.get_credentials(
            access_token="at",
            refresh_token="rt",
            token_expiry=expiry,
        )
        assert creds.refresh_token == "rt"
        assert creds.expiry is not None


class TestNeedsRefresh:
    def test_true_when_expiry_is_none(self, configured_service):
        assert configured_service.needs_refresh(None) is True

    def test_true_when_expired(self, configured_service):
        past = datetime.now(timezone.utc) - timedelta(minutes=10)
        assert configured_service.needs_refresh(past) is True

    def test_true_when_expiring_within_5_minute_buffer(self, configured_service):
        soon = datetime.now(timezone.utc) + timedelta(minutes=2)
        assert configured_service.needs_refresh(soon) is True

    def test_false_when_expiry_is_far_future(self, configured_service):
        far = datetime.now(timezone.utc) + timedelta(hours=2)
        assert configured_service.needs_refresh(far) is False
