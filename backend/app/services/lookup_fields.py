"""Columns whose values come from lookup categories, and how each is enforced.

Form controls offer values from a lookup category (``getLookup('<category>')``
in the frontend, seeded by ``seeds/seed_lookup_data.py`` and extended per
organization in ``collections.lookup_values``). A column that also carried a
CHECK constraint listing a different vocabulary refused some of those values at
commit, which the routes reported as "may already exist" or a 500.

Each lookup-backed column is registered here with one of three modes:

- ``OPEN``: a descriptive vocabulary organizations are meant to extend. The
  column has no CHECK; the API accepts any value that is active for the
  organization (global or org-added) via :func:`check_lookup_values`.
- ``FIXED``: a closed vocabulary that code relies on (workflow status, a rating
  scale the risk views rank). The CHECK stays, every seeded value must satisfy
  it, and organizations cannot add values to the category
  (:func:`refuse_fixed_category_addition`).
- ``FREE``: never had a CHECK and is not validated (currency codes, a
  role label); listed so the registry covers every persisted category.

``tests/test_lookup_backed_columns.py`` holds the registry to the database:
an OPEN or FREE column with a CHECK, a FIXED column whose CHECK rejects a
seeded value, or a frontend lookup category missing from the registry fails.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import or_

OPEN = "open"
FIXED = "fixed"
FREE = "free"


@dataclass(frozen=True)
class LookupColumn:
    category: str
    table: str  # schema-qualified, e.g. "collections.acquisitions"
    column: str
    mode: str


def _cols(mode: str, category: str, *targets: str) -> list[LookupColumn]:
    out = []
    for target in targets:
        schema, table, column = target.split(".")
        out.append(LookupColumn(category, f"{schema}.{table}", column, mode))
    return out


LOOKUP_COLUMNS: tuple[LookupColumn, ...] = tuple(
    # -- OPEN: org-extendable, validated against the org's lookup values --
    _cols(OPEN, "acquisition_method", "collections.acquisitions.acquisition_method")
    + _cols(OPEN, "source_type", "collections.acquisitions.source_type")
    + _cols(OPEN, "legal_status", "collections.acquisitions.legal_status")
    + _cols(OPEN, "audit_type", "collections.audit_campaigns.audit_type")
    + _cols(OPEN, "sample_method", "collections.audit_campaigns.sample_method")
    + _cols(OPEN, "citation_type", "collections.citations.citation_type")
    + _cols(OPEN, "review_type", "collections.collections_reviews.review_type")
    + _cols(OPEN, "report_type", "collections.condition_reports.report_type")
    + _cols(OPEN, "treatment_type", "collections.conservation_treatments.treatment_type")
    + _cols(OPEN, "deaccession_reason", "collections.deaccessions.reason")
    + _cols(OPEN, "documentation_plan_type", "collections.documentation_plans.plan_type")
    + _cols(OPEN, "review_frequency", "collections.documentation_plans.review_frequency")
    + _cols(OPEN, "event_type", "collections.events.event_type")
    + _cols(OPEN, "event_audience", "collections.events.audience")
    + _cols(OPEN, "incident_type", "collections.incident_reports.incident_type")
    + _cols(OPEN, "claim_status", "collections.incident_reports.insurance_claim_status")
    + _cols(OPEN, "loan_purpose", "collections.loans_in.loan_purpose", "collections.loans_out.loan_purpose")
    + _cols(OPEN, "entry_reason", "collections.object_entries.entry_reason")
    + _cols(OPEN, "exit_reason", "collections.object_exits.exit_reason")
    + _cols(OPEN, "reproduction_type", "collections.reproduction_requests.reproduction_type")
    + _cols(OPEN, "right_type", "collections.object_rights.right_type")
    + _cols(OPEN, "use_type", "collections.use_requests.use_type")
    + _cols(OPEN, "valuation_type", "collections.valuations.valuation_type")
    + _cols(OPEN, "valuation_method", "collections.valuations.valuation_method")
    # -- FIXED: code branches on these values; the CHECK is the contract --
    # object_status drives loans, deaccession and public visibility.
    + _cols(FIXED, "object_status", "collections.collection_objects.object_status")
    # overall_condition is a ranked scale (risk overview, report templates).
    + _cols(FIXED, "condition", "collections.condition_reports.overall_condition")
    + _cols(FREE, "condition", "collections.object_exits.condition_at_exit")
    + _cols(FIXED, "right_status", "collections.object_rights.status")
    # -- FREE: no CHECK, any value is stored as given --
    + _cols(
        FREE,
        "currency",
        "collections.acquisitions.cost_currency",
        "collections.acquisitions.appraised_value_currency",
        "collections.conservation_treatments.estimated_cost_currency",
        "collections.conservation_treatments.actual_cost_currency",
        "collections.deaccessions.appraised_value_currency",
        "collections.deaccessions.sale_currency",
        "collections.loans_in.insurance_currency",
        "collections.object_entries.insurance_currency",
        "collections.object_rights.fee_currency",
        "collections.reproduction_requests.fee_currency",
        "collections.valuations.valuation_currency",
    )
    + _cols(FREE, "priority", "collections.condition_reports.conservation_priority")
    + _cols(FREE, "committee_recommendation", "collections.deaccessions.committee_recommendation")
    + _cols(FREE, "disposal_method", "collections.deaccessions.disposal_method")
    + _cols(FREE, "entry_duration", "collections.object_entries.expected_duration")
    + _cols(FREE, "shipping_method", "collections.object_exits.exit_method")
    + _cols(FREE, "reproduction_purpose", "collections.reproduction_requests.reproduction_purpose")
    + _cols(FREE, "fee_type", "collections.reproduction_requests.fee_type")
    + _cols(FREE, "delivery_method", "collections.reproduction_requests.delivery_method")
    + _cols(FREE, "license_type", "collections.object_rights.license_type")
    + _cols(FREE, "reproduction_type", "collections.use_requests.reproduction_type")
    + _cols(FREE, "gender", "collections.constituents.gender")
    + _cols(FREE, "life_role", "collections.constituents.life_roles")
    + [
        LookupColumn(f"constituent_role_{suffix}", "collections.constituent_xrefs", "role", FREE)
        for suffix in (
            "object", "acquisition", "exhibition", "event", "shipment", "conservation",
            "loan_in", "loan_out", "right", "generic",
        )
    ]
)

# Categories a form uses that are not stored as a value key in a column.
NOT_PERSISTED_AS_KEY: dict[str, str] = {
    "classification": "stored as object_classifications rows by lookup value_id",
}

FIXED_CATEGORIES: frozenset[str] = frozenset(c.category for c in LOOKUP_COLUMNS if c.mode == FIXED)


def max_value_key_length(category_key: str) -> int | None:
    """Longest value key every column filled from ``category_key`` can store.

    Lookup value keys allow 100 characters but some columns are narrower
    (review_frequency is 20, currency codes 3); a longer org-added key could
    be picked but never saved.
    """
    lengths = [
        length
        for entry in LOOKUP_COLUMNS
        if entry.category == category_key
        and (length := _column_length(entry.table, entry.column))
    ]
    return min(lengths) if lengths else None


def _column_length(table: str, column: str) -> int | None:
    import app.models  # noqa: F401 - populate the metadata
    from app.database import Base

    t = Base.metadata.tables.get(table)
    col = t.columns.get(column) if t is not None else None
    return getattr(getattr(col, "type", None), "length", None)


def _open_fields(table: str) -> dict[str, str]:
    return {c.column: c.category for c in LOOKUP_COLUMNS if c.table == table and c.mode == OPEN}


def _table_name(model_or_table) -> str:
    if isinstance(model_or_table, str):
        return model_or_table
    return model_or_table.__table__.fullname


def is_active_lookup_value(db, org_id: UUID, category: str, value: str) -> bool:
    """True if ``value`` is an active key in ``category`` for the organization."""
    from app.models import LookupCategory, LookupValue

    return (
        db.query(LookupValue.value_id)
        .join(LookupCategory, LookupValue.category_id == LookupCategory.category_id)
        .filter(
            LookupCategory.category_key == category,
            LookupValue.value_key == value,
            LookupValue.is_active.is_(True),
            or_(LookupValue.organization_id == org_id, LookupValue.organization_id.is_(None)),
        )
        .first()
        is not None
    )


def lookup_label(db, org_id: UUID, category: str, value: str) -> str:
    """The label an organization sees for ``value`` (its own row wins)."""
    from app.models import LookupCategory, LookupValue

    rows = (
        db.query(LookupValue.organization_id, LookupValue.label)
        .join(LookupCategory, LookupValue.category_id == LookupCategory.category_id)
        .filter(
            LookupCategory.category_key == category,
            LookupValue.value_key == value,
            or_(LookupValue.organization_id == org_id, LookupValue.organization_id.is_(None)),
        )
        .all()
    )
    for org, label in sorted(rows, key=lambda r: r[0] is None):
        if label:
            return label
    return value


def active_values(db, org_id: UUID, category: str) -> list[str]:
    """Active value keys of ``category`` for the organization (global + own)."""
    from app.models import LookupCategory, LookupValue

    rows = (
        db.query(LookupValue.value_key)
        .join(LookupCategory, LookupValue.category_id == LookupCategory.category_id)
        .filter(
            LookupCategory.category_key == category,
            LookupValue.is_active.is_(True),
            or_(LookupValue.organization_id == org_id, LookupValue.organization_id.is_(None)),
        )
        .order_by(LookupValue.sort_order, LookupValue.value_key)
        .all()
    )
    return list(dict.fromkeys(r[0] for r in rows))


def field_enum_options(field_meta, db=None, org_id: UUID | None = None) -> list[str] | None:
    """Options for a form-registry field: its fixed list, or (for a
    lookup-backed field) the org's active values. Without a session the
    lookup-backed field has no fixed list to offer and returns None."""
    if getattr(field_meta, "enum_values", None):
        return list(field_meta.enum_values)
    category = getattr(field_meta, "lookup_values", None)
    if category and db is not None and org_id is not None:
        return active_values(db, org_id, category)
    return None


def find_invalid_lookup_value(
    db,
    org_id: UUID,
    model_or_table,
    data: Mapping,
    *,
    current=None,
    aliases: Mapping[str, str] | None = None,
) -> tuple[str, str, object] | None:
    """The first ``(key, category, value)`` in ``data`` that is not an active
    OPEN lookup value for the org, or None. See :func:`check_lookup_values`."""
    table = _table_name(model_or_table)
    aliases = aliases or {}
    for column, category in _open_fields(table).items():
        for key in dict.fromkeys((aliases.get(column, column), column)):
            if key not in data:
                continue
            value = data[key]
            if value is None or value == "":
                continue
            if current is not None and getattr(current, column, None) == value:
                continue
            limit = _column_length(table, column)
            too_long = isinstance(value, str) and limit is not None and len(value) > limit
            if too_long or not isinstance(value, str) or not is_active_lookup_value(db, org_id, category, value):
                return key, category, value
    return None


def check_lookup_values(
    db,
    org_id: UUID,
    model_or_table,
    data: Mapping,
    *,
    current=None,
    aliases: Mapping[str, str] | None = None,
) -> None:
    """400 unless each OPEN lookup-backed value in ``data`` is active for the org.

    ``data`` is the request body (API field names); ``aliases`` maps a column to
    the body key that writes it when they differ (e.g. ``entry_reason`` ->
    ``reason``). Empty values are left to the column's own nullability. On an
    update pass the stored row as ``current``: a value equal to the stored one
    is not re-checked, so a record saved before a value was retired (or under
    the old CHECK vocabulary) can still be edited without changing it.
    """
    bad = find_invalid_lookup_value(db, org_id, model_or_table, data, current=current, aliases=aliases)
    if bad:
        key, _category, value = bad
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_lookup_value",
                "message": f"Unknown {key}: {value}",
                "field": key,
            },
        )


# Agent draft entity type -> (table its applier writes, {column: payload key}).
# Draft payload schemas type these fields as LookupKey (any string); the
# organization's lookup values are checked here when a draft is proposed or
# edited, so an agent can propose an org-added value and is refused an unknown
# one. tests/test_lookup_backed_columns.py holds this map to the schemas.
DRAFT_LOOKUP_TABLES: dict[str, tuple[str, dict[str, str]]] = {
    "acquisition": ("collections.acquisitions", {}),
    "condition_report": ("collections.condition_reports", {}),
    "conservation_treatment": ("collections.conservation_treatments", {}),
    "deaccession": ("collections.deaccessions", {}),
    "loan_in": ("collections.loans_in", {}),
    "loan_out": ("collections.loans_out", {}),
    "object_entry": ("collections.object_entries", {"entry_reason": "reason"}),
    "object_exit": ("collections.object_exits", {}),
    "object_right": ("collections.object_rights", {}),
    "reproduction_request": ("collections.reproduction_requests", {}),
    "use_request": ("collections.use_requests", {}),
    "valuation": ("collections.valuations", {}),
}


def draft_lookup_error(db, org_id: UUID, entity_type: str, payload: Mapping) -> str | None:
    """Why a draft payload's lookup-backed values are refused, or None. The
    message lists the allowed values so the agent can correct itself."""
    target = DRAFT_LOOKUP_TABLES.get(entity_type)
    if target is None:
        return None
    table, aliases = target
    bad = find_invalid_lookup_value(db, org_id, table, payload, aliases=aliases)
    if bad is None:
        return None
    key, category, value = bad
    return (
        f"{key} {value!r} is not one of this organization's {category} values; "
        f"choose one of: {', '.join(active_values(db, org_id, category))}"
    )


def check_new_value_key(category_key: str, value_key: str) -> None:
    """400 unless an organization may add ``value_key`` to ``category_key``.

    A FIXED category's values are the CHECK on its column, and a key longer
    than the narrowest column filled from the category cannot be stored.
    """
    refuse_fixed_category_addition(category_key)
    limit = max_value_key_length(category_key)
    if limit is not None and len(value_key) > limit:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "value_key_too_long",
                "message": f"Keys in '{category_key}' can be at most {limit} characters.",
                "field": "value_key",
            },
        )


def refuse_fixed_category_addition(category_key: str) -> None:
    """400 when an organization tries to add a value to a FIXED category."""
    if category_key in FIXED_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "fixed_lookup_category",
                "message": (
                    f"Values in '{category_key}' drive record workflow and cannot be "
                    "added to. You can rename or hide the existing values."
                ),
            },
        )
