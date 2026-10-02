"""
Database-driven derivative configuration.

Replaces the hardcoded STANDARD_DERIVATIVES / DOCUMENT_DERIVATIVE_SIZES /
DERIVATIVE_PRESETS constants with per-org, per-media-type config rows.

Query pattern:
    1. Look for org-specific rows (organization_id = org_id, media_type, is_processing=True)
    2. Fall back to system defaults (organization_id IS NULL)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DerivativeSpec:
    """A single derivative to generate, sourced from the database."""
    name: str               # 'thumbnail', 'large', 'web_mp4_720p'
    label: str
    max_width: int | None
    max_height: int | None
    format: str             # 'jpeg', 'webp', 'mp4'
    quality: int | None
    config: dict = field(default_factory=dict)   # type-specific (codec, bitrate, dpi…)
    sort_order: int = 0


def get_derivative_specs(
    organization_id: str,
    media_type: str,
    db_session: Session,
) -> list[DerivativeSpec]:
    """
    Return the derivative specs for an org + media type.

    Falls back to system defaults (organization_id IS NULL) when the org
    has no custom processing configs for the given media type.
    """
    from app.models.media import DerivativeSizeConfig

    # Try org-specific first
    configs = (
        db_session.query(DerivativeSizeConfig)
        .filter(
            DerivativeSizeConfig.organization_id == organization_id,
            DerivativeSizeConfig.media_type == media_type,
        )
        .order_by(DerivativeSizeConfig.sort_order)
        .all()
    )

    # Fall back to system defaults
    if not configs:
        configs = (
            db_session.query(DerivativeSizeConfig)
            .filter(
                DerivativeSizeConfig.organization_id.is_(None),
                DerivativeSizeConfig.media_type == media_type,
            )
            .order_by(DerivativeSizeConfig.sort_order)
            .all()
        )

    if not configs:
        logger.warning(
            "No derivative configs found for org=%s media_type=%s (no system defaults either)",
            organization_id, media_type,
        )

    return [
        DerivativeSpec(
            name=c.name,
            label=c.label,
            max_width=c.max_width,
            max_height=c.max_height,
            format=c.format,
            quality=c.quality,
            config=c.config or {},
            sort_order=c.sort_order,
        )
        for c in configs
    ]
