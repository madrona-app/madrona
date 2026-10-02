"""
Contact/constituent search tool for the agent.

Allows the assistant to find people and organizations in the contacts
database — donors, artists, lenders, vendors, conservators, etc.
"""

import logging

from sqlalchemy import or_

from app.services.agent_tools import AgentContext, ToolRegistry

logger = logging.getLogger(__name__)


def search_contacts(args: dict, ctx: AgentContext) -> dict:
    """Search contacts/constituents by name, role, or type."""
    from app.models.contacts import Constituent

    db = ctx.db_session
    org_id = ctx.organization_id

    query_text = args.get("query", "").strip()
    constituent_type = args.get("type")
    limit = min(args.get("limit", 10), 25)

    if not query_text:
        return {"error": "query is required"}

    q = db.query(Constituent).filter(
        Constituent.organization_id == org_id,
        Constituent.status == "active",
    )

    pattern = f"%{query_text}%"
    q = q.filter(or_(
        Constituent.name.ilike(pattern),
        Constituent.display_name.ilike(pattern),
        Constituent.organization_name.ilike(pattern),
        Constituent.email.ilike(pattern),
    ))

    if constituent_type:
        q = q.filter(Constituent.constituent_type == constituent_type)

    results = q.order_by(Constituent.name.asc()).limit(limit).all()

    return {
        "contacts": [
            {
                "constituent_id": str(c.constituent_id),
                "name": c.display_name or c.name,
                "type": c.constituent_type,
                "organization": c.organization_name,
                "role": c.role,
                "email": c.email,
                "phone": c.phone,
                "department": c.department,
                "is_verified": c.is_verified,
            }
            for c in results
        ],
        "total": len(results),
    }


def register_contact_tools(registry: ToolRegistry) -> None:
    """Register contact search tools."""
    registry.register(
        name="search_contacts",
        description=(
            "Search the contacts database for people and organizations — donors, "
            "artists, lenders, borrowers, vendors, conservators, appraisers, "
            "couriers, and other constituents. Use this when someone asks 'who is "
            "our conservator?', 'find the lender for this loan', or 'contact info "
            "for the shipping company'."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Name, email, or organization to search for.",
                },
                "type": {
                    "type": "string",
                    "description": "Filter by constituent type.",
                    "enum": ["person", "organization", "corporate_body", "family",
                             "department", "estate", "dealer", "auction_house"],
                },
                "limit": {
                    "type": "integer",
                    "description": "Max results (default 10, max 25).",
                },
            },
            "required": ["query"],
        },
        handler=search_contacts,
        personas=["staff"],
    )
