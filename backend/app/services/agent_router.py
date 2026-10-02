"""Router service: pick the best initial persona for a staff conversation.

Phase 3 of multi-agent orchestration. Calls a lightweight LLM (Claude Haiku
in the production config) with a cached static routing prompt + the user's
first message, and returns a RouteDecision.

Constraints:
- Only invoked for staff conversations. Visitor and guide bypass.
- Below confidence_threshold, the decision is rewritten to 'staff' so the
  generalist handles ambiguous prompts.
- Failure paths (API down, malformed JSON, invalid persona) all fall back
  to 'staff' rather than blocking the user.
- Decisions are recorded on Conversation.persona_history with source='router'.

Tier 1 testability: the LLM client is constructed via the same get_llm_client
factory the agent uses, so tests can substitute a stub.
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

from app.services.agent_persona import SPECIALIST_PERSONAS

logger = logging.getLogger(__name__)


# --- output type ---


@dataclass
class RouteDecision:
    """The router's per-call output."""

    persona: str
    confidence: float
    rationale: str
    source: str = "router"  # 'router' | 'router_fallback'
    error: str | None = None
    raw_response: str | None = None
    duration_ms: int = 0

    def to_history_entry(self) -> dict[str, Any]:
        """Shape matches the persona_history JSONB row schema."""
        entry: dict[str, Any] = {
            "persona": self.persona,
            "source": self.source,
            "confidence": self.confidence,
            "rationale": self.rationale,
        }
        if self.error:
            entry["error"] = self.error
        return entry


# --- config knobs ---

DEFAULT_CONFIDENCE_THRESHOLD = 0.7
DEFAULT_MODEL = "claude-haiku-4-5"
DEFAULT_NUM_CTX = 8192
ROUTABLE_PERSONAS: tuple[str, ...] = ("staff", *SPECIALIST_PERSONAS)


# --- the routing prompt (cached static text) ---

_ROUTER_SYSTEM_PROMPT = """You are the routing layer for a museum collections assistant. A staff user just asked a question. Your job is to pick which specialist (or the generalist) should answer.

You have these targets:

- staff — generalist. Pick this when the question is broad, mixed, ambiguous, or just casual conversation. The generalist can also delegate to specialists later.
- registrar — cataloging, classifications, materials, vocabulary terms (Getty AAT/ULAN/TGN, Nomenclature), procedure cataloging standards. "What's the right term for X?" "How do I describe this object?" "Is this object number formatted right?"
- loans_registrar — loans in/out, transactions, transit, shipments, facility reports, courier requirements, indemnity. "What's the status of this loan?" "Walk me through receiving an incoming loan." "When is the loan return due?"
- conservator — condition reports, treatment history (never recommends treatment), environmental requirements, conservation standards (CCI, AIC, ICOM-CC). "What does this condition rating mean?" "Storage RH for textiles?" "How should I document this damage?"
- rights_specialist — copyright, reproductions, donor restrictions, licensing terms. "Can we publish this?" "Public domain analysis?" "What rights do we have to this image?"
- curator — interpretation, art-historical context, exhibition object selection, attribution research. "Comparable works in our collection?" "Style and period for this piece?" "Is this attribution settled?"

OUTPUT FORMAT — strict JSON, nothing else:
{"persona": "<one of: staff, registrar, loans_registrar, conservator, rights_specialist, curator>", "confidence": <number 0.0–1.0>, "rationale": "<one sentence>"}

CONFIDENCE GUIDANCE:
- 0.9+ → unambiguous match to a specialist's domain
- 0.7–0.9 → strong match but the question could plausibly span domains
- 0.5–0.7 → mixed or vague; consider routing to staff
- <0.5 → no good fit; route to staff

When in doubt, choose staff. The staff persona has access to all specialists via delegation, so a wrong specialist routing is more costly than defaulting.

Do not write any explanation outside the JSON. No markdown fences. Just the JSON object.
"""


# --- service ---


class RouterService:
    """Stateful router. Construct once per request handler if you like.

    Call site:
        router = RouterService(settings)
        decision = router.classify(user_message, page_context)
        if decision.persona != current_persona:
            conversation.persona = decision.persona
            ... append decision.to_history_entry() to persona_history
    """

    def __init__(
        self,
        settings,
        confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
    ):
        self.settings = settings
        self.confidence_threshold = confidence_threshold

    def classify(
        self,
        user_message: str,
        page_context: dict | None = None,
    ) -> RouteDecision:
        """Classify a single user message. Always returns a RouteDecision —
        even on error — so the call site never has to handle exceptions.
        """
        from app.services.model_profiles import resolve_llm

        if not user_message or not user_message.strip():
            return self._fallback("empty_input", rationale="empty user message")

        t0 = time.monotonic()
        try:
            # Staff-side classifier: no org context here, so this resolves via
            # env AGENT_PERSONA_PROFILES or the default profile.
            llm = resolve_llm("staff", settings=self.settings).client
        except Exception as e:  # noqa: BLE001
            logger.warning("Router LLM client init failed: %s", e)
            return self._fallback("llm_init", rationale=str(e))

        messages = self._build_messages(user_message, page_context)
        model = getattr(self.settings, "agent_router_model", None) or DEFAULT_MODEL

        try:
            response = llm.chat(
                model,
                messages,
                None,  # no tools — pure classification
                getattr(self.settings, "agent_num_ctx", DEFAULT_NUM_CTX),
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("Router LLM call failed: %s", e)
            return self._fallback(
                "llm_error",
                rationale=str(e),
                duration_ms=int((time.monotonic() - t0) * 1000),
            )

        duration_ms = int((time.monotonic() - t0) * 1000)
        raw = (response.content or "").strip()
        parsed = _parse_decision_json(raw)
        if parsed is None:
            return self._fallback(
                "parse_error",
                rationale="router LLM did not return valid JSON",
                raw=raw,
                duration_ms=duration_ms,
            )

        persona = parsed.get("persona")
        if persona not in ROUTABLE_PERSONAS:
            return self._fallback(
                "invalid_persona",
                rationale=f"router returned unknown persona {persona!r}",
                raw=raw,
                duration_ms=duration_ms,
            )

        try:
            confidence = float(parsed.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0

        rationale = str(parsed.get("rationale", "")).strip() or "(no rationale)"

        # Threshold gate: low-confidence routes get rewritten to staff so
        # the generalist (who can delegate later) handles ambiguous prompts.
        if confidence < self.confidence_threshold and persona != "staff":
            return RouteDecision(
                persona="staff",
                confidence=confidence,
                rationale=(
                    f"router preferred {persona} at confidence {confidence:.2f}; "
                    f"below threshold {self.confidence_threshold:.2f}, "
                    f"defaulting to staff"
                ),
                source="router_fallback",
                raw_response=raw,
                duration_ms=duration_ms,
            )

        return RouteDecision(
            persona=persona,
            confidence=confidence,
            rationale=rationale,
            source="router",
            raw_response=raw,
            duration_ms=duration_ms,
        )

    # --- helpers ---

    @staticmethod
    def _build_messages(user_message: str, page_context: dict | None) -> list[dict]:
        user_payload = user_message.strip()
        if page_context:
            try:
                user_payload += (
                    "\n\nPAGE CONTEXT (the user is currently viewing):\n"
                    + json.dumps(page_context, default=str)
                )
            except (TypeError, ValueError):
                pass
        return [
            {"role": "system", "content": _ROUTER_SYSTEM_PROMPT},
            {"role": "user", "content": user_payload},
        ]

    def _fallback(
        self,
        error_kind: str,
        rationale: str = "",
        raw: str | None = None,
        duration_ms: int = 0,
    ) -> RouteDecision:
        return RouteDecision(
            persona="staff",
            confidence=0.0,
            rationale=rationale or f"router fell back: {error_kind}",
            source="router_fallback",
            error=error_kind,
            raw_response=raw,
            duration_ms=duration_ms,
        )


# --- JSON parsing ---


_JSON_OBJECT_PATTERN = re.compile(r"\{.*\}", re.DOTALL)


def _parse_decision_json(raw: str) -> dict[str, Any] | None:
    """Parse a router JSON response. Tolerant of light formatting noise:
    leading code-fence headers, stray trailing prose. Returns None on
    irrecoverable mismatch.
    """
    if not raw:
        return None
    # Direct attempt
    try:
        result = json.loads(raw)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass
    # Substring fallback: pull the first {...} block
    match = _JSON_OBJECT_PATTERN.search(raw)
    if match:
        try:
            result = json.loads(match.group(0))
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            return None
    return None
