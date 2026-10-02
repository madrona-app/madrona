"""Pydantic schemas for TUS upload webhook."""

from __future__ import annotations

from app.fastapi_app.schemas.common import SuccessResponse


class TusUploadCompleteResponse(SuccessResponse):
    """TUS upload completion response."""
    media_id: str
    status: str
