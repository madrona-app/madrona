"""
Named LLM model profiles + per-(persona, org) routing.

The economic enabler for the Visitor Guide product line (see
docs/architecture/visitor-guide-product-line.md): visitor traffic can run on
a cheap/capacity-bound profile while staff personas use a stronger model —
both within the same org. Resolution precedence, per persona:

  1. Org override:   Guide OrganizationApplication.config["llm_profiles"]
                     e.g. {"visitor": "claude-haiku"}
  2. Env default:    AGENT_PERSONA_PROFILES JSON map,
                     e.g. '{"visitor": "claude-haiku"}'
  3. "default":      built from AGENT_PROVIDER / AGENT_MODEL — byte-for-byte
                     today's behavior, so with no configuration this module
                     changes nothing.

Unknown profile names log a warning and fall through — routing must never
500 a visitor. Clients are cached per profile (ClaudeClient binds its model
at construction, so one client per profile sidesteps that wrinkle).

Adding a self-hosted profile later (e.g. "local-32b" on a dedicated RunPod
endpoint) is one new catalog entry — no refactor.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Literal, Optional
from uuid import UUID

logger = logging.getLogger(__name__)

Provider = Literal["claude", "runpod", "ollama"]

DEFAULT_PROFILE = "default"


@dataclass(frozen=True)
class ModelProfile:
    name: str
    provider: Provider
    model: str
    max_tokens: int = 4096
    endpoint_id: str | None = None  # runpod
    base_url: str | None = None     # ollama

    @property
    def cache_key(self) -> tuple:
        return (self.provider, self.model, self.max_tokens, self.endpoint_id, self.base_url)


@dataclass(frozen=True)
class BoundLLM:
    """A resolved client + the profile it was built from."""
    client: object  # LLMClient
    profile: ModelProfile


def get_profile_catalog(settings) -> dict[str, ModelProfile]:
    """Named profiles available for routing, built from settings."""
    provider = getattr(settings, "agent_provider", "ollama")
    claude_model = getattr(settings, "agent_claude_model", "claude-haiku-4-5")
    claude_max_tokens = getattr(settings, "agent_claude_max_tokens", 4096)

    if provider == "claude":
        default_model = claude_model
    else:
        default_model = getattr(settings, "agent_model", "qwen2.5:14b")

    catalog = {
        # Reproduces get_llm_client(settings) exactly — the no-config path.
        DEFAULT_PROFILE: ModelProfile(
            name=DEFAULT_PROFILE,
            provider=provider,
            model=default_model,
            max_tokens=claude_max_tokens,
            endpoint_id=getattr(settings, "runpod_endpoint_id", None) or None,
            base_url=getattr(settings, "ollama_base_url", None) or None,
        ),
        "claude-haiku": ModelProfile(
            name="claude-haiku",
            provider="claude",
            model=claude_model,
            max_tokens=claude_max_tokens,
        ),
        # Future: "local-32b": ModelProfile(name="local-32b", provider="runpod",
        #   model="qwen2.5:32b", endpoint_id=settings.runpod_local32b_endpoint_id)
    }
    return catalog


_client_cache: dict[tuple, object] = {}


def _reset_client_cache() -> None:
    """Test hook."""
    _client_cache.clear()


def _build_client(profile: ModelProfile, settings):
    # The default profile constructs through get_llm_client — the exact code
    # path (and test patch seam) used before routing existed.
    if profile.name == DEFAULT_PROFILE:
        from app.services.llm_client import get_llm_client
        return get_llm_client(settings)

    from app.services.llm_client import ClaudeClient, OllamaClient, RunPodClient

    if profile.provider == "claude":
        return ClaudeClient(
            api_key=settings.anthropic_api_key,
            model=profile.model,
            max_tokens=profile.max_tokens,
        )
    if profile.provider == "runpod":
        return RunPodClient(
            api_key=settings.runpod_api_key,
            endpoint_id=profile.endpoint_id or settings.runpod_endpoint_id,
        )
    return OllamaClient(base_url=profile.base_url or settings.ollama_base_url)


def _client_for(profile: ModelProfile, settings):
    # The default profile is built fresh per resolution (matching the
    # per-request construction behavior before routing, and keeping the
    # get_llm_client patch seam live). Named profiles are cached.
    if profile.name == DEFAULT_PROFILE:
        return _build_client(profile, settings)
    key = profile.cache_key
    client = _client_cache.get(key)
    if client is None:
        client = _build_client(profile, settings)
        _client_cache[key] = client
    return client


def _env_persona_profiles(settings) -> dict:
    raw = getattr(settings, "agent_persona_profiles", "") or ""
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        logger.warning("AGENT_PERSONA_PROFILES is not valid JSON; ignoring")
        return {}


def _org_persona_profiles(organization_id, db) -> dict:
    if organization_id is None or db is None:
        return {}
    try:
        from app.services.guide_usage import get_guide_config
        profiles = get_guide_config(organization_id, db).get("llm_profiles")
        return profiles if isinstance(profiles, dict) else {}
    except Exception:
        logger.exception("Org llm_profiles lookup failed for %s", organization_id)
        return {}


def resolve_llm(
    persona: str,
    organization_id: Optional[UUID] = None,
    db=None,
    settings=None,
) -> BoundLLM:
    """Resolve the LLM client + model for a (persona, org) pair.

    Never raises for configuration problems — unknown or broken profile names
    fall through to the default profile with a warning.
    """
    if settings is None:
        from app.config import get_settings
        settings = get_settings()

    catalog = get_profile_catalog(settings)

    name = (
        _org_persona_profiles(organization_id, db).get(persona)
        or _env_persona_profiles(settings).get(persona)
        or DEFAULT_PROFILE
    )

    profile = catalog.get(name)
    if profile is None:
        logger.warning(
            "Unknown model profile %r for persona=%s org=%s; using default",
            name, persona, organization_id,
        )
        profile = catalog[DEFAULT_PROFILE]

    return BoundLLM(client=_client_for(profile, settings), profile=profile)
