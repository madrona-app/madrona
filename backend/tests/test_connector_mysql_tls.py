"""MySQL TLS configuration.

PyMySQL builds its SSL context as::

    "verify_mode": ssl_verify_cert if ssl_verify_cert is not None else False

so a CA certificate passed without ``ssl_verify_cert`` is loaded and then
ignored — encrypted, unverified, and silent about it. These tests pin the
mapping from our TLS modes onto that behavior.
"""
from __future__ import annotations

from unittest.mock import patch

from app.connectors.db.connection import _get_mysql_ssl_config


def _cfg(mode: str, **refs):
    return {"mode": mode, **refs}


class TestMysqlSslConfig:
    def test_disable_returns_no_ssl(self):
        assert _get_mysql_ssl_config(_cfg("disable")) == {}

    def test_require_without_certs_encrypts_without_verifying(self):
        cfg = _get_mysql_ssl_config(_cfg("require"))
        assert cfg == {"ssl": True}
        assert "verify_mode" not in cfg

    def test_verify_ca_verifies_chain_but_not_hostname(self):
        with patch("app.connectors.db.connection.resolve_certificate", return_value=None):
            cfg = _get_mysql_ssl_config(_cfg("verify-ca"))
        assert cfg["verify_mode"] is True
        assert cfg["check_hostname"] is False

    def test_verify_full_also_checks_hostname(self):
        with patch("app.connectors.db.connection.resolve_certificate", return_value=None):
            cfg = _get_mysql_ssl_config(_cfg("verify-full"))
        assert cfg["verify_mode"] is True
        assert cfg["check_hostname"] is True

    def test_supplied_ca_enables_verification_even_in_require_mode(self):
        """The defect this guards: a pinned CA was loaded and never used."""
        with patch(
            "app.connectors.db.connection.resolve_certificate",
            side_effect=lambda ref: "CA-PEM" if ref == "ca-ref" else None,
        ):
            cfg = _get_mysql_ssl_config(_cfg("require", caCertRef="ca-ref"))
        assert cfg["ca"] == "CA-PEM"
        assert cfg["verify_mode"] is True, "a supplied CA must be verified against"
        assert cfg["check_hostname"] is False, "require does not imply hostname checking"

    def test_supplied_ca_does_not_override_disable(self):
        cfg = _get_mysql_ssl_config(_cfg("disable", caCertRef="ca-ref"))
        assert cfg == {}
