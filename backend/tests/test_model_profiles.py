"""
Model-profile catalog + resolve_llm(persona, org) routing.

The load-bearing property: with NO profile configuration anywhere, every
persona resolves to the "default" profile which reproduces the global
AGENT_PROVIDER/AGENT_MODEL behavior exactly — routing is a no-op until
someone opts in via env or org config.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.models.core import Application, OrganizationApplication
from app.services import model_profiles as mp


def _settings(**overrides):
    base = dict(
        agent_provider="claude",
        agent_model="qwen2.5:14b",
        agent_claude_model="claude-haiku-4-5",
        agent_claude_max_tokens=4096,
        anthropic_api_key="test-key",
        runpod_api_key="",
        runpod_endpoint_id="",
        ollama_base_url="http://localhost:11434",
        agent_persona_profiles="",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.fixture(autouse=True)
def _clean_cache():
    mp._reset_client_cache()
    yield
    mp._reset_client_cache()


class TestCatalog:
    def test_default_mirrors_claude_settings(self):
        catalog = mp.get_profile_catalog(_settings())
        default = catalog["default"]
        assert default.provider == "claude"
        assert default.model == "claude-haiku-4-5"
        assert default.max_tokens == 4096

    def test_default_mirrors_ollama_settings(self):
        catalog = mp.get_profile_catalog(_settings(agent_provider="ollama"))
        default = catalog["default"]
        assert default.provider == "ollama"
        assert default.model == "qwen2.5:14b"

    def test_claude_haiku_profile_exists(self):
        catalog = mp.get_profile_catalog(_settings(agent_provider="ollama"))
        haiku = catalog["claude-haiku"]
        assert haiku.provider == "claude"
        assert haiku.model == "claude-haiku-4-5"


class TestResolution:
    def test_no_config_resolves_default(self):
        bound = mp.resolve_llm("visitor", settings=_settings())
        assert bound.profile.name == "default"

    def test_env_map_wins_over_default(self):
        s = _settings(agent_provider="ollama",
                      agent_persona_profiles='{"visitor": "claude-haiku"}')
        assert mp.resolve_llm("visitor", settings=s).profile.name == "claude-haiku"
        assert mp.resolve_llm("staff", settings=s).profile.name == "default"

    def test_unknown_profile_falls_through(self):
        s = _settings(agent_persona_profiles='{"visitor": "nonexistent-profile"}')
        assert mp.resolve_llm("visitor", settings=s).profile.name == "default"

    def test_invalid_env_json_ignored(self):
        s = _settings(agent_persona_profiles='not json{')
        assert mp.resolve_llm("visitor", settings=s).profile.name == "default"

    def test_org_config_wins_over_env(self, db_session, demo_tenant):
        app = db_session.query(Application).filter_by(key="guide").first()
        if not app:
            app = Application(key="guide", display_name="Guide")
            db_session.add(app)
            db_session.flush()
        db_session.add(OrganizationApplication(
            organization_id=demo_tenant.organization_id,
            application_id=app.application_id,
            enabled=True,
            config={"llm_profiles": {"visitor": "claude-haiku"}},
        ))
        db_session.commit()

        s = _settings(agent_provider="ollama", agent_persona_profiles="")
        bound = mp.resolve_llm(
            "visitor", demo_tenant.organization_id, db_session, s,
        )
        assert bound.profile.name == "claude-haiku"
        # Personas without an org override still hit default
        assert mp.resolve_llm(
            "staff", demo_tenant.organization_id, db_session, s,
        ).profile.name == "default"

    def test_org_without_guide_app_uses_default(self, db_session, demo_tenant):
        s = _settings()
        bound = mp.resolve_llm("visitor", demo_tenant.organization_id, db_session, s)
        assert bound.profile.name == "default"


class TestClientCache:
    def test_default_profile_built_fresh_per_resolution(self):
        # The default profile deliberately is NOT cached — it constructs via
        # get_llm_client each time, matching pre-routing behavior and keeping
        # that patch seam live for tests.
        s = _settings()
        a = mp.resolve_llm("visitor", settings=s)
        b = mp.resolve_llm("staff", settings=s)
        assert a.profile.name == b.profile.name == "default"
        assert a.client is not b.client

    def test_named_profile_client_cached(self):
        s = _settings(agent_provider="ollama",
                      agent_persona_profiles='{"visitor": "claude-haiku"}')
        a = mp.resolve_llm("visitor", settings=s)
        b = mp.resolve_llm("visitor", settings=s)
        assert a.client is b.client

    def test_different_profiles_different_clients(self):
        s = _settings(agent_provider="ollama",
                      agent_persona_profiles='{"visitor": "claude-haiku"}')
        visitor = mp.resolve_llm("visitor", settings=s)
        staff = mp.resolve_llm("staff", settings=s)
        assert visitor.client is not staff.client

    def test_claude_client_bound_to_profile_model(self):
        s = _settings(agent_provider="ollama",
                      agent_persona_profiles='{"visitor": "claude-haiku"}')
        bound = mp.resolve_llm("visitor", settings=s)
        # ClaudeClient binds model at construction — per-profile clients make
        # that safe. Assert the binding matches the profile.
        assert bound.client.model == "claude-haiku-4-5"
        assert bound.profile.provider == "claude"
