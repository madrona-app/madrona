"""Write tools that propose drafts (Guide Studio v1 §1.3, v2 scale-out).

Each tool NEVER writes a live entity — it creates an `agent_drafts` row via
`draft_service.create_draft`. Tools are persona-allowlisted (condition reports →
conservator) so drafts flow through delegation / templates, not free-form staff
chat: this closes "Guide silently writes" at the design level.

The tools are now generated declaratively by the factory
(`services/drafts/factory`): `register_draft_tools` registers every
`propose_<entity>_draft` from `ENTITY_DRAFT_SPECS`, so adding an entity is one
spec declaration with no edit here.
"""

import logging

from app.services.agent_tools import ToolRegistry
from app.services.drafts.factory.generator import make_handler
from app.services.drafts.factory.registry import ENTITY_DRAFT_SPECS
from app.services.drafts.factory.wiring import register_factory_draft_tools

logger = logging.getLogger(__name__)


def _handler_for(entity_type: str):
    spec = next(s for s in ENTITY_DRAFT_SPECS if s.entity_type == entity_type)
    return make_handler(spec)


# Backward-compatible export: the generated condition-report handler. Existing
# imports (tests, callers) of `propose_condition_report_draft` keep working; it
# is now the factory-generated handler rather than a hand-written one.
propose_condition_report_draft = _handler_for("condition_report")


def register_draft_tools(registry: ToolRegistry) -> None:
    register_factory_draft_tools(registry)
