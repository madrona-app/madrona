"""Pydantic response schemas for Branding API."""
from __future__ import annotations

from pydantic import BaseModel


class BrandingOut(BaseModel):
    branding_id: str | None = None
    organization_id: str
    logo_url: str | None = None
    logo_s3_key: str | None = None
    logo_width_px: int | None = None
    letterhead_name: str | None = None
    letterhead_address_line1: str | None = None
    letterhead_address_line2: str | None = None
    letterhead_city_state_zip: str | None = None
    letterhead_country: str | None = None
    letterhead_phone: str | None = None
    letterhead_email: str | None = None
    letterhead_website: str | None = None
    footer_text: str | None = None
    primary_color: str | None = None
    secondary_color: str | None = None
    accent_color: str | None = None
    signature_url: str | None = None
    signature_s3_key: str | None = None
    signature_name: str | None = None
    signature_title: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    # Only present when no branding configured
    message: str | None = None


class LogoUploadResponse(BaseModel):
    success: bool
    logo_s3_key: str
    logo_url: str | None = None


class LogoDeleteResponse(BaseModel):
    success: bool
    message: str


class SignatureUploadResponse(BaseModel):
    success: bool
    signature_s3_key: str
    signature_url: str | None = None


class SignatureDeleteResponse(BaseModel):
    success: bool
    message: str


class DocumentTemplateOut(BaseModel):
    template_id: str
    organization_id: str
    name: str
    template_type: str | None = None
    description: str | None = None
    is_default: bool | None = None
    is_active: bool | None = None
    created_at: str | None = None
    updated_at: str | None = None


class DocumentTemplateListResponse(BaseModel):
    templates: list[DocumentTemplateOut]
