"""
Madrona models package.

Re-exports all models from sub-modules so that:
  - ``from app.models import Base`` works (used by Alembic)
  - ``from app.models import Organization`` works (used everywhere)
  - All model classes are registered with Base.metadata on import
"""

# Re-export Base and db so callers don't need to change
from app.database import Base  # noqa: F401

# Re-export helpers for any code that did ``from app.models import uuid_pk``
from app.models._helpers import (  # noqa: F401
    JSONType,
    uuid_pk,
    uuid_fk,
    uuid_fk_nullable,
    timestamp_now,
    timestamp_updated,
)

# Import all sub-modules to register models with Base.metadata
from app.models.core import *  # noqa: F401,F403
from app.models.vocabulary import *  # noqa: F401,F403
from app.models.departments import *  # noqa: F401,F403
from app.models.locations import *  # noqa: F401,F403
from app.models.objects import *  # noqa: F401,F403
from app.models.contacts import *  # noqa: F401,F403
from app.models.procedures import *  # noqa: F401,F403
from app.models.signed_documents import *  # noqa: F401,F403
from app.models.media import *  # noqa: F401,F403
from app.models.logistics import *  # noqa: F401,F403
from app.models.compliance import *  # noqa: F401,F403
from app.models.authorities import *  # noqa: F401,F403
from app.models.workspaces import *  # noqa: F401,F403
from app.models.events import *  # noqa: F401,F403
from app.models.discover import *  # noqa: F401,F403
from app.models.exhibit import *  # noqa: F401,F403
from app.models.content import *  # noqa: F401,F403
from app.models.budget import *  # noqa: F401,F403
from app.models.checklists import *  # noqa: F401,F403
from app.models.tasks import *  # noqa: F401,F403
from app.models.insurance import *  # noqa: F401,F403
from app.models.loans import *  # noqa: F401,F403
from app.models.info_requests import *  # noqa: F401,F403
from app.models.provisioning import *  # noqa: F401,F403
from app.models.sla import *  # noqa: F401,F403
from app.models.uri import *  # noqa: F401,F403
from app.models.reports import *  # noqa: F401,F403
from app.models.agent import *  # noqa: F401,F403
from app.models.agent_plans import *  # noqa: F401,F403
from app.models.agent_plan_metrics import *  # noqa: F401,F403
from app.models.agent_drafts import *  # noqa: F401,F403
from app.models.visitor import *  # noqa: F401,F403
from app.models.preservation import *  # noqa: F401,F403
from app.models.nagpra import *  # noqa: F401,F403
from app.models.reference import *  # noqa: F401,F403
from app.models.layout_preferences import *  # noqa: F401,F403
from app.models.guide_document import *  # noqa: F401,F403
from app.models.sequence import *  # noqa: F401,F403

# Orphan: GuideMetric lives under services/ but inherits from Base. Without
# this import, the alembic-fallback path (Base.metadata.create_all) does not
# know about the guide_metrics table and inserts fail with UndefinedTable.
from app.services.agent_monitoring import GuideMetric  # noqa: F401
