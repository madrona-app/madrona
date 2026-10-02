"""
Service for loading system prompts with DB override + caching.

Resolution order:
  1. Org-specific DB row  (organization_id = <org>)
  2. Platform default DB row  (organization_id IS NULL)
  3. Hardcoded fallback in system_prompts.py
"""

import logging
import time
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.agent import GuideSystemPrompt
from app.models.core_users import GuideUserPreference
from app.services.agent_tools.system_prompts import (
    STAFF_SYSTEM_PROMPT,
    VISITOR_SYSTEM_PROMPT,
    GUIDE_SYSTEM_PROMPT,
    REGISTRAR_SYSTEM_PROMPT,
    LOANS_REGISTRAR_SYSTEM_PROMPT,
    CONSERVATOR_SYSTEM_PROMPT,
    RIGHTS_SPECIALIST_SYSTEM_PROMPT,
    CURATOR_SYSTEM_PROMPT,
    PLANNER_SYSTEM_PROMPT,
)

logger = logging.getLogger(__name__)

_HARDCODED = {
    "staff": STAFF_SYSTEM_PROMPT,
    "visitor": VISITOR_SYSTEM_PROMPT,
    "guide": GUIDE_SYSTEM_PROMPT,
    "registrar": REGISTRAR_SYSTEM_PROMPT,
    "loans_registrar": LOANS_REGISTRAR_SYSTEM_PROMPT,
    "conservator": CONSERVATOR_SYSTEM_PROMPT,
    "rights_specialist": RIGHTS_SPECIALIST_SYSTEM_PROMPT,
    "curator": CURATOR_SYSTEM_PROMPT,
    "planner": PLANNER_SYSTEM_PROMPT,
}

# Simple in-memory cache: key = (org_id, persona) -> (content, fetched_at)
_cache: dict[tuple[Optional[UUID], str], tuple[str, float]] = {}
_CACHE_TTL = 60  # seconds


def _cache_key(organization_id: Optional[UUID], persona: str) -> tuple[Optional[UUID], str]:
    return (organization_id, persona)


def get_system_prompt(db: Session, organization_id: UUID, persona: str) -> str:
    """Return the best-match system prompt for an org + persona.

    Checks cache first, then DB (org-specific -> platform default), then
    falls back to the hardcoded constant.
    """
    now = time.monotonic()

    # Check cache for org-specific
    key = _cache_key(organization_id, persona)
    cached = _cache.get(key)
    if cached and (now - cached[1]) < _CACHE_TTL:
        return cached[0]

    # Try org-specific row
    row = (
        db.query(GuideSystemPrompt)
        .filter(
            GuideSystemPrompt.organization_id == organization_id,
            GuideSystemPrompt.persona == persona,
        )
        .first()
    )

    if row:
        _cache[key] = (row.content, now)
        return row.content

    # Try platform default (org_id IS NULL)
    platform_key = _cache_key(None, persona)
    cached_platform = _cache.get(platform_key)
    if cached_platform and (now - cached_platform[1]) < _CACHE_TTL:
        # Also cache under the org key so we don't re-query
        _cache[key] = cached_platform
        return cached_platform[0]

    platform_row = (
        db.query(GuideSystemPrompt)
        .filter(
            GuideSystemPrompt.organization_id.is_(None),
            GuideSystemPrompt.persona == persona,
        )
        .first()
    )

    if platform_row:
        result = (platform_row.content, now)
        _cache[platform_key] = result
        _cache[key] = result
        return platform_row.content

    # Fallback to hardcoded
    fallback = _HARDCODED.get(persona, "")
    _cache[key] = (fallback, now)
    return fallback


def invalidate_cache(organization_id: Optional[UUID] = None, persona: Optional[str] = None) -> None:
    """Clear cached prompts. Called after admin edits."""
    if organization_id is None and persona is None:
        _cache.clear()
        return
    keys_to_remove = [
        k for k in _cache
        if (organization_id is None or k[0] == organization_id)
        and (persona is None or k[1] == persona)
    ]
    for k in keys_to_remove:
        _cache.pop(k, None)


# ── Per-user preferences ─────────────────────────────────────────────────────
# Private, per-user personalization injected BELOW the system prompt as
# subordinate stylistic guidance. Cached separately, keyed by (user_id, org_id)
# -> (rendered_block, fetched_at). Empty/absent resolves to "" — a no-op.

_user_pref_cache: dict[tuple[UUID, UUID], tuple[str, float]] = {}

# Maps the verbosity preference to a one-line instruction. "normal" is the
# default behavior, so it contributes nothing.
_VERBOSITY_GUIDANCE = {
    "terse": "Keep answers short and to the point — a sentence or two unless more detail is explicitly requested.",
    "normal": "",
    "detailed": "Lean toward thorough answers, with relevant context and examples.",
}


def _render_user_pref_block(row: GuideUserPreference) -> str:
    """Render a preference row into the text appended to the prompt ("" if empty)."""
    parts: list[str] = []
    instructions = (row.instructions or "").strip()
    if instructions:
        parts.append(instructions)
    guidance = _VERBOSITY_GUIDANCE.get((row.verbosity or "").strip(), "")
    if guidance:
        parts.append(guidance)
    return "\n".join(parts)


def get_user_preferences(db: Session, user_id: UUID, organization_id: UUID) -> str:
    """Return the rendered preference block for a user, or "" if none/empty.

    Injected below the org/platform system prompt as subordinate stylistic
    preferences — never overrides org rules, persona, or guardrails. Cached
    briefly like the system prompt; invalidate_user_preferences() clears it
    after an edit.
    """
    now = time.monotonic()
    key = (user_id, organization_id)
    cached = _user_pref_cache.get(key)
    if cached and (now - cached[1]) < _CACHE_TTL:
        return cached[0]

    row = (
        db.query(GuideUserPreference)
        .filter(
            GuideUserPreference.user_id == user_id,
            GuideUserPreference.organization_id == organization_id,
        )
        .first()
    )

    block = _render_user_pref_block(row) if row else ""
    _user_pref_cache[key] = (block, now)
    return block


def invalidate_user_preferences(user_id: UUID, organization_id: UUID) -> None:
    """Clear a user's cached preference block after an edit."""
    _user_pref_cache.pop((user_id, organization_id), None)
