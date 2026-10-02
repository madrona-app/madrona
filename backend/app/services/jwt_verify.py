"""
JWT verification for Cognito ID tokens.

Implements secure token verification with:
- Cached JWKS (JSON Web Key Set) fetching with automatic rotation
- Token signature verification using RS256
- Claims validation (issuer, audience, token_use, expiration)
- Redis-backed JWKS caching for distributed deployments

Usage:
    verifier = CognitoJWTVerifier()
    claims = verifier.verify_id_token(id_token)
    # claims contains: sub, email, email_verified, etc.
"""

import os
import time
import logging
from typing import Dict, Any, Optional
from dataclasses import dataclass
from threading import Lock
import json

import jwt
import requests
from jwt import PyJWKClient, PyJWK
from jwt.exceptions import (
    InvalidTokenError,
    ExpiredSignatureError,
    InvalidAudienceError,
    InvalidIssuerError,
)

from app.services.redis_client import get_redis_client

logger = logging.getLogger(__name__)


class TokenVerificationError(Exception):
    """Base exception for token verification errors."""
    pass


class TokenExpiredError(TokenVerificationError):
    """Token has expired."""
    pass


class InvalidTokenSignatureError(TokenVerificationError):
    """Token signature is invalid."""
    pass


class InvalidTokenClaimsError(TokenVerificationError):
    """Token claims are invalid (wrong issuer, audience, etc)."""
    pass


@dataclass
class JWKSCache:
    """Cached JWKS data with expiration."""
    keys: Dict[str, Any]
    fetched_at: float
    ttl_seconds: int = 3600  # 1 hour default


class CognitoJWTVerifier:
    """
    Verifier for Cognito JWT tokens with cached JWKS.

    Features:
    - Automatic JWKS fetching and caching
    - Key rotation safe (refetches on unknown kid)
    - Thread-safe caching
    - Validates issuer, audience, token_use, and expiration

    Usage:
        verifier = CognitoJWTVerifier()

        # Verify ID token
        claims = verifier.verify_id_token(id_token)
        print(claims['email'])

        # Verify access token
        claims = verifier.verify_access_token(access_token)
        print(claims['sub'])
    """

    def __init__(
        self,
        region: Optional[str] = None,
        user_pool_id: Optional[str] = None,
        client_id: Optional[str] = None,
        jwks_cache_ttl: int = 3600,
    ):
        """
        Initialize the JWT verifier.

        Args:
            region: AWS region (defaults to AWS_REGION env var)
            user_pool_id: Cognito User Pool ID (defaults to COGNITO_USER_POOL_ID env var)
            client_id: App client ID for audience validation (defaults to COGNITO_CLIENT_ID env var)
            jwks_cache_ttl: JWKS cache TTL in seconds (default 1 hour)
        """
        self.region = region or os.environ.get('AWS_REGION', 'us-west-2')
        self.user_pool_id = user_pool_id or os.environ.get('COGNITO_USER_POOL_ID')
        self.client_id = client_id or os.environ.get('COGNITO_CLIENT_ID')

        if not self.user_pool_id:
            raise ValueError("COGNITO_USER_POOL_ID is required")
        if not self.client_id:
            raise ValueError("COGNITO_CLIENT_ID is required")

        # Compute JWKS URI and issuer
        self.issuer = f"https://cognito-idp.{self.region}.amazonaws.com/{self.user_pool_id}"
        self.jwks_uri = f"{self.issuer}/.well-known/jwks.json"

        # Cache configuration
        self._jwks_cache: Optional[JWKSCache] = None
        self._cache_lock = Lock()
        self._jwks_cache_ttl = jwks_cache_ttl

        # PyJWKClient for key fetching (handles caching internally too)
        self._jwk_client = PyJWKClient(self.jwks_uri, cache_keys=True, lifespan=jwks_cache_ttl)

        # Redis cache key for JWKS
        self._redis_jwks_key = f"madrona:jwks:{self.user_pool_id}"
        self._redis_jwks_meta_key = f"madrona:jwks:{self.user_pool_id}:meta"

        logger.info(f"Initialized JWT verifier for {self.user_pool_id}")

    def _get_jwks_from_redis(self) -> Optional[Dict[str, Any]]:
        """
        Try to get JWKS from Redis cache.

        Returns:
            Dict of JWKS data if cached and valid, None otherwise
        """
        redis = get_redis_client()
        if not redis.is_available():
            return None

        try:
            # Check if cache is valid
            meta = redis.client.hgetall(self._redis_jwks_meta_key)
            if not meta:
                return None

            fetched_at = float(meta.get(b'fetched_at', 0))
            if time.time() - fetched_at > self._jwks_cache_ttl:
                return None

            # Get JWKS data
            jwks_data = redis.client.get(self._redis_jwks_key)
            if not jwks_data:
                return None

            return json.loads(jwks_data.decode())
        except Exception as e:
            logger.debug(f"Failed to get JWKS from Redis: {e}")
            return None

    def _store_jwks_in_redis(self, jwks: Dict[str, Any]) -> None:
        """
        Store JWKS in Redis cache.

        Args:
            jwks: JWKS data to cache
        """
        redis = get_redis_client()
        if not redis.is_available():
            return

        try:
            pipe = redis.client.pipeline()
            pipe.set(self._redis_jwks_key, json.dumps(jwks))
            pipe.hset(self._redis_jwks_meta_key, mapping={'fetched_at': str(time.time())})
            # Set TTL slightly longer than cache TTL to avoid edge cases
            pipe.expire(self._redis_jwks_key, self._jwks_cache_ttl + 60)
            pipe.expire(self._redis_jwks_meta_key, self._jwks_cache_ttl + 60)
            pipe.execute()
            logger.debug("Stored JWKS in Redis cache")
        except Exception as e:
            logger.debug(f"Failed to store JWKS in Redis: {e}")

    def _fetch_jwks_direct(self) -> Optional[Dict[str, Any]]:
        """
        Fetch JWKS directly from Cognito.

        Returns:
            JWKS data dict or None on failure
        """
        try:
            response = requests.get(self.jwks_uri, timeout=10)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.warning(f"Failed to fetch JWKS directly: {e}")
            return None

    def _get_signing_key(self, token: str) -> PyJWK:
        """
        Get the signing key for a token.

        Tries Redis cache first, then falls back to PyJWKClient.
        Handles key rotation by refetching JWKS if key not found.

        Args:
            token: JWT token string

        Returns:
            PyJWK signing key

        Raises:
            InvalidTokenSignatureError: If key cannot be found
        """
        # Extract kid from token header
        try:
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get('kid')
        except Exception:
            kid = None

        # Try Redis cache first if we have a kid
        if kid:
            cached_jwks = self._get_jwks_from_redis()
            if cached_jwks and 'keys' in cached_jwks:
                for key_data in cached_jwks['keys']:
                    if key_data.get('kid') == kid:
                        try:
                            return PyJWK.from_dict(key_data)
                        except Exception as e:
                            logger.debug(f"Failed to construct key from Redis cache: {e}")
                            break

        # Fall back to PyJWKClient
        try:
            signing_key = self._jwk_client.get_signing_key_from_jwt(token)

            # Store JWKS in Redis for other processes
            jwks = self._fetch_jwks_direct()
            if jwks:
                self._store_jwks_in_redis(jwks)

            return signing_key
        except jwt.exceptions.PyJWKClientError as e:
            # Key not found - might be rotation, try refreshing
            logger.warning(f"Key not found, attempting refresh: {e}")
            try:
                # Force refresh by creating new client
                self._jwk_client = PyJWKClient(
                    self.jwks_uri,
                    cache_keys=True,
                    lifespan=self._jwks_cache_ttl
                )
                signing_key = self._jwk_client.get_signing_key_from_jwt(token)

                # Update Redis cache with new JWKS
                jwks = self._fetch_jwks_direct()
                if jwks:
                    self._store_jwks_in_redis(jwks)

                return signing_key
            except Exception as e2:
                raise InvalidTokenSignatureError(f"Cannot find signing key: {e2}")

    def verify_id_token(self, token: str) -> Dict[str, Any]:
        """
        Verify a Cognito ID token.

        Validates:
        - Token signature using JWKS
        - Token expiration
        - Issuer matches Cognito User Pool
        - Audience matches app client ID
        - token_use claim is "id"

        Args:
            token: JWT ID token string

        Returns:
            Dict of verified claims including:
            - sub: User's unique identifier
            - email: User's email address
            - email_verified: Whether email is verified
            - cognito:username: Cognito username
            - aud: Audience (client ID)
            - iss: Issuer
            - exp: Expiration timestamp
            - iat: Issued at timestamp

        Raises:
            TokenExpiredError: Token has expired
            InvalidTokenSignatureError: Signature verification failed
            InvalidTokenClaimsError: Claims validation failed
        """
        return self._verify_token(token, expected_token_use="id")

    def verify_access_token(self, token: str) -> Dict[str, Any]:
        """
        Verify a Cognito access token.

        Validates:
        - Token signature using JWKS
        - Token expiration
        - Issuer matches Cognito User Pool
        - token_use claim is "access"

        Note: Access tokens use 'client_id' claim instead of 'aud'.

        Args:
            token: JWT access token string

        Returns:
            Dict of verified claims

        Raises:
            TokenExpiredError: Token has expired
            InvalidTokenSignatureError: Signature verification failed
            InvalidTokenClaimsError: Claims validation failed
        """
        return self._verify_token(token, expected_token_use="access")

    def _verify_token(self, token: str, expected_token_use: str) -> Dict[str, Any]:
        """
        Internal token verification with configurable token_use.

        Args:
            token: JWT token string
            expected_token_use: Expected value of token_use claim ("id" or "access")

        Returns:
            Verified claims dict

        Raises:
            TokenVerificationError subclass on failure
        """
        try:
            # Get signing key
            signing_key = self._get_signing_key(token)

            # Decode and verify
            # For ID tokens: audience is client_id
            # For access tokens: no audience claim, use client_id claim instead
            if expected_token_use == "id":
                claims = jwt.decode(
                    token,
                    signing_key.key,
                    algorithms=["RS256"],
                    audience=self.client_id,
                    issuer=self.issuer,
                    options={
                        "verify_exp": True,
                        "verify_iat": True,
                        "verify_aud": True,
                        "verify_iss": True,
                        "require": ["exp", "iat", "iss", "aud", "sub", "token_use"],
                    },
                )
            else:
                # Access tokens don't have aud, they have client_id
                claims = jwt.decode(
                    token,
                    signing_key.key,
                    algorithms=["RS256"],
                    issuer=self.issuer,
                    options={
                        "verify_exp": True,
                        "verify_iat": True,
                        "verify_aud": False,  # Access tokens don't have aud
                        "verify_iss": True,
                        "require": ["exp", "iat", "iss", "sub", "token_use", "client_id"],
                    },
                )
                # Manually verify client_id for access tokens
                if claims.get("client_id") != self.client_id:
                    raise InvalidTokenClaimsError(
                        f"Invalid client_id: expected {self.client_id}, got {claims.get('client_id')}"
                    )

            # Verify token_use claim
            token_use = claims.get("token_use")
            if token_use != expected_token_use:
                raise InvalidTokenClaimsError(
                    f"Invalid token_use: expected '{expected_token_use}', got '{token_use}'"
                )

            return claims

        except ExpiredSignatureError:
            raise TokenExpiredError("Token has expired")

        except InvalidAudienceError as e:
            raise InvalidTokenClaimsError(f"Invalid audience: {e}")

        except InvalidIssuerError as e:
            raise InvalidTokenClaimsError(f"Invalid issuer: {e}")

        except jwt.exceptions.DecodeError as e:
            raise InvalidTokenSignatureError(f"Token decode failed: {e}")

        except jwt.exceptions.InvalidSignatureError as e:
            raise InvalidTokenSignatureError(f"Invalid signature: {e}")

        except InvalidTokenError as e:
            raise TokenVerificationError(f"Token verification failed: {e}")

    def extract_claims_unverified(self, token: str) -> Dict[str, Any]:
        """
        Extract claims from a token WITHOUT verification.

        WARNING: Only use this for debugging or when you've already verified
        the token. Claims returned are NOT validated.

        Args:
            token: JWT token string

        Returns:
            Unverified claims dict
        """
        return jwt.decode(token, options={"verify_signature": False})


# Singleton instance
_verifier: Optional[CognitoJWTVerifier] = None


def get_jwt_verifier() -> CognitoJWTVerifier:
    """Get or create singleton JWT verifier instance."""
    global _verifier
    if _verifier is None:
        _verifier = CognitoJWTVerifier()
    return _verifier


def verify_cognito_id_token(token: str) -> Dict[str, Any]:
    """
    Verify a Cognito ID token (convenience function).

    Args:
        token: JWT ID token string

    Returns:
        Verified claims dict

    Raises:
        TokenVerificationError: Verification failed
    """
    return get_jwt_verifier().verify_id_token(token)


def verify_cognito_access_token(token: str) -> Dict[str, Any]:
    """
    Verify a Cognito access token (convenience function).

    Args:
        token: JWT access token string

    Returns:
        Verified claims dict

    Raises:
        TokenVerificationError: Verification failed
    """
    return get_jwt_verifier().verify_access_token(token)
