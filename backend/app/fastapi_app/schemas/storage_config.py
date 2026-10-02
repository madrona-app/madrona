"""Pydantic response schemas for Storage Configuration API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class StorageConfigOut(BaseModel):
    provider: str
    is_verified: bool | None = None
    verified_at: str | None = None
    verification_error: str | None = None
    storage_region: str | None = None
    cdn_domain: str | None = None
    has_cdn_signing_key: bool | None = None
    created_at: str | None = None
    updated_at: str | None = None
    # Provider-specific fields (dynamic)
    bucket: str | None = None
    region: str | None = None
    endpoint_url: str | None = None
    container: str | None = None
    account_name: str | None = None
    project_id: str | None = None


class StorageConfigUpdateResponse(BaseModel):
    provider: str
    bucket: str | None = None
    region: str | None = None
    is_verified: bool | None = None
    verified_at: str | None = None
    message: str | None = None


class StorageConfigDeleteResponse(BaseModel):
    message: str
    provider: str | None = None


class StorageTestResponse(BaseModel):
    success: bool
    message: str


class CdnConfigResponse(BaseModel):
    cdn_domain: str | None = None
    has_signing_key: bool
    message: str


class MigrationStartResponse(BaseModel):
    task_id: str
    message: str
    status: str
    dry_run: bool


class MigrationStatusResponse(BaseModel):
    task_id: str | None = None
    status: str | None = None
    started_at: str | None = None
    progress: Any = None
    result: Any = None
    completed_at: str | None = None
    error: str | None = None
    message: str | None = None


class VerifyMigrationResponse(BaseModel):
    task_id: str
    message: str
    status: str
    sample_rate: float


class VerificationStatusResponse(BaseModel):
    task_id: str
    status: str
    result: Any = None
    error: str | None = None


class CancelMigrationResponse(BaseModel):
    message: str
    files_copied_before_cancel: int
