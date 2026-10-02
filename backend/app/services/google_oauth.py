"""
Google OAuth service for user-based Sheets access.

Handles OAuth flow for users to authorize the application to create and manage
Google Sheets on their behalf.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import requests
from google.oauth2.credentials import Credentials

from app.config import get_settings

logger = logging.getLogger(__name__)


class GoogleOAuthService:
    """Service for Google OAuth 2.0 authorization flow."""

    SCOPES = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file",
    ]
    AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
    TOKEN_URI = "https://oauth2.googleapis.com/token"

    def __init__(self):
        """Initialize OAuth service with configuration."""
        settings = get_settings()
        self.client_id = settings.google_oauth_client_id
        self.client_secret = settings.google_oauth_client_secret
        self.redirect_uri = settings.google_oauth_redirect_uri

        if not self.client_id or not self.client_secret:
            logger.warning(
                "Google OAuth credentials not configured. "
                "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET."
            )

    def is_configured(self) -> bool:
        """Check if OAuth is properly configured."""
        return bool(self.client_id and self.client_secret)

    def get_authorization_url(self, state: str | None = None) -> str:
        """
        Generate Google OAuth authorization URL.

        Args:
            state: Optional state parameter for CSRF protection

        Returns:
            Authorization URL for user to visit
        """
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": " ".join(self.SCOPES),
            "access_type": "offline",  # Request refresh token
            "prompt": "consent",  # Force consent to get refresh token
        }

        if state:
            params["state"] = state

        return f"{self.AUTH_URI}?{urlencode(params)}"

    def exchange_code_for_tokens(self, code: str) -> dict[str, Any]:
        """
        Exchange authorization code for access and refresh tokens.

        Args:
            code: Authorization code from OAuth callback

        Returns:
            Dictionary with access_token, refresh_token, expires_in, token_expiry

        Raises:
            Exception: If token exchange fails
        """
        data = {
            "code": code,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "redirect_uri": self.redirect_uri,
            "grant_type": "authorization_code",
        }

        response = requests.post(self.TOKEN_URI, data=data, timeout=10)
        response.raise_for_status()

        token_data = response.json()

        # Calculate token expiry
        expires_in = token_data.get("expires_in", 3600)
        token_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        return {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": expires_in,
            "token_expiry": token_expiry,
        }

    def refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        """
        Refresh an expired access token using a refresh token.

        Args:
            refresh_token: The refresh token

        Returns:
            Dictionary with new access_token, expires_in, token_expiry

        Raises:
            Exception: If token refresh fails
        """
        data = {
            "refresh_token": refresh_token,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "grant_type": "refresh_token",
        }

        response = requests.post(self.TOKEN_URI, data=data, timeout=10)
        response.raise_for_status()

        token_data = response.json()

        # Calculate token expiry
        expires_in = token_data.get("expires_in", 3600)
        token_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        return {
            "access_token": token_data["access_token"],
            "expires_in": expires_in,
            "token_expiry": token_expiry,
        }

    def get_credentials(
        self,
        access_token: str,
        refresh_token: str | None = None,
        token_expiry: datetime | None = None,
    ) -> Credentials:
        """
        Create Google OAuth credentials object.

        Args:
            access_token: OAuth access token
            refresh_token: OAuth refresh token (optional)
            token_expiry: Token expiration time (optional)

        Returns:
            Google Credentials object for API calls
        """
        return Credentials(
            token=access_token,
            refresh_token=refresh_token,
            token_uri=self.TOKEN_URI,
            client_id=self.client_id,
            client_secret=self.client_secret,
            scopes=self.SCOPES,
            expiry=token_expiry,
        )

    def needs_refresh(self, token_expiry: datetime | None) -> bool:
        """
        Check if an access token needs to be refreshed.

        Args:
            token_expiry: Token expiration datetime

        Returns:
            True if token is expired or will expire soon (within 5 minutes)
        """
        if not token_expiry:
            return True

        # Refresh if expired or expiring within 5 minutes
        buffer = timedelta(minutes=5)
        return datetime.now(timezone.utc) >= (token_expiry - buffer)
