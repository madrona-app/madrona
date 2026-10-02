"""Schemas for per-user workspace layout overrides.

`FormLayoutDelta` is the renderer-agnostic override — ops only, never a full
layout snapshot and never HTML/CSS. Section/group ids are validated against the
surface catalog at author time; unknown ids are dropped at merge (frontend
resolver), where the compliance invariant (a required section can never be
hidden) is also enforced.
"""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Defensive bounds — a layout has tens of sections, not thousands.
_MAX_IDS = 200
_MAX_ID_LEN = 80


def _clean_id_list(values: list[str]) -> list[str]:
    """Strip, drop empties/overlong, de-duplicate preserving order."""
    seen: set[str] = set()
    out: list[str] = []
    for v in values:
        if not isinstance(v, str):
            continue
        s = v.strip()
        if not s or len(s) > _MAX_ID_LEN or s in seen:
            continue
        seen.add(s)
        out.append(s)
    if len(out) > _MAX_IDS:
        raise ValueError(f"too many ids ({len(out)} > {_MAX_IDS})")
    return out


class FormLayoutDelta(BaseModel):
    """Overrides applied over the base layout. Ops only."""

    model_config = ConfigDict(extra="forbid")

    hidden_sections: list[str] = Field(default_factory=list)
    section_order: list[str] = Field(default_factory=list)
    group_order: list[str] = Field(default_factory=list)
    collapsed_groups: list[str] = Field(default_factory=list)

    @field_validator(
        "hidden_sections", "section_order", "group_order", "collapsed_groups"
    )
    @classmethod
    def _dedupe(cls, v: list[str]) -> list[str]:
        return _clean_id_list(v)


class LayoutOverrideCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    surface_key: str = Field(min_length=1, max_length=64)
    object_type: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    delta: FormLayoutDelta
    base_version: str | None = Field(default=None, max_length=32)
    # Whether this new variant becomes the active one for its surface.
    make_active: bool = True


class LayoutOverrideUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    delta: FormLayoutDelta | None = None


class LayoutDeactivateRequest(BaseModel):
    """Switch the surface back to the default (no active variant)."""

    model_config = ConfigDict(extra="forbid")

    surface_key: str = Field(min_length=1, max_length=64)
    object_type: str | None = Field(default=None, max_length=64)


class LayoutSectionCatalogItem(BaseModel):
    """One selectable section, sent by the client so the AI can only reference
    real ids (and knows which are required and may not be hidden)."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=200)
    group: str | None = Field(default=None, max_length=80)
    required: bool = False


class LayoutSuggestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    surface_key: str = Field(min_length=1, max_length=64)
    instruction: str = Field(min_length=1, max_length=2000)
    sections: list[LayoutSectionCatalogItem] = Field(min_length=1, max_length=200)


class LayoutOverrideOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    surface_key: str
    object_type: str | None
    name: str
    delta: dict
    base_version: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
