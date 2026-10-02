"""Pydantic response models for health endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class RootResponse(BaseModel):
    name: str
    version: str
    api_base: str
    docs: str


class HealthResponse(BaseModel):
    status: str


class SearchHealthResponse(BaseModel):
    status: str
    message: str | None = None
    cluster_name: str | None = None
    number_of_nodes: int | None = None
    active_shards: int | None = None
    relocating_shards: int | None = None
    initializing_shards: int | None = None
    unassigned_shards: int | None = None


class DeepHealthResponse(BaseModel):
    status: str
    checks: dict[str, Any]
    response_time_ms: int
