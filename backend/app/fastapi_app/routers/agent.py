"""
Agent chat API endpoints (FastAPI).

Staff endpoints (authenticated):
  POST   /api/organizations/{organization_id}/agent/conversations
  GET    /api/organizations/{organization_id}/agent/conversations
  GET    /api/organizations/{organization_id}/agent/conversations/{conversation_id}/messages
  POST   /api/organizations/{organization_id}/agent/conversations/{conversation_id}/chat
  DELETE /api/organizations/{organization_id}/agent/conversations/{conversation_id}

Visitor endpoints (public):
  POST   /api/guide/{org_slug}/conversations
  POST   /api/guide/{org_slug}/conversations/{conversation_id}/chat
  DELETE /api/guide/{org_slug}/visitor-data
"""

import logging
import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.config import get_settings
from app.database import get_db
from app.fastapi_app.dependencies.auth import (
    AuthContext,
    require_auth,
    require_permission,
    check_permission_for_session,
)
from app.fastapi_app.schemas.agent import (
    CreateStaffConversationBody,
    CreateVisitorConversationBody,
    GDPRDeleteBody,
    StaffChatBody,
    StaffConversationListResponse,
    StaffConversationOut,
    StaffMessagesResponse,
    VisitorChatBody,
)
from app.fastapi_app.schemas.common import DeletedResponse
from app.models import AgentPlan, AgentPlanStep, Conversation, Organization
from app.permissions import Permission
from app.services.agent_plan_service import PlanService
from app.services.agent_retention import gdpr_delete_visitor_data, serialize_message
from app.services.agent_service import get_agent_service
from app.services.guide_usage import get_widget_access
from app.services.rate_limiter import RateLimiter
from app.services.rls import set_rls_context_for_session
from app.services.visitor_service import get_visitor_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["agent"])

INPUT_LIMIT_STAFF = 4000
INPUT_LIMIT_VISITOR = 2000

VISITOR_SESSION_COOKIE = "madrona_visitor_session"
VISITOR_SESSION_MAX_AGE = 86400  # 24 hours

# ═══════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════

_visitor_limiter: RateLimiter | None = None


def _get_visitor_limiter() -> RateLimiter:
    global _visitor_limiter
    if _visitor_limiter is None:
        settings = get_settings()
        _visitor_limiter = RateLimiter(
            max_requests=settings.agent_visitor_rate_limit,
            window_seconds=60,
        )
    return _visitor_limiter


def _check_agent_enabled() -> None:
    """Raise 503 if agent feature is disabled."""
    if not get_settings().agent_enabled:
        raise HTTPException(
            status_code=503,
            detail={"code": "feature_disabled", "message": "Agent is not enabled"},
        )


def _check_visitor_rate_limit(request: Request) -> None:
    """Check rate limit for visitor endpoints. Raises 429 if exceeded."""
    client_ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
    if "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()
    limiter = _get_visitor_limiter()
    if not limiter.allow(client_ip, "guide"):
        raise HTTPException(
            status_code=429,
            detail={"error": "Rate limit exceeded"},
            headers={"Retry-After": "60"},
        )


def _check_widget_access(organization_id, db: Session) -> None:
    """Enforce the per-org visitor-widget gate, then the monthly cap.

    Gate before cap: 403 when the org hasn't enabled the widget (config
    ``widget_enabled``, absent = off), 429 when enabled but over its monthly
    ``max_widget_queries``. ``max_queries=None`` on an ENABLED org means
    unmetered (platform/enterprise). The GDPR delete endpoint deliberately
    does not call this — data-rights requests must work while the widget is
    dark.
    """
    access = get_widget_access(organization_id, db)
    if not access.enabled:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "widget_not_enabled",
                "message": "The visitor guide is not enabled for this collection.",
            },
        )
    if access.over_cap:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "widget_limit_reached",
                "message": "This museum has reached its monthly Guide widget limit.",
            },
        )


def _get_org_by_slug(db: Session, slug: str) -> Organization | None:
    """Resolve an active org by public slug for anonymous visitor requests.

    Must run BEFORE any RLS context exists, and the organizations table is
    RLS-protected — the app role sees zero rows without a context (the
    chicken-and-egg of anonymous slug resolution). Try the request session
    first (covers tests and session-unified setups), then fall back to a
    short-lived owner session, mirroring how the public discover router
    resolves orgs (it uses get_admin_db throughout).
    """
    org = db.query(Organization).filter(
        Organization.slug == slug,
        Organization.status == "active",
    ).first()
    if org:
        return org

    import types
    from app.tasks.rls_helpers import admin_db_session
    try:
        with admin_db_session() as admin_db:
            row = admin_db.query(
                Organization.organization_id,
                Organization.slug,
                Organization.status,
            ).filter(
                Organization.slug == slug,
                Organization.status == "active",
            ).first()
    except Exception:
        logger.exception("Owner-session org lookup failed for slug %s", slug)
        return None
    if not row:
        return None
    # Detached, read-only view — visitor endpoints only use organization_id
    return types.SimpleNamespace(
        organization_id=row.organization_id,
        slug=row.slug,
        status=row.status,
    )


def _mint_session_token() -> str:
    """Generate a cryptographically secure session token."""
    return secrets.token_urlsafe(32)


def _validate_session_cookie(request: Request, body_session_id: str) -> bool:
    """Double-submit validation: body token must match cookie."""
    cookie_val = request.cookies.get(VISITOR_SESSION_COOKIE)
    if not cookie_val:
        return False
    return cookie_val == body_session_id


# ═══════════════════════════════════════════════════════════════════
# Staff endpoints (authenticated)
# ═══════════════════════════════════════════════════════════════════


@router.post("/api/organizations/{organization_id}/agent/conversations", status_code=201, response_model=StaffConversationOut, summary="Create staff conversation")
def create_staff_conversation(
    organization_id: UUID,
    body: CreateStaffConversationBody | None = None,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Create staff conversation."""
    _check_agent_enabled()

    data = body or CreateStaffConversationBody()
    service = get_agent_service(session=db)

    conv = service.create_conversation(
        organization_id=organization_id,
        persona="staff",
        user_id=auth.user_id,
        context_entity_type=data.context_entity_type,
        context_entity_id=data.context_entity_id,
    )

    return {
        "conversation_id": str(conv.conversation_id),
        "persona": conv.persona,
        "title": conv.title,
        "created_at": conv.created_at.isoformat(),
    }


@router.get("/api/organizations/{organization_id}/agent/conversations", response_model=StaffConversationListResponse, summary="List staff conversations")
def list_staff_conversations(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List staff conversations."""
    _check_agent_enabled()

    service = get_agent_service(session=db)
    convs = service.list_conversations(
        organization_id=organization_id,
        user_id=auth.user_id,
    )

    return {
        "conversations": [
            {
                "conversation_id": str(c.conversation_id),
                "title": c.title,
                "persona": c.persona,
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
            }
            for c in convs
        ]
    }


@router.get("/api/organizations/{organization_id}/agent/conversations/{conversation_id}/messages", response_model=StaffMessagesResponse, summary="Get staff messages")
def get_staff_messages(
    organization_id: UUID,
    conversation_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get staff messages."""
    _check_agent_enabled()

    service = get_agent_service(session=db)
    conv = service.get_conversation(
        conversation_id=conversation_id,
        organization_id=organization_id,
        user_id=auth.user_id,
    )
    if not conv:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Conversation not found"},
        )

    messages = service.get_messages(conversation_id, organization_id)

    # Determine requester role for access control on sensitive fields
    is_owner = check_permission_for_session(
        db, auth.user_id, organization_id, Permission.ORG_MANAGE_SETTINGS,
    )
    requester_role = "owner" if is_owner else "member"

    return {
        "messages": [
            serialize_message(m, requester_role=requester_role)
            for m in messages
        ]
    }


@router.post("/api/organizations/{organization_id}/agent/conversations/{conversation_id}/chat", summary="Staff chat")
def staff_chat(
    organization_id: UUID,
    conversation_id: UUID,
    body: StaffChatBody,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Staff chat."""
    _check_agent_enabled()

    service = get_agent_service(session=db)
    conv = service.get_conversation(
        conversation_id=conversation_id,
        organization_id=organization_id,
        user_id=auth.user_id,
    )
    if not conv:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Conversation not found"},
        )

    message = body.message.strip()
    # model_dump with by_alias=False returns snake_case keys — the service
    # formatter accepts either. Keep camelCase here because Pydantic stored
    # the original alias values when populate_by_name is on.
    page_context_payload = (
        body.page_context.model_dump(by_alias=True, exclude_none=True)
        if body.page_context is not None
        else None
    )

    def generate():
        try:
            yield from service.stream_response(
                conv, message, page_context=page_context_payload
            )
        except Exception:
            logger.exception("Agent stream error")
            yield 'event: error\ndata: {"error": "Internal error"}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _serialize_step_metric(metric, weight: float) -> dict:
    """§2A effort telemetry embedded on a step. weight is normalized within the
    plan (computed in _serialize_plan). Effort fields are passed through as-is —
    NULL means "no measure / no AI cost", never coerced to 0."""
    return {
        "input_tokens": metric.input_tokens,
        "output_tokens": metric.output_tokens,
        "llm_rounds": metric.llm_rounds,
        "tool_calls": metric.tool_calls,
        "latency_ms": metric.latency_ms,
        "delegation_depth": metric.delegation_depth,
        "cost_estimate_usd": (
            float(metric.cost_estimate_usd)
            if metric.cost_estimate_usd is not None else None
        ),
        "raw_effort": (
            float(metric.raw_effort) if metric.raw_effort is not None else None
        ),
        "weight": weight,
        "model_id": metric.model_id,
        "attempt": metric.attempt,
    }


def _serialize_plan_step(
    step: AgentPlanStep, metric=None, weight: float = 0.0, draft_facts: dict | None = None,
) -> dict:
    data = {
        "step_id": str(step.step_id),
        "idx": step.idx,
        "kind": step.kind,
        "description": step.description,
        "tool": step.tool,
        "persona": step.persona,
        "status": step.status,
        "wait_for": step.wait_for,
        "error": step.error,
        # Branching: which path a step belongs to (None = unconditional); a
        # decision step's selectable options; and the phase-group label (UI
        # grouping; null = ungrouped → flat rail).
        "branch": step.branch,
        "phase": step.phase,
        "options": (
            (step.args or {}).get("options") if step.kind == "decision" else None
        ),
        # Absolute timestamps — the FE renders relative time so it stays fresh
        # across polls (never preformatted server-side).
        "started_at": step.started_at.isoformat() if step.started_at else None,
        "completed_at": step.completed_at.isoformat() if step.completed_at else None,
        # Facts the step produced (a draft it proposed, a gate outcome). The BE
        # emits facts; the FE owns routing — it links to the live entity if
        # applied_entity_id is present, else the draft. This self-heals: a draft
        # applied after this serialization gets the entity link on the next poll.
        "result_facts": _step_result_facts(step, draft_facts),
        # §2A: effort telemetry (null until the step has run; awaits never have it).
        "effort": _serialize_step_metric(metric, weight) if metric is not None else None,
    }
    return data


def _step_result_facts(step: AgentPlanStep, draft_facts: dict | None) -> dict | None:
    """Curated, link-able facts from a step's result + the draft it produced.

    draft_id/entity_type come from the step result; applied_entity_id +
    draft_status are enriched from the live draft (so they self-heal once the
    draft is approved/applied); outcome/reviewed_by/chosen describe a resolved
    gate. Returns None when there's nothing to show yet."""
    res = step.result if isinstance(step.result, dict) else {}
    facts: dict = {}
    draft_id = res.get("draft_id")
    if draft_id:
        facts["draft_id"] = str(draft_id)
    if res.get("entity_type"):
        facts["entity_type"] = res["entity_type"]
    if res.get("applied_entity_id"):
        facts["applied_entity_id"] = str(res["applied_entity_id"])
    if res.get("outcome"):
        facts["outcome"] = res["outcome"]
    if res.get("reviewed_by"):
        facts["reviewed_by"] = str(res["reviewed_by"])
    if res.get("chosen"):
        facts["chosen"] = res["chosen"]
    # Self-heal from the live draft (propose steps): applied_entity_id appears
    # once the draft is applied; draft_status reflects its current state.
    if facts.get("draft_id") and draft_facts:
        d = draft_facts.get(facts["draft_id"])
        if d:
            facts.setdefault("entity_type", d.get("entity_type"))
            facts["draft_status"] = d.get("status")
            if d.get("applied_entity_id"):
                facts.setdefault("applied_entity_id", str(d["applied_entity_id"]))
    return facts or None


def _draft_facts_for_plan(session, steps) -> dict:
    """One batched query → {draft_id: {applied_entity_id, status, entity_type}}
    for every draft a plan's steps produced. Lets the step serializer self-heal
    artifact links without an N+1."""
    if session is None:
        return {}
    from app.models import AgentDraft

    draft_ids = []
    for s in steps:
        res = s.result if isinstance(s.result, dict) else {}
        if res.get("draft_id"):
            draft_ids.append(res["draft_id"])
    if not draft_ids:
        return {}
    rows = (
        session.query(
            AgentDraft.draft_id, AgentDraft.applied_entity_id,
            AgentDraft.status, AgentDraft.entity_type,
        )
        .filter(AgentDraft.draft_id.in_(draft_ids))
        .all()
    )
    return {
        str(r.draft_id): {
            "applied_entity_id": r.applied_entity_id,
            "status": r.status,
            "entity_type": r.entity_type,
        }
        for r in rows
    }


def _latest_metrics_for_plan(session, plan_id):
    """Latest attempt's metric per step for a plan → {step_id: metric}."""
    from app.models import AgentPlanStepMetric

    rows = (
        session.query(AgentPlanStepMetric)
        .filter(AgentPlanStepMetric.plan_id == plan_id)
        .order_by(AgentPlanStepMetric.attempt.asc())
        .all()
    )
    # asc order → later attempts overwrite earlier ones, leaving the latest.
    return {r.step_id: r for r in rows}


def _serialize_plan(plan: AgentPlan, *, include_steps: bool = False) -> dict:
    steps = sorted(plan.steps, key=lambda s: s.idx)
    # The step a user can act on right now (an approval/form await parked on
    # awaiting_user). Lets the Plans page badge "needs you" and pick the
    # right action without re-deriving it client-side.
    awaiting_step = next(
        (
            s for s in steps
            if s.status == "awaiting_user"
            and (
                s.kind == "decision"
                or (
                    isinstance(s.wait_for, dict)
                    and s.wait_for.get("kind") in ("approval_request", "form_submission")
                )
            )
        ),
        None,
    )
    data = {
        "plan_id": str(plan.plan_id),
        "conversation_id": str(plan.conversation_id),
        "goal": plan.goal,
        "status": plan.status,
        "step_count": len(steps),
        "last_error": plan.last_error,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
        "updated_at": plan.updated_at.isoformat() if plan.updated_at else None,
        "started_at": plan.started_at.isoformat() if plan.started_at else None,
        "completed_at": plan.completed_at.isoformat() if plan.completed_at else None,
        "awaits_user": awaiting_step is not None,
        "awaiting_kind": (
            None if awaiting_step is None
            else "decision" if awaiting_step.kind == "decision"
            else awaiting_step.wait_for.get("kind")
        ),
        # The step the user acts on (needed for the form-submitted POST without
        # fetching full detail). None unless a user-actionable await is parked.
        "awaiting_step_id": (
            str(awaiting_step.step_id) if awaiting_step else None
        ),
    }
    if include_steps:
        # §2A/§2D: embed each step's latest effort metric, with weight
        # normalized within the plan (where did the AI work hardest?).
        from sqlalchemy.orm import object_session
        from app.services.agent_plan_effort import weight as _weight

        session = object_session(plan)
        metrics = (
            _latest_metrics_for_plan(session, plan.plan_id) if session is not None else {}
        )
        plan_max_raw = max(
            (float(m.raw_effort) for m in metrics.values() if m.raw_effort is not None),
            default=0.0,
        )
        draft_facts = _draft_facts_for_plan(session, steps)
        data["steps"] = [
            _serialize_plan_step(
                s,
                metric=metrics.get(s.step_id),
                weight=(
                    _weight(float(metrics[s.step_id].raw_effort or 0), plan_max_raw)
                    if s.step_id in metrics else 0.0
                ),
                draft_facts=draft_facts,
            )
            for s in steps
        ]
        # Plan-level effort rollup for the summary header (§2E).
        data["effort_summary"] = _plan_effort_summary(metrics.values())
    return data


def _plan_effort_summary(metrics) -> dict:
    """Plan-wide rollup for the summary header: totals across all step metrics."""
    metrics = list(metrics)
    total_in = sum(m.input_tokens or 0 for m in metrics)
    total_out = sum(m.output_tokens or 0 for m in metrics)
    total_cost = sum(float(m.cost_estimate_usd or 0) for m in metrics)
    return {
        "total_input_tokens": total_in,
        "total_output_tokens": total_out,
        "total_tokens": total_in + total_out,
        "total_llm_rounds": sum(m.llm_rounds or 0 for m in metrics),
        "total_tool_calls": sum(m.tool_calls or 0 for m in metrics),
        "total_latency_ms": sum(m.latency_ms or 0 for m in metrics),
        "specialist_steps": sum(1 for m in metrics if (m.delegation_depth or 0) > 0),
        "cost_estimate_usd": round(total_cost, 6) if total_cost else None,
    }


@router.get(
    "/api/organizations/{organization_id}/agent/plans",
    summary="List the user's agent plans",
)
def list_agent_plans(
    organization_id: UUID,
    status: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """The requesting user's agent plans in this org, newest first.

    User-scoped via conversation ownership — this is the user's own plan
    inbox, mirroring the staff-conversations list. Optional ?status= filter
    (pending|running|awaiting|completed|failed|cancelled).
    """
    _check_agent_enabled()

    query = (
        db.query(AgentPlan)
        .join(
            Conversation,
            Conversation.conversation_id == AgentPlan.conversation_id,
        )
        .filter(
            AgentPlan.organization_id == organization_id,
            Conversation.user_id == auth.user_id,
        )
    )
    if status:
        query = query.filter(AgentPlan.status == status)

    plans = query.order_by(AgentPlan.created_at.desc()).all()
    return {"plans": [_serialize_plan(p) for p in plans]}


def _serialize_template(t) -> dict:
    """Serialize a plan template for the deterministic 'Start procedure' UI."""
    return {
        "template_id": t.template_id,
        "title": t.title,
        "goal": t.goal,
        "procedure": t.procedure,
        "nav_item": t.nav_item,
        "params": [
            {
                "key": p.key,
                "label": p.label,
                "type": p.type,
                "required": p.required,
                "enum_options": list(p.enum_options),
                "from_context": p.from_context,
                "entity_kind": p.entity_kind,
                "help_text": p.help_text,
            }
            for p in t.params
        ],
        # Static step shape for the launch preview (kind/persona/description are
        # literal; only args carry Param placeholders, which we don't expose).
        "steps": [
            {"kind": s.kind, "persona": s.persona, "description": s.description}
            for s in t.steps
        ],
    }


@router.get(
    "/api/organizations/{organization_id}/agent/plan-templates",
    summary="List startable plan templates (optionally for one nav surface)",
)
def list_plan_templates(
    organization_id: UUID,
    nav_item: str | None = None,
    requires_context: str | None = None,
    no_context: bool = False,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """The catalog of procedures a user can start deterministically, filtered to
    the surface that's asking:

    - `nav_item` — one workspace list surface (e.g. 'acquisitions').
    - `requires_context` — an entity-detail surface (e.g. 'object_id' on a
      collection-object page): only templates that take that page-context id.
    - `no_context` — the central 'Start a procedure' list: only templates that
      need no page context (so every offered procedure is actually runnable).

    Omit all three for the unfiltered catalog."""
    _check_agent_enabled()
    from app.services.agent_tools.plan_templates.catalog import list_templates
    templates = list_templates(
        nav_item, context_param=requires_context, no_context=no_context,
    )
    return {"templates": [_serialize_template(t) for t in templates]}


class _CreatePlanFromTemplateBody(BaseModel):
    template_id: str
    params: dict = {}
    # Optional viewed-entity context (e.g. the object/media the user is on); the
    # frontend may instead include from_context ids directly in `params`.
    context_entity_type: str | None = None
    context_entity_id: UUID | None = None


@router.post(
    "/api/organizations/{organization_id}/agent/plans",
    status_code=201,
    summary="Start a plan from a template (deterministic — the forced entry point)",
)
def create_plan_from_template(
    organization_id: UUID,
    body: _CreatePlanFromTemplateBody,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Create a plan from a catalog template WITHOUT the planner LLM. Unlike the
    conversational path this enforces the template: a missing required param is a
    422, never a free-form fallback. Spins up a staff conversation to own the plan."""
    _check_agent_enabled()
    from app.services.agent_tools.plan_templates.catalog import get_template
    from app.services.agent_tools import AgentContext

    template = get_template(body.template_id)
    if template is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": f"unknown template {body.template_id!r}"},
        )

    params = dict(body.params or {})
    if body.context_entity_id is not None:
        # Let an object/media id come from the page the user is on.
        for k in template.context_params:
            params.setdefault(k, str(body.context_entity_id))

    missing = [k for k in template.required_params if not params.get(k)]
    if missing:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "missing_params",
                "message": f"missing required params: {missing}",
                "missing": missing,
            },
        )

    org = db.query(Organization.slug).filter(
        Organization.organization_id == organization_id,
    ).first()
    conversation = Conversation(
        organization_id=organization_id,
        user_id=auth.user_id,
        persona="staff",
        title=template.title,
    )
    db.add(conversation)
    db.flush()

    ctx = AgentContext(
        organization_id=organization_id,
        user_id=auth.user_id,
        persona="staff",
        db_session=db,
        org_slug=org.slug if org else None,
        conversation_id=conversation.conversation_id,
        context_entity_type=body.context_entity_type,
        context_entity_id=body.context_entity_id,
        page_context=None,
    )
    service = PlanService(db, ctx)
    result = service.create_plan(
        goal=template.goal,
        conversation=conversation,
        template_id=template.template_id,
        template_params=params,
    )
    if result.error is not None or result.plan is None:
        raise HTTPException(
            status_code=422,
            detail={"code": result.error_kind or "error", "message": result.error or "plan creation failed"},
        )
    return _serialize_plan(result.plan, include_steps=True)


@router.get(
    "/api/organizations/{organization_id}/agent/plans/count",
    summary="Count the user's plans awaiting their action",
)
def count_agent_plans_awaiting_user(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Count of the requesting user's plans parked on a user-actionable await
    (decision / approval / form submission). Drives the Plans nav "needs you"
    badge — mirrors the per-plan `awaits_user` flag in _serialize_plan.

    NOTE: registered before the /{plan_id} route so "count" isn't captured as a
    plan id.
    """
    _check_agent_enabled()

    awaiting_step = (
        db.query(AgentPlanStep.step_id)
        .filter(
            AgentPlanStep.plan_id == AgentPlan.plan_id,
            AgentPlanStep.status == "awaiting_user",
            or_(
                AgentPlanStep.kind == "decision",
                AgentPlanStep.wait_for["kind"].astext.in_(
                    ("approval_request", "form_submission")
                ),
            ),
        )
        .exists()
    )
    count = (
        db.query(func.count(func.distinct(AgentPlan.plan_id)))
        .join(
            Conversation,
            Conversation.conversation_id == AgentPlan.conversation_id,
        )
        .filter(
            AgentPlan.organization_id == organization_id,
            Conversation.user_id == auth.user_id,
            awaiting_step,
        )
        .scalar()
    )
    return {"count": count or 0}


@router.get(
    "/api/organizations/{organization_id}/agent/plans/{plan_id}",
    summary="Get an agent plan with its steps",
)
def get_agent_plan(
    organization_id: UUID,
    plan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """One plan with its ordered steps. 404 on org mismatch (no disclosure)."""
    _check_agent_enabled()

    plan = db.query(AgentPlan).filter(AgentPlan.plan_id == plan_id).first()
    if plan is None or plan.organization_id != organization_id:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Plan not found"},
        )
    return _serialize_plan(plan, include_steps=True)


@router.post(
    "/api/organizations/{organization_id}/agent/plans/{plan_id}/run",
    summary="Run a pending agent plan",
)
def run_agent_plan(
    organization_id: UUID,
    plan_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Start a plan's pending steps (the Guide Studio v1 Phase 0 trigger).

    Decision #3 (accepted 2026-05-14): plans never auto-execute on
    creation — an explicit user Run click is always required. This is
    that click's endpoint. `run_plan` is idempotent: a completed/failed/
    cancelled plan returns halt_reason='already_done'; an awaiting plan
    returns halt_reason='awaiting' without advancing (the Celery scanner
    and approval hook own resumption).

    RLS is already scoped to the path org by require_permission, so a
    plan_id from another org is invisible and resolves to 404. We return
    404 (not 403) on org mismatch as well, so cross-org plan existence is
    never disclosed.
    """
    _check_agent_enabled()

    plan = (
        db.query(AgentPlan)
        .filter(AgentPlan.plan_id == plan_id)
        .first()
    )
    if plan is None or plan.organization_id != organization_id:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Plan not found"},
        )

    result = PlanService(db).run_plan(plan_id)
    if result is None:
        # Plan vanished between the guard query and run_plan (CASCADE
        # delete of the parent conversation, say). Treat as not-found.
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Plan not found"},
        )

    return {
        "plan_id": str(result.plan.plan_id),
        "status": result.plan.status,
        "halted": result.halted,
        "halt_reason": result.halt_reason,
        "steps_executed": result.steps_executed,
        "last_error": result.last_error,
    }


@router.post(
    "/api/organizations/{organization_id}/agent/plans/{plan_id}/steps/{step_id}/form-submitted",
    summary="Resolve a form_submission await on an agent plan step",
)
def submit_agent_plan_form(
    organization_id: UUID,
    plan_id: UUID,
    step_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Signal that the user completed the form a plan step is awaiting.

    Unlike approvals (resumed via the approvals review hook) and
    workflow_transitions (resumed by the Celery scanner), a form_submission
    await has no automatic trigger — this endpoint is it. The Guide Studio
    plan checklist calls it once the user has submitted the form the step
    names. Validates that the step is an awaiting form_submission on a plan in
    the path org, then signals it; PlanService.signal resumes the plan.

    404 (not 403) on org mismatch so cross-org plan existence isn't disclosed.
    """
    _check_agent_enabled()

    plan = db.query(AgentPlan).filter(AgentPlan.plan_id == plan_id).first()
    if plan is None or plan.organization_id != organization_id:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Plan not found"},
        )

    step = (
        db.query(AgentPlanStep)
        .filter(AgentPlanStep.step_id == step_id, AgentPlanStep.plan_id == plan_id)
        .first()
    )
    if step is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Step not found"},
        )

    wait_for = step.wait_for if isinstance(step.wait_for, dict) else {}
    if step.kind != "await" or wait_for.get("kind") != "form_submission":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "not_form_await",
                "message": "Step is not awaiting a form submission",
            },
        )

    signal_data = {
        "kind": "form_submission",
        "outcome": "completed",
        "form": wait_for.get("form"),
        "entity": wait_for.get("entity"),
        "entity_id": wait_for.get("entity_id"),
        "submitted_by": str(auth.user_id),
    }
    result = PlanService(db).signal(plan_id, step_id, signal_data)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Plan not found"},
        )

    return {
        "plan_id": str(result.plan.plan_id),
        "status": result.plan.status,
        "halted": result.halted,
        "halt_reason": result.halt_reason,
        "steps_executed": result.steps_executed,
        "last_error": result.last_error,
    }


@router.post(
    "/api/organizations/{organization_id}/agent/plans/{plan_id}/steps/{step_id}/decide",
    summary="Resolve a decision (branch) step on an agent plan",
)
def decide_agent_plan_step(
    organization_id: UUID,
    plan_id: UUID,
    step_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Record the user's branch choice on a `decision` step and resume the plan.

    The chosen key selects a path; the steps tagged with the decision's other
    keys are skipped. 404 (not 403) on org mismatch so cross-org plan existence
    isn't disclosed; 422 if the choice isn't one of the step's options.
    """
    _check_agent_enabled()

    plan = db.query(AgentPlan).filter(AgentPlan.plan_id == plan_id).first()
    if plan is None or plan.organization_id != organization_id:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Plan not found"},
        )

    step = (
        db.query(AgentPlanStep)
        .filter(AgentPlanStep.step_id == step_id, AgentPlanStep.plan_id == plan_id)
        .first()
    )
    if step is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Step not found"},
        )
    if step.kind != "decision":
        raise HTTPException(
            status_code=409,
            detail={"code": "not_decision", "message": "Step is not a decision"},
        )

    chosen = body.get("chosen") if isinstance(body, dict) else None
    result = PlanService(db).signal(
        plan_id, step_id, {"kind": "decision", "chosen": chosen}
    )
    if result is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Plan not found"},
        )
    if result.halt_reason == "invalid_signal":
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_choice", "message": result.last_error},
        )

    return {
        "plan_id": str(result.plan.plan_id),
        "status": result.plan.status,
        "halted": result.halted,
        "halt_reason": result.halt_reason,
        "steps_executed": result.steps_executed,
        "last_error": result.last_error,
    }


@router.delete("/api/organizations/{organization_id}/agent/conversations/{conversation_id}", response_model=DeletedResponse, summary="Delete staff conversation")
def delete_staff_conversation(
    organization_id: UUID,
    conversation_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Delete staff conversation."""
    _check_agent_enabled()

    service = get_agent_service(session=db)
    deleted = service.delete_conversation(
        conversation_id=conversation_id,
        organization_id=organization_id,
        user_id=auth.user_id,
    )
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Conversation not found"},
        )

    return {"deleted": True}


@router.post("/api/organizations/{organization_id}/agent/conversations/{conversation_id}/messages/{message_id}/feedback", summary="Rate a message")
def rate_message(
    organization_id: UUID,
    conversation_id: UUID,
    message_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Record thumbs up/down satisfaction on an assistant message.

    Links to the GuideMetric row by conversation_id for aggregate analysis.
    """
    from app.services.agent_monitoring import GuideMetric

    satisfaction = body.get("satisfaction")
    if satisfaction not in ("positive", "negative"):
        raise HTTPException(status_code=400, detail="satisfaction must be 'positive' or 'negative'")

    # Find the most recent metric for this conversation
    metric = (
        db.query(GuideMetric)
        .filter(
            GuideMetric.conversation_id == conversation_id,
            GuideMetric.organization_id == organization_id,
        )
        .order_by(GuideMetric.created_at.desc())
        .first()
    )
    if metric:
        metric.satisfaction = satisfaction
        db.commit()

    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════
# Visitor endpoints (public, rate-limited)
# ═══════════════════════════════════════════════════════════════════


@router.post("/api/guide/{org_slug}/conversations", status_code=201, summary="Create visitor conversation")
def create_visitor_conversation(
    org_slug: str,
    request: Request,
    body: CreateVisitorConversationBody | None = None,
    db: Session = Depends(get_db),
):
    """Create visitor conversation."""
    _check_visitor_rate_limit(request)
    _check_agent_enabled()

    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Organization not found"},
        )

    set_rls_context_for_session(db, str(org.organization_id), None)

    _check_widget_access(org.organization_id, db)

    data = body or CreateVisitorConversationBody()

    # Server-minted session: use existing cookie or mint new token
    cookie_session = request.cookies.get(VISITOR_SESSION_COOKIE)
    body_session = (data.session_id or "").strip()

    if cookie_session:
        # Returning visitor — use cookie value
        session_id = cookie_session
    elif body_session:
        # First request with client-provided session (backward compat)
        session_id = body_session
    else:
        # New visitor — mint a token
        session_id = _mint_session_token()

    # Upsert visitor and ensure an active visit exists
    visitor_service = get_visitor_service(session=db)
    visitor = visitor_service.get_or_create_visitor(
        organization_id=org.organization_id,
        session_token=session_id,
        locale=data.locale,
    )
    visit = visitor_service.get_or_create_active_visit(
        organization_id=org.organization_id,
        visitor_id=visitor.visitor_id,
        source=data.source,
    )

    service = get_agent_service(session=db)
    conv = service.create_conversation(
        organization_id=org.organization_id,
        persona="visitor",
        session_id=session_id,
        context_entity_type=data.context_entity_type,
        context_entity_id=data.context_entity_id,
        visitor_id=visitor.visitor_id,
        visit_id=visit.visit_id,
    )

    # Record agent conversation interaction
    visitor_service.record_interaction(
        organization_id=org.organization_id,
        visit_id=visit.visit_id,
        interaction_type="agent_conversation",
        metadata={"conversation_id": str(conv.conversation_id)},
    )

    response = JSONResponse(
        content={
            "conversation_id": str(conv.conversation_id),
            "persona": conv.persona,
            "visitor_id": str(visitor.visitor_id),
            "visit_id": str(visit.visit_id),
            "session_id": session_id,
        },
        status_code=201,
    )
    response.set_cookie(
        key=VISITOR_SESSION_COOKIE,
        value=session_id,
        max_age=VISITOR_SESSION_MAX_AGE,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/api/guide/",
    )
    return response


@router.post("/api/guide/{org_slug}/conversations/{conversation_id}/chat", summary="Visitor chat")
def visitor_chat(
    org_slug: str,
    conversation_id: UUID,
    request: Request,
    body: VisitorChatBody,
    db: Session = Depends(get_db),
):
    """Visitor chat."""
    _check_visitor_rate_limit(request)
    _check_agent_enabled()

    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Organization not found"},
        )

    set_rls_context_for_session(db, str(org.organization_id), None)

    message = body.message.strip()
    session_id = body.session_id
    locale = body.locale

    # Double-submit cookie validation
    if not _validate_session_cookie(request, session_id):
        raise HTTPException(
            status_code=403,
            detail={"code": "forbidden", "message": "Invalid session"},
        )

    service = get_agent_service(session=db)
    conv = service.get_conversation(
        conversation_id=conversation_id,
        organization_id=org.organization_id,
        session_id=session_id,
    )
    if not conv:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Conversation not found"},
        )

    _check_widget_access(org.organization_id, db)

    def generate():
        try:
            yield from service.stream_response(
                conv, message, locale=locale, input_mode=body.input_mode,
            )
        except Exception:
            logger.exception("Visitor agent stream error")
            yield 'event: error\ndata: {"error": "Internal error"}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/api/guide/{org_slug}/visitor-data", summary="Gdpr delete")
def gdpr_delete(
    org_slug: str,
    request: Request,
    body: GDPRDeleteBody,
    db: Session = Depends(get_db),
):
    """GDPR right-to-erasure: delete all visitor conversation data for a session.

    Requires valid session cookie + matching body session_id (double-submit).
    Idempotent — returns 200 even if nothing was deleted.
    """
    _check_visitor_rate_limit(request)
    _check_agent_enabled()

    org = _get_org_by_slug(db, org_slug)
    if not org:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Organization not found"},
        )

    session_id = body.session_id.strip()
    if not session_id:
        raise HTTPException(
            status_code=400,
            detail={"code": "bad_request", "message": "session_id is required"},
        )

    # Double-submit cookie validation
    if not _validate_session_cookie(request, session_id):
        raise HTTPException(
            status_code=403,
            detail={"code": "forbidden", "message": "Invalid session"},
        )

    set_rls_context_for_session(db, str(org.organization_id), None)
    count = gdpr_delete_visitor_data(org.organization_id, session_id, session=db)

    response = JSONResponse(content={"deleted_conversations": count})
    response.delete_cookie(key=VISITOR_SESSION_COOKIE, path="/api/guide/")
    return response
