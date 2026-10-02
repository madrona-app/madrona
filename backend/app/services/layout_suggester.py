"""AI-draft a workspace layout delta from a natural-language instruction.

Mirrors the agent_router pattern: a single lightweight LLM call with a cached
system prompt, tolerant JSON parsing, and strict validation of the output
against the caller-supplied section catalog. The model can only *select* from
real section/group ids — it never invents ids, and it can never hide a section
the catalog marks required. The result is a preview `FormLayoutDelta`; saving is
a separate, explicit step (the create endpoint).
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from app.fastapi_app.schemas.layout_overrides import FormLayoutDelta

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-haiku-4-5"
DEFAULT_NUM_CTX = 8192

_SYSTEM_PROMPT = """You configure a record-detail page layout for a museum collections app. The user describes how they want the page arranged; you output a JSON "delta" of changes over the default layout.

You may use ONLY these operations, all optional:
- "hidden_sections": [section ids to hide]
- "section_order": [section ids in the desired order; omitted ones keep default order]
- "group_order": [group ids in the desired order]
- "collapsed_groups": [group ids to start collapsed]

Rules:
- Use ONLY the section ids and group ids from the provided catalog. Never invent an id.
- NEVER hide a section marked "required": true.
- Output STRICT JSON with only those four keys (any subset may be omitted). No prose, no markdown fences.
"""


@dataclass(frozen=True)
class CatalogSection:
    id: str
    label: str
    group: str | None = None
    required: bool = False


_JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json_object(raw: str) -> dict | None:
    """Parse a JSON object, tolerating leading/trailing prose or code fences."""
    if not raw:
        return None
    try:
        result = json.loads(raw)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass
    match = _JSON_OBJECT.search(raw)
    if match:
        try:
            result = json.loads(match.group(0))
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            return None
    return None


def _build_user_message(instruction: str, sections: list[CatalogSection]) -> str:
    catalog = [
        {"id": s.id, "label": s.label, "group": s.group, "required": s.required}
        for s in sections
    ]
    return (
        "CATALOG (the only ids you may use):\n"
        + json.dumps(catalog)
        + "\n\nINSTRUCTION:\n"
        + instruction.strip()
    )


def _validate_against_catalog(
    parsed: dict, sections: list[CatalogSection]
) -> FormLayoutDelta:
    """Keep only ids that exist in the catalog; never hide a required section.
    FormLayoutDelta's validators dedupe/cap the lists."""
    section_ids = {s.id for s in sections}
    group_ids = {s.group for s in sections if s.group}
    required = {s.id for s in sections if s.required}

    def _ids(key: str, allowed: set[str]) -> list[str]:
        value = parsed.get(key)
        if not isinstance(value, list):
            return []
        return [v for v in value if isinstance(v, str) and v in allowed]

    return FormLayoutDelta(
        hidden_sections=[
            sid for sid in _ids("hidden_sections", section_ids) if sid not in required
        ],
        section_order=_ids("section_order", section_ids),
        group_order=_ids("group_order", group_ids),
        collapsed_groups=_ids("collapsed_groups", group_ids),
    )


class LayoutSuggestionError(Exception):
    """Raised when the model is unavailable or returns unusable output."""


def suggest_layout_delta(
    settings,
    instruction: str,
    sections: list[CatalogSection],
) -> FormLayoutDelta:
    """Draft a layout delta from an instruction. Raises LayoutSuggestionError on
    LLM/parse failure so the caller can surface it (vs. a silent no-op)."""
    from app.services.llm_client import get_llm_client

    try:
        llm = get_llm_client(settings)
    except Exception as e:  # noqa: BLE001
        logger.warning("Layout suggester LLM init failed: %s", e)
        raise LayoutSuggestionError("layout assistant unavailable") from e

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": _build_user_message(instruction, sections)},
    ]
    model = getattr(settings, "agent_router_model", None) or DEFAULT_MODEL
    num_ctx = getattr(settings, "agent_num_ctx", DEFAULT_NUM_CTX)

    try:
        response = llm.chat(model, messages, None, num_ctx)
    except Exception as e:  # noqa: BLE001
        logger.warning("Layout suggester LLM call failed: %s", e)
        raise LayoutSuggestionError("layout assistant call failed") from e

    parsed = _parse_json_object((response.content or "").strip())
    if parsed is None:
        logger.warning("Layout suggester returned non-JSON output")
        raise LayoutSuggestionError("layout assistant returned an unusable response")

    return _validate_against_catalog(parsed, sections)
