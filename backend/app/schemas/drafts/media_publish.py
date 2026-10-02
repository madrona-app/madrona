"""Draft payload for publishing a media item.

Applying this draft sets ``Media.is_published`` — but the applier HARD-GATES it:
it refuses unless the item has active rights on file AND has passed sensitive-
content review (and, when ``require_consent`` is set, has valid consent). This
turns the publish endpoint's soft warnings into enforced preconditions.
``extra='forbid'``.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class MediaPublishDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    media_id: UUID = Field(..., description="The media item to publish")
    published_url: str | None = Field(default=None, max_length=500)
    # The public rights statement to assert on publish (prefer a
    # rightsstatements.org URI). Written to Media.rights_statement if given.
    rights_statement: str | None = None
    # Set when the item depicts identifiable people — the applier then also
    # requires a valid MediaConsent before it will publish.
    require_consent: bool = False
