"""Add portal members and their saved personal collections

collections.portal_members: people an organization has approved to keep
personal collections on its public portal. A separate identity from staff
users: no password, no role, no organization membership.

collections.portal_member_login_tokens: one-time emailed sign-in links, stored
as a keyed hash, single use, 15-minute expiry.

collections.member_collections / collections.member_collection_items: a
member's named collections and the portal objects saved in them.

collections.discover_configs.member_collections_enabled: the feature switch,
off by default.

Row-level security is applied by seeds/seed_rls_policies.py, which runs at
boot (all four tables are in RLS_TABLES/RLS_POLICIES).

Revision ID: b7e3a9c41f62
Revises: d5f2b8c4a016
"""
from alembic import op

revision = "b7e3a9c41f62"
down_revision = "d5f2b8c4a016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE collections.discover_configs "
        "ADD COLUMN IF NOT EXISTS member_collections_enabled BOOLEAN NOT NULL DEFAULT false"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS collections.portal_members (
            member_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL
                REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
            email VARCHAR(320) NOT NULL,
            display_name VARCHAR(255),
            status VARCHAR(20) NOT NULL DEFAULT 'invited',
            invited_by_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
            approved_by_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
            approved_at TIMESTAMP WITH TIME ZONE,
            last_sign_in_at TIMESTAMP WITH TIME ZONE,
            session_version INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_portal_members_org_email UNIQUE (organization_id, email),
            CONSTRAINT check_portal_member_status
                CHECK (status IN ('invited', 'active', 'suspended'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_portal_members_org_status "
        "ON collections.portal_members (organization_id, status)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS collections.portal_member_login_tokens (
            token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL
                REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
            member_id UUID NOT NULL
                REFERENCES collections.portal_members(member_id) ON DELETE CASCADE,
            token_hash VARCHAR(64) NOT NULL UNIQUE,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            used_at TIMESTAMP WITH TIME ZONE,
            created_by_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_portal_member_login_tokens_member "
        "ON collections.portal_member_login_tokens (member_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS collections.member_collections (
            collection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL
                REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
            member_id UUID NOT NULL
                REFERENCES collections.portal_members(member_id) ON DELETE CASCADE,
            name VARCHAR(200) NOT NULL,
            description TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_member_collections_member "
        "ON collections.member_collections (organization_id, member_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS collections.member_collection_items (
            item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL
                REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
            collection_id UUID NOT NULL
                REFERENCES collections.member_collections(collection_id) ON DELETE CASCADE,
            object_id UUID NOT NULL
                REFERENCES collections.collection_objects(object_id) ON DELETE CASCADE,
            note TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_member_collection_items_collection_object UNIQUE (collection_id, object_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_member_collection_items_object "
        "ON collections.member_collection_items (organization_id, object_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS collections.member_collection_items")
    op.execute("DROP TABLE IF EXISTS collections.member_collections")
    op.execute("DROP TABLE IF EXISTS collections.portal_member_login_tokens")
    op.execute("DROP TABLE IF EXISTS collections.portal_members")
    op.execute(
        "ALTER TABLE collections.discover_configs DROP COLUMN IF EXISTS member_collections_enabled"
    )
