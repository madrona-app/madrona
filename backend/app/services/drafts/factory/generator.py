"""Generates a draft tool handler + applier + JSON-schema params per spec.

Imports ``draft_service`` and the tool registry, so this module is heavy: it is
imported only lazily (at tool-registration time via ``wiring`` and inside
``draft_service``'s cached dispatch accessor), never during schema import.
"""

from __future__ import annotations

import importlib
import logging
from typing import Any, Callable

from app.services.agent_tools import AgentContext
from app.services.drafts.draft_service import (
    DraftSensitivityError,
    DraftValidationError,
    create_draft,
)
from app.services.drafts.factory.registry import EntityDraftSpec

logger = logging.getLogger(__name__)


def _resolve_create_fn(dotted: str) -> Callable:
    """Resolve a ``"module:function"`` create-fn path lazily."""
    module_path, fn_name = dotted.split(":", 1)
    return getattr(importlib.import_module(module_path), fn_name)


def build_tool_parameters(spec: EntityDraftSpec) -> dict:
    """JSON-schema tool params: the payload schema's fields plus the
    cross-cutting rationale/citations envelope. The required set is the
    schema's required (non-default) fields — exactly what the model must
    provide to create a valid draft."""
    schema = spec.payload_schema.model_json_schema()
    properties: dict[str, Any] = dict(schema.get("properties") or {})
    # Tell the model that an *_id reference field wants a real entity id —
    # resolve the record (search) and pass its id, rather than only filling the
    # free-text *_name. Keeps references real instead of invented names.
    from app.services.drafts.references import reference_kind
    for fname, prop in properties.items():
        kind = reference_kind(fname)
        if kind and isinstance(prop, dict):
            hint = (
                f" References an existing {kind} — search for the real record and "
                f"pass its id here; don't invent a name in the matching *_name field."
            )
            prop["description"] = (prop.get("description", "") + hint).strip()
    properties["rationale"] = {
        "type": "string",
        "description": (
            "Why you are proposing this draft (shown to the reviewer)"
        ),
    }
    properties["citations"] = {
        "type": "array",
        "items": {"type": "object"},
        "description": (
            "Sources backing the proposal (tool results / corpus chunks)"
        ),
    }
    properties["assign_to_user_id"] = {
        "type": "string",
        "description": (
            "Optional. The user_id of a specific staff member to direct this "
            "draft's approval to — resolve their id with lookup_staff first. "
            "They must hold the approver permission for this entity. Omit to "
            "leave the draft open to any authorized reviewer. (Takes effect only "
            "when an approval rule governs this entity.)"
        ),
    }
    if spec.cardinality == "batch":
        # The payload carries the change to apply to EACH target (all fields
        # optional — set the subset you want changed); target_ids is the
        # required list of entities to apply it to.
        properties["target_ids"] = {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "The ids of the entities to apply this change to (the batch). "
                "Every listed entity is updated as one all-or-nothing unit."
            ),
        }
        required = ["target_ids"]
    else:
        required = list(schema.get("required") or [])
    params: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "required": required,
    }
    # Preserve nested model definitions (Pydantic emits $defs for nested
    # objects / enums referenced via $ref) so the schema stays resolvable.
    if "$defs" in schema:
        params["$defs"] = schema["$defs"]
    return params


def make_handler(spec: EntityDraftSpec) -> Callable[[dict, AgentContext], dict]:
    """Build the ``propose_<entity>_draft`` tool handler. Mirrors the original
    hand-written condition-report handler: strip rationale/citations, forward
    only declared payload fields, create the draft, surface sensitivity/
    validation refusals, and return the standard draft ``_ui`` hint."""
    field_names = set(spec.payload_schema.model_fields.keys())

    is_batch = spec.cardinality == "batch"

    def handler(args: dict, ctx: AgentContext) -> dict:
        args = dict(args or {})
        rationale = args.pop("rationale", None)
        citations = args.pop("citations", None)
        # Directed review handoff (§7.5): route the draft's approval to a named
        # reviewer. Validated against the approver permission in create_draft.
        assign_to_user_id = args.pop("assign_to_user_id", None) or None
        # Batch (§1C): the N entities the change applies to.
        target_ids = args.pop("target_ids", None) if is_batch else None
        payload = {k: v for k, v in args.items() if k in field_names}

        try:
            draft = create_draft(
                ctx,
                entity_type=spec.entity_type,
                intended_action="update" if is_batch else spec.intended_action,
                payload=payload,
                rationale=rationale,
                citations=citations,
                assigned_to_user_id=assign_to_user_id,
                cardinality="batch" if is_batch else "single",
                target_entity_ids=target_ids,
                sensitivity_entity_type=spec.sensitivity_entity_type,
            )
        except DraftSensitivityError as e:
            # Record-level refusal (§7.3): abort the step and surface it; the
            # planner must not retry.
            return {"error": str(e), "refused": True}
        except DraftValidationError as e:
            return {"error": str(e)}
        except ValueError as e:
            # e.g. the assignee doesn't hold the approver permission
            # (_assert_can_approve). Surface cleanly so the agent can drop the
            # assignment or pick a different reviewer.
            return {"error": str(e)}

        summary = (
            spec.summarize(payload) if spec.summarize else f"{spec.entity_type} draft"
        )
        ui: dict[str, Any] = {
            "kind": "draft",
            "draft_id": str(draft.draft_id),
            "entity_type": spec.entity_type,
            "status": draft.status,
            "summary": summary,
        }
        if is_batch:
            ui["cardinality"] = "batch"
            ui["target_count"] = len(draft.target_entity_ids or [])
        return {
            "draft_id": str(draft.draft_id),
            "status": draft.status,
            "entity_type": spec.entity_type,
            "message": "Draft created and awaiting review in the drafts inbox.",
            "_ui": ui,
        }

    return handler


def make_applier(spec: EntityDraftSpec) -> Callable[[Any, Any], Any]:
    """Build the apply-time applier.

    SINGLE: delegates to the shared ``create_fn`` (the same code the router
    uses — no duplicated create logic) inside the draft's savepoint.
    ``open_approval=False``: the draft's own approval gate in ``create_draft``
    already ran, so the applier never re-gates. ``proposed_by`` preserves the
    proposer as distinct from the approving actor (e.g.
    condition_report.examiner_id). Returns the created entity id.

    BATCH (§1C): applies ``payload`` to every id in ``target_entity_ids`` via
    ``apply_fn(session, org_id, target_id, payload, actor)``, inside the SAME
    savepoint apply_draft opened — so any item raising rolls the whole batch
    back (all-or-nothing). Returns the per-item outcome list."""
    if spec.cardinality == "batch":

        def batch_applier(session, draft) -> Any:
            apply_fn = _resolve_create_fn(spec.create_fn)
            actor = draft.decided_by_user_id or draft.proposed_by_user_id
            results: list[dict] = []
            for target_id in draft.target_entity_ids or []:
                apply_fn(session, draft.organization_id, target_id, draft.payload, actor)
                results.append({"target_id": str(target_id), "status": "applied"})
            return results

        return batch_applier

    def applier(session, draft) -> Any:
        create_fn = _resolve_create_fn(spec.create_fn)
        actor = draft.decided_by_user_id or draft.proposed_by_user_id
        entity = create_fn(
            session,
            draft.organization_id,
            draft.payload,
            actor,
            open_approval=False,
            proposed_by=draft.proposed_by_user_id,
        )
        return getattr(entity, spec.id_attr)

    return applier
