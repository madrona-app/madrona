"""Mask secrets already written to entity history

Entity history now masks secrets as they are recorded (MASKED_VALUE in
app/services/entity_audit.py). Media collections were tracked before that,
so their public share link token and share password hash may already be in
entity_audit_field_diffs. Replace any such stored value with "(hidden)",
keeping the row so the history still says the share link changed.

Data only; no schema change. Downgrade is a no-op (the values are gone by
design).

Revision ID: c7e2a94d1b36
Revises: f4d82b0a5c39
"""
from alembic import op

# MADRONA_MIGRATION_STRATEGY: owner
# Runs as the database owner (alembic), so the UPDATE reaches every organization's rows.

revision = "c7e2a94d1b36"
down_revision = "f4d82b0a5c39"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for side in ("old_value", "new_value"):
        op.execute(
            f"""
            UPDATE public.entity_audit_field_diffs d
               SET {side} = to_jsonb('(hidden)'::text)
              FROM public.entity_audit_events e
             WHERE d.event_id = e.event_id
               AND e.entity_type = 'media_collection'
               AND d.field_name IN ('public_share_token', 'public_share_password_hash')
               AND d.{side} IS NOT NULL
               AND d.{side} <> 'null'::jsonb
               AND d.{side} <> to_jsonb('(hidden)'::text)
            """
        )


def downgrade() -> None:
    pass
