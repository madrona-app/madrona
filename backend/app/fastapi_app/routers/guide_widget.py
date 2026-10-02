"""
Visitor widget settings (FastAPI).

Org-admin surface for the Visitor Guide product: enable/disable the public
widget, set the welcome message, and read the usage meter. The widget is off
by default (config ``widget_enabled`` absent = dark) and turned on per org —
either here by an org admin or by platform admin when a deal closes.

  GET /api/guide/widget/settings
  PUT /api/guide/widget/settings
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.fastapi_app.dependencies.guide import GuideContext, require_guide_admin
from app.models import Organization
from app.services.guide_usage import (
    get_guide_org_app,
    widget_queries_this_month,
)
from app.services.public_cache import invalidate_org_cache

logger = logging.getLogger(__name__)

router = APIRouter(tags=["guide-widget"])

WELCOME_MESSAGE_MAX_LENGTH = 300


class WidgetSettingsOut(BaseModel):
    enabled: bool
    welcome_message: str | None = None
    tier: str | None = None
    max_widget_queries: int | None = None
    widget_queries_this_month: int


class WidgetSettingsUpdate(BaseModel):
    enabled: bool
    welcome_message: str | None = Field(default=None, max_length=WELCOME_MESSAGE_MAX_LENGTH)


def _settings_payload(guide_config: dict, organization_id, db: Session) -> dict:
    return {
        "enabled": bool(guide_config.get("widget_enabled")),
        "welcome_message": guide_config.get("widget_welcome_message"),
        "tier": guide_config.get("tier"),
        "max_widget_queries": guide_config.get("max_widget_queries"),
        "widget_queries_this_month": widget_queries_this_month(organization_id, db),
    }


@router.get("/api/guide/widget/settings", response_model=WidgetSettingsOut, summary="Get widget settings")
def get_widget_settings(
    guide_ctx: GuideContext = Depends(require_guide_admin),
    db: Session = Depends(get_db),
):
    """Current visitor-widget settings + usage for the active org."""
    return _settings_payload(guide_ctx.config or {}, guide_ctx.organization_id, db)


@router.put("/api/guide/widget/settings", response_model=WidgetSettingsOut, summary="Update widget settings")
def update_widget_settings(
    body: WidgetSettingsUpdate,
    guide_ctx: GuideContext = Depends(require_guide_admin),
    db: Session = Depends(get_db),
):
    """Enable/disable the public widget and set its welcome message."""
    org_app = get_guide_org_app(guide_ctx.organization_id, db)
    if not org_app:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Guide application not found"},
        )

    config = dict(org_app.config or {})
    config["widget_enabled"] = body.enabled
    welcome = (body.welcome_message or "").strip() or None
    if welcome:
        config["widget_welcome_message"] = welcome
    else:
        config.pop("widget_welcome_message", None)

    org_app.config = config
    flag_modified(org_app, "config")
    db.commit()

    # The public Discover info payload is cached (Redis, 5 min) — invalidate so
    # the widget appears/disappears immediately.
    slug = db.query(Organization.slug).filter(
        Organization.organization_id == guide_ctx.organization_id,
    ).scalar()
    if slug:
        try:
            invalidate_org_cache(slug)
        except Exception:
            logger.warning("Widget settings: cache invalidation failed for %s", slug)

    logger.info(
        "Visitor widget %s for org %s by user %s",
        "enabled" if body.enabled else "disabled",
        guide_ctx.organization_id,
        guide_ctx.auth.user_id,
    )
    return _settings_payload(config, guide_ctx.organization_id, db)
