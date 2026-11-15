"""Organization-added required fields per procedure.

Each procedure has a fixed baseline of required fields (the blocking
requirements in app.services.procedure_requirements). An organization admin
can add further required fields on top of that baseline, and remove the ones
they added; the baseline itself cannot be removed.

Storage: ``organizations.procedure_required_fields`` (JSONB)
    {"loan_out": ["venue_name", "insurance_provider"], ...}

Org-added fields are blocking for every status after a procedure's first
status, and are enforced wherever the baseline is (procedure_enforcement),
only while enforcement is switched on for that procedure.

Only fields that have a control on the procedure's staff form can be added
(procedure_form_fields.json, kept in step with the forms by a frontend test
that reads it). A stored field that is no longer eligible is ignored: it is
not enforced, and the settings page lists it so an admin can remove it.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSON, JSONB

from app.services.procedure_requirements import (
    PROCEDURE_REQUIREMENTS,
    ProcedureRequirement,
    ProcedureRequirementGroup,
)

ORG_GROUP_ID = "org_required"
ORG_GROUP_LABEL = "Required by your organization"

# Procedures whose status transitions are enforced server-side, and the model
# whose columns an added field must exist on.
def _entity_models() -> dict[str, type]:
    from app.models import (
        Acquisition,
        ConservationTreatment,
        Deaccession,
        LoanIn,
        LoanOut,
        ObjectEntry,
        ObjectExit,
    )

    return {
        "object_entry": ObjectEntry,
        "acquisition": Acquisition,
        "loan_in": LoanIn,
        "loan_out": LoanOut,
        "conservation": ConservationTreatment,
        "object_exit": ObjectExit,
        "deaccession": Deaccession,
    }


# System / workflow columns that are never a sensible "required" field.
_EXCLUDED_FIELDS = frozenset({
    "organization_id", "status", "version",
    "created_at", "updated_at", "created_by", "updated_by",
    "created_by_id", "updated_by_id",
})
# Booleans read as "missing" when False, and structured JSON / arrays have no
# single form control, so neither can be made a plain required field.
_EXCLUDED_TYPES = (sa.Boolean, JSON, JSONB, sa.JSON, ARRAY)


_FORM_FIELDS_PATH = Path(__file__).with_name("procedure_form_fields.json")


@lru_cache(maxsize=1)
def form_fields() -> dict[str, frozenset[str]]:
    """Per procedure, the record fields its staff form has a control for."""
    data = json.loads(_FORM_FIELDS_PATH.read_text())
    return {proc: frozenset(names) for proc, names in data.items()}


def supports_org_fields(procedure_type: str) -> bool:
    return procedure_type in _entity_models() and procedure_type in PROCEDURE_REQUIREMENTS


def _humanize(field: str) -> str:
    base = field[:-3] if field.endswith("_id") else field
    text = base.replace("_", " ").strip()
    return text[:1].upper() + text[1:]


def baseline_required_fields(procedure_type: str) -> list[dict[str, Any]]:
    """The fixed blocking requirements, one entry per requirement."""
    proc = PROCEDURE_REQUIREMENTS.get(procedure_type)
    if not proc:
        return []
    out = []
    for group in proc.requirement_groups:
        for req in group.requirements:
            if req.severity != "blocking":
                continue
            out.append({
                "id": req.id,
                "label": req.label,
                "fields": list(req.field_paths),
                "required_for_statuses": list(req.required_for_statuses),
            })
    return out


def _baseline_field_set(procedure_type: str) -> set[str]:
    return {f for r in baseline_required_fields(procedure_type) for f in r["fields"]}


def eligible_fields(procedure_type: str) -> list[dict[str, str]]:
    """Fields an admin may add: real columns of the procedure's entity that
    are not system columns, not booleans/JSON, not already baseline, and that
    the procedure's form has a control for (a requirement nobody can fill in
    on the form would block the record for good)."""
    model = _entity_models().get(procedure_type)
    if model is None:
        return []
    on_form = form_fields().get(procedure_type, frozenset())
    mapper = sa.inspect(model)
    pk_keys = {mapper.get_property_by_column(c).key for c in mapper.primary_key}
    baseline = _baseline_field_set(procedure_type)
    fields = []
    for attr in mapper.column_attrs:
        key = attr.key
        col = attr.columns[0]
        if key in pk_keys or key in _EXCLUDED_FIELDS or key in baseline or key not in on_form:
            continue
        if isinstance(col.type, _EXCLUDED_TYPES):
            continue
        fields.append({"field": key, "label": _humanize(key)})
    fields.sort(key=lambda f: f["label"].lower())
    return fields


def field_label(procedure_type: str, field: str) -> str:
    for f in eligible_fields(procedure_type):
        if f["field"] == field:
            return f["label"]
    return _humanize(field)


def org_added_fields(org, procedure_type: str) -> list[dict[str, str]]:
    """Org-added fields for a procedure, as [{field, label}], skipping any
    stored name that is no longer a valid column."""
    stored = ((getattr(org, "procedure_required_fields", None) or {}).get(procedure_type)) or []
    valid = {f["field"]: f["label"] for f in eligible_fields(procedure_type)}
    return [{"field": f, "label": valid[f]} for f in stored if f in valid]


def ignored_org_fields(org, procedure_type: str) -> list[dict[str, str]]:
    """Stored org-added fields that are no longer eligible (for example the
    form lost its control, or the column was removed). They are not
    enforced; the settings page shows them so an admin can remove them."""
    stored = ((getattr(org, "procedure_required_fields", None) or {}).get(procedure_type)) or []
    valid = {f["field"] for f in eligible_fields(procedure_type)}
    return [{"field": f, "label": _humanize(f)} for f in stored if f not in valid]


def org_required_statuses(procedure_type: str) -> list[str]:
    proc = PROCEDURE_REQUIREMENTS.get(procedure_type)
    if not proc or not proc.status_order:
        return []
    return list(proc.status_order[1:])


def org_requirement_group(org, procedure_type: str) -> ProcedureRequirementGroup | None:
    """The org-added fields as a requirement group, or None when there are none."""
    added = org_added_fields(org, procedure_type)
    if not added:
        return None
    proc = PROCEDURE_REQUIREMENTS[procedure_type]
    statuses = org_required_statuses(procedure_type)
    section_id = proc.requirement_groups[0].section_id if proc.requirement_groups else ORG_GROUP_ID
    return ProcedureRequirementGroup(
        id=ORG_GROUP_ID,
        label=ORG_GROUP_LABEL,
        section_id=section_id,
        requirements=[
            ProcedureRequirement(
                id=f"org:{f['field']}",
                label=f["label"],
                group_id=ORG_GROUP_ID,
                field_paths=[f["field"]],
                required_for_statuses=statuses,
                severity="blocking",
                help_text="Required by your organization",
            )
            for f in added
        ],
    )
