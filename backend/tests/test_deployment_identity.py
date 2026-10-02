"""
Madrona is software anyone can run, so nothing it sends may name one particular
deployment. Sender addresses, the support address and the outbound User-Agent
all identify whoever is running *this* install, derived from APP_BASE_URL unless
set explicitly.

These tests exist because the opposite shipped: the defaults named the hosted
service's own domain, so a self-hosted install sent email as someone else and
told Wikidata someone else was calling.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from app.services import deployment_identity as ident


def _settings(**overrides):
    base = dict(
        app_base_url="https://collections.museum.example",
        ses_accounts_from="",
        ses_notifications_from="",
        support_email="",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class TestAddressesDeriveFromTheDeployment:
    def test_unset_addresses_use_the_app_base_url_host(self):
        with patch.object(ident, "get_settings", return_value=_settings()):
            assert ident.accounts_from() == "accounts@collections.museum.example"
            assert ident.notifications_from() == "notifications@collections.museum.example"
            assert ident.support_address() == "support@collections.museum.example"

    def test_an_explicit_setting_wins(self):
        explicit = _settings(
            ses_accounts_from="no-reply@mail.museum.example",
            ses_notifications_from="alerts@mail.museum.example",
            support_email="help@museum.example",
        )
        with patch.object(ident, "get_settings", return_value=explicit):
            assert ident.accounts_from() == "no-reply@mail.museum.example"
            assert ident.notifications_from() == "alerts@mail.museum.example"
            assert ident.support_address() == "help@museum.example"

    def test_the_outbound_user_agent_names_this_deployment(self):
        with patch.object(ident, "get_settings", return_value=_settings()):
            agent = ident.outbound_user_agent()
        assert "https://collections.museum.example" in agent
        assert "support@collections.museum.example" in agent


class TestNoDefaultNamesAHostedService:
    def test_config_defaults_carry_no_fixed_domain(self):
        """The shipped defaults must be empty, so the derived address applies.
        A default like accounts@<some-domain> would silently make every install
        send as that domain."""
        from app.config import Settings

        for field in ("ses_accounts_from", "ses_notifications_from", "support_email"):
            assert Settings.model_fields[field].default == "", field
