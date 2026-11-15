"""Write path for a conservation treatment's materials.

Materials are stored as rows in ``collections.treatment_materials`` and read
back as ``materials_used`` (a list of ``{material_name, manufacturer,
quantity, purpose}``). The staff form edits them as one material per line, so
writes accept either a list of names / dicts or a newline-separated string.

Rows are matched to incoming entries by material name (case-insensitive), so
saving the list again keeps the manufacturer, quantity and other details of
materials that are still there; removed names are deleted and new names
added, in the order given.
"""
from __future__ import annotations

from typing import Any

from app.models.procedures import ConservationTreatment, TreatmentMaterial

_DETAIL_FIELDS = ("manufacturer", "product_number", "quantity", "concentration", "purpose", "safety_notes")


def _normalize(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, str):
        items: list[Any] = value.splitlines()
    elif isinstance(value, (list, tuple)):
        items = list(value)
    else:
        raise ValueError("materials_used must be a list or a string")
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        if isinstance(item, dict):
            name = str(item.get("material_name") or item.get("name") or item.get("material") or "").strip()
            details = {k: item[k] for k in _DETAIL_FIELDS if k in item}
        else:
            name = str(item or "").strip()
            details = {}
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append({"material_name": name[:255], **details})
    return out


def sync_treatment_materials(session, treatment: ConservationTreatment, value: Any, actor=None) -> None:
    """Replace the treatment's materials with ``value`` (see module docstring)."""
    wanted = _normalize(value)
    existing = {m.material_name.casefold(): m for m in (treatment.materials or [])}
    keep: set[str] = set()
    for order, entry in enumerate(wanted):
        key = entry["material_name"].casefold()
        row = existing.get(key)
        if row is None:
            row = TreatmentMaterial(
                organization_id=treatment.organization_id,
                treatment_id=treatment.treatment_id,
                material_name=entry["material_name"],
                created_by=actor,
            )
            treatment.materials.append(row)
        for field in _DETAIL_FIELDS:
            if field in entry:
                setattr(row, field, entry[field])
        row.display_order = order
        keep.add(key)
    for key, row in existing.items():
        if key not in keep:
            treatment.materials.remove(row)  # delete-orphan removes the row
