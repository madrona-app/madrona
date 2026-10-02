"""Guide Studio v1 Phase 1 — the agent_drafts envelope.

The polymorphic drafts table (v1 plan §1.1, option c): proposed write-work is
captured as a reviewable, auditable envelope and only cascades to the live
entity on approval. One table, one RLS policy, one inbox query — instead of an
`is_draft` flag on every entity or a shadow table per entity.

RLS is applied by `seeds/seed_rls_policies.py` (agent_drafts added to RLS_TABLES
+ policies), matching how agent_plans is governed.

Revision ID: agent_drafts_v1
Revises: guide_approve_plan_perm
Create Date: 2026-05-23 10:00:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "agent_drafts_v1"
down_revision: Union[str, Sequence[str], None] = "guide_approve_plan_perm"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ACTIONS = ("create", "update", "link")
_STATUSES = (
    "pending",
    "approved",
    "rejected",
    "superseded",
    "cancelled",
    "expired",
)
_ACTION_LIST = ", ".join(f"'{a}'" for a in _ACTIONS)
_STATUS_LIST = ", ".join(f"'{s}'" for s in _STATUSES)


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS agent_drafts (
            draft_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL
                REFERENCES organizations(organization_id) ON DELETE CASCADE,
            plan_id UUID
                REFERENCES agent_plans(plan_id) ON DELETE SET NULL,
            plan_step_id UUID
                REFERENCES agent_plan_steps(step_id) ON DELETE SET NULL,
            conversation_id UUID
                REFERENCES conversations(conversation_id) ON DELETE SET NULL,
            proposed_by_user_id UUID NOT NULL
                REFERENCES users(user_id),
            proposed_by_persona VARCHAR(50),
            entity_type TEXT NOT NULL,
            intended_action TEXT NOT NULL
                CHECK (intended_action IN ({_ACTION_LIST})),
            target_entity_id UUID,
            payload JSONB NOT NULL,
            rationale TEXT,
            citations JSONB,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ({_STATUS_LIST})),
            approval_request_id UUID
                REFERENCES approval_requests(request_id) ON DELETE SET NULL,
            supersedes_draft_id UUID
                REFERENCES agent_drafts(draft_id) ON DELETE SET NULL,
            decided_by_user_id UUID
                REFERENCES users(user_id) ON DELETE SET NULL,
            decided_at TIMESTAMP WITH TIME ZONE,
            applied_entity_id UUID,
            apply_error TEXT,
            model_provider TEXT,
            model_id TEXT,
            model_version TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    # Inbox + lifecycle indexes (v1 §Phase 1 scope: org_id, status, plan_id,
    # entity_type).
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_drafts_org "
        "ON agent_drafts (organization_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_drafts_org_status "
        "ON agent_drafts (organization_id, status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_drafts_plan "
        "ON agent_drafts (plan_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_agent_drafts_entity_type "
        "ON agent_drafts (organization_id, entity_type)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS agent_drafts")
