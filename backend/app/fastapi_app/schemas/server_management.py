"""Schemas for server management admin endpoints."""

from typing import Any, Optional

from pydantic import BaseModel


class ServiceStatus(BaseModel):
    status: str
    details: Optional[dict[str, Any]] = None


class FeatureFlags(BaseModel):
    opensearch: bool
    clip: bool
    whisper: bool
    ocr: bool
    semantic_search: bool
    tus: bool
    unoserver: bool
    agent: bool


class ServerStatusResponse(BaseModel):
    environment: dict[str, Any]
    feature_flags: FeatureFlags
    services: dict[str, ServiceStatus]


class ServerActionRequest(BaseModel):
    action: str
    organization_id: Optional[str] = None
    confirm: Optional[bool] = None


class ServerActionResponse(BaseModel):
    success: bool
    action: str
    message: str
    details: Optional[dict[str, Any]] = None
