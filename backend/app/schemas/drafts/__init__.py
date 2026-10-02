"""Typed payload schemas for the agent_drafts envelope (Guide Studio v1 §1.1).

Each entity-type a write tool can propose has a Pydantic payload schema here.
`draft_service.create_draft` validates the tool's payload through the schema
registered for its `entity_type` before persisting — so a hallucinated or
malformed field is rejected at draft-creation, not at apply time.

The entity_type → schema *registry* is assembled by the factory
(`services/drafts/factory/registry.build_payload_schemas`) from the
`ENTITY_DRAFT_SPECS` list, and consumed lazily by `draft_service` — schemas are
the lower layer and never import the service-layer factory, which keeps the
draft_service ↔ factory cycle broken.
"""

from app.schemas.drafts.base import Citation, CitationKind
from app.schemas.drafts.condition_report import ConditionReportDraftPayload

__all__ = [
    "Citation",
    "CitationKind",
    "ConditionReportDraftPayload",
]
