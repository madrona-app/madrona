"""
Org-scoped Guide usage insights.

Counterpart to the platform-admin /api/admin/guide-analytics (which is
cross-tenant and includes operator-only data — by_org, by_provider, COGS).
This endpoint is scoped to the caller's own organization via require_guide_admin
(the same gate as the Corpus / guide documents endpoints) and deliberately
omits cost, token, provider, latency and cross-org fields.

The headline is `corpus_gaps`: questions where a tool/RAG lookup returned
empty (`empty_tool_results > 0`) — i.e. things the assistant couldn't answer.
That's a to-do list for the org's Corpus, surfaced on the Corpus page so the
gap → fill loop closes where the documents are managed.
"""

import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.guide import GuideContext, require_guide_admin
from app.services.guide_insights import org_guide_insights
from app.services.visitor_insights import org_visitor_insights

logger = logging.getLogger(__name__)

router = APIRouter(tags=["guide"])


@router.get("/api/guide/insights", summary="Org-scoped Guide usage insights")
def get_guide_insights(
    guide_ctx: GuideContext = Depends(require_guide_admin),
    db: Session = Depends(get_db),
    days: int = Query(default=30, ge=1, le=365),
):
    """The caller org's own Guide usage signal (no cost/provider/cross-org data).

    Staff/guide personas only — public visitor traffic is reported separately by
    the /visitors endpoint below.
    """
    return org_guide_insights(db, guide_ctx.organization_id, days)


@router.get("/api/guide/insights/visitors", summary="Org-scoped visitor curiosity insights")
def get_visitor_insights(
    guide_ctx: GuideContext = Depends(require_guide_admin),
    db: Session = Depends(get_db),
    days: int = Query(default=30, ge=1, le=365),
):
    """What the org's public visitors are curious about (persona='visitor')."""
    return org_visitor_insights(db, guide_ctx.organization_id, days)
