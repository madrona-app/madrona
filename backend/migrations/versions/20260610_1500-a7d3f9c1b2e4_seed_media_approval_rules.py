"""seed media approval rules + backfill orphaned media draft gates

The media DAM draft gates (entity types ``media_rights`` / ``media_review`` /
``media_publish``) were never added to ``DEFAULT_RULES``, so
``check_approval_required()`` returned ``None`` and media drafts were created
with NO approval request (``approval_request_id IS NULL``). The plan
``draft_approval`` gate then had nothing to approve — the plan deadlocked and
nothing surfaced on the Approvals page.

``seed_default_rules`` only runs at org *provisioning* (platform_admin), never
in the deploy sequence, so existing orgs need this migration to pick up the new
rules. (New orgs get them from the updated ``DEFAULT_RULES``; the
``media.approve_rights`` / ``media.approve_review`` permissions + role grants
ship via ``seed_roles_and_permissions``, which runs on every deploy.)

This migration, idempotently:
  1. seeds the 3 media approval rules for every org that already has approval
     governance (any existing approval rule), and
  2. backfills approval requests for any pending ``media_*`` agent draft left
     orphaned by the bug, then links the draft to it.

Revision ID: a7d3f9c1b2e4
Revises: 498996a46506
Create Date: 2026-06-10 15:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# MADRONA_MIGRATION_STRATEGY: owner
# Runs as the DB owner (BYPASSRLS). Every INSERT sets organization_id
# explicitly, scoped per existing org — no reliance on RLS session context.

# revision identifiers, used by Alembic.
revision: str = 'a7d3f9c1b2e4'
down_revision: Union[str, Sequence[str], None] = '498996a46506'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (entity_type, approver_permission, description) — mirror of the media entries
# added to approval_service.DEFAULT_RULES.
MEDIA_RULES = [
    ("media_rights", "media.approve_rights", "Media rights/license sign-off"),
    ("media_review", "media.approve_review", "Sensitive-content review sign-off (required before publish)"),
    ("media_publish", "media.publish", "Media publish sign-off (hard-gated on rights + review)"),
]


def upgrade() -> None:
    conn = op.get_bind()

    # 1) Seed the media rules for every org that already has approval governance.
    #    Scope to orgs with at least one existing approval_rule (i.e. approvals
    #    were provisioned for them) and skip any rule that already exists.
    for entity_type, perm, descr in MEDIA_RULES:
        conn.execute(
            sa.text(
                """
                INSERT INTO public.approval_rules
                    (rule_id, organization_id, entity_type, trigger_action,
                     approver_permission, description, is_active, created_at)
                SELECT gen_random_uuid(), o.organization_id, (:et)::text, 'create',
                       (:perm)::text, (:descr)::text, true, now()
                FROM (SELECT DISTINCT organization_id FROM public.approval_rules) o
                -- WHERE NOT EXISTS rather than ON CONFLICT on a named constraint:
                -- the unique constraint name is not guaranteed to exist /match
                -- across environments. Casts avoid AmbiguousParameter on :et.
                WHERE NOT EXISTS (
                    SELECT 1 FROM public.approval_rules ar
                    WHERE ar.organization_id = o.organization_id
                      AND ar.entity_type = (:et)::text
                      AND ar.trigger_action = 'create'
                )
                """
            ),
            {"et": entity_type, "perm": perm, "descr": descr},
        )

    # 2) Backfill approval requests for orphaned pending media_* drafts so any
    #    deadlocked plan gate becomes actionable. Only touches drafts with a
    #    NULL approval_request_id (idempotent) and a known proposer.
    conn.execute(
        sa.text(
            """
            WITH orphaned AS (
                SELECT d.draft_id, d.organization_id, d.entity_type,
                       d.proposed_by_user_id
                FROM public.agent_drafts d
                WHERE d.status = 'pending'
                  AND d.approval_request_id IS NULL
                  AND d.proposed_by_user_id IS NOT NULL
                  AND d.entity_type IN ('media_rights', 'media_review', 'media_publish')
            ),
            matched AS (
                SELECT o.draft_id, o.organization_id, o.entity_type,
                       o.proposed_by_user_id, ar.rule_id
                FROM orphaned o
                JOIN public.approval_rules ar
                  ON ar.organization_id = o.organization_id
                 AND ar.entity_type = o.entity_type
                 AND ar.trigger_action = 'create'
            ),
            ins AS (
                INSERT INTO public.approval_requests
                    (request_id, rule_id, organization_id, entity_type, entity_id,
                     requested_by, requested_action, status, created_at)
                SELECT gen_random_uuid(), m.rule_id, m.organization_id, 'agent_draft',
                       m.draft_id, m.proposed_by_user_id,
                       jsonb_build_object(
                           'draft_id', m.draft_id::text,
                           'entity_type', m.entity_type,
                           'action', 'create'
                       ),
                       'pending', now()
                FROM matched m
                RETURNING request_id, entity_id
            )
            UPDATE public.agent_drafts d
            SET approval_request_id = ins.request_id
            FROM ins
            WHERE d.draft_id = ins.entity_id
            """
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    # Remove the media rules this migration seeded. Backfilled approval requests
    # are intentionally left in place — deleting transactional approval records
    # on downgrade would be more destructive than the rule cleanup warrants.
    conn.execute(
        sa.text(
            """
            DELETE FROM public.approval_rules
            WHERE trigger_action = 'create'
              AND entity_type IN ('media_rights', 'media_review', 'media_publish')
            """
        )
    )
