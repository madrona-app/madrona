"""
Usage accounting for Guide limits.

One source of truth so the usage numbers the UI shows match what the upload /
chat / widget endpoints enforce against. The limits themselves are in
guide_limits. Metered dimensions:

- documents       — GuideDocument rows for the org, excluding failed uploads.
- messages        — dashboard (staff/guide persona) chat messages this month.
- widget queries  — public visitor-widget (visitor persona) messages this month.

"This month" is the current UTC calendar month; one count per user turn.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.agent import Conversation, Message
from app.models.core import Application, OrganizationApplication
from app.models.guide_document import GuideDocument

# Dashboard chat vs. public widget, distinguished by conversation persona.
_DASHBOARD_PERSONAS = ("guide", "staff")
_WIDGET_PERSONAS = ("visitor",)


def month_start_utc(now: datetime | None = None) -> datetime:
    """First instant of the current UTC calendar month."""
    now = now or datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def documents_used(organization_id: UUID, db: Session) -> int:
    """Count of non-failed Guide documents for the org."""
    return db.execute(
        select(func.count())
        .select_from(GuideDocument)
        .where(
            GuideDocument.organization_id == organization_id,
            GuideDocument.status != "error",
        )
    ).scalar_one()


def _user_messages_this_month(organization_id: UUID, db: Session, personas: tuple[str, ...]) -> int:
    """Count user-role messages this month in conversations of the given personas."""
    return db.execute(
        select(func.count())
        .select_from(Message)
        .join(Conversation, Conversation.conversation_id == Message.conversation_id)
        .where(
            Message.organization_id == organization_id,
            Message.role == "user",
            Message.created_at >= month_start_utc(),
            Conversation.persona.in_(personas),
        )
    ).scalar_one()


def messages_used_this_month(organization_id: UUID, db: Session) -> int:
    """Dashboard (staff/guide) chat messages sent this month."""
    return _user_messages_this_month(organization_id, db, _DASHBOARD_PERSONAS)


def widget_queries_this_month(organization_id: UUID, db: Session) -> int:
    """Public visitor-widget queries this month."""
    return _user_messages_this_month(organization_id, db, _WIDGET_PERSONAS)


def get_guide_config(organization_id: UUID, db: Session) -> dict:
    """The org's Guide OrganizationApplication config (tier + limits), or {}.

    Used by endpoints outside the guide router (e.g. the public visitor widget)
    that need a tenant's tier limits without the require_guide_app dependency.
    """
    org_app = get_guide_org_app(organization_id, db)
    return (org_app.config or {}) if org_app else {}


def get_guide_org_app(organization_id: UUID, db: Session) -> OrganizationApplication | None:
    guide_app = db.execute(
        select(Application).where(Application.key == "guide")
    ).scalar_one_or_none()
    if not guide_app:
        return None
    return db.execute(
        select(OrganizationApplication).where(
            OrganizationApplication.organization_id == organization_id,
            OrganizationApplication.application_id == guide_app.application_id,
        )
    ).scalar_one_or_none()


@dataclass(frozen=True)
class WidgetAccess:
    """Resolved visitor-widget access state for an org.

    ``enabled`` requires BOTH the guide app row being enabled AND the explicit
    ``widget_enabled`` config flag (absent → False: the widget is dark until a
    deal turns it on). ``max_queries=None`` means unmetered — safe only because
    the gate is checked first.
    """

    enabled: bool
    max_queries: int | None
    used: int
    welcome_message: str | None = None

    @property
    def over_cap(self) -> bool:
        return self.max_queries is not None and self.used >= self.max_queries


def get_widget_access(organization_id: UUID, db: Session) -> WidgetAccess:
    """Gate + cap state for the public visitor widget, in one read."""
    org_app = get_guide_org_app(organization_id, db)
    config = (org_app.config or {}) if org_app else {}
    enabled = bool(org_app and org_app.enabled and config.get("widget_enabled"))
    if not enabled:
        return WidgetAccess(enabled=False, max_queries=None, used=0)
    from app.config import get_settings
    from app.services.guide_limits import resolve_widget_queries

    return WidgetAccess(
        enabled=True,
        # Absent from config is not the same as null: absent falls back to a
        # provider-dependent default, null is an operator choosing unmetered.
        max_queries=resolve_widget_queries(
            config, getattr(get_settings(), "agent_provider", None)
        ),
        used=widget_queries_this_month(organization_id, db),
        welcome_message=config.get("widget_welcome_message"),
    )
