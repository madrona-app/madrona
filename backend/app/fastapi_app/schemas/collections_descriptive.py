"""Pydantic response models for collections-descriptive endpoints."""

from __future__ import annotations

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Vocabulary Term (embedded)
# ---------------------------------------------------------------------------

class VocabularyTermOut(BaseModel):
    term_id: str
    vocabulary: str | None = None
    external_id: str | None = None
    external_uri: str | None = None
    preferred_term: str | None = None
    scope_note: str | None = None
    broader_term: str | None = None


# ---------------------------------------------------------------------------
# Object Materials
# ---------------------------------------------------------------------------

class ObjectMaterialOut(BaseModel):
    link_id: str
    object_id: str
    vocabulary_term_id: str
    part: str | None = None
    extent: str | None = None
    notes: str | None = None
    display_order: int | None = None
    created_at: str | None = None
    vocabulary_term: VocabularyTermOut | None = None


# ---------------------------------------------------------------------------
# Object Techniques
# ---------------------------------------------------------------------------

class ObjectTechniqueOut(BaseModel):
    link_id: str
    object_id: str
    vocabulary_term_id: str
    part: str | None = None
    extent: str | None = None
    notes: str | None = None
    display_order: int | None = None
    created_at: str | None = None
    vocabulary_term: VocabularyTermOut | None = None


# ---------------------------------------------------------------------------
# Object Classifications
# ---------------------------------------------------------------------------

class LookupValueBrief(BaseModel):
    value_id: str
    value_key: str | None = None
    label: str | None = None
    description: str | None = None


class ObjectClassificationOut(BaseModel):
    link_id: str
    object_id: str
    value_id: str
    display_order: int | None = None
    created_at: str | None = None
    lookup_value: LookupValueBrief | None = None
