"""Project a draft's payload into editable form-field descriptors.

The drafts inbox should let a reviewer edit a proposal as a real form, not raw
JSON. This builds the field descriptors for that form: the fields the draft
payload actually allows (the proposable subset — authoritative), each enriched
with the human label / input type / enum options / section from the form
registry where that entity has one, and derived from the Pydantic payload schema
otherwise. So every draftable entity gets a form, and the well-known procedures
get rich, sectioned labels.

No values are invented here — this is purely the field *shape*. Empty fields
stay empty in the UI; the reviewer fills them.
"""

from __future__ import annotations

import datetime
import decimal
import types
import typing
import uuid

from app.services.agent_tools.form_registry import FORM_REGISTRY
from app.services.drafts.factory.registry import build_payload_schemas
from app.services.drafts.references import reference_kind as _reference_kind

# Draft entity_type → form-registry key, where they differ.
_FORM_ALIAS: dict[str, str] = {
    "conservation_treatment": "conservation",
    "object_right": "right",
}

# form-registry field_type → UI input type the drafts form renders.
_UI_TYPE: dict[str, str] = {
    "text": "text",
    "date": "date",
    "boolean": "boolean",
    "currency": "number",
    "integer": "number",
    "enum": "enum",
    "json": "json",
    "contact": "text",  # an id today; a picker later (lookup_category carries the kind)
}

# Field names that hold long prose → render a textarea, not a one-line input.
_LONG_TEXT_HINTS = (
    "note", "notes", "description", "summary", "justification", "rationale",
    "conditions", "requirements", "findings", "detail", "details", "statement",
    "purpose", "comment", "comments", "remarks",
)


def _humanize(name: str) -> str:
    return name.replace("_id", "").replace("_", " ").strip().title()


def _is_long_text(name: str) -> bool:
    return any(h == name or name.endswith(f"_{h}") or name == h for h in _LONG_TEXT_HINTS)


def _unwrap_optional(annotation):
    """Strip Optional/Union[..., None] down to the meaningful inner type(s)."""
    origin = typing.get_origin(annotation)
    if origin in (typing.Union, getattr(types, "UnionType", None)):
        args = [a for a in typing.get_args(annotation) if a is not type(None)]
        return args[0] if len(args) == 1 else annotation
    return annotation


def _literal_values(annotation) -> list[str] | None:
    inner = _unwrap_optional(annotation)
    if typing.get_origin(inner) is typing.Literal:
        return [str(v) for v in typing.get_args(inner)]
    return None


def _derive_type(annotation) -> tuple[str, list[str] | None]:
    """Best-effort UI input type from a Pydantic field annotation."""
    enum = _literal_values(annotation)
    if enum:
        return "enum", enum
    inner = _unwrap_optional(annotation)
    origin = typing.get_origin(inner)
    if inner is bool:
        return "boolean", None
    if inner in (int, decimal.Decimal, float):
        return "number", None
    if inner in (datetime.date, datetime.datetime):
        return "date", None
    if inner is uuid.UUID:
        return "text", None
    if origin in (list, dict) or inner in (list, dict):
        return "json", None
    return "text", None


def draft_form_schema(entity_type: str) -> dict | None:
    """Editable field descriptors for a draft entity, or None if the entity has
    no draft payload schema. Shape:

    {
      entity_type, entity_label,
      fields: [{name, label, type, required, enum_values, section, lookup_category}]
    }
    """
    model = build_payload_schemas().get(entity_type)
    if model is None:
        return None

    form = FORM_REGISTRY.get(_FORM_ALIAS.get(entity_type, entity_type))
    fr_by_name = {f.name: f for f in form.fields} if form else {}

    fields = []
    for name, info in model.model_fields.items():
        meta = fr_by_name.get(name)
        if meta is not None:
            ftype = _UI_TYPE.get(meta.field_type, "text")
            enum = list(meta.enum_values) if meta.enum_values else None
            label, section, lookup = meta.label, meta.section, meta.lookup_category
        else:
            ftype, enum = _derive_type(info.annotation)
            label, section, lookup = _humanize(name), "Details", None

        # The Pydantic Literal is the source of truth for enum options — use it
        # if the registry didn't supply any (and upgrade a plain text field).
        lit = _literal_values(info.annotation)
        if lit and not enum:
            enum, ftype = lit, "enum"
        if ftype == "text" and _is_long_text(name):
            ftype = "textarea"

        ref_kind = _reference_kind(name, lookup)
        if ref_kind:
            ftype = "reference"  # the form renders an entity picker for these

        fields.append({
            "name": name,
            "label": label,
            "type": ftype,
            "required": info.is_required(),
            "enum_values": enum,
            "section": section,
            "lookup_category": lookup,
            "reference_kind": ref_kind,
        })

    return {
        "entity_type": entity_type,
        "entity_label": form.entity_label if form else _humanize(entity_type),
        "fields": fields,
    }
