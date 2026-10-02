"""
Platform Admin API — FastAPI router.

Migrated from app/api/platform_admin.py.

Provides endpoints for platform-level administration:
- Managing organization application subscriptions
- Viewing all applications
- Provisioning new organizations (enterprise onboarding)
- SSO/SAML configuration
- Entity audit logging
- RLS health checks
- Permission matrix management

Requires platform admin permission for all endpoints.
"""

import hashlib
import logging
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import cast, Date, desc, func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.services.deployment_identity import support_address
from app.config import get_settings
from app.database import get_db
from app.fastapi_app.dependencies.admin_db import admin_db_dep
from app.fastapi_app.dependencies.auth import (
    AuthContext,
    require_auth,
    require_platform_admin,
    require_fresh_mfa,
    require_permission,
)
from app.fastapi_app.schemas.platform_admin import (
    ApplicationsListResponse,
    BulkImportUsersBody,
    DisableAppResponse,
    EnableAppBody,
    EnableAppResponse,
    EntityAuditEventDetailResponse,
    EntityAuditEventsResponse,
    EntityAuditHistoryResponse,
    EntityAuditStatsResponse,
    MessageResponse,
    OkResponse,
    OrgApplicationsResponse,
    OrgStorageListResponse,
    PermissionsMatrixResponse,
    PlatformOrganizationsResponse,
    ProvisionOrganizationBody,
    ProvisioningJobDetailResponse,
    ProvisioningJobListResponse,
    ProvisioningLogsResponse,
    ProvisioningStatsResponse,
    ReconcileResponse,
    ResendInviteResponse,
    RolePermissionBody,
    SSOConfigBody,
    SSOConfigResponse,
    SSOTestBody,
    SSOTestResponse,
    SSOUpdateResponse,
    UpdateOrganizationBody,
    UpdateOrganizationResponse,
    UpdateStorageBody,
    UpdateStorageResponse,
)
from app.models import (
    Application,
    EntityAuditEvent,
    EntityAuditFieldDiff,
    Organization,
    OrganizationApplication,
    OrganizationInvitation,
    OrganizationMembership,
    Permission as PermissionModel,
    ProvisioningAuditLog,
    Role,
    RolePermission,
    SSOConfiguration,
    User,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike, sanitize_error_message
from app.services.email_service import get_email_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["platform-admin"])

# Compiled once at import time; used by bulk_import_users
_BULK_EMAIL_RE = re.compile(r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$")


# Moved to dependencies/admin_db.py when first-run install needed the same
# session. Same object, not a wrapper: `app.dependency_overrides` keys on the
# function, so the conftest override registered against either name covers both
# routers.
_admin_db_dep = admin_db_dep


# ============================================================================
# Dashboard Stats
# ============================================================================


@router.get("/api/admin/dashboard-stats", summary="Get dashboard stats")
def get_dashboard_stats(
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Platform dashboard summary stats."""

    org_count = db.query(func.count(Organization.organization_id)).filter(
        Organization.status == "active",
    ).scalar() or 0

    user_count = db.query(func.count(func.distinct(OrganizationMembership.user_id))).filter(
        OrganizationMembership.status == "active",
    ).scalar() or 0

    # Total storage: sum file_size across all media
    from app.models.media import Media
    total_bytes = db.query(func.sum(Media.file_size)).scalar() or 0

    if total_bytes >= 1_000_000_000_000:
        storage_display = f"{total_bytes / 1_000_000_000_000:.1f} TB"
    elif total_bytes >= 1_000_000_000:
        storage_display = f"{total_bytes / 1_000_000_000:.1f} GB"
    elif total_bytes >= 1_000_000:
        storage_display = f"{total_bytes / 1_000_000:.0f} MB"
    else:
        storage_display = f"{total_bytes / 1_000:.0f} KB"

    return {
        "organizations": org_count,
        "users": user_count,
        "storage": storage_display,
        "storage_bytes": total_bytes,
    }


# ============================================================================
# Guide Analytics
# ============================================================================


@router.get("/api/admin/guide-analytics", summary="Get guide analytics")
def get_guide_analytics(
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
    days: int = Query(default=30, ge=1, le=365),
):
    """Guide AI usage analytics across all organizations."""
    from app.services.agent_monitoring import GuideMetric

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Overall summary
    base_q = db.query(GuideMetric).filter(GuideMetric.request_started_at >= cutoff)

    total_requests = base_q.count()
    total_errors = base_q.filter(GuideMetric.had_error.is_(True)).count()

    token_sums = db.query(
        func.coalesce(func.sum(GuideMetric.input_tokens), 0),
        func.coalesce(func.sum(GuideMetric.output_tokens), 0),
    ).filter(GuideMetric.request_started_at >= cutoff).one()
    total_input_tokens = int(token_sums[0])
    total_output_tokens = int(token_sums[1])

    avg_latency = db.query(
        func.avg(GuideMetric.response_latency_ms),
    ).filter(GuideMetric.request_started_at >= cutoff).scalar()

    # Per-org breakdown
    org_rows = db.query(
        GuideMetric.organization_id,
        Organization.name,
        func.count().label("requests"),
        func.coalesce(func.sum(GuideMetric.input_tokens), 0).label("input_tokens"),
        func.coalesce(func.sum(GuideMetric.output_tokens), 0).label("output_tokens"),
        func.sum(GuideMetric.tool_calls_count).label("tool_calls"),
        func.avg(GuideMetric.response_latency_ms).label("avg_latency_ms"),
    ).join(
        Organization,
        Organization.organization_id == GuideMetric.organization_id,
    ).filter(
        GuideMetric.request_started_at >= cutoff,
    ).group_by(
        GuideMetric.organization_id, Organization.name,
    ).order_by(
        desc("requests"),
    ).all()

    by_org = []
    for row in org_rows:
        inp = int(row.input_tokens)
        out = int(row.output_tokens)
        by_org.append({
            "organization_id": str(row.organization_id) if row.organization_id else None,
            "organization_name": row.name,
            "requests": row.requests,
            "input_tokens": inp,
            "output_tokens": out,
            "total_tokens": inp + out,
            "estimated_cost_usd": round(inp * 0.25 / 1_000_000 + out * 1.25 / 1_000_000, 4),
            "tool_calls": int(row.tool_calls or 0),
            "avg_latency_ms": round(float(row.avg_latency_ms or 0)),
        })

    # Tool usage breakdown
    # tool_names is a JSON column with tool name counts, so we need to aggregate differently
    tool_rows = db.query(
        GuideMetric.tool_names,
    ).filter(
        GuideMetric.request_started_at >= cutoff,
        GuideMetric.tool_names.isnot(None),
    ).all()

    tool_counts: dict[str, int] = {}
    for (names,) in tool_rows:
        if isinstance(names, list):
            for name in names:
                tool_counts[name] = tool_counts.get(name, 0) + 1
        elif isinstance(names, dict):
            for name, count in names.items():
                tool_counts[name] = tool_counts.get(name, 0) + (count if isinstance(count, int) else 1)

    by_tool = [{"tool": k, "calls": v} for k, v in sorted(tool_counts.items(), key=lambda x: -x[1])]

    # Daily request counts for chart
    daily_rows = db.query(
        cast(GuideMetric.request_started_at, Date).label("day"),
        func.count().label("requests"),
        func.coalesce(func.sum(GuideMetric.input_tokens), 0).label("input_tokens"),
        func.coalesce(func.sum(GuideMetric.output_tokens), 0).label("output_tokens"),
    ).filter(
        GuideMetric.request_started_at >= cutoff,
    ).group_by("day").order_by("day").all()

    daily = []
    for row in daily_rows:
        inp = int(row.input_tokens)
        out = int(row.output_tokens)
        daily.append({
            "date": row.day.isoformat(),
            "requests": row.requests,
            "tokens": inp + out,
            "estimated_cost_usd": round(inp * 0.25 / 1_000_000 + out * 1.25 / 1_000_000, 4),
        })

    # Per-provider breakdown
    provider_rows = db.query(
        GuideMetric.model_provider,
        func.count().label("requests"),
    ).filter(
        GuideMetric.request_started_at >= cutoff,
    ).group_by(GuideMetric.model_provider).all()

    by_provider = {row.model_provider: row.requests for row in provider_rows}

    # Top questions (grouped by text, top 20)
    top_questions_rows = db.query(
        GuideMetric.user_question,
        func.count().label("count"),
    ).filter(
        GuideMetric.request_started_at >= cutoff,
        GuideMetric.user_question.isnot(None),
    ).group_by(GuideMetric.user_question).order_by(desc("count")).limit(20).all()
    top_questions = [{"question": r.user_question, "count": r.count} for r in top_questions_rows]

    # Satisfaction summary
    sat_rows = db.query(
        GuideMetric.satisfaction,
        func.count().label("count"),
    ).filter(
        GuideMetric.request_started_at >= cutoff,
        GuideMetric.satisfaction.isnot(None),
    ).group_by(GuideMetric.satisfaction).all()
    satisfaction = {r.satisfaction: r.count for r in sat_rows}

    # Retrieval misses (questions where tools returned empty)
    miss_rows = db.query(
        GuideMetric.user_question,
        GuideMetric.tool_names,
        GuideMetric.page_entity_type,
    ).filter(
        GuideMetric.request_started_at >= cutoff,
        GuideMetric.empty_tool_results > 0,
    ).order_by(GuideMetric.request_started_at.desc()).limit(20).all()
    retrieval_misses = [
        {
            "question": r.user_question,
            "tools": r.tool_names,
            "entity_type": r.page_entity_type,
        }
        for r in miss_rows
    ]

    # Top pages (most questions asked from)
    page_rows = db.query(
        GuideMetric.page_route,
        func.count().label("count"),
    ).filter(
        GuideMetric.request_started_at >= cutoff,
        GuideMetric.page_route.isnot(None),
    ).group_by(GuideMetric.page_route).order_by(desc("count")).limit(15).all()
    top_pages = [{"route": r.page_route, "count": r.count} for r in page_rows]

    return {
        "period_days": days,
        "summary": {
            "total_requests": total_requests,
            "total_errors": total_errors,
            "error_rate": round(total_errors / total_requests, 4) if total_requests else 0,
            "total_input_tokens": total_input_tokens,
            "total_output_tokens": total_output_tokens,
            "total_tokens": total_input_tokens + total_output_tokens,
            "estimated_cost_usd": round(
                total_input_tokens * 0.25 / 1_000_000 + total_output_tokens * 1.25 / 1_000_000, 4
            ),
            "avg_latency_ms": round(float(avg_latency or 0)),
            "satisfaction_positive": satisfaction.get("positive", 0),
            "satisfaction_negative": satisfaction.get("negative", 0),
        },
        "by_org": by_org,
        "by_tool": by_tool,
        "by_provider": by_provider,
        "daily": daily,
        "top_questions": top_questions,
        "retrieval_misses": retrieval_misses,
        "top_pages": top_pages,
    }


# ============================================================================
# Provisioning Audit Log Helper
# ============================================================================


def log_provisioning_event(
    db: Session,
    request: Request | None,
    action: str,
    performer_id=None,
    org_id=None,
    details: dict = None,
):
    """
    Log a provisioning event for audit purposes.

    Args:
        db: SQLAlchemy session
        request: FastAPI Request for IP/user-agent
        action: Action type (e.g., 'org_created', 'user_bulk_imported', 'app_enabled')
        performer_id: UUID of the user performing the action
        org_id: UUID of the target organization (optional)
        details: Additional action-specific details (optional)
    """
    try:
        ip_address = None
        user_agent = None
        if request:
            ip_address = request.client.host if request.client else None
            user_agent = (request.headers.get("user-agent") or "")[:500]

        log = ProvisioningAuditLog(
            action=action,
            performed_by=performer_id,
            organization_id=org_id,
            details=details or {},
            ip_address=ip_address,
            user_agent=user_agent,
        )
        db.add(log)
        # Note: caller should commit as part of their transaction
    except Exception as e:
        logger.error(f"Failed to log provisioning event: {e}")


# ============================================================================
# Helper functions
# ============================================================================


def _normalize_iso(value: str) -> str:
    """Make an ISO-8601 string parseable by ``datetime.fromisoformat``.

    Two real-world hazards we have to absorb:
    - clients send ``Z`` for UTC (Python's parser wants ``+00:00`` until 3.11+)
    - query strings may decode ``+00:00`` to `` 00:00`` because ``+`` is the
      reserved space in form-urlencoded payloads. Restore the plus.
    """
    s = value.replace("Z", "+00:00")
    # Tail like " 00:00" (note the leading space) was an encoded "+00:00".
    # Re-glue it. Only touch the tail, not whitespace inside the value.
    if len(s) >= 6 and s[-6] == " " and s[-3] == ":":
        s = s[:-6] + "+" + s[-5:]
    return s


def _mask_email(email: str | None) -> str | None:
    """Mask an email address for safe display: j***@domain.com."""
    if not email or "@" not in email:
        return email
    local, domain = email.rsplit("@", 1)
    if len(local) <= 1:
        masked_local = local
    else:
        masked_local = local[0] + "***"
    return f"{masked_local}@{domain}"


def _build_job_timeline(job) -> list[dict]:
    """
    Build a clean step timeline from a job's steps JSONB.

    Returns a list of step dicts ordered by the provisioning step sequence,
    each with: step, status, started_at, completed_at, duration_ms, error.
    """
    from app.services.provisioning_service import PROVISIONING_STEPS

    timeline = []
    for step_key in PROVISIONING_STEPS:
        step_data = job.steps.get(step_key, {})
        started = step_data.get("started_at")
        completed = step_data.get("completed_at")

        duration_ms = None
        if started and completed:
            try:
                t0 = datetime.fromisoformat(started)
                t1 = datetime.fromisoformat(completed)
                duration_ms = round((t1 - t0).total_seconds() * 1000)
            except (ValueError, TypeError):
                pass

        timeline.append({
            "step": step_key,
            "status": step_data.get("status", "pending"),
            "started_at": started,
            "completed_at": completed,
            "duration_ms": duration_ms,
            "error": step_data.get("error"),
        })
    return timeline


def _send_bulk_user_invitation_email(
    email_service,
    email: str,
    name: str,
    org_name: str,
    role_name: str,
    activation_url: str,
) -> bool:
    """Send invitation email for bulk-imported user."""
    html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Madrona</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: #ffffff;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">

        <div style="margin-bottom: 32px;">
            <h1 style="font-family: Georgia, 'Times New Roman', serif; font-weight: 600; font-size: 24px; color: #111827; margin: 0;">
                Madrona
            </h1>
            <div style="height: 1px; background-color: #e5e7eb; margin-top: 16px;"></div>
        </div>

        <div style="margin-bottom: 32px;">
            <h2 style="font-size: 20px; font-weight: 600; color: #111827; margin: 0 0 24px 0;">
                Welcome to {org_name}, {name}
            </h2>

            <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                You've been added to <strong>{org_name}</strong> on Madrona as a <strong>{role_name}</strong>.
            </p>

            <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #374151;">
                Complete your account setup to get started:
            </p>

            <div style="margin-bottom: 24px;">
                <a href="{activation_url}"
                   style="display: inline-block; background-color: #166534; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 4px; font-size: 15px; font-weight: 500;">
                    Complete Account Setup
                </a>
            </div>

            <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                Or copy and paste this link into your browser:
            </p>
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #6b7280; word-break: break-all;">
                {activation_url}
            </p>

            <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.5; color: #6b7280;">
                This link will expire in 7 days.
            </p>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; margin-top: 40px;">
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #9ca3af;">
                Questions? Contact {support_address()}
            </p>
        </div>

    </div>
</body>
</html>
"""

    text_body = f"""Madrona

Welcome to {org_name}, {name}

You've been added to {org_name} on Madrona as a {role_name}.

Complete your account setup to get started:
{activation_url}

This link will expire in 7 days.

Questions? Contact {support_address()}
"""

    return email_service.send_email(
        channel="accounts",
        to=[email],
        subject=f"Welcome to {org_name} on Madrona",
        html=html,
        text=text_body,
        tags={"type": "bulk_invitation"},
    )


# ============================================================================
# Application Endpoints
# ============================================================================


@router.get("/api/platform/applications", response_model=ApplicationsListResponse, summary="List applications")
def list_applications(
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """List all available applications."""
    applications = (
        db.query(Application)
        .order_by(Application.sort_order)
        .all()
    )

    return {
        "applications": [
            {
                "application_id": str(app.application_id),
                "key": app.key,
                "display_name": app.display_name,
                "description": app.description,
                "icon": app.icon,
                "default_enabled": app.default_enabled,
                "requires_contract": app.requires_contract,
                "sort_order": app.sort_order,
                "status": app.status,
            }
            for app in applications
        ]
    }


# ============================================================================
# Organization Endpoints
# ============================================================================


@router.get("/api/platform/organizations", response_model=PlatformOrganizationsResponse, summary="List all organizations")
def list_all_organizations(
    auth: AuthContext = Depends(require_platform_admin),
    admin_db: Session = Depends(_admin_db_dep),
):
    """
    List all organizations with detailed info (platform admin only).

    Runs on the BYPASSRLS owner connection because the request session's
    RLS policies on `organizations`, `organization_memberships`, and
    `organization_applications` filter to the calling user's own
    memberships. A platform admin needs to see every org regardless of
    membership; same rationale as the provisioning saga.
    """
    from sqlalchemy import func as sql_func

    # Get all organizations
    organizations = (
        admin_db.query(Organization)
        .order_by(Organization.name)
        .all()
    )

    # Get user counts per organization
    user_counts = dict(
        admin_db.query(
            OrganizationMembership.organization_id,
            sql_func.count(OrganizationMembership.user_id)
        )
        .filter(OrganizationMembership.status == "active")
        .group_by(OrganizationMembership.organization_id)
        .all()
    )

    # Get all enabled app subscriptions
    org_apps = (
        admin_db.query(OrganizationApplication, Application)
        .join(Application, OrganizationApplication.application_id == Application.application_id)
        .filter(OrganizationApplication.enabled == True)
        .all()
    )

    # Group apps by organization
    apps_by_org: dict = {}
    for org_app, app in org_apps:
        org_id = org_app.organization_id
        if org_id not in apps_by_org:
            apps_by_org[org_id] = []
        apps_by_org[org_id].append({
            "key": app.key,
            "display_name": app.display_name,
            "contract_start_date": org_app.contract_start_date.isoformat() if org_app.contract_start_date else None,
            "contract_end_date": org_app.contract_end_date.isoformat() if org_app.contract_end_date else None,
        })

    today = date.today()
    result = []

    for org in organizations:
        # Calculate storage info (unified: media + db + search)
        media_bytes = org.storage_used_bytes or 0
        db_bytes = org.db_used_bytes or 0
        search_bytes = org.search_used_bytes or 0
        total_used_bytes = media_bytes + db_bytes + search_bytes
        used_gb = round(total_used_bytes / (1024 ** 3), 2)
        limit_gb = org.storage_limit_gb if org.storage_limit_gb is not None else Organization.DEFAULT_STORAGE_LIMIT_GB
        usage_percent = round((total_used_bytes / (limit_gb * 1024 ** 3) * 100), 2) if limit_gb else 0

        # Get apps for this org
        org_app_list = apps_by_org.get(org.organization_id, [])

        # Determine earliest contract end date (most restrictive)
        contract_end_dates = [
            a["contract_end_date"] for a in org_app_list
            if a["contract_end_date"]
        ]
        earliest_end = min(contract_end_dates) if contract_end_dates else None

        # Determine contract start dates for status calculation
        contract_start_dates = [
            a["contract_start_date"] for a in org_app_list
            if a["contract_start_date"]
        ]
        earliest_start = min(contract_start_dates) if contract_start_dates else None

        # Determine status
        status = "active"
        if earliest_end:
            end_date = date.fromisoformat(earliest_end)
            if end_date < today:
                status = "expired"

        # If org has no apps at all, mark as inactive
        if len(org_app_list) == 0:
            status = "inactive"

        result.append({
            "organization_id": str(org.organization_id),
            "name": org.name,
            "slug": org.slug,
            "created_at": org.created_at.isoformat() if org.created_at else None,
            "user_count": user_counts.get(org.organization_id, 0),
            "storage": {
                "media_bytes": media_bytes,
                "db_bytes": db_bytes,
                "search_bytes": search_bytes,
                "total_used_bytes": total_used_bytes,
                "used_gb": used_gb,
                "limit_gb": limit_gb,
                "usage_percent": usage_percent,
                "metered_at": org.storage_metered_at.isoformat() if org.storage_metered_at else None,
            },
            "apps": org_app_list,
            "contract_end_date": earliest_end,
            "status": status,
        })

    return {"organizations": result}


@router.put("/api/platform/organizations/{organization_id}", response_model=UpdateOrganizationResponse, summary="Update organization")
def update_organization(
    organization_id: UUID,
    body: UpdateOrganizationBody,
    request: Request,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(_admin_db_dep),  # BYPASSRLS owner: cross-org platform-admin (issue #75)
):
    """Update an organization's properties."""
    org = db.query(Organization).filter_by(organization_id=organization_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No fields to update"})

    changes = {}

    if "name" in data:
        name = data["name"].strip()
        if not name:
            raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Name cannot be empty", "field": "name"})
        changes["name"] = (org.name, name)
        org.name = name

    if "slug" in data:
        slug = data["slug"].strip().lower()
        if not slug:
            raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Slug cannot be empty", "field": "slug"})
        # Check uniqueness excluding current org
        existing = (
            db.query(Organization)
            .filter(Organization.slug == slug, Organization.organization_id != organization_id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail={"code": "conflict", "message": f"Slug '{slug}' is already in use"})
        changes["slug"] = (org.slug, slug)
        org.slug = slug

    if "status" in data:
        status = data["status"]
        if status not in ("active", "inactive", "suspended"):
            raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Status must be active, inactive, or suspended", "field": "status"})
        changes["status"] = (org.status, status)
        org.status = status

    if "is_demo" in data:
        changes["is_demo"] = (org.is_demo, bool(data["is_demo"]))
        org.is_demo = bool(data["is_demo"])

    if "timezone" in data:
        changes["timezone"] = (org.timezone, data["timezone"])
        org.timezone = data["timezone"]

    if not changes:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No fields to update"})

    log_provisioning_event(
        db=db,
        request=request,
        action="org_updated",
        performer_id=auth.user_id,
        org_id=organization_id,
        details={
            "organization_name": org.name,
            "changes": {k: {"from": v[0], "to": v[1]} for k, v in changes.items()},
        },
    )

    db.commit()

    logger.info(f"Platform admin updated organization {organization_id}: {list(changes.keys())}")

    return {
        "message": "Organization updated successfully",
        "organization_id": str(org.organization_id),
        "name": org.name,
        "slug": org.slug,
        "status": org.status,
        "is_demo": org.is_demo,
        "timezone": org.timezone,
    }


@router.delete("/api/platform/organizations/{organization_id}", response_model=MessageResponse, summary="Delete organization")
def delete_organization(
    organization_id: UUID,
    request: Request,
    confirm: str = Query(None),
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
    admin_db: Session = Depends(_admin_db_dep),
):
    """
    Delete an organization and all associated data.

    Requires ?confirm=true query parameter as a safety check.

    Runs the lookup + delete on the BYPASSRLS owner connection (admin_db).
    The request session's RLS on `organizations` would otherwise return
    None for any org the platform admin isn't a member of, masquerading
    as a 404 — same reason list_all_organizations now uses admin_db.
    The audit log write stays on `db` because provisioning_audit_logs
    is RLS-exempt (see migration f1a2b3c4d5e6).
    """
    if confirm != "true":
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Must pass ?confirm=true to confirm deletion"})

    org = admin_db.query(Organization).filter_by(organization_id=organization_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    org_name = org.name
    org_slug = org.slug

    # Log before delete so we capture the org_id, and COMMIT it before the
    # delete lands.
    #
    # log_provisioning_event only does db.add(); the caller commits. Every
    # other call site commits `db` — this one committed `admin_db` instead,
    # and get_db's `finally: session.close()` then rolled the audit row back.
    # So the single most destructive operation in the system was the only one
    # that left no trace: entity_audit_events, audit_logs and every collections
    # table cascade away with the organization, and the one row designed to
    # survive it (provisioning_audit_logs is ON DELETE SET NULL) was never
    # written. Committing first also means the record survives if the delete
    # itself fails.
    log_provisioning_event(
        db=db,
        request=request,
        action="org_deleted",
        performer_id=auth.user_id,
        org_id=organization_id,
        details={
            "organization_name": org_name,
            "organization_slug": org_slug,
        },
    )
    db.commit()

    admin_db.delete(org)
    admin_db.commit()

    logger.info(f"Platform admin deleted organization {organization_id} ({org_slug})")

    return {"message": f"Organization '{org_name}' deleted successfully"}


# ============================================================================
# Organization Application Endpoints
# ============================================================================


@router.get("/api/platform/organizations/{organization_id}/applications", response_model=OrgApplicationsResponse, summary="Get organization applications")
def get_organization_applications(
    organization_id: UUID,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(_admin_db_dep),  # BYPASSRLS owner: cross-org platform-admin (issue #75)
):
    """Get all applications with their enabled status for an organization."""
    org = db.query(Organization).filter_by(organization_id=organization_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    # Get all applications with org subscription status
    app_data = (
        db.query(Application, OrganizationApplication)
        .outerjoin(
            OrganizationApplication,
            (OrganizationApplication.application_id == Application.application_id) &
            (OrganizationApplication.organization_id == organization_id)
        )
        .order_by(Application.sort_order)
        .all()
    )

    return {
        "organization_id": str(organization_id),
        "organization_name": org.name,
        "applications": [
            {
                "application_id": str(app.application_id),
                "key": app.key,
                "display_name": app.display_name,
                "status": app.status,
                "enabled": org_app.enabled if org_app else False,
                "enabled_at": org_app.enabled_at.isoformat() if org_app and org_app.enabled_at else None,
                "enabled_by": str(org_app.enabled_by) if org_app and org_app.enabled_by else None,
                "contract_start_date": org_app.contract_start_date.isoformat() if org_app and org_app.contract_start_date else None,
                "contract_end_date": org_app.contract_end_date.isoformat() if org_app and org_app.contract_end_date else None,
            }
            for app, org_app in app_data
        ]
    }


class WidgetConfigPatchBody(BaseModel):
    widget_enabled: bool


@router.patch("/api/platform/organizations/{organization_id}/applications/guide/widget", summary="Toggle visitor widget for organization")
def patch_guide_widget_config(
    organization_id: UUID,
    body: WidgetConfigPatchBody,
    request: Request,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(_admin_db_dep),  # BYPASSRLS owner: cross-org platform-admin (issue #75)
):
    """Flip the per-org visitor-widget gate (deal provisioning)."""
    from sqlalchemy.orm.attributes import flag_modified

    org = db.query(Organization).filter_by(organization_id=organization_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    application = db.query(Application).filter_by(key="guide").first()
    org_app = (
        db.query(OrganizationApplication)
        .filter_by(organization_id=organization_id, application_id=application.application_id)
        .first()
    ) if application else None
    if not org_app or not org_app.enabled:
        raise HTTPException(status_code=409, detail={
            "code": "guide_not_enabled",
            "message": "Enable the Guide application for this organization first",
        })

    config = dict(org_app.config or {})
    config["widget_enabled"] = body.widget_enabled
    org_app.config = config
    flag_modified(org_app, "config")

    log_provisioning_event(
        db=db,
        request=request,
        action="widget_enabled" if body.widget_enabled else "widget_disabled",
        performer_id=auth.user_id,
        org_id=organization_id,
        details={"app_key": "guide", "organization_name": org.name},
    )
    db.commit()

    from app.services.public_cache import invalidate_org_cache
    try:
        invalidate_org_cache(org.slug)
    except Exception:
        logger.warning("Widget toggle: cache invalidation failed for %s", org.slug)

    return {"widget_enabled": body.widget_enabled}


@router.post("/api/platform/organizations/{organization_id}/applications", response_model=EnableAppResponse, summary="Enable organization application")
def enable_organization_application(
    organization_id: UUID,
    body: EnableAppBody,
    request: Request,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(_admin_db_dep),  # BYPASSRLS owner: cross-org platform-admin (issue #75)
):
    """Enable an application for an organization."""
    try:
        app_key = body.application_key

        # Verify organization exists
        org = db.query(Organization).filter_by(organization_id=organization_id).first()
        if not org:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

        # Verify application exists
        application = db.query(Application).filter_by(key=app_key).first()
        if not application:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Application not found"})

        # Check if subscription already exists
        existing = (
            db.query(OrganizationApplication)
            .filter_by(organization_id=organization_id, application_id=application.application_id)
            .first()
        )

        if existing:
            # Update existing subscription
            existing.enabled = True
            existing.enabled_at = datetime.now(timezone.utc)
            existing.enabled_by = auth.user_id

            # Update contract dates if provided
            if body.contract_start_date is not None:
                existing.contract_start_date = datetime.fromisoformat(body.contract_start_date).date() if body.contract_start_date else None
            if body.contract_end_date is not None:
                existing.contract_end_date = datetime.fromisoformat(body.contract_end_date).date() if body.contract_end_date else None
        else:
            # Create new subscription
            new_sub = OrganizationApplication(
                organization_id=organization_id,
                application_id=application.application_id,
                enabled=True,
                enabled_by=auth.user_id,
            )

            # Set contract dates if provided
            if body.contract_start_date:
                new_sub.contract_start_date = datetime.fromisoformat(body.contract_start_date).date()
            if body.contract_end_date:
                new_sub.contract_end_date = datetime.fromisoformat(body.contract_end_date).date()

            db.add(new_sub)

        # Log provisioning event
        log_provisioning_event(
            db=db,
            request=request,
            action="app_enabled",
            performer_id=auth.user_id,
            org_id=organization_id,
            details={
                "app_key": app_key,
                "organization_name": org.name,
            },
        )

        db.commit()

        # Seed default approval rules when collections is enabled
        if app_key == 'collections':
            from app.services.approval_service import seed_default_rules
            seed_default_rules(organization_id, db)
            db.commit()

        logger.info(f"Platform admin enabled application '{app_key}' for org {organization_id}")

        return {
            "message": "Application enabled successfully",
            "application_key": app_key,
            "enabled": True,
        }

    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": f"Invalid date format: {e}"})
    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "conflict", "message": "Application subscription already exists"})
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Database constraint violation"})


@router.delete("/api/platform/organizations/{organization_id}/applications/{app_key}", response_model=DisableAppResponse, summary="Disable organization application")
def disable_organization_application(
    organization_id: UUID,
    app_key: str,
    request: Request,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(_admin_db_dep),  # BYPASSRLS owner: cross-org platform-admin (issue #75)
):
    """Disable an application for an organization."""
    try:
        # Verify organization exists
        org = db.query(Organization).filter_by(organization_id=organization_id).first()
        if not org:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

        # Verify application exists
        application = db.query(Application).filter_by(key=app_key).first()
        if not application:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Application not found"})

        # Find subscription
        subscription = (
            db.query(OrganizationApplication)
            .filter_by(organization_id=organization_id, application_id=application.application_id)
            .first()
        )

        if not subscription:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Application subscription not found"})

        # Disable (don't delete, preserve history)
        subscription.enabled = False

        # Log provisioning event
        log_provisioning_event(
            db=db,
            request=request,
            action="app_disabled",
            performer_id=auth.user_id,
            org_id=organization_id,
            details={
                "app_key": app_key,
                "organization_name": org.name,
            },
        )

        db.commit()

        logger.info(f"Platform admin disabled application '{app_key}' for org {organization_id}")

        return {
            "message": "Application disabled successfully",
            "application_key": app_key,
            "enabled": False,
        }

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "conflict", "message": "Resource already exists"})
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Database constraint violation"})


# ============================================================================
# Storage Management Endpoints
# ============================================================================


@router.get("/api/platform/organizations/storage", response_model=OrgStorageListResponse, summary="List organizations storage")
def list_organizations_storage(
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """List all organizations with their storage configuration and usage."""
    organizations = (
        db.query(Organization)
        .order_by(Organization.name)
        .all()
    )

    org_data = []
    for org in organizations:
        limit_gb = org.storage_limit_gb if org.storage_limit_gb is not None else Organization.DEFAULT_STORAGE_LIMIT_GB
        media_bytes = org.storage_used_bytes or 0
        db_bytes_val = org.db_used_bytes or 0
        search_bytes = org.search_used_bytes or 0
        total_used_bytes = media_bytes + db_bytes_val + search_bytes
        used_gb = round(total_used_bytes / (1024 ** 3), 2)
        usage_percent = round((total_used_bytes / (limit_gb * 1024 ** 3) * 100), 2) if limit_gb else 0

        org_data.append({
            "organization_id": str(org.organization_id),
            "name": org.name,
            "slug": org.slug,
            "storage_limit_gb": limit_gb,
            "usage": {
                "media_bytes": media_bytes,
                "db_bytes": db_bytes_val,
                "search_bytes": search_bytes,
                "total_used_bytes": total_used_bytes,
                "used_gb": used_gb,
                "usage_percent": usage_percent,
                "metered_at": org.storage_metered_at.isoformat() if org.storage_metered_at else None,
            },
            "region": org.storage_region or "us-west-2",
        })

    return {"organizations": org_data}


@router.put("/api/platform/organizations/{organization_id}/storage", response_model=UpdateStorageResponse, summary="Update organization storage")
def update_organization_storage(
    organization_id: UUID,
    body: UpdateStorageBody,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(_admin_db_dep),  # BYPASSRLS owner: cross-org platform-admin (issue #75)
):
    """Update storage limit for an organization."""
    org = db.query(Organization).filter_by(organization_id=organization_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    data = body.model_dump(exclude_unset=True)

    if "storage_limit_gb" in data:
        limit_gb = data["storage_limit_gb"]
        if limit_gb is not None:
            if not isinstance(limit_gb, int) or limit_gb < 0:
                raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "storage_limit_gb must be a non-negative integer", "field": "storage_limit_gb"})
        org.storage_limit_gb = limit_gb

    db.commit()

    logger.info(
        f"Platform admin updated storage config for org {organization_id}: "
        f"storage_limit_gb={org.storage_limit_gb}"
    )

    return {
        "message": "Storage configuration updated",
        "organization_id": str(organization_id),
        "storage_limit_gb": org.storage_limit_gb,
    }


# ============================================================================
# Organization Provisioning (Enterprise Onboarding)
# ============================================================================


@router.post("/api/platform/provision", summary="Provision organization")
def provision_organization(
    body: ProvisionOrganizationBody,
    request: Request,
    mode: str = Query("", alias="mode"),
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
    admin_db: Session = Depends(_admin_db_dep),
):
    """
    Provision a new organization with apps, admin user, and send welcome email.

    Creates an organization on behalf of someone who is not yet a user of it,
    which is what separates this from the first-run install wizard: that one
    runs once, unauthenticated, on an empty instance. This one is how an
    operator adds organizations to an instance that already has some —
    including, for anyone running Madrona as a service, from their own
    control plane.
    Runs as a job-tracked saga with idempotent, retryable steps.
    """
    from app.models import OrgProvisioningJob
    from app.services.provisioning_service import (
        ProvisioningService, ProvisioningError, PayloadMismatchError, ConcurrentJobError,
    )

    try:
        data = body.model_dump()

        # Fast-fail validation of required fields
        org_data = data.get("organization", {})
        admin_data = data.get("admin", {})

        if not org_data.get("name"):
            raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "organization.name is required", "field": "organization.name"})
        if not admin_data.get("email"):
            raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "admin.email is required", "field": "admin.email"})
        if not admin_data.get("name"):
            raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "admin.name is required", "field": "admin.name"})

        performer_id = auth.user_id
        service = ProvisioningService(db, performer_id=performer_id)

        # Validate-only mode: return normalized values + warnings, no side effects
        if mode.lower() == "validate":
            result = service.validate_only(data)
            status = 200 if result["valid"] else 400
            return JSONResponse(content=result, status_code=status)

        try:
            job = service.create_job(data)
        except ProvisioningError:
            raise HTTPException(status_code=409, detail={"code": "conflict", "message": "A provisioning job for this organization is already running"})
        except PayloadMismatchError as e:
            return JSONResponse(content={
                "error": "Payload differs from existing job for this slug/email",
                "existing_job_id": str(e.existing_job_id),
            }, status_code=409)

        # If the job is already completed, return the cached result with
        # 200 OK (not 201). On an idempotent retry no new resource was
        # created, so the conventional status is 200; 201 is reserved for
        # the first call that actually provisioned.
        if job.status == "completed":
            apps_result = job.steps.get("enable_applications", {}).get("result", {})
            email_result = job.steps.get("send_welcome_email", {}).get("result", {})
            return JSONResponse(content={
                "message": "Organization provisioned successfully",
                "job_id": str(job.job_id),
                "organization_id": str(job.organization_id),
                "organization_slug": job.organization_slug,
                "admin_user_id": str(job.admin_user_id),
                "enabled_applications": apps_result.get("enabled_apps", []),
                "welcome_email_sent": email_result.get("email_sent", False),
            }, status_code=200)

        # If the job previously failed, tell the caller to use retry
        if job.status == "failed":
            return JSONResponse(content={
                "error": "Previous provisioning attempt failed",
                "job_id": str(job.job_id),
                "error_step": job.error_step,
                "error_message": job.error_message,
                "retry_url": f"/api/platform/provision/{job.job_id}/retry",
            }, status_code=409)

        # Sandbox provisioning (with_demo_data=true) takes 5–15 min because
        # the seed_sandbox_data step downloads collection objects and
        # generates synthetic media. Dispatch to Celery so the request
        # returns immediately; the admin UI polls
        # GET /api/platform/provision/{job_id} for step progress.
        if data.get("with_demo_data"):
            from app.tasks.provisioning import run_provisioning_job_task
            run_provisioning_job_task.delay(str(job.job_id))
            logger.info(
                "Sandbox provisioning queued for slug=%s job=%s",
                job.organization_slug,
                job.job_id,
            )
            return JSONResponse(content={
                "message": "Sandbox provisioning queued",
                "job_id": str(job.job_id),
                "organization_slug": job.organization_slug,
                "status_url": f"/api/platform/provision/{job.job_id}",
            }, status_code=202)

        # Synchronous saga for the existing enterprise-provisioning flow
        # (with_demo_data=false). Steps complete in seconds.
        #
        # `admin_db` is a BYPASSRLS owner connection (see _admin_db_dep).
        # The saga writes to org-scoped tables for an org that doesn't
        # yet exist in any membership graph (no valid current_org_id),
        # so the standard RLS policy `(organization_id = current_org_id())`
        # would deny every INSERT on a regular session.
        try:
            admin_job = (
                admin_db.query(OrgProvisioningJob)
                .filter_by(job_id=job.job_id)
                .first()
            )
            admin_service = ProvisioningService(
                admin_db, performer_id=performer_id
            )
            admin_service.run_job(admin_job)
            # admin session commits its writes; refresh the request-session
            # `job` so its status/error fields reflect the saga's outcome.
            db.refresh(job)
        except ConcurrentJobError:
            return JSONResponse(content={
                "error": "A provisioning job for this organization is already running",
                "job_id": str(job.job_id),
            }, status_code=409)
        except ProvisioningError as e:
            logger.error("Provisioning failed at step '%s' for job %s: %s", e.step, job.job_id, e)
            return JSONResponse(content={
                "error": f"Provisioning failed at step '{e.step}'",
                "job_id": str(job.job_id),
                "error_step": e.step,
                "error_message": sanitize_error_message(e),
                "retry_url": f"/api/platform/provision/{job.job_id}/retry",
            }, status_code=500)

        # Success
        apps_result = job.steps.get("enable_applications", {}).get("result", {})
        email_result = job.steps.get("send_welcome_email", {}).get("result", {})

        logger.info(
            f"Provisioned organization '{job.organization_slug}' ({job.organization_id}) "
            f"via job {job.job_id}"
        )

        return JSONResponse(content={
            "message": "Organization provisioned successfully",
            "job_id": str(job.job_id),
            "organization_id": str(job.organization_id),
            "organization_slug": job.organization_slug,
            "admin_user_id": str(job.admin_user_id),
            "enabled_applications": apps_result.get("enabled_apps", []),
            "welcome_email_sent": email_result.get("email_sent", False),
        }, status_code=201)

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "conflict", "message": "Organization or user already exists"})
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Database constraint violation"})


# ============================================================================
# Provisioning Job Endpoints
# ============================================================================


@router.get("/api/platform/provision/jobs", response_model=ProvisioningJobListResponse, summary="List provisioning jobs")
def list_provisioning_jobs(
    status: str = Query(None),
    search: str = Query(""),
    include_email: str = Query(""),
    limit: str = Query("25"),
    offset: str = Query("0"),
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """List provisioning jobs with optional filtering and pagination.

    `limit`/`offset` are typed as ``str`` (not ``int``) so callers passing
    garbage like ``?limit=abc`` get default-coerced to 25/0 rather than
    a 422. The expected behavior is graceful fallback.
    """
    from app.models import OrgProvisioningJob
    from sqlalchemy import or_

    search = search.strip().lower()
    include_email_flag = include_email.lower() == "true"
    try:
        limit = min(int(limit), 100)
    except (ValueError, TypeError):
        limit = 25
    try:
        offset = max(int(offset), 0)
    except (ValueError, TypeError):
        offset = 0

    query = db.query(OrgProvisioningJob)

    if status:
        query = query.filter(OrgProvisioningJob.status == status)

    if search:
        escaped = escape_ilike(search)
        query = query.filter(
            or_(
                OrgProvisioningJob.organization_slug.ilike(f"%{escaped}%", escape="\\"),
                OrgProvisioningJob.admin_email.ilike(f"%{escaped}%", escape="\\"),
            )
        )

    total = query.count()
    jobs = query.order_by(OrgProvisioningJob.created_at.desc()).offset(offset).limit(limit).all()

    email_fn = (lambda e: e) if include_email_flag else _mask_email

    return {
        "items": [
            {
                "job_id": str(j.job_id),
                "status": j.status,
                "organization_slug": j.organization_slug,
                "organization_id": str(j.organization_id) if j.organization_id else None,
                "admin_email": email_fn(j.admin_email),
                "current_step": j.current_step,
                "error_step": j.error_step,
                "retry_count": j.retry_count,
                "started_at": j.started_at.isoformat() if j.started_at else None,
                "completed_at": j.completed_at.isoformat() if j.completed_at else None,
                "created_at": j.created_at.isoformat() if j.created_at else None,
            }
            for j in jobs
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/platform/provision/{job_id}", response_model=ProvisioningJobDetailResponse, summary="Get provisioning job")
def get_provisioning_job(
    job_id: UUID,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Inspect a provisioning job's status and per-step details."""
    from app.models import OrgProvisioningJob

    job = db.query(OrgProvisioningJob).filter_by(job_id=job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Provisioning job not found"})

    return {
        "job_id": str(job.job_id),
        "status": job.status,
        "organization_id": str(job.organization_id) if job.organization_id else None,
        "organization_slug": job.organization_slug,
        "admin_user_id": str(job.admin_user_id) if job.admin_user_id else None,
        "current_step": job.current_step,
        "error_message": job.error_message,
        "error_step": job.error_step,
        "retry_count": job.retry_count,
        "max_retries": job.max_retries,
        "steps": job.steps,
        "timeline": _build_job_timeline(job),
        "event_log": job.event_log or [],
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "created_at": job.created_at.isoformat() if job.created_at else None,
    }


@router.put("/api/platform/provision/{job_id}/retry", summary="Retry provisioning job")
def retry_provisioning_job(
    job_id: UUID,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
    admin_db: Session = Depends(_admin_db_dep),
):
    """Retry a failed provisioning job from the point of failure."""
    from app.models import OrgProvisioningJob
    from app.services.provisioning_service import (
        ProvisioningService, ProvisioningError, ConcurrentJobError,
    )

    job = db.query(OrgProvisioningJob).filter_by(job_id=job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Provisioning job not found"})

    if job.status != "failed":
        return JSONResponse(content={
            "error": f"Job is '{job.status}', only failed jobs can be retried",
            "job_id": str(job.job_id),
        }, status_code=409)

    # No retry cap. Retries here are user-initiated (PUT from a platform
    # admin), not automatic — Celery autoretry is disabled (max_retries=0
    # in app/tasks/provisioning.py). The retry_count column stays as
    # informational telemetry; max_retries on the row is no longer
    # enforced here.
    job.retry_count += 1
    db.commit()

    performer_id = auth.user_id

    # Sandbox retries (with_demo_data=true) take 5–15 min for the seeders;
    # dispatch to Celery and return 202, mirroring the initial provision
    # flow. The Celery worker runs the saga on admin_db_session()
    # (BYPASSRLS owner) so the cross-org writes succeed.
    if job.request_payload.get("with_demo_data"):
        from app.tasks.provisioning import run_provisioning_job_task
        run_provisioning_job_task.delay(str(job.job_id))
        logger.info(
            "Sandbox provisioning retry queued for slug=%s job=%s",
            job.organization_slug, job.job_id,
        )
        return JSONResponse(content={
            "message": "Sandbox provisioning retry queued",
            "job_id": str(job.job_id),
            "organization_slug": job.organization_slug,
            "retry_count": job.retry_count,
            "status_url": f"/api/platform/provision/{job.job_id}",
        }, status_code=202)

    # Enterprise retry: run sync on the BYPASSRLS owner connection
    # (`admin_db`, see _admin_db_dep), same rationale as
    # provision_organization.
    try:
        admin_job = (
            admin_db.query(OrgProvisioningJob)
            .filter_by(job_id=job.job_id)
            .first()
        )
        admin_service = ProvisioningService(
            admin_db, performer_id=performer_id
        )
        admin_service.run_job(admin_job)
        db.refresh(job)
    except ConcurrentJobError:
        return JSONResponse(content={
            "error": "Job is already being retried by another request",
            "job_id": str(job.job_id),
        }, status_code=409)
    except ProvisioningError as e:
        logger.error("Provisioning retry failed at step '%s' for job %s: %s", e.step, job.job_id, e)
        return JSONResponse(content={
            "error": f"Retry failed at step '{e.step}'",
            "job_id": str(job.job_id),
            "error_step": e.step,
            "error_message": sanitize_error_message(e),
            "retry_count": job.retry_count,
            "retry_url": f"/api/platform/provision/{job.job_id}/retry",
        }, status_code=500)

    apps_result = job.steps.get("enable_applications", {}).get("result", {})
    email_result = job.steps.get("send_welcome_email", {}).get("result", {})

    return JSONResponse(content={
        "message": "Organization provisioned successfully after retry",
        "job_id": str(job.job_id),
        "organization_id": str(job.organization_id),
        "organization_slug": job.organization_slug,
        "admin_user_id": str(job.admin_user_id),
        "enabled_applications": apps_result.get("enabled_apps", []),
        "welcome_email_sent": email_result.get("email_sent", False),
        "retry_count": job.retry_count,
    }, status_code=201)


@router.post(
    "/api/platform/provision/{job_id}/steps/{step_key}/rerun",
    summary="Re-run a saga step (and all later steps)",
)
def rerun_provisioning_step(
    job_id: UUID,
    step_key: str,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
    admin_db: Session = Depends(_admin_db_dep),
):
    """
    Rerun the saga from `step_key` onward.

    Marks `step_key` AND every later step as `pending` (clearing their
    `result` / `error` / timestamps), flips job.status to 'failed' so
    the saga's atomic claim path works, then dispatches:

      * Sandbox jobs (with_demo_data=true) → Celery via
        `run_provisioning_job_task` (returns 202 with job_id).
      * Enterprise jobs → sync on admin_db (returns 200 with the run's
        result).

    Earlier completed steps are kept as-is — their `status: completed`
    survives, so the saga's loop skips them. This is the "I want to
    redo from here" affordance, not a full restart.

    Why cascade later steps: rerunning a single seeder in isolation
    rarely matches reality. If a Met seeder run created 0 objects but
    the saga marked it completed, the phase-2 seeders that ran after
    it ran with no objects to work with — those are stale too. Forcing
    the user to manually pick every step would be tedious.
    """
    from app.models import OrgProvisioningJob
    from app.services.provisioning_service import (
        ProvisioningService,
        ProvisioningError,
        ConcurrentJobError,
        PROVISIONING_STEPS,
    )
    from sqlalchemy.orm.attributes import flag_modified

    if step_key not in PROVISIONING_STEPS:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Unknown step '{step_key}'",
        })

    job = db.query(OrgProvisioningJob).filter_by(job_id=job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Provisioning job not found",
        })

    if job.status == "running":
        return JSONResponse(content={
            "error": "Cannot rerun a step on a running job; cancel it first.",
            "job_id": str(job.job_id),
            "status": job.status,
        }, status_code=409)

    # Reset step_key and every step after it. Find the index, then
    # walk forward through PROVISIONING_STEPS.
    start_idx = PROVISIONING_STEPS.index(step_key)
    reset_steps = PROVISIONING_STEPS[start_idx:]

    new_steps = dict(job.steps or {})
    for sk in reset_steps:
        new_steps[sk] = {
            "status": "pending",
            "started_at": None,
            "completed_at": None,
            "result": None,
            "error": None,
        }
    job.steps = new_steps
    flag_modified(job, "steps")

    # Clear the durable welcome-email dedupe marker if the welcome step
    # is being reset. Otherwise `_step_send_welcome_email` short-circuits
    # on the saved `welcome_email_sent_at` and never calls SES — the
    # operator's intent to re-send is silently ignored. This bit us when
    # the original send delivered a broken-link email (blank
    # activation_url): the marker stuck, every subsequent rerun
    # short-circuited, no email ever reached the inbox.
    if "send_welcome_email" in reset_steps:
        job.welcome_email_sent_at = None

    # Move to a re-claimable state. Saga claim: status IN (pending, failed).
    job.status = "failed"
    job.current_step = step_key
    job.error_step = None
    job.error_message = None
    job.completed_at = None
    job.retry_count = (job.retry_count or 0) + 1
    db.commit()

    logger.info(
        "Provisioning job %s: rerun requested from step '%s' by user %s "
        "(reset %d steps)",
        job_id, step_key, auth.user_id, len(reset_steps),
    )

    performer_id = auth.user_id

    # Dispatch (mirrors retry endpoint).
    if job.request_payload.get("with_demo_data"):
        from app.tasks.provisioning import run_provisioning_job_task
        run_provisioning_job_task.delay(str(job.job_id))
        return JSONResponse(content={
            "message": f"Rerun queued from step '{step_key}'",
            "job_id": str(job.job_id),
            "from_step": step_key,
            "reset_steps": reset_steps,
            "status_url": f"/api/platform/provision/{job.job_id}",
        }, status_code=202)

    # Enterprise: sync on admin_db.
    try:
        admin_job = (
            admin_db.query(OrgProvisioningJob)
            .filter_by(job_id=job.job_id)
            .first()
        )
        admin_service = ProvisioningService(admin_db, performer_id=performer_id)
        admin_service.run_job(admin_job)
        db.refresh(job)
    except ConcurrentJobError:
        return JSONResponse(content={
            "error": "Job is already running elsewhere",
            "job_id": str(job.job_id),
        }, status_code=409)
    except ProvisioningError as e:
        return JSONResponse(content={
            "error": f"Rerun failed at step '{e.step}'",
            "job_id": str(job.job_id),
            "error_step": e.step,
            "error_message": sanitize_error_message(e),
            "retry_url": f"/api/platform/provision/{job.job_id}/retry",
        }, status_code=500)

    return JSONResponse(content={
        "message": f"Rerun completed from step '{step_key}'",
        "job_id": str(job.job_id),
        "from_step": step_key,
        "reset_steps": reset_steps,
    }, status_code=200)


@router.post("/api/platform/provision/{job_id}/cancel", summary="Cancel or reset a provisioning job")
def cancel_provisioning_job(
    job_id: UUID,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """
    Cancel/reset a provisioning job.

    Two flavours sharing one endpoint:

    * **Cancel** (status ∈ pending/running): atomically flip to failed
      with error_step='cancelled'. Cooperative — a Celery worker mid-step
      keeps running until the step finishes and the saga loop's top-of-
      iteration refresh reads the new status (fast steps: <1s; the
      seed_collections steps: up to 5–15 min). There's no celery
      revocation path because we don't store the task_id (follow-up).

    * **Reset** (status = failed): keep status=failed but reset
      retry_count to 0. Useful when an iterating dev has burned through
      max_retries on a series of unrelated bugs and just wants to keep
      going. error_step is preserved so the UI still shows where it
      last broke.

    Either way the existing retry endpoint accepts failed jobs, so the
    UI can flow from cancel → retry without a separate "reset" verb.
    """
    from datetime import datetime, timezone
    from sqlalchemy import update
    from app.models import OrgProvisioningJob

    job = db.query(OrgProvisioningJob).filter_by(job_id=job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Provisioning job not found",
        })

    if job.status in ("pending", "running"):
        # Cancel path: stop the saga + reset retry counter so the next
        # attempt's telemetry starts clean.
        result = db.execute(
            update(OrgProvisioningJob)
            .where(
                OrgProvisioningJob.job_id == job_id,
                OrgProvisioningJob.status.in_(["pending", "running"]),
            )
            .values(
                status="failed",
                error_step="cancelled",
                error_message="Cancelled by admin",
                current_step=None,
                retry_count=0,
                completed_at=datetime.now(timezone.utc),
            )
        )
        db.commit()
        if result.rowcount == 0:
            # Worker raced us and the job already terminated.
            db.refresh(job)
            return JSONResponse(content={
                "message": f"Job already in '{job.status}' state",
                "job_id": str(job_id),
                "status": job.status,
            }, status_code=200)
        logger.info("Provisioning job %s cancelled by user %s", job_id, auth.user_id)
        return JSONResponse(content={
            "message": "Provisioning job cancelled",
            "job_id": str(job_id),
            "status": "failed",
            "error_step": "cancelled",
            "retry_url": f"/api/platform/provision/{job_id}/retry",
        }, status_code=200)

    if job.status == "failed":
        # Reset path: keep failed status but clear retry telemetry so
        # the count starts fresh on the next attempt.
        result = db.execute(
            update(OrgProvisioningJob)
            .where(
                OrgProvisioningJob.job_id == job_id,
                OrgProvisioningJob.status == "failed",
            )
            .values(retry_count=0)
        )
        db.commit()
        logger.info(
            "Provisioning job %s retry counter reset by user %s (rows=%d)",
            job_id, auth.user_id, result.rowcount,
        )
        return JSONResponse(content={
            "message": "Retry counter reset",
            "job_id": str(job_id),
            "status": "failed",
            "retry_count": 0,
            "retry_url": f"/api/platform/provision/{job_id}/retry",
        }, status_code=200)

    # Completed / cancelled / anything terminal we can't act on.
    return JSONResponse(content={
        "error": f"Job is '{job.status}'; only pending, running, or failed jobs can be cancelled or reset",
        "job_id": str(job_id),
        "status": job.status,
    }, status_code=409)


# ============================================================================
# Invitation Resend & Reconciliation
# ============================================================================


@router.post("/api/platform/provision/{job_id}/resend-invite", response_model=ResendInviteResponse, summary="Resend provisioning invite")
def resend_provisioning_invite(
    job_id: UUID,
    force: str = Query(""),
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """
    Resend the activation invitation for a completed provisioning job.

    Ensures Cognito user exists, rotates the invitation token, extends expiry,
    and re-sends the activation email.
    """
    from app.models import OrgProvisioningJob
    from app.services.provisioning_service import ProvisioningService, ProvisioningError
    from app.services.rate_limiter import resend_daily_limiter, resend_force_daily_limiter

    job = db.query(OrgProvisioningJob).filter_by(job_id=job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Provisioning job not found"})

    performer_id = auth.user_id
    service = ProvisioningService(db, performer_id=performer_id)

    force_flag = force.lower() == "true"

    # Rate limit: 5/day per job (or 20/day with force)
    job_key = str(job_id)
    if force_flag:
        if not resend_force_daily_limiter.allow(organization_id=job_key, endpoint="resend_force"):
            return JSONResponse(content={
                "error": "Daily resend limit reached (even with force).",
                "error_code": "RATE_LIMIT_EXCEEDED",
                "retry_after_seconds": 86400,
            }, status_code=429)
    else:
        if not resend_daily_limiter.allow(organization_id=job_key, endpoint="resend"):
            return JSONResponse(content={
                "error": "Daily resend limit reached — use ?force=true or wait until tomorrow.",
                "error_code": "RATE_LIMIT_EXCEEDED",
                "retry_after_seconds": 86400,
            }, status_code=429)

    try:
        result = service.resend_invite(job, force=force_flag)
    except ProvisioningError as e:
        logger.warning("Resend invite failed for job %s: %s", job.job_id, e)
        return JSONResponse(content={
            "error": sanitize_error_message(e),
            "job_id": str(job.job_id),
        }, status_code=409)

    if result.get("already_active"):
        return {
            "message": "User is already active — no invite needed",
            "job_id": str(job.job_id),
            **result,
        }

    if result.get("dedupe_skipped"):
        return {
            "message": "Invite was sent recently (10 min window) — use ?force=true to override",
            "job_id": str(job.job_id),
            **result,
        }

    return {
        "message": "Invitation resent successfully",
        "job_id": str(job.job_id),
        **result,
    }


@router.post("/api/platform/provision/{job_id}/reconcile", response_model=ReconcileResponse, summary="Reconcile provisioning job")
def reconcile_provisioning_job(
    job_id: UUID,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """
    Reconcile partial provisioning state for a job.

    Idempotently ensures:
    - Cognito user exists (creates if missing)
    - Valid invitation exists (creates if missing/expired)
    - Membership exists (creates if missing)
    """
    from app.models import OrgProvisioningJob
    from app.services.provisioning_service import ProvisioningService, ProvisioningError

    job = db.query(OrgProvisioningJob).filter_by(job_id=job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Provisioning job not found"})

    performer_id = auth.user_id
    service = ProvisioningService(db, performer_id=performer_id)

    try:
        result = service.reconcile(job)
    except ProvisioningError as e:
        logger.warning("Reconciliation failed for job %s: %s", job.job_id, e)
        return JSONResponse(content={
            "error": sanitize_error_message(e),
            "job_id": str(job.job_id),
        }, status_code=409)

    return {
        "message": "Reconciliation complete",
        "job_id": str(job.job_id),
        **result,
    }


# ============================================================================
# Bulk User Import
# ============================================================================


@router.post("/api/platform/organizations/{organization_id}/users/bulk", summary="Bulk import users")
def bulk_import_users(
    organization_id: UUID,
    body: BulkImportUsersBody,
    request: Request,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(_admin_db_dep),  # BYPASSRLS owner: cross-org platform-admin (issue #75)
):
    """Bulk import users to an organization from CSV data."""
    try:
        users_data = body.users
        send_invitations = body.send_invitations

        # Guard against unbounded imports
        MAX_BULK_IMPORT_ROWS = 500
        if len(users_data) > MAX_BULK_IMPORT_ROWS:
            raise HTTPException(
                status_code=400,
                detail={"code": "validation_error", "message": f"Maximum {MAX_BULK_IMPORT_ROWS} users per import, got {len(users_data)}"},
            )

        # Verify organization exists
        org = db.query(Organization).filter_by(organization_id=organization_id).first()
        if not org:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

        # Get roles. "member" in the API maps to the viewer role — read-only
        # access is the safe default for bulk-invited users; admins can
        # upgrade individuals later.
        admin_role = db.query(Role).filter_by(role_key="admin").first()
        member_role = db.query(Role).filter_by(role_key="viewer").first()

        settings = get_settings()
        email_service = get_email_service()

        results = []
        created_count = 0
        skipped_count = 0
        error_count = 0

        for user_data in users_data:
            email = user_data.get("email", "").strip().lower()
            name = user_data.get("name", "").strip()
            role_str = user_data.get("role", "member").lower()

            # Validate email (RFC 5322 basic check)
            if not email or not _BULK_EMAIL_RE.match(email):
                results.append({
                    "email": email or "(empty)",
                    "status": "error",
                    "reason": "Invalid email format"
                })
                error_count += 1
                continue

            # Validate name
            if not name or len(name) > 200:
                results.append({
                    "email": email,
                    "status": "error",
                    "reason": "Name is required and must be 200 characters or fewer"
                })
                error_count += 1
                continue

            # Validate role — reject unknown values instead of silently defaulting
            VALID_ROLES = ("admin", "member")
            if role_str not in VALID_ROLES:
                results.append({
                    "email": email,
                    "status": "error",
                    "reason": f"Invalid role '{role_str}'. Must be one of: {', '.join(VALID_ROLES)}"
                })
                error_count += 1
                continue

            # Check if user already exists globally
            existing_user = db.query(User).filter_by(email=email).first()

            if existing_user:
                # Check if already a member of this org
                existing_membership = (
                    db.query(OrganizationMembership)
                    .filter_by(organization_id=organization_id, user_id=existing_user.user_id)
                    .first()
                )

                if existing_membership:
                    results.append({
                        "email": email,
                        "status": "skipped",
                        "reason": "User already exists in organization"
                    })
                    skipped_count += 1
                    continue

                # Add existing user to org
                role = admin_role if role_str == "admin" else member_role
                membership = OrganizationMembership(
                    organization_id=organization_id,
                    user_id=existing_user.user_id,
                    role=role_str,
                    role_id=role.role_id if role else None,
                    status="active",
                )
                db.add(membership)

                results.append({
                    "email": email,
                    "status": "created",
                    "user_id": str(existing_user.user_id),
                    "note": "Added existing user to organization"
                })
                created_count += 1
            else:
                # Create new user
                user = User(
                    email=email,
                    display_name=name,
                    status="invited",
                )
                db.add(user)
                db.flush()

                # Create membership
                role = admin_role if role_str == "admin" else member_role
                membership = OrganizationMembership(
                    organization_id=organization_id,
                    user_id=user.user_id,
                    role=role_str,
                    role_id=role.role_id if role else None,
                    status="active",
                )
                db.add(membership)

                # Create invitation token
                if send_invitations:
                    token = secrets.token_urlsafe(32)
                    token_hash = hashlib.sha256(token.encode()).hexdigest()
                    expires_at = datetime.now(timezone.utc) + timedelta(days=7)

                    invitation = OrganizationInvitation(
                        organization_id=organization_id,
                        user_id=user.user_id,
                        email=email,
                        token_hash=token_hash,
                        role=role_str,
                        invited_by=auth.user_id,
                        expires_at=expires_at,
                    )
                    db.add(invitation)

                    # Send invitation email
                    activation_url = f"{settings.app_base_url.rstrip('/')}/activate?token={token}"
                    role_display = "Administrator" if role_str == "admin" else "Member"

                    _send_bulk_user_invitation_email(
                        email_service, email, name, org.name, role_display, activation_url
                    )

                results.append({
                    "email": email,
                    "status": "created",
                    "user_id": str(user.user_id),
                    "invitation_sent": send_invitations
                })
                created_count += 1

        # Log provisioning event for bulk import
        if created_count > 0:
            log_provisioning_event(
                db=db,
                request=request,
                action="user_bulk_imported",
                performer_id=auth.user_id,
                org_id=organization_id,
                details={
                    "count": created_count,
                    "skipped": skipped_count,
                    "errors": error_count,
                    "organization_name": org.name,
                },
            )

        db.commit()

        logger.info(
            f"Bulk import to org {organization_id}: "
            f"created={created_count}, skipped={skipped_count}, errors={error_count}"
        )

        return JSONResponse(content={
            "message": "Bulk import completed",
            "organization_id": str(organization_id),
            "results": {
                "created": created_count,
                "skipped": skipped_count,
                "errors": error_count,
            },
            "users": results,
        }, status_code=201)

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "conflict", "message": "User already exists"})
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Database constraint violation"})


# ============================================================================
# Provisioning Audit Log Endpoints
# ============================================================================


@router.get("/api/platform/provisioning-logs", response_model=ProvisioningLogsResponse, summary="List provisioning logs")
def list_provisioning_logs(
    limit: int = Query(25),
    offset: int = Query(0),
    action: str = Query(None),
    organization_id: str = Query(None),
    performer_id: str = Query(None),
    since: str = Query(None),
    until: str = Query(None),
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """List all provisioning audit logs with pagination and filters."""
    try:
        # Parse pagination
        limit = min(int(limit), 100)
        offset = int(offset)

        # Build query
        query = db.query(ProvisioningAuditLog)

        # Apply filters
        if action:
            query = query.filter(ProvisioningAuditLog.action == action)

        if organization_id:
            query = query.filter(ProvisioningAuditLog.organization_id == organization_id)

        if performer_id:
            query = query.filter(ProvisioningAuditLog.performed_by == performer_id)

        if since:
            since_dt = datetime.fromisoformat(_normalize_iso(since))
            query = query.filter(ProvisioningAuditLog.created_at >= since_dt)

        if until:
            until_dt = datetime.fromisoformat(_normalize_iso(until))
            query = query.filter(ProvisioningAuditLog.created_at <= until_dt)

        # Get total count
        total_count = query.count()

        # Apply pagination and ordering
        logs = (
            query
            .order_by(desc(ProvisioningAuditLog.created_at))
            .offset(offset)
            .limit(limit)
            .all()
        )

        # Collect user IDs and org IDs for lookup
        user_ids = set()
        org_ids = set()
        for log in logs:
            if log.performed_by:
                user_ids.add(log.performed_by)
            if log.organization_id:
                org_ids.add(log.organization_id)

        # Lookup users
        users = {}
        if user_ids:
            user_records = db.query(User).filter(User.user_id.in_(user_ids)).all()
            users = {u.user_id: {"name": u.display_name, "email": u.email} for u in user_records}

        # Lookup organizations
        orgs = {}
        if org_ids:
            org_records = db.query(Organization).filter(Organization.organization_id.in_(org_ids)).all()
            orgs = {o.organization_id: {"name": o.name, "slug": o.slug} for o in org_records}

        return {
            "items": [
                {
                    "id": str(log.id),
                    "action": log.action,
                    "performed_by": str(log.performed_by) if log.performed_by else None,
                    "performer_name": users.get(log.performed_by, {}).get("name") if log.performed_by else None,
                    "performer_email": users.get(log.performed_by, {}).get("email") if log.performed_by else None,
                    "organization_id": str(log.organization_id) if log.organization_id else None,
                    "organization_name": orgs.get(log.organization_id, {}).get("name") if log.organization_id else None,
                    "organization_slug": orgs.get(log.organization_id, {}).get("slug") if log.organization_id else None,
                    "details": log.details or {},
                    "ip_address": log.ip_address,
                    "user_agent": log.user_agent,
                    "created_at": log.created_at.isoformat() if log.created_at else None,
                }
                for log in logs
            ],
            "total": total_count,
            "page": {
                "limit": limit,
                "offset": offset,
                "has_more": offset + limit < total_count,
            },
        }

    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": f"Invalid parameter: {e}"})


@router.get("/api/platform/provisioning-logs/stats", response_model=ProvisioningStatsResponse, summary="Get provisioning stats")
def get_provisioning_stats(
    days: int = Query(30),
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Get summary statistics for provisioning audit logs."""
    try:
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=today_start.weekday())
        days_ago = today_start - timedelta(days=days)

        # Total events
        total_events = db.query(ProvisioningAuditLog).count()

        # Events today
        events_today = (
            db.query(ProvisioningAuditLog)
            .filter(ProvisioningAuditLog.created_at >= today_start)
            .count()
        )

        # Events this week
        events_this_week = (
            db.query(ProvisioningAuditLog)
            .filter(ProvisioningAuditLog.created_at >= week_start)
            .count()
        )

        # Counts by action type
        by_action_query = (
            db.query(
                ProvisioningAuditLog.action,
                func.count(ProvisioningAuditLog.id).label("count")
            )
            .group_by(ProvisioningAuditLog.action)
            .all()
        )
        by_action = {row.action: row.count for row in by_action_query}

        # Counts by day (last N days)
        by_day_query = (
            db.query(
                cast(ProvisioningAuditLog.created_at, Date).label("date"),
                func.count(ProvisioningAuditLog.id).label("count")
            )
            .filter(ProvisioningAuditLog.created_at >= days_ago)
            .group_by(cast(ProvisioningAuditLog.created_at, Date))
            .order_by(desc(cast(ProvisioningAuditLog.created_at, Date)))
            .all()
        )
        by_day = [
            {"date": row.date.isoformat(), "count": row.count}
            for row in by_day_query
        ]

        return {
            "total_events": total_events,
            "events_today": events_today,
            "events_this_week": events_this_week,
            "by_action": by_action,
            "by_day": by_day,
        }

    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": f"Invalid parameter: {e}"})


# ============================================================================
# SSO/SAML Configuration Endpoints
# ============================================================================


@router.get("/api/platform/organizations/{organization_id}/sso", response_model=SSOConfigResponse, summary="Get sso config")
def get_sso_config(
    organization_id: UUID,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(_admin_db_dep),  # BYPASSRLS owner: cross-org platform-admin (issue #75)
):
    """Get SSO configuration for an organization."""
    org = db.query(Organization).filter_by(organization_id=organization_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    sso_config = db.query(SSOConfiguration).filter_by(
        organization_id=organization_id
    ).first()

    settings = get_settings()
    base_url = settings.app_base_url.rstrip('/')
    sp_metadata = {
        "entity_id": f"{base_url}/saml/metadata/{organization_id}",
        "acs_url": f"{base_url}/saml/acs/{organization_id}",
    }

    roles = db.query(Role).order_by(Role.display_name).all()

    # Get enabled apps for this organization
    enabled_apps = db.query(OrganizationApplication).filter_by(
        organization_id=organization_id
    ).all()

    response = {
        "organization_id": str(organization_id),
        "organization_name": org.name,
        "sso_config": None,
        "sp_metadata": sp_metadata,
        "available_roles": [
            {"role_id": str(r.role_id), "role_key": r.role_key, "display_name": r.display_name}
            for r in roles
        ],
        "enabled_apps": [
            {"app_key": app.application.key, "display_name": app.application.display_name}
            for app in enabled_apps if app.application
        ],
    }

    if sso_config:
        response["sso_config"] = {
            "id": str(sso_config.id),
            "provider": sso_config.provider,
            "enabled": sso_config.enabled,
            "idp_entity_id": sso_config.idp_entity_id,
            "idp_sso_url": sso_config.idp_sso_url,
            "idp_certificate": sso_config.idp_certificate,
            "sp_entity_id": sso_config.sp_entity_id,
            "client_id": sso_config.client_id,
            "discovery_url": sso_config.discovery_url,
            "auto_provision_users": sso_config.auto_provision_users,
            "default_app_roles": sso_config.default_app_roles or {},
            "allowed_domains": sso_config.allowed_domains or [],
            "created_at": sso_config.created_at.isoformat() if sso_config.created_at else None,
            "updated_at": sso_config.updated_at.isoformat() if sso_config.updated_at else None,
        }

    return response


@router.put("/api/platform/organizations/{organization_id}/sso", response_model=SSOUpdateResponse, summary="Update sso config")
def update_sso_config(
    organization_id: UUID,
    body: SSOConfigBody,
    auth: AuthContext = Depends(require_platform_admin),
    _mfa: AuthContext = Depends(require_fresh_mfa()),
    db: Session = Depends(_admin_db_dep),  # BYPASSRLS owner: cross-org platform-admin (issue #75)
):
    """Create or update SSO configuration for an organization."""
    try:
        org = db.query(Organization).filter_by(organization_id=organization_id).first()
        if not org:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

        data = body.model_dump(exclude_unset=True)

        provider = data.get("provider", "saml")
        if provider not in ("saml", "oidc"):
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Invalid provider. Must be 'saml' or 'oidc'"})

        # Validate default_app_roles if provided
        default_app_roles = data.get("default_app_roles")
        if default_app_roles:
            valid_app_keys = {'bridge', 'collections', 'media', 'reports'}
            valid_role_keys = {r.role_key for r in db.query(Role).all()}
            for app_key, role_key in default_app_roles.items():
                if app_key not in valid_app_keys:
                    raise HTTPException(status_code=422, detail={"code": "validation_error", "message": f"Invalid app_key: {app_key}", "field": "default_app_roles"})
                if role_key and role_key not in valid_role_keys:
                    raise HTTPException(status_code=422, detail={"code": "validation_error", "message": f"Invalid role_key: {role_key}", "field": "default_app_roles"})

        sso_config = db.query(SSOConfiguration).filter_by(
            organization_id=organization_id
        ).first()

        if not sso_config:
            sso_config = SSOConfiguration(organization_id=organization_id)
            db.add(sso_config)

        sso_config.provider = provider
        sso_config.enabled = data.get("enabled", False)

        if "idp_entity_id" in data:
            sso_config.idp_entity_id = data["idp_entity_id"]
        if "idp_sso_url" in data:
            sso_config.idp_sso_url = data["idp_sso_url"]
        if "idp_certificate" in data:
            sso_config.idp_certificate = data["idp_certificate"]
        if "sp_entity_id" in data:
            sso_config.sp_entity_id = data["sp_entity_id"]
        if "client_id" in data:
            sso_config.client_id = data["client_id"]
        if "client_secret" in data:
            sso_config.client_secret = data["client_secret"]
        if "discovery_url" in data:
            sso_config.discovery_url = data["discovery_url"]
        if "auto_provision_users" in data:
            sso_config.auto_provision_users = data["auto_provision_users"]
        if "default_app_roles" in data:
            sso_config.default_app_roles = data["default_app_roles"] if data["default_app_roles"] else None
        if "allowed_domains" in data:
            sso_config.allowed_domains = data["allowed_domains"] if data["allowed_domains"] else None

        db.commit()

        logger.info(f"Updated SSO config for org {organization_id}: provider={provider}, enabled={sso_config.enabled}")

        return {
            "message": "SSO configuration updated",
            "sso_config": {
                "id": str(sso_config.id),
                "provider": sso_config.provider,
                "enabled": sso_config.enabled,
                "idp_entity_id": sso_config.idp_entity_id,
                "idp_sso_url": sso_config.idp_sso_url,
                "sp_entity_id": sso_config.sp_entity_id,
                "auto_provision_users": sso_config.auto_provision_users,
                "default_app_roles": sso_config.default_app_roles or {},
                "allowed_domains": sso_config.allowed_domains or [],
            }
        }

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "conflict", "message": "SSO configuration already exists"})
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Database constraint violation"})


@router.post("/api/platform/organizations/{organization_id}/sso/test", response_model=SSOTestResponse, summary="Test sso config")
def test_sso_config(
    organization_id: UUID,
    body: SSOTestBody = None,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(_admin_db_dep),  # BYPASSRLS owner: cross-org platform-admin (issue #75)
):
    """Test SSO configuration (validate certificate, check connectivity)."""
    org = db.query(Organization).filter_by(organization_id=organization_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    data = body.model_dump(exclude_unset=True) if body else {}

    if data:
        idp_certificate = data.get("idp_certificate")
        idp_sso_url = data.get("idp_sso_url")
    else:
        sso_config = db.query(SSOConfiguration).filter_by(
            organization_id=organization_id
        ).first()
        if not sso_config:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "SSO configuration not found"})
        idp_certificate = sso_config.idp_certificate
        idp_sso_url = sso_config.idp_sso_url

    details = {"certificate_valid": False, "certificate_expires": None, "certificate_error": None, "idp_reachable": None}
    errors = []

    if idp_certificate:
        try:
            from cryptography import x509
            cert_data = idp_certificate.strip()
            if not cert_data.startswith("-----BEGIN CERTIFICATE-----"):
                cert_data = f"-----BEGIN CERTIFICATE-----\n{cert_data}\n-----END CERTIFICATE-----"
            cert = x509.load_pem_x509_certificate(cert_data.encode())
            details["certificate_valid"] = True
            details["certificate_expires"] = cert.not_valid_after_utc.isoformat()
            if cert.not_valid_after_utc < datetime.now(timezone.utc):
                details["certificate_error"] = "Certificate has expired"
                errors.append("Certificate has expired")
        except Exception as cert_error:
            details["certificate_valid"] = False
            details["certificate_error"] = str(cert_error)
            errors.append(f"Certificate validation failed: {cert_error}")
    else:
        details["certificate_error"] = "No certificate provided"
        errors.append("No certificate provided")

    if idp_sso_url:
        try:
            import urllib.request
            import urllib.error
            import ssl
            req = urllib.request.Request(idp_sso_url, method='HEAD')
            context = ssl.create_default_context()
            with urllib.request.urlopen(req, timeout=10, context=context) as response:
                details["idp_reachable"] = response.status < 500
        except urllib.error.HTTPError as e:
            details["idp_reachable"] = e.code < 500
        except Exception as url_error:
            details["idp_reachable"] = False
            errors.append(f"Could not reach IdP SSO URL: {url_error}")

    success = details["certificate_valid"] and not errors

    if success:
        return {"success": True, "message": "SSO configuration is valid", "details": details}
    else:
        return JSONResponse(content={"success": False, "message": "; ".join(errors) if errors else "Validation failed", "details": details}, status_code=400)


@router.delete("/api/platform/organizations/{organization_id}/sso", response_model=MessageResponse, summary="Delete sso config")
def delete_sso_config(
    organization_id: UUID,
    auth: AuthContext = Depends(require_platform_admin),
    _mfa: AuthContext = Depends(require_fresh_mfa()),
    db: Session = Depends(_admin_db_dep),  # BYPASSRLS owner: cross-org platform-admin (issue #75)
):
    """Delete SSO configuration for an organization."""
    try:
        org = db.query(Organization).filter_by(organization_id=organization_id).first()
        if not org:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

        sso_config = db.query(SSOConfiguration).filter_by(
            organization_id=organization_id
        ).first()

        if not sso_config:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "SSO configuration not found"})

        db.delete(sso_config)
        db.commit()

        logger.info(f"Deleted SSO config for org {organization_id}")

        return {"message": "SSO configuration deleted"}

    except IntegrityError as e:
        db.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail={"code": "conflict", "message": "Resource already exists"})
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Database constraint violation"})










# ============================================================================
# Entity Audit Logging API
# ============================================================================


@router.get("/api/platform/audit/entities", response_model=EntityAuditEventsResponse, summary="List entity audit events")
def list_entity_audit_events(
    organization_id: str = Query(None),
    entity_type: str = Query(None),
    entity_id: str = Query(None),
    changed_by: str = Query(None),
    change_type: str = Query(None),
    since: str = Query(None),
    until: str = Query(None),
    limit: int = Query(50),
    offset: int = Query(0),
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """List entity audit events with filtering."""
    try:
        limit = min(int(limit), 200)
        offset = int(offset)

        # Build query
        query = db.query(EntityAuditEvent)

        if organization_id:
            query = query.filter(EntityAuditEvent.organization_id == organization_id)

        if entity_type:
            query = query.filter(EntityAuditEvent.entity_type == entity_type)

        if entity_id:
            query = query.filter(EntityAuditEvent.entity_id == entity_id)

        if changed_by:
            query = query.filter(EntityAuditEvent.changed_by == changed_by)

        if change_type:
            query = query.filter(EntityAuditEvent.change_type == change_type)

        if since:
            since_dt = datetime.fromisoformat(_normalize_iso(since))
            query = query.filter(EntityAuditEvent.changed_at >= since_dt)

        if until:
            until_dt = datetime.fromisoformat(_normalize_iso(until))
            query = query.filter(EntityAuditEvent.changed_at <= until_dt)

        # Get total count
        total = query.count()

        # Apply ordering and pagination
        events = (
            query
            .order_by(desc(EntityAuditEvent.changed_at))
            .limit(limit)
            .offset(offset)
            .all()
        )

        return {
            "items": [
                {
                    "event_id": str(e.event_id),
                    "organization_id": str(e.organization_id),
                    "entity_type": e.entity_type,
                    "entity_id": str(e.entity_id),
                    "entity_display_key": e.entity_display_key,
                    "change_type": e.change_type,
                    "changed_at": e.changed_at.isoformat() if e.changed_at else None,
                    "changed_by": str(e.changed_by) if e.changed_by else None,
                    "changed_by_name": e.changed_by_name,
                    "changed_by_email": e.changed_by_email,
                    "changed_fields": e.changed_fields,
                    "summary": e.summary,
                }
                for e in events
            ],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": f"Invalid parameter: {e}"})


# NOTE: /audit/entities/stats MUST be declared before /audit/entities/{event_id}.
# FastAPI matches routes in declaration order; if the `{event_id}` route is first,
# "stats" is matched as a UUID-typed path param, fails validation, and returns 422
# before reaching this handler.
@router.get("/api/platform/audit/entities/stats", response_model=EntityAuditStatsResponse, summary="Get entity audit stats")
def get_entity_audit_stats(
    organization_id: str = Query(None),
    since: str = Query(None),
    until: str = Query(None),
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Get summary statistics for entity audit events."""
    try:
        # Base query
        base_query = db.query(EntityAuditEvent)

        if organization_id:
            base_query = base_query.filter(EntityAuditEvent.organization_id == organization_id)

        if since:
            since_dt = datetime.fromisoformat(_normalize_iso(since))
            base_query = base_query.filter(EntityAuditEvent.changed_at >= since_dt)

        if until:
            until_dt = datetime.fromisoformat(_normalize_iso(until))
            base_query = base_query.filter(EntityAuditEvent.changed_at <= until_dt)

        # Total events
        total_events = base_query.count()

        # By entity type
        entity_type_counts = dict(
            db.query(
                EntityAuditEvent.entity_type,
                func.count(EntityAuditEvent.event_id)
            )
            .filter(EntityAuditEvent.event_id.in_(base_query.with_entities(EntityAuditEvent.event_id)))
            .group_by(EntityAuditEvent.entity_type)
            .all()
        )

        # By change type
        change_type_counts = dict(
            db.query(
                EntityAuditEvent.change_type,
                func.count(EntityAuditEvent.event_id)
            )
            .filter(EntityAuditEvent.event_id.in_(base_query.with_entities(EntityAuditEvent.event_id)))
            .group_by(EntityAuditEvent.change_type)
            .all()
        )

        # By organization (top 20)
        org_counts = (
            db.query(
                EntityAuditEvent.organization_id,
                Organization.name,
                func.count(EntityAuditEvent.event_id).label("count")
            )
            .join(Organization, EntityAuditEvent.organization_id == Organization.organization_id)
            .filter(EntityAuditEvent.event_id.in_(base_query.with_entities(EntityAuditEvent.event_id)))
            .group_by(EntityAuditEvent.organization_id, Organization.name)
            .order_by(desc("count"))
            .limit(20)
            .all()
        )

        # By user (top 20)
        user_counts = (
            db.query(
                EntityAuditEvent.changed_by,
                EntityAuditEvent.changed_by_name,
                EntityAuditEvent.changed_by_email,
                func.count(EntityAuditEvent.event_id).label("count")
            )
            .filter(
                EntityAuditEvent.event_id.in_(base_query.with_entities(EntityAuditEvent.event_id)),
                EntityAuditEvent.changed_by.isnot(None)
            )
            .group_by(
                EntityAuditEvent.changed_by,
                EntityAuditEvent.changed_by_name,
                EntityAuditEvent.changed_by_email
            )
            .order_by(desc("count"))
            .limit(20)
            .all()
        )

        # Time-based stats
        now = datetime.now(timezone.utc)
        last_24h = now - timedelta(hours=24)
        last_7d = now - timedelta(days=7)
        last_30d = now - timedelta(days=30)

        events_last_24h = base_query.filter(EntityAuditEvent.changed_at >= last_24h).count()
        events_last_7d = base_query.filter(EntityAuditEvent.changed_at >= last_7d).count()
        events_last_30d = base_query.filter(EntityAuditEvent.changed_at >= last_30d).count()

        return {
            "stats": {
                "total_events": total_events,
                "by_entity_type": entity_type_counts,
                "by_change_type": change_type_counts,
                "by_organization": [
                    {
                        "organization_id": str(org_id),
                        "name": name,
                        "count": count
                    }
                    for org_id, name, count in org_counts
                ],
                "by_user": [
                    {
                        "user_id": str(user_id) if user_id else None,
                        "name": name,
                        "email": email,
                        "count": count
                    }
                    for user_id, name, email, count in user_counts
                ],
                "events_last_24h": events_last_24h,
                "events_last_7d": events_last_7d,
                "events_last_30d": events_last_30d,
            }
        }

    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": f"Invalid parameter: {e}"})


@router.get("/api/platform/audit/entities/{event_id}", response_model=EntityAuditEventDetailResponse, summary="Get entity audit event")
def get_entity_audit_event(
    event_id: UUID,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Get a single entity audit event with all field diffs."""
    event = db.query(EntityAuditEvent).filter_by(event_id=event_id).first()

    if not event:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Event not found"})

    # Get field diffs
    diffs = (
        db.query(EntityAuditFieldDiff)
        .filter_by(event_id=event_id)
        .order_by(EntityAuditFieldDiff.field_name)
        .all()
    )

    return {
        "event": {
            "event_id": str(event.event_id),
            "organization_id": str(event.organization_id),
            "entity_type": event.entity_type,
            "entity_id": str(event.entity_id),
            "entity_display_key": event.entity_display_key,
            "change_type": event.change_type,
            "changed_at": event.changed_at.isoformat() if event.changed_at else None,
            "changed_by": str(event.changed_by) if event.changed_by else None,
            "changed_by_name": event.changed_by_name,
            "changed_by_email": event.changed_by_email,
            "request_path": event.request_path,
            "request_method": event.request_method,
            "ip_address": event.ip_address,
            "user_agent": event.user_agent,
            "changed_fields": event.changed_fields,
            "summary": event.summary,
            "field_diffs": [
                {
                    "diff_id": str(d.diff_id),
                    "field_name": d.field_name,
                    "old_value": d.old_value,
                    "new_value": d.new_value,
                }
                for d in diffs
            ],
        }
    }


@router.get("/api/platform/audit/entities/by-entity/{entity_type}/{entity_id}", response_model=EntityAuditHistoryResponse, summary="Get entity audit history")
def get_entity_audit_history(
    entity_type: str,
    entity_id: UUID,
    include_diffs: str = Query("false"),
    limit: int = Query(100),
    offset: int = Query(0),
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Get full audit history for a specific entity."""
    try:
        include_diffs_flag = include_diffs.lower() == "true"
        limit = min(int(limit), 500)
        offset = int(offset)

        # Build query
        query = (
            db.query(EntityAuditEvent)
            .filter(
                EntityAuditEvent.entity_type == entity_type,
                EntityAuditEvent.entity_id == entity_id,
            )
        )

        # Get total count
        total = query.count()

        # Apply ordering and pagination
        events = (
            query
            .order_by(desc(EntityAuditEvent.changed_at))
            .limit(limit)
            .offset(offset)
            .all()
        )

        # Build response
        events_data = []
        for e in events:
            event_dict = {
                "event_id": str(e.event_id),
                "organization_id": str(e.organization_id),
                "entity_display_key": e.entity_display_key,
                "change_type": e.change_type,
                "changed_at": e.changed_at.isoformat() if e.changed_at else None,
                "changed_by": str(e.changed_by) if e.changed_by else None,
                "changed_by_name": e.changed_by_name,
                "changed_by_email": e.changed_by_email,
                "changed_fields": e.changed_fields,
                "summary": e.summary,
            }

            if include_diffs_flag:
                diffs = (
                    db.query(EntityAuditFieldDiff)
                    .filter_by(event_id=e.event_id)
                    .order_by(EntityAuditFieldDiff.field_name)
                    .all()
                )
                event_dict["field_diffs"] = [
                    {
                        "diff_id": str(d.diff_id),
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

    except ValueError as e:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": f"Invalid parameter: {e}"})


# ============================================================================
# RLS Canary Health Check
# ============================================================================

# Sample of RLS-protected tables to probe (one per schema).
_RLS_CANARY_TABLES = [
    ("collections", "collection_objects"),
    ("flow", "pipelines"),
    ("media", "media"),
    ("public", "audit_logs"),
]


@router.get("/api/platform/health/rls", summary="Rls canary check")
def rls_canary_check(
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """
    Runtime self-check that Row-Level Security is enforced.

    Returns a structured report verifying:
    1. The DB session role is madrona_app (not the owner role)
    2. row_security is enabled at the session level
    3. Querying RLS-protected tables without org context returns 0 rows
    4. The current_org_id() function returns NULL when no context is set
    """
    dialect = db.bind.dialect.name if db.bind else ""
    if dialect != "postgresql":
        return {
            "status": "skipped",
            "reason": f"RLS checks only apply to PostgreSQL (current: {dialect})",
        }

    checks = []
    all_passed = True

    # 1. Verify session role
    try:
        result = db.execute(text("SELECT current_user")).scalar()
        passed = result == "madrona_app"
        checks.append({
            "check": "session_role",
            "passed": passed,
            "expected": "madrona_app",
            "actual": result,
        })
        if not passed:
            all_passed = False
    except Exception as e:
        checks.append({"check": "session_role", "passed": False, "error": sanitize_error_message(e)})
        all_passed = False

    # 2. Verify row_security is on
    try:
        result = db.execute(text("SHOW row_security")).scalar()
        passed = result == "on"
        checks.append({
            "check": "row_security_setting",
            "passed": passed,
            "expected": "on",
            "actual": result,
        })
        if not passed:
            all_passed = False
    except Exception as e:
        checks.append({"check": "row_security_setting", "passed": False, "error": sanitize_error_message(e)})
        all_passed = False

    # 3. Verify current_org_id() returns NULL when no context is set
    try:
        # Clear any RLS context from the auth decorator
        db.execute(text("SET LOCAL app.current_org_id = ''"))
        result = db.execute(text("SELECT current_org_id()")).scalar()
        passed = result is None
        checks.append({
            "check": "current_org_id_null_without_context",
            "passed": passed,
            "expected": None,
            "actual": str(result) if result else None,
        })
        if not passed:
            all_passed = False
    except Exception as e:
        checks.append({
            "check": "current_org_id_null_without_context",
            "passed": False,
            "error": sanitize_error_message(e),
        })
        all_passed = False

    # 4. Verify RLS-protected tables return 0 rows without org context
    for schema, table in _RLS_CANARY_TABLES:
        fqn = f"{schema}.{table}"
        check_name = f"rls_zero_rows_{schema}_{table}"
        try:
            db.execute(text("SET LOCAL app.current_org_id = ''"))
            row_count = db.execute(
                text(f"SELECT count(*) FROM {fqn}")
            ).scalar()
            passed = row_count == 0
            checks.append({
                "check": check_name,
                "passed": passed,
                "expected": 0,
                "actual": row_count,
            })
            if not passed:
                all_passed = False
        except Exception as e:
            error_msg = str(e)
            # Table might not exist yet (e.g., fresh DB) — not a failure
            if "does not exist" in error_msg:
                checks.append({
                    "check": check_name,
                    "passed": True,
                    "skipped": True,
                    "reason": "table does not exist",
                })
            else:
                checks.append({"check": check_name, "passed": False, "error": sanitize_error_message(e)})
                all_passed = False

    status_code = 200 if all_passed else 503
    return JSONResponse(content={
        "status": "healthy" if all_passed else "degraded",
        "checks": checks,
        "total": len(checks),
        "passed": sum(1 for c in checks if c["passed"]),
        "failed": sum(1 for c in checks if not c["passed"]),
    }, status_code=status_code)


# ============================================================================
# Permission Management
# ============================================================================


@router.get("/api/platform/permissions-matrix", response_model=PermissionsMatrixResponse, summary="Get permissions matrix")
def get_permissions_matrix(
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """
    Return all roles, permissions (grouped by scope), and current assignments.
    Used by the Permission Management admin page.
    """
    # All roles ordered by a sensible hierarchy
    role_order = ['platform_admin', 'admin', 'registrar', 'curator', 'publisher', 'viewer']
    roles = db.query(Role).all()
    roles_sorted = sorted(roles, key=lambda r: (
        role_order.index(r.role_key) if r.role_key in role_order else 999
    ))

    # All permissions ordered by scope then action
    permissions = (
        db.query(PermissionModel)
        .order_by(PermissionModel.scope, PermissionModel.action)
        .all()
    )

    # All role-permission mappings
    role_perms = db.query(RolePermission).all()
    # Build lookup: permission_id -> set of role_keys
    perm_role_map: dict[str, set[str]] = {}
    role_id_to_key = {str(r.role_id): r.role_key for r in roles}
    for rp in role_perms:
        pid = str(rp.permission_id)
        rkey = role_id_to_key.get(str(rp.role_id))
        if rkey:
            perm_role_map.setdefault(pid, set()).add(rkey)

    # Group permissions by scope
    scopes_dict: dict[str, list] = {}
    for p in permissions:
        pid = str(p.permission_id)
        entry = {
            "permission_id": pid,
            "permission_key": p.permission_key,
            "display_name": p.display_name,
            "description": p.description or "",
            "roles": sorted(perm_role_map.get(pid, set())),
        }
        scopes_dict.setdefault(p.scope, []).append(entry)

    scopes = [
        {"scope": scope, "permissions": perms}
        for scope, perms in scopes_dict.items()
    ]

    return {
        "roles": [
            {
                "role_id": str(r.role_id),
                "role_key": r.role_key,
                "display_name": r.display_name,
            }
            for r in roles_sorted
        ],
        "scopes": scopes,
    }


@router.post("/api/platform/role-permissions", response_model=OkResponse, summary="Add role permission")
def add_role_permission(
    body: RolePermissionBody,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Grant a permission to a role."""
    role_id = body.role_id
    permission_id = body.permission_id

    if not role_id or not permission_id:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "role_id and permission_id are required"})

    rp = RolePermission(role_id=role_id, permission_id=permission_id)
    db.add(rp)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # Already exists — not an error
    return {"ok": True}


@router.delete("/api/platform/role-permissions", response_model=OkResponse, summary="Remove role permission")
def remove_role_permission(
    body: RolePermissionBody,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """
    Revoke a permission from a role.

    Safety: prevents removing platform.admin from platform_admin role.
    """
    role_id = body.role_id
    permission_id = body.permission_id

    if not role_id or not permission_id:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "role_id and permission_id are required"})

    # Safety check: prevent removing platform.admin from platform_admin
    role = db.get(Role, role_id)
    perm = db.get(PermissionModel, permission_id)

    if role and perm and role.role_key == "platform_admin" and perm.permission_key == "platform.admin":
        raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "Cannot remove platform.admin permission from platform_admin role"})

    rp = db.get(RolePermission, (role_id, permission_id))
    if rp:
        db.delete(rp)
        db.commit()

    return {"ok": True}


# ============================================================================
# Newsletter Subscribers (DynamoDB)
# ============================================================================



