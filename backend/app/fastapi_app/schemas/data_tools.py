"""Pydantic response schemas for Data Tools (Transformers, Field Access, Projection Profiles) API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# Transformers
# ============================================================================

class TransformerGeneratedOut(BaseModel):
    transformer_id: str
    dataset_id: str
    target_format: str
    status: str
    ai_provider: str | None = None
    sample_count: int | None = None
    code_length: int
    generated_at: str


class TransformerSummaryOut(BaseModel):
    transformer_id: str
    target_format: str
    status: str
    ai_provider: str | None = None
    sample_count: int | None = None
    code_length: int
    generated_at: str
    activated_at: str | None = None


class TransformerListResponse(BaseModel):
    transformers: list[TransformerSummaryOut]


class TransformerDetailOut(BaseModel):
    transformer_id: str
    dataset_id: str
    target_format: str
    status: str
    ai_provider: str | None = None
    transformer_code: str
    generated_at: str
    activated_at: str | None = None


class TransformerUpdateResponse(BaseModel):
    transformer_id: str
    updated: bool


class TransformerActivateResponse(BaseModel):
    transformer_id: str
    status: str
    activated_at: str


# ============================================================================
# Field Access
# ============================================================================

class FieldPolicyListResponse(BaseModel):
    policies: list[Any]


class FieldGrantListResponse(BaseModel):
    grants: list[Any]


class FieldGrantUpsertResponse(BaseModel):
    grants: list[Any]
    message: str


# ============================================================================
# Projection Profiles
# ============================================================================

class ProjectionProfileResponse(BaseModel):
    organization_id: str
    config: Any
    is_default: bool
    defaults: Any = None
    message: str | None = None
