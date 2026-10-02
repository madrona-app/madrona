"""
Seed applications.

Populates the public.applications table with the canonical set of
Madrona platform applications.

Run with:
    python -m seeds.seed_applications

Idempotent: ON CONFLICT (key) DO UPDATE refreshes the presentational
fields (display_name, description, icon, sort_order) on re-run so
operator-facing copy can be edited here and rolled out via deploy
without a migration. Operator-managed flags (default_enabled,
requires_contract, status) are NOT touched on conflict.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import Settings


# ---------------------------------------------------------------------------
# Data definitions
# ---------------------------------------------------------------------------

# (application_id, key, display_name, description, icon, default_enabled,
#  requires_contract, sort_order, status)
APPLICATIONS = [
    (
        "b0952c41-2fb6-431b-8df8-b201ff26d472",
        "bridge",
        "Bridge",
        "Data integration and pipeline management - connect, transform, and sync data across systems",
        "Workflow",
        False,
        True,
        1,
        "active",
    ),
    (
        "08404a00-6332-4891-8b6c-23aaa3f65b7f",
        "collections",
        "Collections",
        "Collection management with object cataloging, locations, and movements",
        "Database",
        False,
        True,
        2,
        "active",
    ),
    (
        "0baaeb91-617a-4c4c-a4f8-daa1210ca625",
        "media",
        "Media",
        "Digital asset management for images, documents, and multimedia",
        "Image",
        False,
        True,
        3,
        "active",
    ),
    (
        "e85536e2-9433-4d3a-97bb-9c5c77129b7c",
        "content",
        "Content",
        "Content management system — build your museum's website with pages, blog posts, and a block editor",
        "Globe",
        False,
        True,
        4,
        "active",
    ),
    (
        "991bc4c5-3843-4244-b64c-2252ff7b1610",
        "discover",
        "Discover",
        "Public collection browser - share your collection with the world through a customizable public website",
        "Globe",
        False,
        False,
        7,
        "active",
    ),
    # Guide Studio is the subscribed product; the always-on chat
    # ("Guide", available to every authenticated user via the
    # floating sidebar FAB regardless of subscription) is the lite
    # surface. Subscribing to Guide Studio unlocks (a) the playground
    # routes at /organizations/:orgId/guide/{chat,documents} and
    # (b) richer orchestration capabilities inside the always-on
    # chat — delegation to specialists, durable plans, and the
    # drafts inbox where Guide stages records for review.
    (
        "c1f2a3b4-5d6e-7f80-91a2-b3c4d5e6f7a8",
        "guide",
        "Guide Studio",
        "Automate planning and collections procedures with Guide — multi-agent orchestration, durable plans, and a drafts inbox where every record Guide creates is scoped for your review before it persists. The lightweight chat lives in every Madrona sidebar; subscribing unlocks orchestration + the Studio playground.",
        "Sparkles",
        False,
        True,
        8,
        "active",
    ),
]


# ---------------------------------------------------------------------------
# SQL statements
# ---------------------------------------------------------------------------

INSERT_APPLICATION = text("""
    INSERT INTO public.applications (
        application_id, key, display_name, description,
        icon, default_enabled, requires_contract, sort_order, status
    ) VALUES (
        :application_id, :key, :display_name, :description,
        :icon, :default_enabled, :requires_contract, :sort_order, :status
    )
    ON CONFLICT (key) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        icon = EXCLUDED.icon,
        sort_order = EXCLUDED.sort_order
        -- Intentionally NOT updating: default_enabled, requires_contract,
        -- status. Those are operator-managed once the row exists; the
        -- seed only owns presentational fields (display_name, description,
        -- icon, sort_order). Without this branch, renaming Guide → Guide
        -- Studio would only land on fresh DBs.
""")


# ---------------------------------------------------------------------------
# Seed function
# ---------------------------------------------------------------------------

def seed_applications():
    """Seed applications."""
    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())

    print("\n" + "=" * 80)
    print("Seeding Applications")
    print("=" * 80)

    with Session(engine) as session:
        # ----- Applications -----
        print("\nApplications:")
        print("-" * 40)
        apps_inserted = 0
        for row in APPLICATIONS:
            (application_id, key, display_name, description,
             icon, default_enabled, requires_contract, sort_order, status) = row
            result = session.execute(INSERT_APPLICATION, {
                "application_id": application_id,
                "key": key,
                "display_name": display_name,
                "description": description,
                "icon": icon,
                "default_enabled": default_enabled,
                "requires_contract": requires_contract,
                "sort_order": sort_order,
                "status": status,
            })
            if result.rowcount > 0:
                apps_inserted += 1
                print(f"  + {key:20} {display_name}")
            else:
                print(f"  . {key:20} {display_name} (exists)")

        session.commit()

        # ----- Summary -----
        app_count = session.execute(
            text("SELECT count(*) FROM public.applications")
        ).scalar()

        print("\n" + "=" * 80)
        print(f"Inserted {apps_inserted} applications    (total in table: {app_count})")
        print("=" * 80 + "\n")


if __name__ == "__main__":
    seed_applications()
