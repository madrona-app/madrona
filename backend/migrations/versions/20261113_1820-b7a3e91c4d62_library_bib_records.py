"""Add library catalog tables: bibliographic records, holdings and items

collections.bib_records describes a published work (title, responsibility,
edition, imprint, identifiers, call number) with a record type (book, serial,
pamphlet, braille, large_print, audio, video, manuscript, other) and a
marc_json column for imported MARC fields that have no column.

collections.bib_holdings records what is held of a record at a location, and
collections.bib_items each physical piece (barcode unique per organization,
copy number, enumeration, chronology, circulation status), optionally linked
to a collection object.

collections.bib_record_subjects and collections.bib_record_constituents link
records to the subject authority file and to person/organization records
(with a role such as author, narrator or transcriber).

Row-level security is applied by seeds/seed_rls_policies.py, which runs at
boot (all five tables are in RLS_TABLES/RLS_POLICIES).

Revision ID: b7a3e91c4d62
Revises: d5f2b8c4a016
"""
from alembic import op

revision = "b7a3e91c4d62"
down_revision = "d5f2b8c4a016"
branch_labels = None
depends_on = None

_RECORD_TYPES = (
    "'book', 'serial', 'pamphlet', 'braille', 'large_print', "
    "'audio', 'video', 'manuscript', 'other'"
)
_ITEM_STATUSES = "'available', 'on_loan', 'missing', 'withdrawn', 'in_processing'"
_NAME_ROLES = (
    "'author', 'editor', 'translator', 'illustrator', 'narrator', 'transcriber', "
    "'compiler', 'contributor', 'publisher', 'other'"
)


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS collections.bib_records (
            bib_record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL
                REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
            record_type VARCHAR(20) NOT NULL DEFAULT 'book',
            title VARCHAR(1000) NOT NULL,
            subtitle VARCHAR(1000),
            statement_of_responsibility TEXT,
            edition VARCHAR(255),
            place VARCHAR(255),
            publisher VARCHAR(255),
            date_display VARCHAR(100),
            date_earliest INTEGER,
            date_latest INTEGER,
            extent VARCHAR(500),
            series_statement VARCHAR(500),
            language VARCHAR(100),
            isbn VARCHAR(50),
            issn VARCHAR(20),
            lccn VARCHAR(50),
            oclc_number VARCHAR(50),
            call_number VARCHAR(100),
            format_notes TEXT,
            notes TEXT,
            marc_json JSONB,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
            CONSTRAINT check_bib_record_type CHECK (record_type IN ({_RECORD_TYPES})),
            CONSTRAINT check_bib_record_dates CHECK (
                date_earliest IS NULL OR date_latest IS NULL OR date_latest >= date_earliest
            )
        )
        """
    )
    for name, cols in (
        ("ix_bib_records_org_type", "organization_id, record_type"),
        ("ix_bib_records_org_title", "organization_id, title"),
        ("ix_bib_records_org_isbn", "organization_id, isbn"),
        ("ix_bib_records_org_call_number", "organization_id, call_number"),
    ):
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON collections.bib_records ({cols})")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS collections.bib_holdings (
            holding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL
                REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
            bib_record_id UUID NOT NULL
                REFERENCES collections.bib_records(bib_record_id) ON DELETE CASCADE,
            location_id UUID
                REFERENCES collections.locations(location_id) ON DELETE SET NULL,
            call_number VARCHAR(100),
            holdings_statement VARCHAR(1000),
            shelving_notes TEXT,
            public_note TEXT,
            staff_note TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_bib_holdings_record "
        "ON collections.bib_holdings (organization_id, bib_record_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_bib_holdings_location "
        "ON collections.bib_holdings (location_id)"
    )

    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS collections.bib_items (
            item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL
                REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
            holding_id UUID NOT NULL
                REFERENCES collections.bib_holdings(holding_id) ON DELETE CASCADE,
            barcode VARCHAR(100),
            copy_number VARCHAR(50),
            enumeration VARCHAR(255),
            chronology VARCHAR(255),
            status VARCHAR(20) NOT NULL DEFAULT 'available',
            condition_note TEXT,
            collection_object_id UUID
                REFERENCES collections.collection_objects(object_id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
            CONSTRAINT uq_bib_items_org_barcode UNIQUE (organization_id, barcode),
            CONSTRAINT check_bib_item_status CHECK (status IN ({_ITEM_STATUSES}))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_bib_items_holding "
        "ON collections.bib_items (organization_id, holding_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_bib_items_object "
        "ON collections.bib_items (collection_object_id)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS collections.bib_record_subjects (
            link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL
                REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
            bib_record_id UUID NOT NULL
                REFERENCES collections.bib_records(bib_record_id) ON DELETE CASCADE,
            subject_authority_id UUID NOT NULL
                REFERENCES collections.subject_authorities(authority_id) ON DELETE CASCADE,
            display_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
            CONSTRAINT uq_bib_record_subjects_record_subject UNIQUE (bib_record_id, subject_authority_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_bib_record_subjects_subject "
        "ON collections.bib_record_subjects (organization_id, subject_authority_id)"
    )

    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS collections.bib_record_constituents (
            link_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL
                REFERENCES public.organizations(organization_id) ON DELETE CASCADE,
            bib_record_id UUID NOT NULL
                REFERENCES collections.bib_records(bib_record_id) ON DELETE CASCADE,
            constituent_id UUID NOT NULL
                REFERENCES collections.constituents(constituent_id) ON DELETE CASCADE,
            role VARCHAR(30) NOT NULL DEFAULT 'author',
            display_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
            CONSTRAINT uq_bib_record_constituents_record_name_role UNIQUE (bib_record_id, constituent_id, role),
            CONSTRAINT check_bib_record_constituent_role CHECK (role IN ({_NAME_ROLES}))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_bib_record_constituents_constituent "
        "ON collections.bib_record_constituents (organization_id, constituent_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS collections.bib_record_constituents")
    op.execute("DROP TABLE IF EXISTS collections.bib_record_subjects")
    op.execute("DROP TABLE IF EXISTS collections.bib_items")
    op.execute("DROP TABLE IF EXISTS collections.bib_holdings")
    op.execute("DROP TABLE IF EXISTS collections.bib_records")
