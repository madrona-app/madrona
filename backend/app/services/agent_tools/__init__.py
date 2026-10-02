"""
Agent tool registry.

Holds tool definitions (JSON schema for Ollama) and dispatches execution.
Each tool is a function: (input: dict, context: AgentContext) -> dict.
"""

import copy
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable
from uuid import UUID

logger = logging.getLogger(__name__)

# Cap tool result size to keep context manageable
MAX_RESULT_BYTES = 8192

# Delimiters to wrap tool results in Ollama messages, making injection harder
TOOL_RESULT_PREFIX = "--- TOOL RESULT START ---"
TOOL_RESULT_SUFFIX = "--- TOOL RESULT END ---"

# --- Injection detection patterns ---
# Narrowed to avoid false positives (e.g. "metric system" won't trigger).

_INJECTION_PATTERNS: list[re.Pattern] = [
    re.compile(r"ignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+(?:a\s+)?(?:different|new)", re.IGNORECASE),
    re.compile(r"\b(?:system|developer)\s*:\s*(?:you are|ignore|follow|instructions)", re.IGNORECASE),
    re.compile(r"<\|(?:im_start|system|user|assistant)\|>", re.IGNORECASE),
    re.compile(r"(?:forget|disregard)\s+(?:your|all)\s+(?:instructions|rules|guidelines)", re.IGNORECASE),
]


def _scan_injection_in_value(value: str) -> list[re.Match]:
    """Scan a single string value for injection patterns. Returns matches."""
    matches = []
    for pattern in _INJECTION_PATTERNS:
        found = pattern.search(value)
        if found:
            matches.append(found)
    return matches


def _strip_injection_from_dict(d: dict) -> tuple[dict, int]:
    """Deep-copy a dict and replace injection patterns in all string leaf values.

    Returns (cleaned_copy, strip_count). Keys and non-string values are untouched.
    """
    cleaned = copy.deepcopy(d)
    count = _strip_leaves(cleaned)
    return cleaned, count


def _strip_leaves(obj: Any) -> int:
    """Recursively strip injection patterns from string leaves in-place. Returns count."""
    count = 0
    if isinstance(obj, dict):
        for key in obj:
            val = obj[key]
            if isinstance(val, str):
                new_val, n = _strip_string(val)
                if n > 0:
                    obj[key] = new_val
                    count += n
            elif isinstance(val, (dict, list)):
                count += _strip_leaves(val)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            if isinstance(item, str):
                new_val, n = _strip_string(item)
                if n > 0:
                    obj[i] = new_val
                    count += n
            elif isinstance(item, (dict, list)):
                count += _strip_leaves(item)
    return count


def _strip_string(value: str) -> tuple[str, int]:
    """Replace all injection patterns in a string. Returns (cleaned, count)."""
    count = 0
    for pattern in _INJECTION_PATTERNS:
        value, n = pattern.subn("[REDACTED]", value)
        count += n
    return value, count


@dataclass
class AgentContext:
    """Context passed to every tool invocation."""
    organization_id: UUID
    user_id: UUID | None
    persona: str  # 'staff' or 'visitor'
    db_session: Any  # SQLAlchemy session
    org_slug: str | None = None  # For generating visitor-friendly URLs
    # The active conversation, when the turn runs inside one. Lets drafts record
    # their provenance and lets the CitationValidator resolve tool_result cites
    # against this conversation's tool-call ledger (v1 §7.2).
    conversation_id: UUID | None = None
    context_entity_type: str | None = None  # e.g. 'collection_object'
    context_entity_id: UUID | None = None  # Entity the user is currently viewing
    # Per-turn page snapshot from the frontend. Shape matches PageContextIn.
    # Tools can read this to answer "what does the user see right now?"
    # without hitting the database (e.g. current route, nav section, workflow
    # blockers). Always None for visitor persona unless explicitly wired.
    page_context: dict | None = None
    # Plan provenance, set only when a tool runs inside a plan step (the
    # executor stamps these on a per-step copy). A draft proposed here records
    # them so the plan can pause on that draft's approval and thread its
    # applied entity id into later steps (draft-chaining).
    plan_id: UUID | None = None
    plan_step_id: UUID | None = None


@dataclass
class ToolDef:
    """A registered tool with its schema and handler."""
    name: str
    description: str
    parameters: dict  # JSON Schema
    handler: Callable[[dict, AgentContext], dict]
    personas: list[str] = field(default_factory=lambda: ["staff", "visitor"])


@dataclass
class ToolExecutionResult:
    """Result of executing a tool, with separate prompt and raw versions."""
    result_for_prompt: dict  # What goes into Ollama messages (may have injections stripped)
    result_raw: dict  # Original result for guardrails (flagged but unaltered)


class ToolRegistry:
    """Registry for agent tools."""

    def __init__(self):
        self._tools: dict[str, ToolDef] = {}

    def register(
        self,
        name: str,
        description: str,
        parameters: dict,
        handler: Callable[[dict, AgentContext], dict],
        personas: list[str] | None = None,
    ) -> None:
        self._tools[name] = ToolDef(
            name=name,
            description=description,
            parameters=parameters,
            handler=handler,
            personas=personas or ["staff", "visitor"],
        )

    def get_tools_for_persona(self, persona: str) -> list[dict]:
        """Return Ollama-compatible tool definitions for a persona.

        If the persona has a PersonaPolicy.allowed_tools set, use that as the
        source of truth (so adding a specialist persona doesn't require
        editing every tool's `personas` list). Falls back to the per-tool
        `personas` registration when no policy exists for the persona.
        """
        try:
            from app.services.agent_persona import get_persona_policy
            policy_tools = get_persona_policy(persona).allowed_tools
        except (ValueError, ImportError):
            policy_tools = None

        tools = []
        for td in self._tools.values():
            if policy_tools is not None:
                visible = td.name in policy_tools
            else:
                visible = persona in td.personas
            if visible:
                tools.append({
                    "type": "function",
                    "function": {
                        "name": td.name,
                        "description": td.description,
                        "parameters": td.parameters,
                    },
                })
        return tools

    def get_all_tool_names(self) -> set[str]:
        """Return the names of all registered tools."""
        return set(self._tools.keys())

    def execute(
        self,
        name: str,
        arguments: dict,
        context: AgentContext,
        strip_injections: bool = False,
    ) -> ToolExecutionResult:
        """Execute a tool by name and return the result.

        Args:
            name: Tool name.
            arguments: Tool arguments from the model.
            context: Agent context.
            strip_injections: If True, create a sanitized copy for prompt injection
                and return both versions. Visitor persona should use True.

        Returns:
            ToolExecutionResult with result_for_prompt and result_raw.
        """
        td = self._tools.get(name)
        if not td:
            err = {"error": f"Unknown tool: {name}"}
            return ToolExecutionResult(result_for_prompt=err, result_raw=err)

        # Allowlist gate: prefer PersonaPolicy.allowed_tools if available;
        # fall back to the per-tool `personas` list for personas without
        # a policy (none in current code, but defensive).
        try:
            from app.services.agent_persona import get_persona_policy
            policy_tools = get_persona_policy(context.persona).allowed_tools
            tool_visible = name in policy_tools
        except (ValueError, ImportError):
            policy_tools = None
            tool_visible = context.persona in td.personas

        if not tool_visible:
            logger.warning(
                "Persona mismatch: %s tried to call %s (allowed via %s)",
                context.persona, name,
                "policy" if policy_tools is not None else "registration",
            )
            err = {"error": f"Tool '{name}' not available for {context.persona}"}
            return ToolExecutionResult(result_for_prompt=err, result_raw=err)

        # Isolate each tool's DB work in a SAVEPOINT. A tool query that errors
        # aborts the whole request transaction at the psycopg level; without
        # this, every later statement — including saving the assistant reply —
        # fails with InFailedSqlTransaction and the chat dies with "Internal
        # error". The savepoint lets one tool fail and the conversation continue.
        session = getattr(context, "db_session", None)
        nested = None
        if session is not None:
            try:
                nested = session.begin_nested()
            except Exception:
                nested = None

        try:
            result = td.handler(arguments, context)
            # Enforce size cap
            serialized = json.dumps(result, default=str)
            if len(serialized.encode()) > MAX_RESULT_BYTES:
                result = _truncate_result(result, serialized)
            if nested is not None:
                # RELEASE SAVEPOINT. If the handler swallowed a DB error (caught
                # it and returned an error dict), the savepoint is already
                # aborted and this raises — roll back so the outer transaction
                # stays usable, and surface a tool error.
                try:
                    nested.commit()
                except Exception:
                    try:
                        nested.rollback()
                    except Exception:
                        pass
                    logger.warning("Tool %s left the transaction aborted; rolled back to savepoint", name)
                    err = {"error": f"Tool '{name}' failed due to a database error."}
                    return ToolExecutionResult(result_for_prompt=err, result_raw=err)
        except Exception as e:
            if nested is not None:
                try:
                    nested.rollback()
                except Exception:
                    pass
            logger.exception("Tool execution failed: %s", name)
            err = {"error": f"Tool error: {str(e)}"}
            return ToolExecutionResult(result_for_prompt=err, result_raw=err)

        # Scan for injection patterns
        has_injection = False
        serialized_for_scan = json.dumps(result, default=str)
        for pattern in _INJECTION_PATTERNS:
            if pattern.search(serialized_for_scan):
                has_injection = True
                break

        if has_injection:
            result["_injection_warning"] = True
            logger.warning(
                "Injection pattern detected in tool result: %s (persona=%s)",
                name, context.persona,
            )

        if strip_injections and has_injection:
            result_for_prompt, count = _strip_injection_from_dict(result)
            result_for_prompt["_injection_stripped"] = count
            return ToolExecutionResult(result_for_prompt=result_for_prompt, result_raw=result)

        return ToolExecutionResult(result_for_prompt=result, result_raw=result)


def _truncate_result(result: dict, serialized: str) -> dict:
    """Truncate oversized results while preserving structure."""
    # If result has a list of items, trim items
    for key in ("results", "objects", "exhibitions", "items", "events", "categories"):
        if key in result and isinstance(result[key], list):
            while len(json.dumps(result, default=str).encode()) > MAX_RESULT_BYTES and len(result[key]) > 1:
                result[key].pop()
            result["truncated"] = True
            return result
    # Fallback: return a truncation notice
    return {"summary": serialized[:4000], "truncated": True}


# Singleton registry
_registry: ToolRegistry | None = None


def get_tool_registry() -> ToolRegistry:
    """Get (or create) the global tool registry."""
    global _registry
    if _registry is None:
        _registry = ToolRegistry()
        # Auto-register all tools
        from app.services.agent_tools.collection_tools import register_collection_tools
        from app.services.agent_tools.exhibition_tools import register_exhibition_tools
        from app.services.agent_tools.reference_tools import register_reference_tools
        from app.services.agent_tools.staff_tools import register_staff_tools
        from app.services.agent_tools.visitor_tools import register_visitor_tools
        from app.services.agent_tools.web_tools import register_web_tools
        from app.services.agent_tools.analytics_tools import register_analytics_tools
        from app.services.agent_tools.workflow_tools import register_workflow_tools
        from app.services.agent_tools.media_tools import register_media_tools
        from app.services.agent_tools.contact_tools import register_contact_tools
        from app.services.agent_tools.location_tools import register_location_tools
        from app.services.agent_tools.visitor_info_tools import register_visitor_info_tools
        from app.services.agent_tools.nav_tools import register_nav_tools
        from app.services.agent_tools.playbook_tools import register_playbook_tools
        from app.services.agent_tools.operations_tools import register_operations_tools
        from app.services.agent_tools.orchestration_tools import register_orchestration_tools
        from app.services.agent_tools.draft_tools import register_draft_tools
        register_collection_tools(_registry)
        register_exhibition_tools(_registry)
        register_reference_tools(_registry)
        register_staff_tools(_registry)
        register_visitor_tools(_registry)
        register_web_tools(_registry)
        register_analytics_tools(_registry)
        register_workflow_tools(_registry)
        register_media_tools(_registry)
        register_contact_tools(_registry)
        register_location_tools(_registry)
        register_visitor_info_tools(_registry)
        register_nav_tools(_registry)
        register_playbook_tools(_registry)
        register_operations_tools(_registry)
        register_orchestration_tools(_registry)
        register_draft_tools(_registry)
    return _registry
