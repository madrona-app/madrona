"""Draft payload for a MediaConsent record (release for media depicting people).

Mirrors the ``create_media_consent`` router endpoint; the consent_type /
consent_scope CHECKs are enforced as Literals. ``extra='forbid'``.
"""

from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Mirror media_consent.check_consent_type / check_consent_scope.
ConsentType = Literal[
    "photo_release", "model_release", "interview", "performance", "general", "other"
]
ConsentScope = Literal["internal", "public", "commercial", "educational", "all"]


class MediaConsentDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    media_id: UUID = Field(..., description="The media item this consent covers")
    subject_name: str = Field(..., min_length=1, max_length=255)
    subject_role: str | None = Field(default=None, max_length=100)
    consent_type: ConsentType = "model_release"
    consent_scope: ConsentScope = "internal"
    consent_date: date | None = None  # defaults to today in the create fn
    expiry_date: date | None = None
    consent_document_key: str | None = Field(default=None, max_length=500)
    is_valid: bool = True
    notes: str | None = None
