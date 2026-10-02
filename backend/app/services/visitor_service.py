"""
Visitor session and visit lifecycle service.

Manages server-side visitor identity, visit tracking, and interaction logging.
"""

import logging
from datetime import datetime, timezone, timedelta
from uuid import UUID

from sqlalchemy import func

from app.models.visitor import Visitor, Visit, VisitInteraction

logger = logging.getLogger(__name__)


class VisitorService:
    """Manages visitor sessions, visits, and interactions."""

    def __init__(self, session):
        self.session = session

    def get_or_create_visitor(
        self,
        organization_id: UUID,
        session_token: str,
        locale: str = "en",
    ) -> Visitor:
        """Find existing visitor by session token or create a new one."""
        visitor = self.session.query(Visitor).filter(
            Visitor.organization_id == organization_id,
            Visitor.session_token == session_token,
        ).first()

        if visitor:
            visitor.last_seen_at = func.now()
            self.session.commit()
            return visitor

        visitor = Visitor(
            organization_id=organization_id,
            session_token=session_token,
            locale=locale,
        )
        self.session.add(visitor)
        self.session.commit()
        return visitor

    def identify_visitor(
        self,
        visitor: Visitor,
        email: str | None = None,
        display_name: str | None = None,
        locale: str | None = None,
    ) -> Visitor:
        """Update visitor profile with identifying information.

        Email is only stored when the visitor has given consent
        (email_consent=True). If consent hasn't been granted yet,
        email is silently dropped.
        """
        if email is not None:
            if visitor.email_consent:
                visitor.email = email
            else:
                logger.debug(
                    "Dropping email for visitor %s: no consent",
                    visitor.visitor_id,
                )
        if display_name is not None:
            visitor.display_name = display_name
        if locale is not None:
            visitor.locale = locale
        self.session.commit()
        return visitor

    def set_email_consent(
        self,
        visitor: Visitor,
        consent: bool,
    ) -> Visitor:
        """Record email consent (or withdrawal)."""
        visitor.email_consent = consent
        visitor.email_consent_at = datetime.now(timezone.utc) if consent else None
        if not consent:
            visitor.email = None
        self.session.commit()
        return visitor

    def start_visit(
        self,
        organization_id: UUID,
        visitor_id: UUID,
        visit_type: str = "digital",
        source: str | None = None,
        venue_id: UUID | None = None,
    ) -> Visit:
        """Start a new visit for a visitor."""
        # Increment visit count atomically
        from sqlalchemy import update
        self.session.execute(
            update(Visitor)
            .where(Visitor.visitor_id == visitor_id, Visitor.organization_id == organization_id)
            .values(visit_count=Visitor.visit_count + 1)
        )

        visit = Visit(
            organization_id=organization_id,
            visitor_id=visitor_id,
            visit_type=visit_type,
            source=source,
            venue_id=venue_id,
        )
        self.session.add(visit)
        self.session.commit()
        return visit

    def get_or_create_active_visit(
        self,
        organization_id: UUID,
        visitor_id: UUID,
        source: str | None = None,
    ) -> Visit:
        """Get the current active visit or start a new one.

        A visit is considered active if it has no ended_at timestamp.
        """
        visit = self.session.query(Visit).filter(
            Visit.organization_id == organization_id,
            Visit.visitor_id == visitor_id,
            Visit.ended_at.is_(None),
        ).order_by(Visit.started_at.desc()).first()

        if visit:
            return visit

        return self.start_visit(
            organization_id=organization_id,
            visitor_id=visitor_id,
            source=source,
        )

    def end_visit(self, organization_id: UUID, visit_id: UUID) -> Visit | None:
        """End a visit by setting ended_at."""
        visit = self.session.query(Visit).filter(
            Visit.visit_id == visit_id,
            Visit.organization_id == organization_id,
        ).first()
        if not visit:
            return None
        visit.ended_at = datetime.now(timezone.utc)
        self.session.commit()
        return visit

    def record_interaction(
        self,
        organization_id: UUID,
        visit_id: UUID,
        interaction_type: str,
        entity_type: str | None = None,
        entity_id: UUID | None = None,
        metadata: dict | None = None,
    ) -> VisitInteraction:
        """Record a visitor interaction within a visit."""
        interaction = VisitInteraction(
            organization_id=organization_id,
            visit_id=visit_id,
            interaction_type=interaction_type,
            entity_type=entity_type,
            entity_id=entity_id,
            meta=metadata,
        )
        self.session.add(interaction)
        self.session.commit()
        return interaction

    def get_visitor_profile(
        self,
        organization_id: UUID,
        session_token: str,
    ) -> dict | None:
        """Get visitor profile with recent visit summary."""
        visitor = self.session.query(Visitor).filter(
            Visitor.organization_id == organization_id,
            Visitor.session_token == session_token,
        ).first()

        if not visitor:
            return None

        # Get current active visit (org-scoped)
        active_visit = self.session.query(Visit).filter(
            Visit.organization_id == organization_id,
            Visit.visitor_id == visitor.visitor_id,
            Visit.ended_at.is_(None),
        ).order_by(Visit.started_at.desc()).first()

        return {
            "visitor_id": str(visitor.visitor_id),
            "email": visitor.email,
            "display_name": visitor.display_name,
            "locale": visitor.locale,
            "visit_count": visitor.visit_count,
            "first_seen_at": visitor.first_seen_at.isoformat() if visitor.first_seen_at else None,
            "active_visit_id": str(active_visit.visit_id) if active_visit else None,
        }


def get_visitor_service(session) -> VisitorService:
    """Get a VisitorService instance bound to the given SQLAlchemy session."""
    return VisitorService(session=session)
