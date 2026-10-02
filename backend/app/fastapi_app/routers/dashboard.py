"""
Dashboard API — FastAPI router.

Aggregates cross-module "needs attention" items for the home dashboard:
- Overdue loan monitoring events (in + out)
- Active media rights/consent expiration alerts
- Overdue compliance actions (audits, condition reviews, follow-ups)
"""

import logging
from datetime import date, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import OrgContext, require_org_role
from app.fastapi_app.schemas.dashboard import (
    ActivityResponse,
    AttentionSummaryResponse,
    AttentionV2Response,
    DashboardSummaryResponse,
    GreetingResponse,
    PulseResponse,
    SuggestionsResponse,
    WorkshopCountsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dashboard"])

SAMPLE_LIMIT = 5


def _loans_attention(db: Session, organization_id: UUID) -> dict:
    """Overdue loan monitoring events with loan-number labels."""
    from app.models.procedures import LoanIn, LoanOut, LoanMonitoringEvent

    today = date.today()
    base = (
        db.query(LoanMonitoringEvent)
        .filter(
            LoanMonitoringEvent.organization_id == organization_id,
            LoanMonitoringEvent.status == "pending",
            LoanMonitoringEvent.due_date <= today,
        )
    )
    total = base.count()
    events = (
        base.order_by(LoanMonitoringEvent.due_date.asc()).limit(SAMPLE_LIMIT).all()
    )

    samples: list[dict] = []
    for ev in events:
        if ev.loan_type == "loan_out":
            loan = (
                db.query(LoanOut.loan_number, LoanOut.borrower_name)
                .filter(LoanOut.loan_out_id == ev.loan_id)
                .first()
            )
            number = loan.loan_number if loan else None
            party = loan.borrower_name if loan else None
            href = f"/collections/loans-out/{ev.loan_id}"
        else:
            loan = (
                db.query(LoanIn.loan_number, LoanIn.lender_name)
                .filter(LoanIn.loan_in_id == ev.loan_id)
                .first()
            )
            number = loan.loan_number if loan else None
            party = loan.lender_name if loan else None
            href = f"/collections/loans-in/{ev.loan_id}"

        prefix = number or str(ev.loan_id)[:8]
        label_parts = [prefix, ev.event_type.replace("_", " ")]
        if party:
            label_parts.append(f"— {party}")
        samples.append({
            "id": str(ev.event_id),
            "label": " ".join(label_parts),
            "due_date": ev.due_date.isoformat() if ev.due_date else None,
            "severity": "critical" if ev.due_date and ev.due_date < today else "urgent",
            "href": href,
        })

    return {"total": total, "samples": samples}


def _rights_attention(db: Session, organization_id: UUID) -> dict:
    """Active rights/consent expiration alerts."""
    from app.models.media import ExpirationAlert

    base = db.query(ExpirationAlert).filter(
        ExpirationAlert.organization_id == organization_id,
        ExpirationAlert.status == "active",
    )
    total = base.count()
    alerts = (
        base.order_by(ExpirationAlert.expiry_date.asc()).limit(SAMPLE_LIMIT).all()
    )

    samples = [
        {
            "id": str(a.alert_id),
            "label": f"{a.alert_type.title()} expires in {a.days_until_expiry}d",
            "due_date": a.expiry_date.isoformat() if a.expiry_date else None,
            "severity": a.severity,
            "href": f"/dam/media/{a.media_id}",
        }
        for a in alerts
    ]
    return {"total": total, "samples": samples}


def _audits_attention(db: Session, organization_id: UUID) -> dict:
    """Overdue compliance actions (audit follow-ups, condition reviews, etc.)."""
    from app.models.compliance import ComplianceAction

    today = date.today()
    base = db.query(ComplianceAction).filter(
        ComplianceAction.organization_id == organization_id,
        ComplianceAction.due_date.isnot(None),
        ComplianceAction.due_date < today,
        ComplianceAction.status.notin_(["completed", "cancelled"]),
    )
    total = base.count()
    actions = (
        base.order_by(ComplianceAction.due_date.asc()).limit(SAMPLE_LIMIT).all()
    )

    samples = [
        {
            "id": str(a.action_id),
            "label": a.title,
            "due_date": a.due_date.isoformat() if a.due_date else None,
            "severity": a.priority or "warning",
            "href": None,
        }
        for a in actions
    ]
    return {"total": total, "samples": samples}


@router.get(
    "/api/organizations/{organization_id}/dashboard/attention",
    response_model=AttentionSummaryResponse,
    summary="Get needs-attention summary for the home dashboard",
)
def get_attention_summary(
    organization_id: UUID,
    org: OrgContext = Depends(require_org_role("member")),
    db: Session = Depends(get_db),
):
    """
    Return aggregate counts + sample items across categories that need
    a user's attention: overdue loan monitoring, expiring media rights,
    overdue compliance actions.
    """
    return {
        "loans": _loans_attention(db, organization_id),
        "rights": _rights_attention(db, organization_id),
        "audits": _audits_attention(db, organization_id),
    }


# ---------------------------------------------------------------------------
# V2 — flat AttentionItem[] for the redesigned home screen
# ---------------------------------------------------------------------------

V2_PER_CATEGORY_LIMIT = 5
V2_TOTAL_LIMIT = 10
SEVERITY_ORDER = {"urgent": 0, "this_week": 1, "informational": 2}


def _due_severity(due: date | None, today: date) -> str:
    """Map a due-date to a V2 severity bucket."""
    if due is None:
        return "informational"
    if due <= today:
        return "urgent"
    if (due - today).days <= 7:
        return "this_week"
    return "informational"


def _human_ago(when: datetime | date | None, today: date) -> str:
    if when is None:
        return ""
    if isinstance(when, datetime):
        when_d = when.date()
    else:
        when_d = when
    days = (today - when_d).days
    if days <= 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 7:
        return f"{days}d ago"
    if days < 30:
        return f"{days // 7}w ago"
    return when_d.isoformat()


def _v2_incidents(db: Session, organization_id: UUID, today: date) -> list[dict]:
    from app.models.compliance import IncidentReport

    rows = (
        db.query(IncidentReport)
        .filter(
            IncidentReport.organization_id == organization_id,
            IncidentReport.status.in_(["submitted", "under_investigation"]),
        )
        .order_by(IncidentReport.discovered_date.desc())
        .limit(V2_PER_CATEGORY_LIMIT)
        .all()
    )
    items: list[dict] = []
    for r in rows:
        discovered = r.discovered_date.date() if r.discovered_date else None
        ago = _human_ago(discovered, today) if discovered else ""
        actor = r.discovered_by_name or "team member"
        # Truncate long descriptions to a single sentence-ish summary
        title = (r.incident_description or "Incident reported").strip()
        if len(title) > 110:
            title = title[:107].rstrip() + "…"
        items.append({
            "id": str(r.report_id),
            "type": "incident",
            "severity": "urgent" if discovered and (today - discovered).days <= 7 else "this_week",
            "ref_number": r.report_number,
            "title": title,
            "context": f"Reported {ago} by {actor}" if ago else f"Reported by {actor}",
            "href": f"/collections/incidents/{r.report_id}",
        })
    return items


def _v2_loans(db: Session, organization_id: UUID, today: date) -> list[dict]:
    from app.models.procedures import LoanIn, LoanOut, LoanMonitoringEvent

    seven_days = today + timedelta(days=7)
    events = (
        db.query(LoanMonitoringEvent)
        .filter(
            LoanMonitoringEvent.organization_id == organization_id,
            LoanMonitoringEvent.status == "pending",
            LoanMonitoringEvent.due_date <= seven_days,
        )
        .order_by(LoanMonitoringEvent.due_date.asc())
        .limit(V2_PER_CATEGORY_LIMIT)
        .all()
    )
    items: list[dict] = []
    for ev in events:
        if ev.loan_type == "loan_out":
            loan = (
                db.query(LoanOut.loan_number, LoanOut.borrower_name)
                .filter(LoanOut.loan_out_id == ev.loan_id)
                .first()
            )
            number = loan.loan_number if loan else str(ev.loan_id)[:8]
            party = loan.borrower_name if loan else None
            href = f"/collections/loans-out/{ev.loan_id}"
            verb = "Outgoing loan"
        else:
            loan = (
                db.query(LoanIn.loan_number, LoanIn.lender_name)
                .filter(LoanIn.loan_in_id == ev.loan_id)
                .first()
            )
            number = loan.loan_number if loan else str(ev.loan_id)[:8]
            party = loan.lender_name if loan else None
            href = f"/collections/loans-in/{ev.loan_id}"
            verb = "Incoming loan"

        days = (ev.due_date - today).days
        if days < 0:
            timing = f"{abs(days)}d overdue"
        elif days == 0:
            timing = "due today"
        else:
            timing = f"due in {days}d"

        action = ev.event_type.replace("_", " ")
        title = (
            f"{verb} to {party} — {action} {timing}"
            if party
            else f"{verb} {action} {timing}"
        )
        items.append({
            "id": str(ev.event_id),
            "type": "loan",
            "severity": _due_severity(ev.due_date, today),
            "ref_number": number,
            "title": title,
            "context": f"{action.capitalize()} step on the loan workflow",
            "href": href,
        })
    return items


def _v2_accessions(db: Session, organization_id: UUID, today: date) -> list[dict]:
    from app.models.procedures import Acquisition

    rows = (
        db.query(Acquisition)
        .filter(
            Acquisition.organization_id == organization_id,
            Acquisition.status == "pending_approval",
        )
        .order_by(Acquisition.created_at.desc())
        .limit(V2_PER_CATEGORY_LIMIT)
        .all()
    )
    items: list[dict] = []
    for a in rows:
        source = (a.source.display_name or a.source.name) if a.source else "New acquisition"
        count = a.objects_count or 1
        plural = "object" if count == 1 else "objects"
        ago = _human_ago(a.created_at, today)
        items.append({
            "id": str(a.acquisition_id),
            "type": "accession",
            "severity": "this_week",
            "ref_number": a.acquisition_number,
            "title": f"{source}, {count} {plural} ready for catalog review",
            "context": f"Drafted {ago} · awaiting curator approval" if ago else "Awaiting curator approval",
            "href": f"/collections/acquisitions/{a.acquisition_id}",
        })
    return items


def _v2_condition_reports(db: Session, organization_id: UUID, today: date) -> list[dict]:
    """Overdue compliance actions surfaced under the condition_report bucket."""
    from app.models.compliance import ComplianceAction

    rows = (
        db.query(ComplianceAction)
        .filter(
            ComplianceAction.organization_id == organization_id,
            ComplianceAction.due_date.isnot(None),
            ComplianceAction.due_date <= today + timedelta(days=7),
            ComplianceAction.status.notin_(["completed", "cancelled"]),
        )
        .order_by(ComplianceAction.due_date.asc())
        .limit(V2_PER_CATEGORY_LIMIT)
        .all()
    )
    items: list[dict] = []
    for a in rows:
        days = (a.due_date - today).days
        if days < 0:
            timing = f"{abs(days)}d overdue"
        elif days == 0:
            timing = "due today"
        else:
            timing = f"due in {days}d"
        items.append({
            "id": str(a.action_id),
            "type": "condition_report",
            "severity": _due_severity(a.due_date, today),
            "ref_number": str(a.action_id)[:8].upper(),
            "title": a.title,
            "context": f"{a.action_type.replace('_', ' ').capitalize()} · {timing}",
            "href": "",
        })
    return items


@router.get(
    "/api/organizations/{organization_id}/dashboard/attention-v2",
    response_model=AttentionV2Response,
    summary="V2 attention queue: flat AttentionItem[] for the redesigned home",
)
def get_attention_v2(
    organization_id: UUID,
    org: OrgContext = Depends(require_org_role("member")),
    db: Session = Depends(get_db),
):
    """
    Return a flat list of AttentionItem objects across the four V2 categories
    (incident, loan, accession, condition_report), sorted by severity then
    most recent first, capped at V2_TOTAL_LIMIT.
    """
    today = date.today()
    all_items: list[dict] = []
    all_items.extend(_v2_incidents(db, organization_id, today))
    all_items.extend(_v2_loans(db, organization_id, today))
    all_items.extend(_v2_accessions(db, organization_id, today))
    all_items.extend(_v2_condition_reports(db, organization_id, today))

    all_items.sort(key=lambda i: SEVERITY_ORDER.get(i["severity"], 99))
    return {"items": all_items[:V2_TOTAL_LIMIT]}


# ---------------------------------------------------------------------------
# V2 — Today's pulse (3 stats + recently-updated object)
# ---------------------------------------------------------------------------


def _ago_phrase(when: datetime, now: datetime) -> str:
    delta = now - when
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return "just now"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    days = hours // 24
    if days < 7:
        return f"{days} day{'s' if days != 1 else ''} ago"
    weeks = days // 7
    if weeks < 5:
        return f"{weeks} week{'s' if weeks != 1 else ''} ago"
    return when.date().isoformat()


@router.get(
    "/api/organizations/{organization_id}/dashboard/pulse",
    response_model=PulseResponse,
    summary="V2 today's pulse: 3 stats + most recently updated object",
)
def get_pulse(
    organization_id: UUID,
    org: OrgContext = Depends(require_org_role("member")),
    db: Session = Depends(get_db),
):
    """Aggregate the three V2 pulse stats and pick the most-recently-updated object."""
    from app.models.objects import CollectionObject, ConditionReport
    from app.models.procedures import LoanIn, LoanOut

    today = date.today()
    week_ago = today - timedelta(days=7)
    fortnight = today + timedelta(days=14)

    accessions_this_week = (
        db.query(CollectionObject)
        .filter(
            CollectionObject.organization_id == organization_id,
            CollectionObject.accession_date.isnot(None),
            CollectionObject.accession_date >= week_ago,
        )
        .count()
    )

    open_condition_reports = (
        db.query(ConditionReport)
        .filter(
            ConditionReport.organization_id == organization_id,
            ConditionReport.status.notin_(["approved", "completed", "archived", "cancelled"]),
        )
        .count()
    )

    loans_returning = (
        db.query(LoanOut)
        .filter(
            LoanOut.organization_id == organization_id,
            LoanOut.loan_end_date.isnot(None),
            LoanOut.loan_end_date >= today,
            LoanOut.loan_end_date <= fortnight,
            LoanOut.actual_return_date.is_(None),
        )
        .count()
    ) + (
        db.query(LoanIn)
        .filter(
            LoanIn.organization_id == organization_id,
            LoanIn.loan_end_date.isnot(None),
            LoanIn.loan_end_date >= today,
            LoanIn.loan_end_date <= fortnight,
        )
        .count()
    )

    recent = (
        db.query(CollectionObject)
        .filter(CollectionObject.organization_id == organization_id)
        .order_by(CollectionObject.updated_at.desc())
        .limit(1)
        .first()
    )

    recent_object = None
    if recent and recent.updated_at:
        name = recent.object_name or recent.object_number or "an object"
        recent_object = {
            "name": name,
            "href": f"/collections/objects/{recent.object_id}",
            "updated_ago": _ago_phrase(recent.updated_at, datetime.now(recent.updated_at.tzinfo)),
        }

    return {
        "stats": [
            {"value": accessions_this_week, "label": "Accessioned this week"},
            {"value": open_condition_reports, "label": "Open condition reports"},
            {"value": loans_returning, "label": "Loans returning ≤14d"},
        ],
        "recent_object": recent_object,
    }


# ---------------------------------------------------------------------------
# V2 — Workshop counts (per-app live status)
# ---------------------------------------------------------------------------


@router.get(
    "/api/organizations/{organization_id}/dashboard/workshop",
    response_model=WorkshopCountsResponse,
    summary="V2 workshop: per-app status counts for the home dashboard",
)
def get_workshop_counts(
    organization_id: UUID,
    org: OrgContext = Depends(require_org_role("member")),
    db: Session = Depends(get_db),
):
    """
    Return raw counts for each app's status line. Frontend formats copy.
    """
    from app.models.agent import Conversation
    from app.models.content import Page
    from app.models.core_misc import Run
    from app.models.media import Media
    from app.models.objects import CollectionObject

    # Bridge: pipeline runs currently in flight
    bridge_running = (
        db.query(Run)
        .filter(
            Run.organization_id == organization_id,
            Run.status.in_(["running", "queued", "starting"]),
        )
        .count()
    )

    # Collections: total cataloged objects in the org
    collections_records = (
        db.query(CollectionObject)
        .filter(CollectionObject.organization_id == organization_id)
        .count()
    )

    # Guide: conversations updated within the last 30 minutes count as "active"
    active_window = datetime.now(tz=None) - timedelta(minutes=30)
    guide_active = (
        db.query(Conversation)
        .filter(
            Conversation.organization_id == organization_id,
            Conversation.updated_at >= active_window,
        )
        .count()
    )

    # Content: pages with status=draft
    content_drafts = (
        db.query(Page)
        .filter(
            Page.organization_id == organization_id,
            Page.status == "draft",
        )
        .count()
    )

    # Media: total assets
    media_assets = (
        db.query(Media)
        .filter(Media.organization_id == organization_id)
        .count()
    )

    return {
        "bridge_running": bridge_running,
        "collections_records": collections_records,
        "guide_active_conversations": guide_active,
        "content_drafts": content_drafts,
        "media_assets": media_assets,
    }


# ---------------------------------------------------------------------------
# V2 — Editorial greeting subtitle (heuristic phrasing)
# ---------------------------------------------------------------------------


def _pick_subtitle(*, urgent: int, accessions_week: int, loans_returning: int) -> str:
    """Heuristic phrasing for the editorial greeting subtitle.

    Priority order: urgent attention items > new accessions > returning loans
    > generic fallback. The v2 plan replaces this with a Guide-generated line.
    """
    if urgent > 0:
        noun = "thing" if urgent == 1 else "things"
        return f"{urgent} {noun} want your attention today."
    if accessions_week > 0:
        if accessions_week == 1:
            return "One newly-accessioned object joined the collection this week."
        return f"{accessions_week} newly-accessioned objects joined the collection this week."
    if loans_returning > 0:
        if loans_returning == 1:
            return "One loan returns to the collection within two weeks."
        return f"{loans_returning} loans return to the collection within two weeks."
    return "Welcome back. Here's where things stand."


@router.get(
    "/api/organizations/{organization_id}/dashboard/greeting",
    response_model=GreetingResponse,
    summary="V2 editorial greeting subtitle (heuristic phrasing)",
)
def get_greeting(
    organization_id: UUID,
    org: OrgContext = Depends(require_org_role("member")),
    db: Session = Depends(get_db),
):
    """Return a one-sentence subtitle for the editorial greeting.

    v1 (this implementation): heuristic phrasing based on attention + pulse counts.
    v2 (TODO): Guide-generated line summarizing the day.
    """
    from app.models.compliance import IncidentReport
    from app.models.objects import CollectionObject
    from app.models.procedures import LoanIn, LoanOut, LoanMonitoringEvent

    today = date.today()
    week_ago = today - timedelta(days=7)
    fortnight = today + timedelta(days=14)

    # Urgent = any overdue loan monitoring + open incidents discovered this week
    overdue_loans = (
        db.query(LoanMonitoringEvent)
        .filter(
            LoanMonitoringEvent.organization_id == organization_id,
            LoanMonitoringEvent.status == "pending",
            LoanMonitoringEvent.due_date < today,
        )
        .count()
    )
    urgent_incidents = (
        db.query(IncidentReport)
        .filter(
            IncidentReport.organization_id == organization_id,
            IncidentReport.status.in_(["submitted", "under_investigation"]),
            IncidentReport.discovered_date >= datetime.combine(week_ago, datetime.min.time()),
        )
        .count()
    )
    urgent = overdue_loans + urgent_incidents

    accessions_week = (
        db.query(CollectionObject)
        .filter(
            CollectionObject.organization_id == organization_id,
            CollectionObject.accession_date.isnot(None),
            CollectionObject.accession_date >= week_ago,
        )
        .count()
    )

    loans_returning = (
        db.query(LoanOut)
        .filter(
            LoanOut.organization_id == organization_id,
            LoanOut.loan_end_date.isnot(None),
            LoanOut.loan_end_date >= today,
            LoanOut.loan_end_date <= fortnight,
            LoanOut.actual_return_date.is_(None),
        )
        .count()
    ) + (
        db.query(LoanIn)
        .filter(
            LoanIn.organization_id == organization_id,
            LoanIn.loan_end_date.isnot(None),
            LoanIn.loan_end_date >= today,
            LoanIn.loan_end_date <= fortnight,
        )
        .count()
    )

    return {
        "subtitle": _pick_subtitle(
            urgent=urgent,
            accessions_week=accessions_week,
            loans_returning=loans_returning,
        ),
    }


# ---------------------------------------------------------------------------
# V2 — Suggestion chips for the Guide hero (heuristic)
# ---------------------------------------------------------------------------


_FALLBACK_SUGGESTIONS = [
    "What changed this week?",
    "Open condition reports",
    "Recently updated objects",
]


@router.get(
    "/api/organizations/{organization_id}/dashboard/suggestions",
    response_model=SuggestionsResponse,
    summary="V2 Guide-hero suggestion chips (heuristic)",
)
def get_suggestions(
    organization_id: UUID,
    org: OrgContext = Depends(require_org_role("member")),
    db: Session = Depends(get_db),
):
    """Return up to 3 suggestion chips for the Guide hero.

    v1 (this implementation): derived heuristically from recent activity signals.
    v2 (TODO): Guide-generated suggestions tailored to the user.
    """
    from app.models.compliance import IncidentReport
    from app.models.objects import CollectionObject, ConditionReport
    from app.models.procedures import Acquisition, LoanMonitoringEvent

    today = date.today()
    week_ago = today - timedelta(days=7)

    suggestions: list[str] = []

    # Signal: overdue or due-this-week loan monitoring events
    has_loans_due = (
        db.query(LoanMonitoringEvent)
        .filter(
            LoanMonitoringEvent.organization_id == organization_id,
            LoanMonitoringEvent.status == "pending",
            LoanMonitoringEvent.due_date <= today + timedelta(days=7),
        )
        .first()
        is not None
    )
    if has_loans_due:
        suggestions.append("Loans due this week")

    # Signal: pending acquisitions
    has_pending_acq = (
        db.query(Acquisition)
        .filter(
            Acquisition.organization_id == organization_id,
            Acquisition.status == "pending_approval",
        )
        .first()
        is not None
    )
    if has_pending_acq:
        suggestions.append("Acquisitions awaiting approval")

    # Signal: open incidents
    has_incidents = (
        db.query(IncidentReport)
        .filter(
            IncidentReport.organization_id == organization_id,
            IncidentReport.status.in_(["submitted", "under_investigation"]),
        )
        .first()
        is not None
    )
    if has_incidents:
        suggestions.append("Recent incidents")

    # Signal: open condition reports
    has_open_conditions = (
        db.query(ConditionReport)
        .filter(
            ConditionReport.organization_id == organization_id,
            ConditionReport.status.notin_(["approved", "completed", "archived", "cancelled"]),
        )
        .first()
        is not None
    )
    if has_open_conditions and len(suggestions) < 3:
        suggestions.append("Open condition reports")

    # Signal: accessions this week
    has_recent_accessions = (
        db.query(CollectionObject)
        .filter(
            CollectionObject.organization_id == organization_id,
            CollectionObject.accession_date.isnot(None),
            CollectionObject.accession_date >= week_ago,
        )
        .first()
        is not None
    )
    if has_recent_accessions and len(suggestions) < 3:
        suggestions.append("What was accessioned this week?")

    # Pad with generic fallbacks if we still have fewer than 3
    for fallback in _FALLBACK_SUGGESTIONS:
        if len(suggestions) >= 3:
            break
        if fallback not in suggestions:
            suggestions.append(fallback)

    return {"suggestions": suggestions[:3]}


# ---------------------------------------------------------------------------
# V2 — Org-wide synthesized activity feed
# ---------------------------------------------------------------------------


def _actor_name(user) -> str:
    if user is None:
        return "Someone"
    return user.display_name or user.email or "Someone"


@router.get(
    "/api/organizations/{organization_id}/dashboard/activity",
    response_model=ActivityResponse,
    summary="V2 org-wide activity feed (synthesized from existing tables)",
)
def get_activity(
    organization_id: UUID,
    org: OrgContext = Depends(require_org_role("member")),
    db: Session = Depends(get_db),
):
    """Return up to 10 synthesized org-wide activity entries.

    v1 (this implementation): synthesized by querying recent rows on a few
    high-signal tables — no dedicated audit_events infrastructure.
    v2 (TODO): replace with a real org-events table once that infra lands.
    """
    from app.models.compliance import IncidentReport
    from app.models.core_users import User
    from app.models.objects import CollectionObject, ConditionReport
    from app.models.procedures import Acquisition

    cutoff = datetime.now() - timedelta(days=7)
    entries: list[dict] = []

    # Incidents — filed verb, kind=incident
    incidents = (
        db.query(IncidentReport, User)
        .outerjoin(User, IncidentReport.created_by == User.user_id)
        .filter(
            IncidentReport.organization_id == organization_id,
            IncidentReport.created_at >= cutoff,
        )
        .order_by(IncidentReport.created_at.desc())
        .limit(5)
        .all()
    )
    for inc, user in incidents:
        entries.append({
            "id": f"incident-{inc.report_id}",
            "kind": "incident",
            "text": f"{_actor_name(user)} filed {inc.report_number}",
            "href": f"/collections/incidents/{inc.report_id}",
            "timestamp": int(inc.created_at.timestamp() * 1000),
        })

    # Acquisitions — drafted verb, kind=system
    acquisitions = (
        db.query(Acquisition, User)
        .outerjoin(User, Acquisition.created_by == User.user_id)
        .filter(
            Acquisition.organization_id == organization_id,
            Acquisition.created_at >= cutoff,
        )
        .order_by(Acquisition.created_at.desc())
        .limit(5)
        .all()
    )
    for acq, user in acquisitions:
        entries.append({
            "id": f"acquisition-{acq.acquisition_id}",
            "kind": "system",
            "text": f"{_actor_name(user)} drafted catalog entry for {acq.acquisition_number}",
            "href": f"/collections/acquisitions/{acq.acquisition_id}",
            "timestamp": int(acq.created_at.timestamp() * 1000),
        })

    # Condition reports — created verb, kind=system
    conditions = (
        db.query(ConditionReport, User)
        .outerjoin(User, ConditionReport.created_by == User.user_id)
        .filter(
            ConditionReport.organization_id == organization_id,
            ConditionReport.created_at >= cutoff,
        )
        .order_by(ConditionReport.created_at.desc())
        .limit(5)
        .all()
    )
    for rep, user in conditions:
        entries.append({
            "id": f"condition-{rep.report_id}",
            "kind": "system",
            "text": f"{_actor_name(user)} opened condition report {rep.report_number}",
            "href": f"/collections/condition-reports/{rep.report_id}",
            "timestamp": int(rep.created_at.timestamp() * 1000),
        })

    # Recently-updated objects — touched verb, kind=system
    objects = (
        db.query(CollectionObject, User)
        .outerjoin(User, CollectionObject.created_by == User.user_id)
        .filter(
            CollectionObject.organization_id == organization_id,
            CollectionObject.updated_at >= cutoff,
        )
        .order_by(CollectionObject.updated_at.desc())
        .limit(5)
        .all()
    )
    for obj, user in objects:
        name = obj.object_name or obj.object_number or "an object"
        entries.append({
            "id": f"object-{obj.object_id}",
            "kind": "system",
            "text": f"{_actor_name(user)} updated {name}",
            "href": f"/collections/objects/{obj.object_id}",
            "timestamp": int(obj.updated_at.timestamp() * 1000),
        })

    entries.sort(key=lambda e: e["timestamp"], reverse=True)
    return {"entries": entries[:10]}


# ---------------------------------------------------------------------------
# V2 — Single-call dashboard summary aggregator
# ---------------------------------------------------------------------------


@router.get(
    "/api/organizations/{organization_id}/dashboard/summary",
    response_model=DashboardSummaryResponse,
    summary="V2 dashboard — all sections in a single round-trip",
)
def get_dashboard_summary(
    organization_id: UUID,
    org: OrgContext = Depends(require_org_role("member")),
    db: Session = Depends(get_db),
):
    """Bundle every V2 dashboard endpoint into one response.

    The home screen fans out to several queries on mount; this aggregator lets
    the frontend make one round-trip instead of six.
    """
    return {
        "greeting": get_greeting(organization_id, org, db),
        "suggestions": get_suggestions(organization_id, org, db),
        "attention": get_attention_v2(organization_id, org, db),
        "pulse": get_pulse(organization_id, org, db),
        "workshop": get_workshop_counts(organization_id, org, db),
        "activity": get_activity(organization_id, org, db),
    }
