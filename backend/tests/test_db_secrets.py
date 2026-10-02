"""
Tests for database connector secrets resolution.

Tests cover:
- Inline password resolution
- Environment variable resolution
- Secret reference validation
- Certificate resolution
"""

import os
import tempfile
from unittest.mock import patch

import pytest

from app.connectors.db.secrets import (
    SecretResolutionError,
    resolve_certificate,
    resolve_password,
    resolve_secret_ref,
)


class TestResolveSecretRef:
    """Test resolve_secret_ref function."""

    def test_env_secret(self):
        """Environment variable secrets resolve correctly."""
        with patch.dict(os.environ, {"MY_DB_PASSWORD": "secret123"}):
            result = resolve_secret_ref({"type": "env", "key": "MY_DB_PASSWORD"})
            assert result == "secret123"

    def test_env_secret_not_found(self):
        """Missing environment variable raises error."""
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(SecretResolutionError) as exc_info:
                resolve_secret_ref({"type": "env", "key": "NONEXISTENT_VAR"})
            assert "Environment variable" in str(exc_info.value)
            assert "not found" in str(exc_info.value)

    def test_file_secret(self):
        """File secrets resolve correctly."""
        with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".txt") as f:
            f.write("file-secret-value")
            f.flush()
            try:
                result = resolve_secret_ref({"type": "file", "key": f.name})
                assert result == "file-secret-value"
            finally:
                os.unlink(f.name)

    def test_file_secret_not_found(self):
        """Missing file raises error."""
        with pytest.raises(SecretResolutionError) as exc_info:
            resolve_secret_ref({"type": "file", "key": "/nonexistent/path/secret.txt"})
        assert "Secret file not found" in str(exc_info.value)

    def test_vault_not_implemented(self):
        """Vault secrets raise an error when not configured."""
        with pytest.raises(SecretResolutionError) as exc_info:
            resolve_secret_ref({"type": "vault", "key": "secret/data/mydb"})
        _msg = str(exc_info.value).lower()
        assert "not implemented" in _msg or "hvac" in _msg or "vault" in _msg

    def test_ssm_not_implemented(self):
        """SSM secrets raise an error when not found/configured."""
        with pytest.raises(SecretResolutionError) as exc_info:
            resolve_secret_ref({"type": "ssm", "key": "/prod/db/password"})
        _msg = str(exc_info.value).lower()
        assert "not implemented" in _msg or "not found" in _msg or "ssm" in _msg

    def test_secrets_manager_not_implemented(self):
        """Secrets Manager secrets raise an error when not found/configured."""
        with pytest.raises(SecretResolutionError) as exc_info:
            resolve_secret_ref({"type": "secrets_manager", "key": "prod/mydb"})
        _msg = str(exc_info.value).lower()
        assert "not implemented" in _msg or "not found" in _msg or "secrets manager" in _msg

    def test_unknown_type(self):
        """Unknown secret type raises error."""
        with pytest.raises(SecretResolutionError) as exc_info:
            resolve_secret_ref({"type": "unknown", "key": "some-key"})
        assert "Unknown secret reference type" in str(exc_info.value)

    def test_missing_type(self):
        """Missing type field raises error."""
        with pytest.raises(SecretResolutionError) as exc_info:
            resolve_secret_ref({"key": "some-key"})
        assert "must have 'type' and 'key'" in str(exc_info.value)

    def test_missing_key(self):
        """Missing key field raises error."""
        with pytest.raises(SecretResolutionError) as exc_info:
            resolve_secret_ref({"type": "env"})
        assert "must have 'type' and 'key'" in str(exc_info.value)


class TestResolvePassword:
    """Test resolve_password function."""

    def test_inline_password(self):
        """Inline password returns directly."""
        auth_config = {"mode": "password", "password": "inline-secret"}
        result = resolve_password(auth_config)
        assert result == "inline-secret"

    def test_inline_password_empty(self):
        """Empty inline password returns empty string."""
        auth_config = {"mode": "password", "password": ""}
        result = resolve_password(auth_config)
        assert result == ""

    def test_secret_ref_env(self):
        """Secret ref with env type resolves correctly."""
        with patch.dict(os.environ, {"DB_PASS": "env-secret"}):
            auth_config = {
                "mode": "password",
                "secretRef": {"type": "env", "key": "DB_PASS"},
            }
            result = resolve_password(auth_config)
            assert result == "env-secret"

    def test_inline_takes_precedence(self):
        """Inline password takes precedence over secretRef."""
        with patch.dict(os.environ, {"DB_PASS": "env-secret"}):
            auth_config = {
                "mode": "password",
                "password": "inline-secret",
                "secretRef": {"type": "env", "key": "DB_PASS"},
            }
            result = resolve_password(auth_config)
            assert result == "inline-secret"

    def test_no_password_returns_none(self):
        """No password config returns None."""
        auth_config = {"mode": "password"}
        result = resolve_password(auth_config)
        assert result is None

    def test_empty_config_returns_none(self):
        """Empty auth config returns None."""
        result = resolve_password({})
        assert result is None

    def test_none_config_returns_none(self):
        """None auth config returns None."""
        result = resolve_password(None)
        assert result is None

    def test_secret_ref_failure_propagates(self):
        """SecretResolutionError propagates from secretRef."""
        auth_config = {
            "mode": "password",
            "secretRef": {"type": "vault", "key": "secret/db"},
        }
        with pytest.raises(SecretResolutionError):
            resolve_password(auth_config)


class TestResolveCertificate:
    """Test resolve_certificate function."""

    def test_file_certificate(self):
        """File certificate returns path."""
        with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".pem") as f:
            f.write("-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----")
            f.flush()
            try:
                result = resolve_certificate({"type": "file", "key": f.name})
                assert result == f.name
            finally:
                os.unlink(f.name)

    def test_file_certificate_not_found(self):
        """Missing certificate file raises error."""
        with pytest.raises(SecretResolutionError) as exc_info:
            resolve_certificate({"type": "file", "key": "/nonexistent/ca.pem"})
        assert "Certificate file not found" in str(exc_info.value)

    def test_env_certificate(self):
        """Env certificate returns value."""
        with patch.dict(os.environ, {"CA_CERT_PATH": "/etc/ssl/ca.pem"}):
            result = resolve_certificate({"type": "env", "key": "CA_CERT_PATH"})
            assert result == "/etc/ssl/ca.pem"

    def test_none_returns_none(self):
        """None cert ref returns None."""
        result = resolve_certificate(None)
        assert result is None

    def test_empty_returns_none(self):
        """Empty cert ref returns None."""
        result = resolve_certificate({})
        assert result is None

    def test_missing_type_returns_none(self):
        """Cert ref without type returns None."""
        result = resolve_certificate({"key": "some-path"})
        assert result is None

    def test_missing_key_returns_none(self):
        """Cert ref without key returns None."""
        result = resolve_certificate({"type": "file"})
        assert result is None
