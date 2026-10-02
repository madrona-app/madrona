"""Typed payload for a `media_metadata` BATCH draft (§1C).

The change to apply to each target medium — the safe descriptive subset of the
Media update shape (`app/models/media.py::Media`). All fields optional: the AI
sets only what should change, and `create_draft` stores just the provided fields
(`exclude_unset`) so unset fields are never written as NULL across the batch.
`extra='forbid'` rejects anything else (rights/consent/publishing fields are
deliberately excluded — those carry workflow semantics and are out of scope).
"""

from pydantic import BaseModel, ConfigDict, Field


class MediaMetadataDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=500)
    description: str | None = None
    alt_text: str | None = Field(default=None, max_length=500)
    credit: str | None = Field(default=None, max_length=500)
    creator: str | None = Field(default=None, max_length=255)
    source: str | None = Field(default=None, max_length=500)
