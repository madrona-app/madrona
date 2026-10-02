"""
Tests for connector config redaction.

Verifies that sensitive values (passwords, secrets, tokens, etc.) are
properly redacted from API responses to prevent credential leakage.

Run with: pytest tests/test_connector_redaction.py -v
"""

import pytest
from app.fastapi_app.routers.connectors import (
    redact_config,
    _is_sensitive_key,
    REDACTED,
)


class TestIsSensitiveKey:
    """Test sensitive key detection."""

    def test_detects_password(self):
        """Detects password keys."""
        assert _is_sensitive_key("password")
        assert _is_sensitive_key("db_password")
        assert _is_sensitive_key("userPassword")
        assert _is_sensitive_key("PASSWORD")

    def test_detects_secret(self):
        """Detects secret keys."""
        assert _is_sensitive_key("secret")
        assert _is_sensitive_key("client_secret")
        assert _is_sensitive_key("secretKey")

    def test_detects_token(self):
        """Detects token keys."""
        assert _is_sensitive_key("token")
        assert _is_sensitive_key("access_token")
        assert _is_sensitive_key("auth_token")
        assert _is_sensitive_key("authToken")

    def test_detects_api_key(self):
        """Detects API key variations."""
        assert _is_sensitive_key("api_key")
        assert _is_sensitive_key("apiKey")
        assert _is_sensitive_key("api-key")

    def test_detects_private_key(self):
        """Detects private key variations."""
        assert _is_sensitive_key("private_key")
        assert _is_sensitive_key("privateKey")
        assert _is_sensitive_key("private-key")

    def test_detects_client_key(self):
        """Detects client key variations."""
        assert _is_sensitive_key("client_key")
        assert _is_sensitive_key("clientKey")

    def test_detects_access_key(self):
        """Detects access key variations."""
        assert _is_sensitive_key("access_key")
        assert _is_sensitive_key("accessKey")

    def test_detects_credential(self):
        """Detects credential keys."""
        assert _is_sensitive_key("credential")
        assert _is_sensitive_key("credentials")
        assert _is_sensitive_key("userCredential")

    def test_detects_bearer(self):
        """Detects bearer token keys."""
        assert _is_sensitive_key("bearer")
        assert _is_sensitive_key("bearerToken")

    def test_non_sensitive_keys(self):
        """Non-sensitive keys are not flagged."""
        assert not _is_sensitive_key("host")
        assert not _is_sensitive_key("port")
        assert not _is_sensitive_key("database")
        assert not _is_sensitive_key("username")
        assert not _is_sensitive_key("user")
        assert not _is_sensitive_key("name")
        assert not _is_sensitive_key("schema")
        assert not _is_sensitive_key("ssl_mode")


class TestRedactConfig:
    """Test config redaction function."""

    def test_redacts_password(self):
        """Redacts password values."""
        config = {
            "host": "localhost",
            "port": 5432,
            "username": "admin",
            "password": "super_secret_123",
        }

        result = redact_config(config)

        assert result["host"] == "localhost"
        assert result["port"] == 5432
        assert result["username"] == "admin"
        assert result["password"] == REDACTED

    def test_redacts_nested_secrets(self):
        """Redacts secrets in nested dicts."""
        config = {
            "host": "localhost",
            "auth": {
                "mode": "password",
                "password": "secret123",
                "token": "bearer_token_here",
            },
        }

        result = redact_config(config)

        assert result["host"] == "localhost"
        assert result["auth"]["mode"] == "password"
        assert result["auth"]["password"] == REDACTED
        assert result["auth"]["token"] == REDACTED

    def test_redacts_deeply_nested(self):
        """Redacts secrets at any depth."""
        config = {
            "level1": {
                "level2": {
                    "level3": {
                        "api_key": "deep_secret",
                    }
                }
            }
        }

        result = redact_config(config)

        assert result["level1"]["level2"]["level3"]["api_key"] == REDACTED

    def test_preserves_empty_values(self):
        """Preserves empty/null sensitive values."""
        config = {
            "password": "",
            "secret": None,
            "username": "admin",
        }

        result = redact_config(config)

        assert result["password"] == ""
        assert result["secret"] is None
        assert result["username"] == "admin"

    def test_handles_lists(self):
        """Handles lists containing dicts."""
        config = {
            "databases": [
                {"name": "db1", "password": "secret1"},
                {"name": "db2", "password": "secret2"},
            ]
        }

        result = redact_config(config)

        assert result["databases"][0]["name"] == "db1"
        assert result["databases"][0]["password"] == REDACTED
        assert result["databases"][1]["name"] == "db2"
        assert result["databases"][1]["password"] == REDACTED

    def test_handles_mixed_lists(self):
        """Handles lists with mixed types."""
        config = {
            "items": [
                "string_value",
                123,
                {"key": "value", "secret": "hidden"},
                ["nested", "list"],
            ]
        }

        result = redact_config(config)

        assert result["items"][0] == "string_value"
        assert result["items"][1] == 123
        assert result["items"][2]["key"] == "value"
        assert result["items"][2]["secret"] == REDACTED
        assert result["items"][3] == ["nested", "list"]

    def test_does_not_modify_original(self):
        """Original config is not modified."""
        config = {
            "host": "localhost",
            "password": "secret",
        }

        result = redact_config(config)

        assert config["password"] == "secret"  # Original unchanged
        assert result["password"] == REDACTED  # Result redacted

    def test_handles_none_config(self):
        """Returns None for None input."""
        assert redact_config(None) is None

    def test_handles_empty_config(self):
        """Handles empty config dict."""
        assert redact_config({}) == {}

    def test_database_source_config(self):
        """Real-world database source config redaction."""
        config = {
            "type": "postgres",
            "host": "db.example.com",
            "port": 5432,
            "database": "production",
            "username": "app_user",
            "auth": {
                "mode": "password",
                "password": "P@ssw0rd!",
            },
            "tls": {
                "mode": "verify-full",
                "caCert": "/path/to/ca.crt",
                "clientCert": "/path/to/client.crt",
                "clientKey": "/path/to/client.key",  # Should be redacted
            },
            "driverOptions": {
                "connectTimeoutMs": 30000,
                "statementTimeoutMs": 60000,
            },
        }

        result = redact_config(config)

        # Non-sensitive fields preserved
        assert result["type"] == "postgres"
        assert result["host"] == "db.example.com"
        assert result["port"] == 5432
        assert result["database"] == "production"
        assert result["username"] == "app_user"
        assert result["tls"]["mode"] == "verify-full"
        assert result["tls"]["caCert"] == "/path/to/ca.crt"
        assert result["tls"]["clientCert"] == "/path/to/client.crt"
        assert result["driverOptions"]["connectTimeoutMs"] == 30000

        # Sensitive fields redacted
        assert result["auth"]["password"] == REDACTED
        assert result["tls"]["clientKey"] == REDACTED

    def test_oauth_config_redaction(self):
        """OAuth configuration redaction."""
        config = {
            "type": "salesforce",
            "clientId": "connected_app_id",
            "clientSecret": "oauth_client_secret",
            "accessToken": "bearer_token_value",
            "refreshToken": "refresh_token_value",
            "instanceUrl": "https://na1.salesforce.com",
        }

        result = redact_config(config)

        assert result["type"] == "salesforce"
        assert result["clientId"] == "connected_app_id"  # ID is not secret
        assert result["clientSecret"] == REDACTED
        assert result["accessToken"] == REDACTED
        assert result["refreshToken"] == REDACTED
        assert result["instanceUrl"] == "https://na1.salesforce.com"

    def test_aws_config_redaction(self):
        """AWS credentials redaction."""
        config = {
            "region": "us-west-2",
            "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
            "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            "bucket": "my-bucket",
        }

        result = redact_config(config)

        assert result["region"] == "us-west-2"
        # accessKeyId contains "access" + "key" so _is_sensitive_key matches it
        assert result["accessKeyId"] == REDACTED
        assert result["secretAccessKey"] == REDACTED
        assert result["bucket"] == "my-bucket"


class TestRedactConfigEdgeCases:
    """Test edge cases for redaction."""

    def test_numeric_values_not_redacted(self):
        """Numeric values are not treated as secrets."""
        config = {"port": 5432, "password": "secret"}
        result = redact_config(config)
        assert result["port"] == 5432

    def test_boolean_values_preserved(self):
        """Boolean values are preserved."""
        config = {"ssl": True, "password": "secret"}
        result = redact_config(config)
        assert result["ssl"] is True

    def test_unicode_keys_and_values(self):
        """Handles unicode keys and values."""
        config = {
            "password": "pароль",  # Russian value
        }
        result = redact_config(config)
        assert result["password"] == REDACTED

    def test_case_insensitive_detection(self):
        """Key detection is case-insensitive."""
        config = {
            "PASSWORD": "secret1",
            "Password": "secret2",
            "passWord": "secret3",
        }
        result = redact_config(config)
        assert result["PASSWORD"] == REDACTED
        assert result["Password"] == REDACTED
        assert result["passWord"] == REDACTED

    def test_partial_key_match(self):
        """Partial key matches are detected."""
        config = {
            "database_password": "secret",
            "oauth_client_secret": "secret",
            "my_api_key_value": "secret",
        }
        result = redact_config(config)
        assert result["database_password"] == REDACTED
        assert result["oauth_client_secret"] == REDACTED
        assert result["my_api_key_value"] == REDACTED
