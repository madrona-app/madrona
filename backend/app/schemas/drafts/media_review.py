"""Draft payload for the sensitive-content metadata review of a media item.

Approving this draft IS the review sign-off: applying it sets
``Media.metadata_reviewed`` (and stamps who/when). A precondition for publishing.
``extra='forbid'``.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class MediaReviewDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    media_id: UUID = Field(..., description="The media item being reviewed")
    notes: str | None = Field(default=None, description="Review notes (sensitive content, etc.)")
