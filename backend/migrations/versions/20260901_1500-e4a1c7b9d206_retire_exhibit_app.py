"""retire_exhibit_app

Revision ID: e4a1c7b9d206
Revises: d3e7f1a9c2b4
Create Date: 2026-09-01 15:00:00.000000

Removes 'exhibit' as a registered application.

Exhibit shipped as a separate app whose distinguishing feature was the
virtual gallery designer (place artwork on walls, simulate lighting).
That viewer has been removed, and everything else it offered —
exhibitions, venues, checklists, label templates — now lives under
Collections, with the old /exhibit routes already redirecting there. The
application row was all that remained, and it showed up as an app tab in
Role Management and in the app switcher for a product that no longer
exists.

What this migration does NOT remove: the exhibit.* permissions. The
Exhibitions section of Collections is gated on 'exhibit.view', so
dropping those permissions would hide a working feature.

One config value has to survive. ExhibitObjectSourceService reads
organization_applications.config->>'object_source' off the exhibit row to
decide whether an exhibition sources its objects from Collections or from
Bridge. With exhibitions now owned by Collections, the service reads that
key off the collections row instead, so this migration copies the value
across before deleting anything. Orgs that never set it are unaffected —
the service defaults to 'collections'.

# MADRONA_MIGRATION_STRATEGY: owner
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4a1c7b9d206'
down_revision: Union[str, None] = 'd3e7f1a9c2b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Carry object_source onto the collections row for any org that set it.
    # jsonb_set needs an existing object; config defaults to '{}' so
    # coalesce guards the null case.
    conn.execute(sa.text("""
        UPDATE organization_applications AS coll
        SET config = jsonb_set(
                COALESCE(coll.config, '{}'::jsonb),
                '{object_source}',
                ex.config -> 'object_source',
                true
            )
        FROM organization_applications AS ex
        JOIN applications AS ex_app
          ON ex_app.application_id = ex.application_id
         AND ex_app.key = 'exhibit'
        JOIN applications AS coll_app
          ON coll_app.key = 'collections'
        WHERE coll.organization_id = ex.organization_id
          AND coll.application_id = coll_app.application_id
          AND ex.config ? 'object_source'
    """))

    # Per-user app role overrides scoped to the retired app.
    conn.execute(sa.text(
        "DELETE FROM app_role_assignments WHERE app_key = 'exhibit'"
    ))

    # Org enablement rows, then the application itself.
    conn.execute(sa.text("""
        DELETE FROM organization_applications
        WHERE application_id IN (
            SELECT application_id FROM applications WHERE key = 'exhibit'
        )
    """))
    conn.execute(sa.text("DELETE FROM applications WHERE key = 'exhibit'"))


def downgrade() -> None:
    conn = op.get_bind()

    # Restore the application row with its original id, so any historical
    # reference to it resolves.
    conn.execute(sa.text("""
        INSERT INTO applications (
            application_id, key, display_name, description, icon,
            default_enabled, requires_contract, sort_order, status
        )
        VALUES (
            '47550464-5f47-42a7-ad7e-48f1e3392bf0', 'exhibit', 'Exhibit',
            'Exhibition planning and virtual gallery design - place artwork '
            'on walls, simulate lighting, and export installation specs',
            'Frame', false, true, 6, 'active'
        )
        ON CONFLICT (key) DO NOTHING
    """))

    # Re-enable for every org that has Collections, which is the closest
    # reconstruction available: the original per-org rows are gone.
    conn.execute(sa.text("""
        INSERT INTO organization_applications (organization_id, application_id, enabled)
        SELECT coll.organization_id, ex_app.application_id, true
        FROM organization_applications AS coll
        JOIN applications AS coll_app
          ON coll_app.application_id = coll.application_id
         AND coll_app.key = 'collections'
        JOIN applications AS ex_app ON ex_app.key = 'exhibit'
        ON CONFLICT DO NOTHING
    """))
