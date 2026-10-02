"""Assembles the factory's outputs from the spec list.

- ``build_apply_dispatch`` → entity_type → applier (consumed lazily by
  ``draft_service._get_dispatch``).
- ``register_factory_draft_tools`` → registers every ``propose_<entity>_draft``
  tool on the registry (called from ``draft_tools.register_draft_tools``).

Payload-schema assembly lives in ``registry.build_payload_schemas`` (the light,
service-free layer) so schema consumers never pull this heavy module.
"""

from __future__ import annotations

from app.services.agent_tools import ToolRegistry
from app.services.drafts.factory.generator import (
    build_tool_parameters,
    make_applier,
    make_handler,
)
from app.services.drafts.factory.registry import ENTITY_DRAFT_SPECS


def build_apply_dispatch() -> dict:
    """entity_type → applier(session, draft) -> applied_entity_id."""
    return {s.entity_type: make_applier(s) for s in ENTITY_DRAFT_SPECS}


def register_factory_draft_tools(registry: ToolRegistry) -> None:
    """Register every declared ``propose_<entity>_draft`` tool. The persona
    allowlist is generated from each spec's ``personas`` (also unioned into
    PersonaPolicy.allowed_tools — the gate the registry actually reads)."""
    for spec in ENTITY_DRAFT_SPECS:
        registry.register(
            name=spec.tool_name,
            description=spec.tool_description,
            parameters=build_tool_parameters(spec),
            handler=make_handler(spec),
            personas=list(spec.personas),
        )
