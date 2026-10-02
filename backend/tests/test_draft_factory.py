"""Structural guarantees for the declarative draft-tool factory.

The point of the factory is that *one* ``EntityDraftSpec`` declaration is enough:
the tool, its applier, its payload schema, and the persona allowlists all derive
from the spec list. These tests are parametrized over ``ENTITY_DRAFT_SPECS`` so
they hold for every entity added later — if a spec is declared but (say) its
persona can't actually see the tool, exactly one of these fails.
"""

import pytest

from app.services.agent_persona import get_persona_policy
from app.services.agent_tools import ToolRegistry
from app.services.drafts.draft_service import _get_dispatch, _get_payload_schemas
from app.services.drafts.factory.generator import build_tool_parameters
from app.services.drafts.factory.registry import (
    ENTITY_DRAFT_SPECS,
    factory_draft_tool_names_for,
)
from app.services.drafts.factory.wiring import register_factory_draft_tools

_SPECS = list(ENTITY_DRAFT_SPECS)
_IDS = [s.entity_type for s in _SPECS]


@pytest.fixture(scope="module")
def factory_registry() -> ToolRegistry:
    registry = ToolRegistry()
    register_factory_draft_tools(registry)
    return registry


@pytest.mark.parametrize("spec", _SPECS, ids=_IDS)
def test_spec_registers_a_tool(spec, factory_registry):
    assert spec.tool_name in factory_registry.get_all_tool_names()
    td = factory_registry._tools[spec.tool_name]
    assert td.description == spec.tool_description
    assert td.personas == list(spec.personas)


@pytest.mark.parametrize("spec", _SPECS, ids=_IDS)
def test_spec_has_applier_in_dispatch(spec):
    assert spec.entity_type in _get_dispatch()


@pytest.mark.parametrize("spec", _SPECS, ids=_IDS)
def test_spec_schema_in_registry(spec):
    schemas = _get_payload_schemas()
    assert schemas.get(spec.entity_type) is spec.payload_schema


@pytest.mark.parametrize("spec", _SPECS, ids=_IDS)
def test_tool_params_cover_schema_and_envelope(spec):
    params = build_tool_parameters(spec)
    props = params["properties"]
    # Every payload field is offered to the model...
    for field in spec.payload_schema.model_fields:
        assert field in props, f"{field} missing from {spec.tool_name} params"
    # ...plus the cross-cutting draft envelope...
    assert "rationale" in props
    assert "citations" in props
    assert "assign_to_user_id" in props  # directed review handoff (§7.5)
    if spec.cardinality == "batch":
        # Batch: the payload fields are the (optional) change; target_ids is the
        # required list of entities to apply it to (§1C).
        assert "target_ids" in props
        assert set(params["required"]) == {"target_ids"}
    else:
        # Single: required == the schema's required (non-default) fields.
        # (The envelope fields are never required.)
        schema_required = set(spec.payload_schema.model_json_schema().get("required", []))
        assert set(params["required"]) == schema_required


@pytest.mark.parametrize("spec", _SPECS, ids=_IDS)
def test_declared_personas_can_see_the_tool(spec, factory_registry):
    """The registry's gate reads PersonaPolicy.allowed_tools — so a declared
    persona must both have the tool in its allowlist AND be served it by
    get_tools_for_persona. This is the anti-drift guarantee."""
    for persona in spec.personas:
        policy = get_persona_policy(persona)
        assert spec.tool_name in policy.allowed_tools, (
            f"{persona} allowlist is missing {spec.tool_name}"
        )
        visible = {
            t["function"]["name"]
            for t in factory_registry.get_tools_for_persona(persona)
        }
        assert spec.tool_name in visible


def test_factory_tool_names_helper_matches_specs():
    for spec in _SPECS:
        for persona in spec.personas:
            assert spec.tool_name in factory_draft_tool_names_for(persona)
    # A persona with no draftable entity gets an empty set, not an error.
    assert factory_draft_tool_names_for("visitor") == frozenset()
