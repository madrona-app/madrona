"""
Visitor information tools for the agent.

These tools answer practical visitor questions about wayfinding and
accessibility. They search the organization's uploaded documents for
this information.

⚠️  REQUIRES ORGANIZATION DOCUMENTS: These tools search the org's
uploaded Guide documents for floor plans, wayfinding guides, and
accessibility information. They return no results unless the museum
has uploaded relevant documents.
"""

import logging

from app.services.agent_tools import AgentContext, ToolRegistry
from app.services.agent_tools.reference_tools import _embed_query, _search_chunks

logger = logging.getLogger(__name__)


def get_directions(args: dict, ctx: AgentContext) -> dict:
    """
    Search uploaded documents for wayfinding and directions information.

    ⚠️ Requires organization documents: floor plans, gallery maps,
    wayfinding guides uploaded via Guide document management.
    """
    query = args.get("query", "").strip()
    if not query:
        return {"error": "query is required"}

    # Prepend wayfinding context to improve retrieval
    search_query = f"directions wayfinding location gallery floor plan {query}"

    query_vec = _embed_query(search_query)
    if not query_vec:
        return {"error": "Search service unavailable"}

    # Visitors only see public docs
    is_visitor = ctx.persona == "visitor"

    result = _search_chunks(
        query_vec,
        ctx,
        org_only=True,
        public_only=is_visitor,
        limit=4,
    )

    if not result.get("results"):
        return {
            "results": [],
            "message": "No wayfinding information found. The museum may not have uploaded floor plans or gallery guides yet.",
        }

    return result


def check_accessibility(args: dict, ctx: AgentContext) -> dict:
    """
    Search uploaded documents for accessibility information.

    ⚠️ Requires organization documents: accessibility guides, ADA
    compliance docs, sensory-friendly schedules uploaded via Guide.
    """
    query = args.get("query", "").strip()
    if not query:
        query = "accessibility"

    search_query = f"accessibility wheelchair ADA sensory hearing visual {query}"

    query_vec = _embed_query(search_query)
    if not query_vec:
        return {"error": "Search service unavailable"}

    is_visitor = ctx.persona == "visitor"

    result = _search_chunks(
        query_vec,
        ctx,
        org_only=True,
        public_only=is_visitor,
        limit=4,
    )

    if not result.get("results"):
        return {
            "results": [],
            "message": "No accessibility information found. The museum may not have uploaded accessibility guides yet.",
        }

    return result


def register_visitor_info_tools(registry: ToolRegistry) -> None:
    """Register visitor information tools."""
    registry.register(
        name="get_directions",
        description=(
            "Search for wayfinding and directions information — how to get to a "
            "specific gallery, floor plans, building layout. This searches the "
            "museum's uploaded documents for maps and guides. Use this when someone "
            "asks 'how do I get to gallery 204?' or 'where is the gift shop?'"
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "What the person is looking for (e.g., 'gallery 204', 'restrooms', 'gift shop').",
                },
            },
            "required": ["query"],
        },
        handler=get_directions,
        personas=["visitor", "staff"],
    )

    registry.register(
        name="check_accessibility",
        description=(
            "Search for accessibility information — wheelchair access, audio guides, "
            "sensory-friendly hours, assistive devices, sign language interpreters. "
            "This searches the museum's uploaded documents for accessibility policies "
            "and guides. Use this when someone asks about accessibility needs."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Specific accessibility need (e.g., 'wheelchair', 'hearing loop', 'sensory-friendly'). Leave empty for general accessibility info.",
                },
            },
        },
        handler=check_accessibility,
        personas=["visitor", "staff"],
    )
