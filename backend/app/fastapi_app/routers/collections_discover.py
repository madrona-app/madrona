"""
Entity history and discover/publishing endpoints (FastAPI).

Manages audit history, discoverability toggles, and publishing workflows.
"""
import logging
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import cast, func, or_, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    DiscoverConfig,
    Media,
    EntityAuditEvent,
    EntityAuditFieldDiff,
)
from app.services.uploads import get_org_media_url
from app.permissions import Permission
from app.services.rbac_service import check_permission
from app.services.api_security import escape_ilike
from app.services.public_cache import invalidate_org_cache_by_id
from app.services.nagpra_restrictions import display_restricted_ids, is_display_restricted
from app.fastapi_app.serializers.collections_helpers import _index_collection_object
from app.fastapi_app.serializers.collections import _serialize_collection_object
from app.fastapi_app.schemas.collections_discover import (
    EntityAuditHistoryResponse,
    DiscoverableToggleResponse,
    BulkDiscoverableResponse,
    DiscoverConfigOut,
    DiscoverStatsResponse,
    DiscoverPreviewResponse,
    PublishByCriteriaResponse,
    PublishByCriteriaDryRunResponse,
    PublishScheduleOut,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Analytics configuration
# ---------------------------------------------------------------------------
#
# These three values are the only contents of `analytics_config`, and the
# public Discover site interpolates two of them into the body of an inline
# <script> element. That makes them a script-injection sink rather than free
# text: an org admin who could store `'); fetch(...) //` as a measurement ID
# would be running arbitrary JavaScript for every visitor to the public site —
# and where tenants share an origin, for other tenants' visitors too.
#
# So they are constrained here, at the boundary, to the shapes the providers
# actually issue. The frontend validates them a second time before injecting,
# because rows written before this check existed are still in the database and
# a stored value is not a trusted value.
_ANALYTICS_PATTERNS = {
    # G-XXXX (GA4), UA-XXXX-Y (Universal), AW-/DC- (Ads, Floodlight)
    "ga_id": re.compile(r"^(?:G|UA|AW|DC)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?$"),
    "gtm_id": re.compile(r"^GTM-[A-Za-z0-9]+$"),
    # a hostname, which is what Plausible keys a site on
    "plausible_domain": re.compile(
        r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
        r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
    ),
}


def _validate_analytics_config(value):
    """Return a cleaned analytics_config, or raise 422.

    Unknown keys are rejected rather than dropped: silently discarding a key an
    operator believed they had set is its own kind of bug.
    """
    if value is None:
        return None
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "analytics_config must be an object",
        })

    cleaned: dict[str, str] = {}
    for key, raw in value.items():
        pattern = _ANALYTICS_PATTERNS.get(key)
        if pattern is None:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": (
                    f"Unknown analytics_config field: {key}. "
                    f"Allowed: {', '.join(sorted(_ANALYTICS_PATTERNS))}."
                ),
            })
        if raw is None or raw == "":
            continue  # clearing one field is not the same as setting it
        if not isinstance(raw, str) or not pattern.match(raw):
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": f"{key} is not a valid measurement identifier",
            })
        cleaned[key] = raw

    return cleaned or None

router = APIRouter(tags=["collections-discover"])


# ============================================================================
# HELPERS
# ============================================================================

def _is_valid_hex_color(color: str) -> bool:
    """Validate hex color format (#RRGGBB or #RGB)."""
    if not color:
        return True
    if not color.startswith('#'):
        return False
    hex_part = color[1:]
    if len(hex_part) not in [3, 6]:
        return False
    try:
        int(hex_part, 16)
        return True
    except ValueError:
        return False


# ============================================================================
# ENTITY AUDIT HISTORY
# ============================================================================

# Map of entity types to their required permission
ENTITY_TYPE_PERMISSIONS: dict[str, Permission] = {
    "collection_object": Permission.DATA_VIEW,
    "object_entry": Permission.OBJECT_CONTEXTS_VIEW,
    "acquisition": Permission.ACQUISITIONS_VIEW,
    "loan_in": Permission.LOANS_VIEW,
    "loan_out": Permission.LOANS_VIEW,
    "object_exit": Permission.EXITS_VIEW,
    "deaccession": Permission.DEACCESSION_VIEW,
    "condition_report": Permission.CONDITION_REPORTS_VIEW,
    "conservation_treatment": Permission.CONSERVATION_VIEW,
    "movement": Permission.MOVEMENTS_VIEW,
    "location": Permission.LOCATIONS_VIEW,
    "contact": Permission.DATA_VIEW,
    "constituent": Permission.DATA_VIEW,
    "valuation": Permission.VALUATIONS_VIEW,
    "use_request": Permission.USE_REQUESTS_VIEW,
    "reproduction_request": Permission.USE_REQUESTS_VIEW,
    "incident_report": Permission.DATA_VIEW,
    "object_right": Permission.DATA_VIEW,
    "documentation_plan": Permission.DATA_VIEW,
    "emergency_plan": Permission.DATA_VIEW,
    "collections_review": Permission.DATA_VIEW,
    "audit_campaign": Permission.DATA_VIEW,
    "person_authority": Permission.DATA_VIEW,
    "citation": Permission.DATA_VIEW,
    "media": Permission.DATA_VIEW,
}


@router.get("/api/organizations/{organization_id}/entity-history/{entity_type}/{entity_id}", response_model=EntityAuditHistoryResponse, summary="Get entity audit history")
def get_entity_audit_history(
    organization_id: UUID,
    entity_type: str,
    entity_id: UUID,
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    include_diffs: bool = Query(True),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Get audit history for any tracked entity.

    Returns a chronological timeline of all changes to this entity,
    including field-level diffs for each change event.
    """
    # Validate entity type
    if entity_type not in ENTITY_TYPE_PERMISSIONS:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": f"Unknown entity type: {entity_type}",
        })

    # Check specific permission for this entity type
    required_permission = ENTITY_TYPE_PERMISSIONS[entity_type]
    if not check_permission(auth.user_id, organization_id, required_permission, session=db):
        raise HTTPException(status_code=403, detail={
            "code": "FORBIDDEN",
            "message": f"Permission denied for {entity_type} history",
        })

    # Query audit events for this entity within this org
    query = db.query(EntityAuditEvent).filter(
        EntityAuditEvent.organization_id == organization_id,
        EntityAuditEvent.entity_type == entity_type,
        EntityAuditEvent.entity_id == entity_id,
    )

    # Get total count
    total = query.count()

    # Apply ordering and pagination
    events = (
        query
        .order_by(EntityAuditEvent.changed_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    # Build response
    events_data = []
    for e in events:
        event_dict = {
            "event_id": str(e.event_id),
            "change_type": e.change_type,
            "changed_at": e.changed_at.isoformat() if e.changed_at else None,
            "changed_by": str(e.changed_by) if e.changed_by else None,
            "changed_by_name": e.changed_by_name,
            "changed_by_email": e.changed_by_email,
            "changed_fields": e.changed_fields or [],
            "summary": e.summary,
            "request_method": e.request_method,
        }

        if include_diffs:
            diffs = (
                db.query(EntityAuditFieldDiff)
                .filter_by(event_id=e.event_id)
                .order_by(EntityAuditFieldDiff.field_name)
                .all()
            )
            event_dict["field_diffs"] = [
                {
                    "field_name": d.field_name,
                    "old_value": d.old_value,
                    "new_value": d.new_value,
                }
                for d in diffs
            ]

        events_data.append(event_dict)

    return {
        "entity_type": entity_type,
        "entity_id": str(entity_id),
        "items": events_data,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


# ============================================================================
# DISCOVERABLE TOGGLE
# ============================================================================

@router.patch("/api/organizations/{organization_id}/collections/objects/{object_id}/discoverable", response_model=DiscoverableToggleResponse, summary="Toggle object discoverable")
def toggle_object_discoverable(
    organization_id: UUID,
    object_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DISCOVER_PUBLISH)),
    db: Session = Depends(get_db),
):
    """Toggle the is_discoverable flag on a collection object."""
    if "is_discoverable" not in data:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "is_discoverable is required",
        })

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == organization_id,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object not found",
        })

    new_val = bool(data["is_discoverable"])

    # NAGPRA display gate: objects without granted display consent can
    # never be made publicly discoverable (43 CFR 10 duty of care).
    if new_val and is_display_restricted(db, organization_id, object_id):
        raise HTTPException(status_code=409, detail={
            "code": "nagpra_display_restricted",
            "message": (
                "This object has a NAGPRA action without granted display "
                "consent and cannot be made publicly discoverable."
            ),
        })

    obj.is_discoverable = new_val

    if new_val:
        obj.discoverable_at = datetime.now(timezone.utc)
        obj.discoverable_by = auth.user_id
    else:
        obj.discoverable_at = None
        obj.discoverable_by = None

    obj.updated_by = auth.user_id

    db.commit()
    invalidate_org_cache_by_id(str(organization_id), section="featured")

    # Re-index in OpenSearch
    _index_collection_object(obj)

    return {
        "object_id": str(obj.object_id),
        "is_discoverable": obj.is_discoverable,
        "discoverable_at": obj.discoverable_at.isoformat() if obj.discoverable_at else None,
    }


@router.post("/api/organizations/{organization_id}/collections/objects/bulk-discoverable", response_model=BulkDiscoverableResponse, summary="Bulk toggle discoverable")
def bulk_toggle_discoverable(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DISCOVER_PUBLISH)),
    db: Session = Depends(get_db),
):
    """Bulk toggle is_discoverable for multiple objects."""
    object_ids = data.get("object_ids", [])
    if not object_ids:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "object_ids array is required",
        })

    if "is_discoverable" not in data:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "is_discoverable is required",
        })

    new_val = bool(data["is_discoverable"])

    try:
        obj_uuids = [UUID(oid) for oid in object_ids]
    except ValueError:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Invalid object ID in list",
        })

    objects = db.query(CollectionObject).filter(
        CollectionObject.object_id.in_(obj_uuids),
        CollectionObject.organization_id == organization_id,
    ).all()

    if not objects:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "No matching objects found",
        })

    # NAGPRA display gate: skip objects without granted display consent
    # instead of publishing them (43 CFR 10 duty of care).
    skipped = []
    if new_val:
        restricted_ids = display_restricted_ids(
            db, organization_id, [o.object_id for o in objects],
        )
        if restricted_ids:
            skipped = [
                {"object_id": str(oid), "reason": "nagpra_display_restricted"}
                for oid in restricted_ids
            ]
            objects = [o for o in objects if o.object_id not in restricted_ids]

    now = datetime.now(timezone.utc)

    for obj in objects:
        obj.is_discoverable = new_val
        if new_val:
            obj.discoverable_at = now
            obj.discoverable_by = auth.user_id
        else:
            obj.discoverable_at = None
            obj.discoverable_by = None
        obj.updated_by = auth.user_id

    db.commit()
    invalidate_org_cache_by_id(str(organization_id), section="featured")

    # Re-index all affected objects
    for obj in objects:
        _index_collection_object(obj)

    return {
        "updated": len(objects),
        "is_discoverable": new_val,
        "skipped": skipped,
    }


# ============================================================================
# Discover Configuration
# ============================================================================

@router.get("/api/organizations/{organization_id}/collections/discover-config", response_model=DiscoverConfigOut, summary="Get discover config")
def get_discover_config(
    organization_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Get the discover configuration for an organization."""
    config = db.query(DiscoverConfig).filter(
        DiscoverConfig.organization_id == str(organization_id),
    ).first()

    if not config:
        return {
            "hero_media_id": None,
            "page_title": None,
            "page_subtitle": None,
            "show_object_count": True,
            "default_view_mode": "grid",
            "default_sort": "relevance",
            "header_logo_media_id": None,
            "primary_color": None,
            "accent_color": None,
            "font_family": None,
            "nav_items": None,
            "footer_text": None,
            "social_links": None,
            "featured_object_ids": None,
            "homepage_page_id": None,
            "custom_404_page_id": None,
            "secondary_color": None,
            "background_color": None,
            "text_color": None,
            "heading_font_family": None,
            "body_font_family": None,
            "button_style": "rounded",
            "header_style": "solid",
            "google_fonts": None,
            "custom_css": None,
            "footer_columns": None,
            "land_acknowledgment": None,
            "footer_logo_media_id": None,
            "external_integrations": None,
            "analytics_config": None,
        }

    return {
        "hero_media_id": str(config.hero_media_id) if config.hero_media_id else None,
        "page_title": config.page_title,
        "page_subtitle": config.page_subtitle,
        "show_object_count": config.show_object_count,
        "default_view_mode": config.default_view_mode,
        "default_sort": config.default_sort,
        "header_logo_media_id": str(config.header_logo_media_id) if config.header_logo_media_id else None,
        "primary_color": config.primary_color,
        "accent_color": config.accent_color,
        "font_family": config.font_family,
        "nav_items": config.nav_items,
        "footer_text": config.footer_text,
        "social_links": config.social_links,
        "featured_object_ids": config.featured_object_ids,
        "homepage_page_id": str(config.homepage_page_id) if config.homepage_page_id else None,
        "custom_404_page_id": str(config.custom_404_page_id) if config.custom_404_page_id else None,
        # Phase 2: Extended theming
        "secondary_color": config.secondary_color,
        "background_color": config.background_color,
        "text_color": config.text_color,
        "heading_font_family": config.heading_font_family,
        "body_font_family": config.body_font_family,
        "button_style": config.button_style or "rounded",
        "header_style": config.header_style or "solid",
        "google_fonts": config.google_fonts,
        "custom_css": config.custom_css,
        # Phase 2B: Rich footer
        "footer_columns": config.footer_columns,
        "land_acknowledgment": config.land_acknowledgment,
        "footer_logo_media_id": str(config.footer_logo_media_id) if config.footer_logo_media_id else None,
        # Phase 7: External integrations
        "external_integrations": config.external_integrations,
        # Phase 8: Analytics
        "analytics_config": config.analytics_config,
        # CDN
        "cdn_config": config.cdn_config,
    }


@router.put("/api/organizations/{organization_id}/collections/discover-config", response_model=DiscoverConfigOut, summary="Update discover config")
def update_discover_config(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DISCOVER_PUBLISH)),
    db: Session = Depends(get_db),
):
    """Create or update the discover configuration for an organization."""
    org_id_str = str(organization_id)

    config = db.query(DiscoverConfig).filter(
        DiscoverConfig.organization_id == org_id_str,
    ).first()

    if not config:
        config = DiscoverConfig(organization_id=org_id_str)
        db.add(config)

    if "hero_media_id" in data:
        val = data["hero_media_id"]
        config.hero_media_id = UUID(val) if val else None

    if "page_title" in data:
        config.page_title = data["page_title"] or None

    if "page_subtitle" in data:
        config.page_subtitle = data["page_subtitle"] or None

    if "show_object_count" in data:
        config.show_object_count = bool(data["show_object_count"])

    if "default_view_mode" in data:
        if data["default_view_mode"] in ("grid", "list"):
            config.default_view_mode = data["default_view_mode"]

    if "default_sort" in data:
        valid_sorts = ("relevance", "title_asc", "title_desc", "date_asc", "date_desc", "newest")
        if data["default_sort"] in valid_sorts:
            config.default_sort = data["default_sort"]

    # Branding fields
    if "header_logo_media_id" in data:
        val = data["header_logo_media_id"]
        config.header_logo_media_id = UUID(val) if val else None

    if "primary_color" in data:
        val = data["primary_color"]
        if val and not _is_valid_hex_color(val):
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "primary_color must be a valid hex color (e.g. #8E3B2F)",
            })
        config.primary_color = val or None

    if "accent_color" in data:
        val = data["accent_color"]
        if val and not _is_valid_hex_color(val):
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "accent_color must be a valid hex color (e.g. #B87333)",
            })
        config.accent_color = val or None

    if "font_family" in data:
        val = data["font_family"]
        valid_fonts = ("serif", "sans-serif", "Playfair Display", "Inter", "Merriweather", "Lora")
        if val and val not in valid_fonts:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": f"font_family must be one of: {', '.join(valid_fonts)}",
            })
        config.font_family = val or None

    # Navigation & footer
    if "nav_items" in data:
        val = data["nav_items"]
        if val is not None:
            if not isinstance(val, list) or len(val) > 8:
                raise HTTPException(status_code=422, detail={
                    "code": "validation_error",
                    "message": "nav_items must be a list of up to 8 items",
                })
            for item in val:
                if not isinstance(item, dict) or "label" not in item or "url" not in item:
                    raise HTTPException(status_code=422, detail={
                        "code": "validation_error",
                        "message": "Each nav_item must have 'label' and 'url'",
                    })
        config.nav_items = val

    if "footer_text" in data:
        config.footer_text = data["footer_text"] or None

    if "social_links" in data:
        val = data["social_links"]
        if val is not None:
            if not isinstance(val, list) or len(val) > 6:
                raise HTTPException(status_code=422, detail={
                    "code": "validation_error",
                    "message": "social_links must be a list of up to 6 items",
                })
            for item in val:
                if not isinstance(item, dict) or "platform" not in item or "url" not in item:
                    raise HTTPException(status_code=422, detail={
                        "code": "validation_error",
                        "message": "Each social_link must have 'platform' and 'url'",
                    })
        config.social_links = val

    # Homepage page
    if "homepage_page_id" in data:
        val = data["homepage_page_id"]
        config.homepage_page_id = UUID(val) if val else None

    # Custom 404 page
    if "custom_404_page_id" in data:
        val = data["custom_404_page_id"]
        config.custom_404_page_id = UUID(val) if val else None

    # Featured objects
    if "featured_object_ids" in data:
        val = data["featured_object_ids"]
        if val is not None:
            if not isinstance(val, list) or len(val) > 20:
                raise HTTPException(status_code=422, detail={
                    "code": "validation_error",
                    "message": "featured_object_ids must be a list of up to 20 UUIDs",
                })
            for fid in val:
                try:
                    UUID(str(fid))
                except (ValueError, AttributeError):
                    raise HTTPException(status_code=422, detail={
                        "code": "validation_error",
                        "message": f"Invalid UUID in featured_object_ids: {fid}",
                    })
        config.featured_object_ids = val

    # Phase 2: Extended theming
    for color_field in ("secondary_color", "background_color", "text_color"):
        if color_field in data:
            val = data[color_field]
            if val and not _is_valid_hex_color(val):
                raise HTTPException(status_code=422, detail={
                    "code": "validation_error",
                    "message": f"{color_field} must be a valid hex color",
                })
            setattr(config, color_field, val or None)

    if "heading_font_family" in data:
        config.heading_font_family = data["heading_font_family"] or None

    if "body_font_family" in data:
        config.body_font_family = data["body_font_family"] or None

    if "button_style" in data:
        val = data["button_style"]
        if val and val not in ("rounded", "square", "pill"):
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "button_style must be one of: rounded, square, pill",
            })
        config.button_style = val or "rounded"

    if "header_style" in data:
        val = data["header_style"]
        if val and val not in ("solid", "transparent", "gradient"):
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "header_style must be one of: solid, transparent, gradient",
            })
        config.header_style = val or "solid"

    if "google_fonts" in data:
        val = data["google_fonts"]
        if val is not None:
            if not isinstance(val, list) or len(val) > 5:
                raise HTTPException(status_code=422, detail={
                    "code": "validation_error",
                    "message": "google_fonts must be a list of up to 5 font names",
                })
        config.google_fonts = val

    if "custom_css" in data:
        val = data["custom_css"]
        if val and len(val) > 10000:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "custom_css must be under 10,000 characters",
            })
        config.custom_css = val or None

    # Phase 2B: Rich footer
    if "footer_columns" in data:
        val = data["footer_columns"]
        if val is not None:
            if not isinstance(val, list) or len(val) > 4:
                raise HTTPException(status_code=422, detail={
                    "code": "validation_error",
                    "message": "footer_columns must be a list of up to 4 columns",
                })
        config.footer_columns = val

    if "land_acknowledgment" in data:
        config.land_acknowledgment = data["land_acknowledgment"] or None

    if "footer_logo_media_id" in data:
        val = data["footer_logo_media_id"]
        config.footer_logo_media_id = UUID(val) if val else None

    # Phase 7: External integrations
    if "external_integrations" in data:
        config.external_integrations = data["external_integrations"]

    # Phase 8: Analytics — validated; see _validate_analytics_config
    if "analytics_config" in data:
        config.analytics_config = _validate_analytics_config(data["analytics_config"])

    # CDN purge configuration
    if "cdn_config" in data:
        config.cdn_config = data["cdn_config"]

    db.commit()
    invalidate_org_cache_by_id(org_id_str)

    return {
        "hero_media_id": str(config.hero_media_id) if config.hero_media_id else None,
        "page_title": config.page_title,
        "page_subtitle": config.page_subtitle,
        "show_object_count": config.show_object_count,
        "default_view_mode": config.default_view_mode,
        "default_sort": config.default_sort,
        "header_logo_media_id": str(config.header_logo_media_id) if config.header_logo_media_id else None,
        "primary_color": config.primary_color,
        "accent_color": config.accent_color,
        "font_family": config.font_family,
        "nav_items": config.nav_items,
        "footer_text": config.footer_text,
        "social_links": config.social_links,
        "featured_object_ids": config.featured_object_ids,
        "homepage_page_id": str(config.homepage_page_id) if config.homepage_page_id else None,
        "custom_404_page_id": str(config.custom_404_page_id) if config.custom_404_page_id else None,
        "secondary_color": config.secondary_color,
        "background_color": config.background_color,
        "text_color": config.text_color,
        "heading_font_family": config.heading_font_family,
        "body_font_family": config.body_font_family,
        "button_style": config.button_style or "rounded",
        "header_style": config.header_style or "solid",
        "google_fonts": config.google_fonts,
        "custom_css": config.custom_css,
        "footer_columns": config.footer_columns,
        "land_acknowledgment": config.land_acknowledgment,
        "footer_logo_media_id": str(config.footer_logo_media_id) if config.footer_logo_media_id else None,
        "external_integrations": config.external_integrations,
        "analytics_config": config.analytics_config,
        "cdn_config": config.cdn_config,
    }


# ============================================================================
# DISCOVER STATS
# ============================================================================

@router.get("/api/organizations/{organization_id}/collections/discover/stats", response_model=DiscoverStatsResponse, summary="Get discover stats")
def get_discover_stats(
    organization_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Get aggregate publication statistics for the Discover dashboard."""
    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)

    total_objects = db.query(func.count(CollectionObject.object_id)).filter(
        CollectionObject.organization_id == organization_id,
    ).scalar() or 0

    discoverable_count = db.query(func.count(CollectionObject.object_id)).filter(
        CollectionObject.organization_id == organization_id,
        CollectionObject.is_discoverable == True,
    ).scalar() or 0

    published_last_30_days = db.query(func.count(CollectionObject.object_id)).filter(
        CollectionObject.organization_id == organization_id,
        CollectionObject.is_discoverable == True,
        CollectionObject.discoverable_at >= thirty_days_ago,
    ).scalar() or 0

    # Count unpublished in last 30 days via audit trail
    unpublished_last_30_days = db.query(
        func.count(EntityAuditFieldDiff.diff_id)
    ).join(
        EntityAuditEvent,
        EntityAuditFieldDiff.event_id == EntityAuditEvent.event_id,
    ).filter(
        EntityAuditEvent.organization_id == organization_id,
        EntityAuditEvent.entity_type == "CollectionObject",
        EntityAuditFieldDiff.field_name == "is_discoverable",
        EntityAuditFieldDiff.new_value == cast(False, JSONB),
        EntityAuditEvent.changed_at >= thirty_days_ago,
    ).scalar() or 0

    # Count pending publish schedules
    pending_schedules = 0
    try:
        from app.models import PublishSchedule
        pending_schedules = db.query(func.count(PublishSchedule.schedule_id)).filter(
            PublishSchedule.organization_id == organization_id,
            PublishSchedule.status == "pending",
        ).scalar() or 0
    except Exception:
        pass

    return {
        "total_objects": total_objects,
        "discoverable_count": discoverable_count,
        "private_count": total_objects - discoverable_count,
        "pending_schedules": pending_schedules,
        "published_last_30_days": published_last_30_days,
        "unpublished_last_30_days": unpublished_last_30_days,
    }


# ============================================================================
# DISCOVER PREVIEW
# ============================================================================

@router.get("/api/organizations/{organization_id}/collections/objects/{object_id}/discover-preview", response_model=DiscoverPreviewResponse, summary="Get discover preview")
def get_discover_preview(
    organization_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """
    Preview how an object will appear on the public Discover page.

    Returns the same shape as the public discover object endpoint, plus
    preview warnings and current discoverable status.
    """
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == organization_id,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object not found",
        })

    # Get all linked media (both published and unpublished) with eager-loaded Media
    media_links = (
        db.query(CollectionObjectMedia)
        .options(joinedload(CollectionObjectMedia.media))
        .filter(
            CollectionObjectMedia.object_id == obj.object_id,
        )
        .order_by(
            CollectionObjectMedia.is_primary.desc(),
            CollectionObjectMedia.sort_order,
        )
        .all()
    )

    media_items = []
    unpublished_media_count = 0
    for link in media_links:
        media = link.media
        if not media or not media.s3_key:
            continue
        if not media.is_published:
            unpublished_media_count += 1
            continue
        try:
            # A rendition, never media.s3_key: that is the uploaded master, and
            # minting it here put a full-resolution original behind every
            # thumbnail in the preview grid.
            from app.services.discovery_service import (
                build_display_key_for_media,
                build_srcset_for_media,
            )

            display_key = build_display_key_for_media(media, db)
            if not display_key:
                logger.warning(
                    "Media %s has no rendition to display; omitting from preview",
                    media.media_id,
                )
                continue
            url = get_org_media_url(
                display_key,
                organization_id=str(organization_id),
                db_session=db,
                expiry_seconds=3600,
            )
            media_items.append({
                "media_id": str(media.media_id),
                "url": url,
                "srcset": build_srcset_for_media(media.media_id, organization_id, db),
                "media_type": media.media_type,
                "mime_type": media.mime_type,
                "width": media.width,
                "height": media.height,
                "alt_text": media.alt_text,
                "credit": media.credit,
                "is_primary": link.is_primary,
                "caption": link.caption_override,
            })
        except Exception as e:
            logger.warning(f"Failed to build media URL for {media.media_id}: {e}")

    # Build preview warnings
    preview_warnings = []
    if unpublished_media_count > 0:
        preview_warnings.append(
            f"{unpublished_media_count} linked media item{'s are' if unpublished_media_count != 1 else ' is'} "
            f"unpublished and won't appear publicly"
        )
    if not media_items:
        preview_warnings.append("No images will be shown")

    # Build display helpers
    def _get_display_title(title_links):
        if title_links and len(title_links) > 0:
            return title_links[0].title or ""
        return ""

    def _get_primary_classification(obj):
        if hasattr(obj, 'classification_links') and obj.classification_links:
            first = obj.classification_links[0]
            if first.lookup_value:
                return first.lookup_value.label
        return None

    def _serialize_classifications(obj):
        if not hasattr(obj, 'classification_links') or not obj.classification_links:
            return []
        return [
            {"term": cl.lookup_value.label if cl.lookup_value else None}
            for cl in obj.classification_links
        ]

    def _extract_creators(creators):
        if not creators:
            return []
        return [
            {
                "name": c.get("name", ""),
                "role": c.get("role", ""),
                "qualifier": c.get("qualifier"),
            }
            for c in creators
        ]

    result = {
        "object_id": str(obj.object_id),
        "object_number": obj.object_number,
        "title": _get_display_title(obj.title_links),
        "titles": [
            {"title": t.title, "title_type": t.title_type, "language": t.language, "is_preferred": t.is_preferred}
            for t in (obj.title_links or [])
        ],
        "brief_description": obj.brief_description,
        "full_description": obj.full_description,
        "object_type": obj.object_type,
        "classification": _get_primary_classification(obj),
        "classifications": _serialize_classifications(obj),
        "creators": _extract_creators(obj.creators),
        "creation_date_display": obj.creation_date_display,
        "creation_date_earliest": obj.creation_date_earliest.isoformat() if obj.creation_date_earliest else None,
        "creation_date_latest": obj.creation_date_latest.isoformat() if obj.creation_date_latest else None,
        "creation_place": obj.creation_place,
        "materials": obj.materials,
        "techniques": obj.techniques,
        "measurements": [
            {"dimension": m.dimension, "value": float(m.value), "unit": m.unit, "part": m.part}
            for m in (obj.measurement_links or [])
        ],
        "inscriptions": [i.content for i in (obj.inscription_links or [])],
        "style_period": obj.style_period,
        "provenance": obj.provenance,
        "credit_line": obj.credit_line,
        "media": media_items,
        "has_image": len(media_items) > 0,
        # Preview-specific fields
        "is_currently_discoverable": obj.is_discoverable,
        "unpublished_media_count": unpublished_media_count,
        "preview_warnings": preview_warnings,
    }

    return result


# ============================================================================
# CRITERIA-BASED PUBLISHING
# ============================================================================

@router.post("/api/organizations/{organization_id}/collections/discover/publish-by-criteria", response_model=None, summary="Publish by criteria")
def publish_by_criteria(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DISCOVER_PUBLISH)),
    db: Session = Depends(get_db),
):
    """
    Publish or unpublish all objects matching a set of filter criteria.

    Supports dry_run mode to preview matched objects without modifying.
    """
    criteria = data.get("criteria", {})
    is_discoverable = bool(data.get("is_discoverable", True))
    dry_run = bool(data.get("dry_run", False))

    if not criteria:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "criteria is required",
        })

    # Build query from criteria
    query = db.query(CollectionObject).filter(
        CollectionObject.organization_id == organization_id,
    )

    if "object_type" in criteria:
        val = criteria["object_type"]
        if isinstance(val, list):
            query = query.filter(CollectionObject.object_type.in_(val))
        else:
            query = query.filter(CollectionObject.object_type == val)

    if "classification" in criteria:
        val = criteria["classification"]
        search_term = f"%{escape_ilike(val)}%"
        cls_search = text(
            "EXISTS (SELECT 1 FROM jsonb_array_elements(classifications) AS c "
            "WHERE c->>'term' ILIKE :cls_search)"
        ).bindparams(cls_search=search_term)
        query = query.filter(cls_search)

    if "object_status" in criteria:
        query = query.filter(CollectionObject.object_status == criteria["object_status"])

    if "has_image" in criteria:
        has_img = bool(criteria["has_image"])
        img_subquery = db.query(CollectionObjectMedia.object_id).join(
            Media, CollectionObjectMedia.media_id == Media.media_id
        ).filter(
            Media.is_published == True,
        ).subquery()
        if has_img:
            query = query.filter(CollectionObject.object_id.in_(
                db.query(img_subquery.c.object_id)
            ))
        else:
            query = query.filter(~CollectionObject.object_id.in_(
                db.query(img_subquery.c.object_id)
            ))

    if "creator" in criteria:
        val = criteria["creator"]
        search_term = f"%{escape_ilike(val)}%"
        creator_search = text(
            "EXISTS (SELECT 1 FROM jsonb_array_elements(creators) AS c "
            "WHERE c->>'name' ILIKE :creator_search)"
        ).bindparams(creator_search=search_term)
        query = query.filter(creator_search)

    if "material" in criteria:
        val = criteria["material"]
        search_term = f"%{escape_ilike(val)}%"
        mat_search = text(
            "EXISTS (SELECT 1 FROM jsonb_array_elements(materials) AS m "
            "WHERE m->>'material' ILIKE :mat_search)"
        ).bindparams(mat_search=search_term)
        query = query.filter(mat_search)

    if "creation_date_from" in criteria:
        query = query.filter(
            CollectionObject.creation_date_earliest >= criteria["creation_date_from"]
        )

    if "creation_date_to" in criteria:
        query = query.filter(
            CollectionObject.creation_date_latest <= criteria["creation_date_to"]
        )

    if "current_location_id" in criteria:
        query = query.filter(
            CollectionObject.current_location_id == UUID(criteria["current_location_id"])
        )

    if dry_run:
        matched_count = query.count()
        sample_objects = query.limit(10).all()
        restricted_count = 0
        if is_discoverable:
            matched_ids = [row.object_id for row in query.with_entities(CollectionObject.object_id).all()]
            restricted_count = len(display_restricted_ids(db, organization_id, matched_ids))
        return {
            "matched_count": matched_count,
            "restricted_count": restricted_count,
            "sample_objects": [
                {
                    "object_id": str(o.object_id),
                    "object_number": o.object_number,
                    "title": o.title_links[0].title if o.title_links and len(o.title_links) > 0 else None,
                    "object_type": o.object_type,
                    "is_discoverable": o.is_discoverable,
                }
                for o in sample_objects
            ],
        }

    # Execute: update all matching objects
    now = datetime.now(timezone.utc)
    user_id = auth.user_id
    objects = query.all()

    # NAGPRA display gate: never publish objects without granted display consent
    skipped_restricted = 0
    if is_discoverable:
        restricted_ids = display_restricted_ids(
            db, organization_id, [o.object_id for o in objects],
        )
        if restricted_ids:
            skipped_restricted = len(restricted_ids)
            objects = [o for o in objects if o.object_id not in restricted_ids]

    updated_count = 0

    for obj in objects:
        if obj.is_discoverable == is_discoverable:
            continue
        obj.is_discoverable = is_discoverable
        if is_discoverable:
            obj.discoverable_at = now
            obj.discoverable_by = user_id
        else:
            obj.discoverable_at = None
            obj.discoverable_by = None
        obj.updated_by = user_id
        updated_count += 1

    db.commit()
    invalidate_org_cache_by_id(str(organization_id), section="featured")

    # Re-index affected objects
    for obj in objects:
        _index_collection_object(obj)

    return {
        "updated_count": updated_count,
        "is_discoverable": is_discoverable,
        "skipped_restricted": skipped_restricted,
    }


# ============================================================================
# SCHEDULED PUBLISHING
# ============================================================================

@router.post("/api/organizations/{organization_id}/collections/discover/schedules", status_code=201, response_model=PublishScheduleOut, summary="Create publish schedule")
def create_publish_schedule(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DISCOVER_PUBLISH)),
    db: Session = Depends(get_db),
):
    """Create a scheduled publish/unpublish action."""
    from app.models import PublishSchedule

    action = data.get("action")
    if action not in ("publish", "unpublish"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "action must be 'publish' or 'unpublish'",
        })

    scheduled_for_str = data.get("scheduled_for")
    if not scheduled_for_str:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "scheduled_for is required",
        })

    try:
        scheduled_for = datetime.fromisoformat(scheduled_for_str.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "scheduled_for must be a valid ISO 8601 datetime",
        })

    if scheduled_for <= datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "scheduled_for must be in the future",
        })

    criteria = data.get("criteria")
    object_ids = data.get("object_ids")

    if not criteria and not object_ids:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Either criteria or object_ids is required",
        })

    schedule = PublishSchedule(
        organization_id=organization_id,
        action=action,
        scheduled_for=scheduled_for,
        criteria=criteria,
        object_ids=object_ids,
        status="pending",
        created_by=auth.user_id,
    )
    db.add(schedule)
    db.commit()

    return {
        "schedule_id": str(schedule.schedule_id),
        "action": schedule.action,
        "scheduled_for": schedule.scheduled_for.isoformat(),
        "criteria": schedule.criteria,
        "object_ids": schedule.object_ids,
        "status": schedule.status,
        "created_at": schedule.created_at.isoformat(),
    }


@router.get("/api/organizations/{organization_id}/collections/discover/schedules", response_model=list[PublishScheduleOut], summary="List publish schedules")
def list_publish_schedules(
    organization_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """List publish schedules for an organization."""
    from app.models import PublishSchedule

    schedules = db.query(PublishSchedule).filter(
        PublishSchedule.organization_id == organization_id,
    ).order_by(PublishSchedule.scheduled_for.desc()).all()

    return [
        {
            "schedule_id": str(s.schedule_id),
            "action": s.action,
            "scheduled_for": s.scheduled_for.isoformat(),
            "criteria": s.criteria,
            "object_ids": s.object_ids,
            "status": s.status,
            "result_count": s.result_count,
            "error_message": s.error_message,
            "executed_at": s.executed_at.isoformat() if s.executed_at else None,
            "created_at": s.created_at.isoformat(),
        }
        for s in schedules
    ]


@router.delete("/api/organizations/{organization_id}/collections/discover/schedules/{schedule_id}", status_code=204, summary="Cancel publish schedule")
def cancel_publish_schedule(
    organization_id: UUID,
    schedule_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DISCOVER_PUBLISH)),
    db: Session = Depends(get_db),
):
    """Cancel a pending publish schedule."""
    from app.models import PublishSchedule

    schedule = db.query(PublishSchedule).filter(
        PublishSchedule.schedule_id == schedule_id,
        PublishSchedule.organization_id == organization_id,
    ).first()

    if not schedule:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Schedule not found",
        })

    if schedule.status != "pending":
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": f"Cannot cancel schedule with status '{schedule.status}'",
        })

    schedule.status = "cancelled"
    db.commit()

    return Response(status_code=204)
