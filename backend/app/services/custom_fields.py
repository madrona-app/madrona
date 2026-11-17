"""User-defined fields on object records.

Definitions (collections.custom_field_definitions) are created by the
organization's administrator; values live in collection_objects.custom_fields
(jsonb keyed by the field key). Every write is validated here by type, and
each definition carries its own field-level permissions: the roles that may
view it and the roles that may edit it (empty = everyone who can view / edit
objects). Admins always see and edit everything.
"""
from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import CustomFieldDefinition

FIELD_TYPES = ("text", "long_text", "number", "date", "boolean", "select", "multi_select", "url")
MAX_TEXT = 10_000


class CustomFieldError(ValueError):
    def __init__(self, message: str, field: str | None = None, status: int = 422):
        super().__init__(message)
        self.field = field
        self.status = status


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (text or "").strip().lower()).strip("_")[:60]


def definitions(db: Session, org_id: UUID, entity_type: str = "collection_object",
                active_only: bool = True) -> list[CustomFieldDefinition]:
    q = db.query(CustomFieldDefinition).filter(
        CustomFieldDefinition.organization_id == org_id,
        CustomFieldDefinition.entity_type == entity_type,
    )
    if active_only:
        q = q.filter(CustomFieldDefinition.is_active.is_(True))
    return q.order_by(CustomFieldDefinition.sort_order, CustomFieldDefinition.label).all()


def serialize_definition(d: CustomFieldDefinition) -> dict:
    return {
        "field_id": str(d.field_id),
        "entity_type": d.entity_type,
        "key": d.key,
        "label": d.label,
        "help_text": d.help_text,
        "field_type": d.field_type,
        "options": d.options or [],
        "is_required": d.is_required,
        "is_searchable": d.is_searchable,
        "is_public": d.is_public,
        "section": d.section,
        "sort_order": d.sort_order,
        "is_active": d.is_active,
        "view_roles": d.view_roles or [],
        "edit_roles": d.edit_roles or [],
    }


def validate_definition_input(data: dict, existing: CustomFieldDefinition | None = None) -> dict:
    out: dict[str, Any] = {}
    if existing is None or "label" in data:
        label = (data.get("label") or "").strip()
        if not label:
            raise CustomFieldError("A field needs a name", "label")
        out["label"] = label[:120]
    if existing is None:
        ftype = data.get("field_type") or "text"
        if ftype not in FIELD_TYPES:
            raise CustomFieldError(f"Field type must be one of: {', '.join(FIELD_TYPES)}", "field_type")
        out["field_type"] = ftype
        key = slug(data.get("key") or out["label"])
        if not key:
            raise CustomFieldError("The field needs a key made of letters or numbers", "key")
        out["key"] = key
    elif "field_type" in data and data["field_type"] != existing.field_type:
        raise CustomFieldError("A field's type cannot be changed once it exists; create a new field", "field_type")
    ftype = out.get("field_type") or existing.field_type
    if "options" in data or (existing is None and ftype in ("select", "multi_select")):
        opts = data.get("options") or []
        if isinstance(opts, str):
            opts = [o.strip() for o in opts.split("\n")]
        opts = [str(o).strip()[:200] for o in opts if str(o).strip()]
        if ftype in ("select", "multi_select") and not opts:
            raise CustomFieldError("A choice field needs at least one choice", "options")
        if len(set(o.lower() for o in opts)) != len(opts):
            raise CustomFieldError("Choices must be different from each other", "options")
        out["options"] = opts
    for flag in ("is_required", "is_searchable", "is_public", "is_active"):
        if flag in data:
            out[flag] = bool(data[flag])
    for text_field, limit in (("help_text", 500), ("section", 60)):
        if text_field in data:
            out[text_field] = (str(data[text_field] or "").strip()[:limit]) or None
    if "sort_order" in data and data["sort_order"] is not None:
        out["sort_order"] = int(data["sort_order"])
    for roles in ("view_roles", "edit_roles"):
        if roles in data:
            value = data[roles] or []
            if not isinstance(value, list):
                raise CustomFieldError("Roles must be a list", roles)
            out[roles] = [str(r)[:100] for r in value if str(r).strip()]
    return out


# ── Permissions ─────────────────────────────────────────────────────────────

class RoleContext:
    """The caller's role, resolved once per request."""

    def __init__(self, role_key: str | None, role_id: UUID | None):
        self.role_key = role_key
        self.role_id = role_id
        self.is_admin = role_key in ("admin", "platform_admin")
        from app.permissions import get_role_inheritance_chain
        try:
            chain = get_role_inheritance_chain(role_key) if role_key else []
        except Exception:
            chain = [role_key] if role_key else []
        self.names = {str(x) for x in chain} | ({str(role_id)} if role_id else set())


def role_context(db: Session, org_id: UUID, user_id: UUID, role_override: str | None = None) -> RoleContext:
    from app.services.field_access_service import get_user_role_info
    info = get_user_role_info(db, org_id, user_id, role_override)
    return RoleContext(info.role_key if info else None, info.role_id if info else None)


def _allowed(roles: list[str] | None, ctx: RoleContext) -> bool:
    if ctx.is_admin or not roles:
        return True
    return bool(set(roles) & ctx.names)


def can_view(d: CustomFieldDefinition, ctx: RoleContext) -> bool:
    return _allowed(d.view_roles, ctx)


def can_edit(d: CustomFieldDefinition, ctx: RoleContext) -> bool:
    return can_view(d, ctx) and _allowed(d.edit_roles, ctx)


# ── Values ──────────────────────────────────────────────────────────────────

def _coerce(d: CustomFieldDefinition, value: Any):
    label = d.label
    if value is None or value == "" or value == []:
        return None
    t = d.field_type
    if t in ("text", "long_text"):
        s = str(value).strip()
        limit = 500 if t == "text" else MAX_TEXT
        if len(s) > limit:
            raise CustomFieldError(f"{label} is limited to {limit} characters", d.key)
        return s or None
    if t == "number":
        try:
            n = Decimal(str(value).strip())
        except InvalidOperation:
            raise CustomFieldError(f"{label} must be a number", d.key)
        if not n.is_finite():
            raise CustomFieldError(f"{label} must be a number", d.key)
        return int(n) if n == n.to_integral_value() and abs(n) < 2**53 else float(n)
    if t == "date":
        try:
            return date.fromisoformat(str(value).strip()[:10]).isoformat()
        except ValueError:
            raise CustomFieldError(f"{label} must be a date (YYYY-MM-DD)", d.key)
    if t == "boolean":
        if isinstance(value, bool):
            return value
        s = str(value).strip().lower()
        if s in ("true", "yes", "1"):
            return True
        if s in ("false", "no", "0"):
            return False
        raise CustomFieldError(f"{label} must be yes or no", d.key)
    if t == "select":
        s = str(value).strip()
        match = next((o for o in (d.options or []) if o.lower() == s.lower()), None)
        if match is None:
            raise CustomFieldError(f"{label} must be one of: {', '.join(d.options or [])}", d.key)
        return match
    if t == "multi_select":
        items = value if isinstance(value, list) else [v.strip() for v in str(value).split(";")]
        out = []
        for item in items:
            match = next((o for o in (d.options or []) if o.lower() == str(item).strip().lower()), None)
            if match is None:
                raise CustomFieldError(f"{label}: “{item}” is not one of the choices", d.key)
            if match not in out:
                out.append(match)
        return out or None
    if t == "url":
        s = str(value).strip()
        p = urlparse(s)
        if p.scheme.lower() not in ("http", "https") or not p.netloc:
            raise CustomFieldError(f"{label} must be a web address starting with https:// or http://", d.key)
        return s[:2000]
    raise CustomFieldError(f"{label} has an unknown type", d.key)


def apply_values(db: Session, org_id: UUID, existing: dict | None, incoming: Any, ctx: RoleContext,
                 *, creating: bool) -> dict | None:
    """Merge ``incoming`` into ``existing`` custom field values, validating everything.

    Keys not sent are kept. A null/empty value clears a field. Unknown keys,
    inactive fields and fields the caller's role cannot edit are refused.
    Required fields must have a value after the merge. That is checked only
    when the caller sends custom fields, so quick-create flows elsewhere in the
    app and edits to migrated records are not blocked by fields they don't show.
    """
    if incoming is None:
        incoming = {}
    if not isinstance(incoming, dict):
        raise CustomFieldError("custom_fields must be an object keyed by field key", "custom_fields")
    defs = {d.key: d for d in definitions(db, org_id)}
    result = dict(existing or {})
    for key, value in incoming.items():
        d = defs.get(key)
        if d is None:
            raise CustomFieldError(f"There is no active field “{key}”", key)
        coerced = _coerce(d, value)
        if coerced == (existing or {}).get(key):
            continue  # unchanged (a form echoing back a read-only value)
        if not can_edit(d, ctx):
            raise CustomFieldError(f"Your role cannot edit {d.label}", key, status=403)
        if coerced is None:
            result.pop(key, None)
        else:
            result[key] = coerced
    if incoming:
        missing = [d.label for d in defs.values() if d.is_required and result.get(d.key) in (None, "", [])
                   and can_edit(d, ctx)]
        if missing:
            raise CustomFieldError(f"Required: {', '.join(missing)}", "custom_fields")
    return result or None


def visible_values(db: Session, org_id: UUID, values: dict | None, ctx: RoleContext,
                   public_only: bool = False) -> dict:
    """The values ``ctx`` may see (and, for the portal, only public fields)."""
    if not values:
        return {}
    defs = {d.key: d for d in definitions(db, org_id)}
    out = {}
    for key, value in values.items():
        d = defs.get(key)
        if d is None:
            continue
        if public_only and not d.is_public:
            continue
        if not public_only and not can_view(d, ctx):
            continue
        out[key] = value
    return out


def public_display(db: Session, org_id: UUID, values: dict | None) -> list[dict]:
    """[{label, value}] for the public portal, in the administrator's order."""
    if not values:
        return []
    out = []
    for d in definitions(db, org_id):
        if d.is_public and values.get(d.key) not in (None, "", []):
            v = values[d.key]
            if isinstance(v, list):
                v = "; ".join(map(str, v))
            elif isinstance(v, bool):
                v = "Yes" if v else "No"
            out.append({"label": d.label, "value": str(v)})
    return out
