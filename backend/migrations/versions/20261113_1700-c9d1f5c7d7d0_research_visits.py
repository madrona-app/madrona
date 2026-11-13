"""Add the research visit log

collections.research_visits records an in-person visit by a researcher: who
(free-text name and affiliation, optionally a linked person record), when
(date, optional arrival and departure times), where, why, the supervising
staff member, notes, and optionally the use request that authorised it.

collections.research_visit_objects links a visit to the objects used, with an
optional handling note and an optional note on condition when returned.

Row-level security is applied by seeds/seed_rls_policies.py, which runs at
boot (both tables are in RLS_TABLES/RLS_POLICIES), the same as every other
org-scoped table since the consolidated schema.

Revision ID: c9d1f5c7d7d0
Revises: d2b8e4f0c312
"""
from alembic import op

revision = "c9d1f5c7d7d0"
down_revision = "d2b8e4f0c312"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS collections.research_visits (
            visit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL
                REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
            researcher_constituent_id UUID
                REFERENCES collections.constituents(constituent_id) ON DELETE SET NULL,
            researcher_name VARCHAR(255) NOT NULL,
            researcher_affiliation VARCHAR(255),
            visit_date DATE NOT NULL,
            arrival_time TIME WITHOUT TIME ZONE,
            departure_time TIME WITHOUT TIME ZONE,
            location VARCHAR(255),
            research_topic VARCHAR(500),
            purpose TEXT,
            supervised_by_user_id UUID
                REFERENCES public.users(user_id) ON DELETE SET NULL,
            supervised_by_name VARCHAR(255),
            use_request_id UUID
                REFERENCES collections.use_requests(request_id) ON DELETE SET NULL,
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
            CONSTRAINT check_research_visit_times CHECK (
                arrival_time IS NULL OR departure_time IS NULL
                OR departure_time >= arrival_time
            )
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_research_visits_org_date "
        "ON collections.research_visits (organization_id, visit_date)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_research_visits_constituent "
        "ON collections.research_visits (researcher_constituent_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_research_visits_use_request "
        "ON collections.research_visits (use_request_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS collections.research_visit_objects (
            visit_object_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            visit_id UUID NOT NULL
                REFERENCES collections.research_visits(visit_id) ON DELETE CASCADE,
            organization_id UUID NOT NULL
                REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
            object_id UUID NOT NULL
                REFERENCES collections.collection_objects(object_id) ON DELETE CASCADE,
            handling_note TEXT,
            condition_on_return TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
            CONSTRAINT uq_research_visit_objects_visit_object UNIQUE (visit_id, object_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_research_visit_objects_object "
        "ON collections.research_visit_objects (organization_id, object_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS collections.research_visit_objects")
    op.execute("DROP TABLE IF EXISTS collections.research_visits")
