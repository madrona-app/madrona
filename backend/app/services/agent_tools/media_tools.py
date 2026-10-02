"""
Media/DAM search tools for the agent.

Allows the assistant to search for images, documents, and AV files
in the digital asset management system and retrieve detailed metadata.
"""

import logging

from sqlalchemy import or_, func

from app.services.agent_tools import AgentContext, ToolRegistry

logger = logging.getLogger(__name__)


def search_media(args: dict, ctx: AgentContext) -> dict:
    """Search media assets by keyword, type, or linked object."""
    from app.models.media import Media

    db = ctx.db_session
    org_id = ctx.organization_id

    query_text = args.get("query", "").strip()
    media_type = args.get("media_type")
    limit = min(args.get("limit", 10), 25)

    q = db.query(Media).filter(Media.organization_id == org_id)

    if query_text:
        pattern = f"%{query_text}%"
        q = q.filter(or_(
            Media.title.ilike(pattern),
            Media.filename.ilike(pattern),
            Media.description.ilike(pattern),
            Media.credit.ilike(pattern),
            Media.creator.ilike(pattern),
        ))

    if media_type:
        q = q.filter(Media.media_type == media_type)

    results = q.order_by(Media.created_at.desc()).limit(limit).all()

    return {
        "media": [
            {
                "media_id": str(m.media_id),
                "filename": m.filename,
                "title": m.title,
                "media_type": m.media_type,
                "mime_type": m.mime_type,
                "file_size": m.file_size,
                "description": (m.description or "")[:300],
                "credit": m.credit,
                "is_published": m.is_published,
                "processing_status": m.processing_status,
            }
            for m in results
        ],
        "total": len(results),
    }


def get_media_detail(args: dict, ctx: AgentContext) -> dict:
    """Get detailed metadata for a specific media asset."""
    from uuid import UUID as _UUID
    from app.models.media import Media

    media_id = args.get("media_id", "").strip()
    if not media_id:
        return {"error": "media_id is required"}

    try:
        mid = _UUID(media_id)
    except (ValueError, TypeError):
        return {"error": "Invalid media_id format"}

    db = ctx.db_session
    m = db.query(Media).filter(
        Media.media_id == mid,
        Media.organization_id == ctx.organization_id,
    ).first()

    if not m:
        return {"error": "Media not found"}

    result = {
        "media_id": str(m.media_id),
        "filename": m.filename,
        "title": m.title,
        "media_type": m.media_type,
        "mime_type": m.mime_type,
        "file_size": m.file_size,
        "description": (m.description or "")[:500],
        "alt_text": m.alt_text,
        "credit": m.credit,
        "creator": m.creator,
        "source": m.source,
        "date_created": m.date_created.isoformat() if m.date_created else None,
        "copyright_status": m.copyright_status,
        "rights_statement": (m.rights_statement or "")[:500],
        "is_published": m.is_published,
        "processing_status": m.processing_status,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }

    # Linked objects
    from app.models.media import CollectionObjectMedia
    from app.models.objects import CollectionObject
    links = (
        db.query(CollectionObjectMedia, CollectionObject)
        .join(CollectionObject, CollectionObjectMedia.object_id == CollectionObject.object_id, isouter=True)
        .filter(
            CollectionObjectMedia.media_id == mid,
            CollectionObject.organization_id == ctx.organization_id,
        )
        .limit(10)
        .all()
    )
    if links:
        result["linked_objects"] = [
            {
                "object_id": str(obj.object_id),
                "object_number": obj.object_number,
                "name": obj.object_name,
            }
            for link, obj in links if obj
        ]

    return result


def register_media_tools(registry: ToolRegistry) -> None:
    """Register media search tools."""
    registry.register(
        name="search_media",
        description=(
            "Search the digital asset library for images, documents, audio, or video. "
            "Use this when someone asks 'do we have a photo of this object?', "
            "'find the conservation report PDF', or 'show me images of ceramics'."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search term (filename, title, description, creator).",
                },
                "media_type": {
                    "type": "string",
                    "description": "Filter by type.",
                    "enum": ["image", "video", "audio", "document"],
                },
                "limit": {
                    "type": "integer",
                    "description": "Max results (default 10, max 25).",
                },
            },
        },
        handler=search_media,
        personas=["staff"],
    )

    registry.register(
        name="get_media_detail",
        description=(
            "Get detailed metadata for a specific media asset — file info, rights, "
            "credit, description, and which objects it's linked to. Use this after "
            "search_media to get full details on a specific file."
        ),
        parameters={
            "type": "object",
            "properties": {
                "media_id": {
                    "type": "string",
                    "description": "UUID of the media asset.",
                },
            },
            "required": ["media_id"],
        },
        handler=get_media_detail,
        personas=["staff"],
    )
