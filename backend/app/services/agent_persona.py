"""
Persona policies for the agent.

Single source of truth for per-persona tool access, context field visibility,
input limits, and security flags.
"""

from dataclasses import dataclass
from typing import FrozenSet


@dataclass(frozen=True)
class PersonaPolicy:
    """Immutable policy governing agent behavior for a persona."""

    name: str
    system_prompt_key: str  # Key into SYSTEM_PROMPTS dict
    allowed_tools: FrozenSet[str]
    context_fields: FrozenSet[str]
    max_input_length: int
    rate_limited: bool
    source_grounding_severity: str  # "block" or "warn"
    museum_policy_severity: str  # "block" or "warn"
    strip_injection_in_prompt: bool
    # Multi-agent orchestration: only personas with can_delegate=True may
    # invoke delegate_to_specialist. Specialists must not delegate further;
    # this is the recursion guard.
    can_delegate: bool = False


# --- Tool sets ---

_STAFF_TOOLS = frozenset({
    # Collection
    "search_collection",
    "get_object_detail",
    "find_related_objects",
    # Staff-specific collection tools
    "lookup_vocabulary_term",
    "get_object_history",
    "suggest_cataloging",
    "get_record_summary",
    # Reference / RAG
    "lookup_reference",
    "lookup_museum_info",
    # Web
    "web_search",
    "fetch_webpage",
    # Analytics
    "collection_statistics",
    "recent_activity",
    # Workflow
    "check_workflow_status",
    "find_overdue_items",
    # Media
    "search_media",
    "get_media_detail",
    # Contacts
    "search_contacts",
    # Location
    "find_object_location",
    "check_storage_availability",
    # People lookup — to route approvals/drafts to a specific person (§7.5)
    "lookup_staff",
    # Visitor info (staff can use these too)
    "get_directions",       # ⚠️ Requires org documents
    "check_accessibility",  # ⚠️ Requires org documents
    # Orchestration — staff hands focused questions to specialists
    "delegate_to_specialist",
    # Orchestration — staff decomposes multi-step goals into a persisted plan
    "make_plan",
})

_GUIDE_TOOLS = frozenset({
    "lookup_reference",
    "lookup_museum_info",
    "lookup_vocabulary_term",
    "web_search",
    "fetch_webpage",
})

# --- Specialist tool sets (subsets of _STAFF_TOOLS) ---
# Each specialist gets a tight slice of the staff allowlist. Specialists
# never delegate — recursion guard is enforced via PersonaPolicy.can_delegate.

_REGISTRAR_TOOLS = frozenset({
    "search_collection",
    "get_object_detail",
    "find_related_objects",
    "lookup_vocabulary_term",
    "suggest_cataloging",
    "get_record_summary",
    "get_object_history",
    "lookup_reference",
})

_LOANS_REGISTRAR_TOOLS = frozenset({
    "search_collection",
    "get_object_detail",
    "check_workflow_status",
    "find_overdue_items",
    "get_object_history",
    "find_object_location",
    "check_storage_availability",
    "search_contacts",
})

_CONSERVATOR_TOOLS = frozenset({
    "search_collection",
    "get_object_detail",
    "get_object_history",
    "get_record_summary",
    "find_object_location",
    "check_storage_availability",
    "lookup_reference",
    # Draft write tools (e.g. propose_condition_report_draft) are unioned in
    # automatically by _specialist() from the factory registry — no hand-listing.
})

_RIGHTS_SPECIALIST_TOOLS = frozenset({
    "search_collection",
    "get_object_detail",
    "get_record_summary",
    "search_contacts",
    "lookup_reference",
})

_CURATOR_TOOLS = frozenset({
    "search_collection",
    "get_object_detail",
    "find_related_objects",
    "lookup_vocabulary_term",
    "search_media",
    "get_media_detail",
    "lookup_reference",
    "web_search",
    "fetch_webpage",
    "recent_activity",
})

_VISITOR_TOOLS = frozenset({
    # Collection
    "search_collection",
    "get_object_detail",
    "find_related_objects",
    # Exhibitions & events
    "list_current_exhibitions",
    "get_exhibition_info",
    "get_museum_info",
    "list_upcoming_events",
    "get_event_detail",
    # RAG (public docs only)
    "lookup_museum_info",    # ⚠️ Requires org documents (public visibility)
    # Web
    "web_search",
    # Visitor info
    "get_directions",        # ⚠️ Requires org documents (public visibility)
    "check_accessibility",   # ⚠️ Requires org documents (public visibility)
})

# --- Context field sets (fields allowed in system prompt entity injection) ---

_SHARED_CONTEXT_FIELDS = frozenset({
    "object_name",
    "creators",
    "creation_date_display",
    "style_period",
    "creation_place",
    "brief_description",
    "materials",
    "techniques",
    "dimensions",
})

_STAFF_CONTEXT_FIELDS = _SHARED_CONTEXT_FIELDS | frozenset({
    "provenance",
    "comments",
})

_VISITOR_CONTEXT_FIELDS = _SHARED_CONTEXT_FIELDS

# --- Policies ---

_STAFF_POLICY = PersonaPolicy(
    name="staff",
    system_prompt_key="staff",
    allowed_tools=_STAFF_TOOLS,
    context_fields=_STAFF_CONTEXT_FIELDS,
    max_input_length=4000,
    rate_limited=False,
    source_grounding_severity="warn",
    museum_policy_severity="warn",
    strip_injection_in_prompt=False,
    can_delegate=True,
)


def _specialist(name: str, tools: FrozenSet[str]) -> PersonaPolicy:
    """Build a specialist policy. Specialists are tight subsets of staff
    behavior with their own DB-backed system prompt and no delegation.

    Draft write tools are unioned in from the factory registry so a persona's
    allowlist (the gate `ToolRegistry` actually reads) admits every
    `propose_<entity>_draft` declared for it — no per-tool hand-listing, no
    drift between "tool registered" and "persona can see it".
    """
    from app.services.drafts.factory.registry import factory_draft_tool_names_for

    tools = frozenset(tools) | factory_draft_tool_names_for(name)
    return PersonaPolicy(
        name=name,
        system_prompt_key=name,
        allowed_tools=tools,
        context_fields=_STAFF_CONTEXT_FIELDS,
        max_input_length=4000,
        rate_limited=False,
        source_grounding_severity="warn",
        museum_policy_severity="warn",
        strip_injection_in_prompt=False,
        can_delegate=False,
    )


# Planner has no tools — it emits a JSON plan in its message content and
# the make_plan tool handler parses + persists. Putting tools on the
# planner would tempt it to execute work that the executor (Phase 2.2)
# is supposed to walk later.
_PLANNER_POLICY = PersonaPolicy(
    name="planner",
    system_prompt_key="planner",
    allowed_tools=frozenset(),
    context_fields=_STAFF_CONTEXT_FIELDS,
    max_input_length=4000,
    rate_limited=False,
    source_grounding_severity="warn",
    museum_policy_severity="warn",
    strip_injection_in_prompt=False,
    can_delegate=False,
)


_REGISTRAR_POLICY = _specialist("registrar", _REGISTRAR_TOOLS)
_LOANS_REGISTRAR_POLICY = _specialist("loans_registrar", _LOANS_REGISTRAR_TOOLS)
_CONSERVATOR_POLICY = _specialist("conservator", _CONSERVATOR_TOOLS)
_RIGHTS_SPECIALIST_POLICY = _specialist("rights_specialist", _RIGHTS_SPECIALIST_TOOLS)
_CURATOR_POLICY = _specialist("curator", _CURATOR_TOOLS)

_VISITOR_POLICY = PersonaPolicy(
    name="visitor",
    system_prompt_key="visitor",
    allowed_tools=_VISITOR_TOOLS,
    context_fields=_VISITOR_CONTEXT_FIELDS,
    max_input_length=2000,
    rate_limited=True,
    source_grounding_severity="block",
    museum_policy_severity="block",
    strip_injection_in_prompt=True,
)

_GUIDE_POLICY = PersonaPolicy(
    name="guide",
    system_prompt_key="guide",
    allowed_tools=_GUIDE_TOOLS,
    context_fields=_SHARED_CONTEXT_FIELDS,
    max_input_length=4000,
    rate_limited=False,
    source_grounding_severity="warn",
    museum_policy_severity="warn",
    strip_injection_in_prompt=False,
)

_POLICIES = {
    "staff": _STAFF_POLICY,
    "visitor": _VISITOR_POLICY,
    "guide": _GUIDE_POLICY,
    "registrar": _REGISTRAR_POLICY,
    "loans_registrar": _LOANS_REGISTRAR_POLICY,
    "conservator": _CONSERVATOR_POLICY,
    "rights_specialist": _RIGHTS_SPECIALIST_POLICY,
    "curator": _CURATOR_POLICY,
    "planner": _PLANNER_POLICY,
}

# Personas that may be targets of delegate_to_specialist. Order is the
# canonical order for UI dropdowns and prompt enumeration.
SPECIALIST_PERSONAS: tuple[str, ...] = (
    "registrar",
    "loans_registrar",
    "conservator",
    "rights_specialist",
    "curator",
)


def get_persona_policy(persona: str) -> PersonaPolicy:
    """Get the policy for a persona.

    Raises ValueError for unknown persona names.
    """
    policy = _POLICIES.get(persona)
    if policy is None:
        raise ValueError(f"Unknown persona: {persona!r}")
    return policy
