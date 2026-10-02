"""
Post-visit email recap service.

Generates and sends a summary email after a visit ends — object thumbnails,
chat highlights, and suggestions for next time. Uses existing AWS SES via
email_service.
"""

import logging
from datetime import datetime, timezone
from html import escape as html_escape
from uuid import UUID

from app.database import current_session
from app.models.visitor import Visit, VisitInteraction, Visitor
from app.models.agent import Conversation, Message

logger = logging.getLogger(__name__)


class VisitRecapService:
    """Generates and sends post-visit email recaps."""

    def generate_recap(self, visit_id: UUID) -> dict | None:
        """Generate recap data for a visit.

        Returns a dict with viewed objects, chat highlights, and visit stats,
        or None if the visit has insufficient data.
        """
        visit = current_session().query(Visit).filter(
            Visit.visit_id == visit_id,
        ).first()
        if not visit:
            return None

        visitor = current_session().query(Visitor).filter(
            Visitor.visitor_id == visit.visitor_id,
        ).first()

        # Gather interactions
        interactions = current_session().query(VisitInteraction).filter(
            VisitInteraction.visit_id == visit_id,
        ).order_by(VisitInteraction.created_at).all()

        if not interactions:
            return None

        # Collect viewed objects
        object_ids = []
        for ix in interactions:
            if ix.interaction_type in ("object_view", "qr_scan") and ix.entity_id:
                if ix.entity_id not in object_ids:
                    object_ids.append(ix.entity_id)

        # Fetch object details for thumbnails
        viewed_objects = []
        if object_ids:
            from app.models import CollectionObject, MediaAsset
            objects = current_session().query(CollectionObject).filter(
                CollectionObject.object_id.in_(object_ids[:12]),
                CollectionObject.organization_id == visit.organization_id,
            ).all()

            for obj in objects:
                title = ""
                if obj.title_links:
                    title = obj.title_links[0].title or ""
                elif obj.object_name:
                    title = obj.object_name

                # Get primary thumbnail
                thumbnail_url = None
                if obj.primary_media_id:
                    media = current_session().query(MediaAsset.thumbnail_url).filter(
                        MediaAsset.media_id == obj.primary_media_id,
                    ).first()
                    if media:
                        thumbnail_url = media.thumbnail_url

                viewed_objects.append({
                    "object_id": str(obj.object_id),
                    "object_number": obj.object_number or "",
                    "title": title,
                    "thumbnail_url": thumbnail_url,
                })

        # Collect chat highlights (assistant messages from this visit's conversations)
        chat_highlights = []
        conversations = current_session().query(Conversation).filter(
            Conversation.visit_id == visit_id,
        ).all()

        for conv in conversations:
            assistant_msgs = current_session().query(Message).filter(
                Message.conversation_id == conv.conversation_id,
                Message.role == "assistant",
            ).order_by(Message.created_at).limit(3).all()

            for msg in assistant_msgs:
                if msg.content and len(msg.content) > 30:
                    # First 200 chars of each response
                    snippet = msg.content[:200]
                    if len(msg.content) > 200:
                        snippet += "..."
                    chat_highlights.append(snippet)

        # Visit stats
        duration_minutes = None
        if visit.ended_at and visit.started_at:
            delta = visit.ended_at - visit.started_at
            duration_minutes = int(delta.total_seconds() / 60)

        return {
            "visit_id": str(visit.visit_id),
            "visitor_name": visitor.display_name if visitor else None,
            "visitor_email": visit.recap_email or (visitor.email if visitor else None),
            "started_at": visit.started_at.isoformat() if visit.started_at else None,
            "duration_minutes": duration_minutes,
            "objects_viewed": viewed_objects,
            "chat_highlights": chat_highlights[:5],
            "interaction_count": len(interactions),
        }

    def render_recap_html(self, recap: dict, org_name: str, org_slug: str) -> tuple[str, str]:
        """Render recap into HTML and plain text email content.

        Returns (html, text) tuple.
        """
        visitor_name = html_escape(recap.get("visitor_name") or "Visitor")
        objects = recap.get("objects_viewed", [])
        highlights = recap.get("chat_highlights", [])
        duration = recap.get("duration_minutes")

        # HTML version
        html_parts = [
            '<div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #1C1C1C;">',
            f'<h2 style="color: #1F3A2E;">Thanks for visiting, {visitor_name}!</h2>',
        ]

        if duration:
            html_parts.append(f'<p style="color: #6B7A7E;">You spent about {int(duration)} minutes exploring.</p>')

        if objects:
            html_parts.append('<h3 style="color: #1F3A2E;">Objects you explored</h3>')
            html_parts.append('<div style="display: flex; flex-wrap: wrap; gap: 12px;">')
            for obj in objects[:8]:
                thumb = html_escape(obj.get("thumbnail_url") or "")
                title = html_escape(obj.get("title") or obj.get("object_number", ""))
                obj_url = html_escape(f"/c/{org_slug}/objects/{obj['object_id']}")
                html_parts.append(
                    f'<div style="width: 120px; text-align: center;">'
                    f'<a href="{obj_url}" style="text-decoration: none; color: #8E3B2F;">'
                )
                if thumb:
                    html_parts.append(
                        f'<img src="{thumb}" alt="{title}" '
                        f'style="width: 120px; height: 120px; object-fit: cover; border-radius: 4px;" />'
                    )
                html_parts.append(
                    f'<p style="font-size: 12px; margin-top: 4px;">{title[:50]}</p>'
                    f'</a></div>'
                )
            html_parts.append('</div>')

        if highlights:
            html_parts.append('<h3 style="color: #1F3A2E; margin-top: 24px;">From your conversation with Madrona</h3>')
            for h in highlights[:3]:
                html_parts.append(f'<p style="color: #595959; font-style: italic; border-left: 3px solid #B87333; padding-left: 12px;">"{html_escape(h)}"</p>')

        html_parts.append(
            f'<p style="margin-top: 32px;"><a href="/c/{org_slug}" '
            f'style="background-color: #8E3B2F; color: #F6F2EC; padding: 10px 24px; '
            f'text-decoration: none; border-radius: 4px;">Plan your next visit</a></p>'
        )
        html_parts.append(f'<p style="color: #6B7A7E; font-size: 12px; margin-top: 32px;">{html_escape(org_name)}</p>')
        html_parts.append('</div>')

        html = "\n".join(html_parts)

        # Plain text version
        text_parts = [
            f"Thanks for visiting, {visitor_name}!",
            "",
        ]
        if duration:
            text_parts.append(f"You spent about {duration} minutes exploring.")
            text_parts.append("")

        if objects:
            text_parts.append("Objects you explored:")
            for obj in objects[:8]:
                text_parts.append(f"  - {obj.get('title') or obj.get('object_number', '')}")
            text_parts.append("")

        if highlights:
            text_parts.append("From your conversation with Madrona:")
            for h in highlights[:3]:
                text_parts.append(f'  "{h}"')
            text_parts.append("")

        text_parts.append(f"Plan your next visit: /c/{org_slug}")
        text_parts.append(f"\n{org_name}")

        text = "\n".join(text_parts)

        return html, text

    def send_recap(self, visit_id: UUID) -> bool:
        """Generate and send a recap email for a visit.

        Returns True if sent successfully.
        """
        recap = self.generate_recap(visit_id)
        if not recap:
            logger.info("No recap data for visit %s", visit_id)
            return False

        email = recap.get("visitor_email")
        if not email:
            logger.info("No email for visit %s recap", visit_id)
            return False

        # Get organization info
        visit = current_session().query(Visit).filter(Visit.visit_id == visit_id).first()
        if not visit:
            return False

        from app.models import Organization
        org = current_session().query(Organization).filter(
            Organization.organization_id == visit.organization_id,
        ).first()
        if not org:
            return False

        html, text = self.render_recap_html(recap, org.name, org.slug)

        from app.services.email_service import get_email_service
        email_service = get_email_service()
        success = email_service.send_email(
            channel="notifications",
            to=[email],
            subject=f"Your visit to {org.name} — a recap",
            html=html,
            text=text,
            tags={"type": "visit-recap", "visit_id": str(visit_id)},
        )

        if success:
            visit.recap_sent_at = datetime.now(timezone.utc)
            visit.recap_email = email
            current_session().commit()
            logger.info("Recap sent for visit %s to %s", visit_id, email)

        return success


# Singleton
_recap_service: VisitRecapService | None = None


def get_visit_recap_service() -> VisitRecapService:
    global _recap_service
    if _recap_service is None:
        _recap_service = VisitRecapService()
    return _recap_service
