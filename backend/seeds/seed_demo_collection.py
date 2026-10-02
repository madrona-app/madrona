"""
Seed a demo collection into an existing organization.

Populates a museum-shaped sample: reference data (locations, contacts,
vocabularies), cataloged objects drawn from checked-in Met, Smithsonian
and Rijksmuseum manifests, and worked collections procedures across
acquisitions, loans, exhibitions, conservation and condition reports.

Everything comes from fixtures in app/services/sandbox_seeder/fixtures —
no external API calls, no API keys, works offline.

Run with:
    python -m seeds.seed_demo_collection                  # first org found
    python -m seeds.seed_demo_collection --org-slug demo  # a specific org

This is the same seeding the platform-admin sandbox provisioning flow runs
with with_demo_data=true; this entry point exists so a self-hosted
evaluator can reach it without driving the provisioning machinery. Takes a
few minutes. Not idempotent — it appends, so re-running duplicates rows.
"""

import argparse
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import Settings

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("seed_demo")

# (label, module, function[, kwargs]) — order matters: procedures
# reference objects, so collections must seed first.
STEPS = [
    ("reference data",   "reference",         "seed_reference_data"),
    # Collections come from checked-in manifests referencing the shared
    # sandbox-fixtures/ keys uploaded above — no museum API calls.
    ("Met objects",      "manifest",          "seed_collections_from_manifest", {"source": "met"}),
    ("Smithsonian",      "manifest",          "seed_collections_from_manifest", {"source": "smithsonian"}),
    ("Rijksmuseum",      "manifest",          "seed_collections_from_manifest", {"source": "rijks"}),
    ("acquisitions",     "acquisitions",      "seed_acquisitions"),
    ("loans",            "loans",             "seed_loans"),
    ("exhibitions",      "exhibitions",       "seed_exhibitions"),
    ("conservation",     "conservation",      "seed_conservation"),
    ("condition reports","condition_reports", "seed_condition_reports"),
]


def _resolve_org(session, slug: str | None):
    """Pick the target org.

    Without --org-slug, choose the oldest org that has at least one member.
    Bootstrap seeding creates a memberless 'system' org holding platform
    defaults; that is never the right target, and it sorts first by age.
    """
    from app.models import Organization, OrganizationMembership

    if slug:
        org = session.execute(
            select(Organization).where(Organization.slug == slug)
        ).scalars().first()
        if org is None:
            raise SystemExit(f"No organization with slug {slug!r}.")
        return org

    org = session.execute(
        select(Organization)
        .join(OrganizationMembership,
              OrganizationMembership.organization_id == Organization.organization_id)
        .order_by(Organization.created_at)
    ).scalars().first()
    if org is None:
        raise SystemExit(
            "No organization with members found. Sign up in the app first, "
            "then re-run."
        )
    return org


def _resolve_admin_user_id(session, org_id):
    from app.models import OrganizationMembership

    membership = session.execute(
        select(OrganizationMembership)
        .where(OrganizationMembership.organization_id == org_id)
        .order_by(OrganizationMembership.created_at)
    ).scalars().first()
    if membership is None:
        raise SystemExit(
            "Organization has no members; the seeder needs a user to attribute "
            "records to. Sign up in the app first."
        )
    return membership.user_id


def seed_demo_collection(session, org, admin_user_id) -> list[str]:
    """Seed the demo collection into an existing organization.

    Returns the labels of any steps that failed; an empty list means all of
    them worked. Takes a few minutes and is NOT idempotent — it appends, so
    a second run duplicates rows.

    Extracted from main() so the install wizard's background task runs the
    same seeding an operator gets from the command line, rather than a second
    copy of it that drifts.
    """
    logger.info("Seeding demo collection into %r (%s)", org.name, org.slug)

    # Fixture image bytes must exist in the configured bucket before the
    # manifest seeders create Media rows pointing at them; a self-hosted
    # The object store starts empty, so without this the demo catalog renders with
    # broken images.
    from app.services.sandbox_seeder.fixture_images import ensure_fixture_images

    logger.info("  - fixture images ...")
    fx = ensure_fixture_images()
    if fx.get("missing"):
        logger.warning(
            "    fixture images not present in the repo; objects will seed "
            "without image bytes"
        )
    else:
        logger.info(
            "    %d uploaded, %d already in %s",
            fx["uploaded"], fx["skipped"], fx["bucket"],
        )

    import importlib

    failed = []
    for step in STEPS:
        label, module_name, func_name = step[0], step[1], step[2]
        extra = step[3] if len(step) > 3 else {}
        module = importlib.import_module(f"app.services.sandbox_seeder.{module_name}")
        func = getattr(module, func_name)
        logger.info("  - %s ...", label)
        try:
            # seed_reference_data takes positionals; every other seeder
            # is keyword-only after `session`.
            if func_name == "seed_reference_data":
                func(session, org.organization_id, admin_user_id)
            else:
                func(
                    session,
                    org_id=org.organization_id,
                    admin_user_id=admin_user_id,
                    **extra,
                )
            session.commit()
        except Exception as exc:  # noqa: BLE001 — report and continue
            session.rollback()
            failed.append(label)
            logger.warning("    failed: %s", exc)

    # Media derivatives — thumbnails and previews.
    #
    # The manifest seeder fires process_upload_task.delay() as soon as it
    # creates each Media row, but the surrounding step does not commit until
    # it finishes, so the worker looks the row up before it is visible and
    # gives up with "Media not found". Everything is committed by now, so
    # anything still pending needs processing again; the task is idempotent.
    #
    # Generated here rather than queued. Queuing is only as good as the
    # worker: a self-hosted install with celery-worker stopped, or pointed at
    # a different broker, leaves every seeded object with no thumbnail — a
    # catalog that looks broken, which is the exact failure ensure_fixture_
    # images() exists to prevent. `.apply()` runs the task in this process,
    # through OrgTask.__call__, so it gets the same session and RLS context a
    # worker would and there is no second implementation to drift.
    _generate_media_derivatives(session, org)


def _generate_media_derivatives(session, org) -> None:
    """Process any media still waiting for derivatives, in-process."""
    from app.models import Media

    pending = session.execute(
        select(Media).where(
            Media.organization_id == org.organization_id,
            Media.processing_status == "pending",
        )
    ).scalars().all()
    if not pending:
        return

    logger.info("  - generating derivatives for %d media ...", len(pending))
    try:
        from app.tasks.media import process_upload_task
    except Exception as exc:  # noqa: BLE001
        logger.warning("    media processing unavailable: %s", exc)
        return

    done = failed = 0
    for i, m in enumerate(pending, 1):
        try:
            process_upload_task.apply(
                kwargs={
                    "media_id": str(m.media_id),
                    "organization_id": str(org.organization_id),
                    "generate_webp": False,
                },
                throw=True,
            )
            done += 1
        except Exception as exc:  # noqa: BLE001 - one bad image is not fatal
            failed += 1
            logger.debug("    media %s failed: %s", m.media_id, exc)
        if i % 25 == 0:
            logger.info("    %d/%d ...", i, len(pending))

    if failed:
        logger.warning("    %d generated, %d failed", done, failed)
    else:
        logger.info("    %d generated", done)

    # Mark it as demo data so the UI and any cleanup tooling can tell.
    org.is_demo = True
    session.commit()

    return failed


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed a demo collection.")
    parser.add_argument("--org-slug", default=None, help="Target org slug (default: first org)")
    args = parser.parse_args()

    # Seeding writes org-scoped rows across many tables and must read orgs
    # it has no RLS context for, so it runs as the owner role (BYPASSRLS) —
    # the same convention the entrypoint uses for the other seeds. Falls
    # back to DATABASE_URL for single-role setups.
    settings = Settings()
    db_url = os.environ.get("ALEMBIC_DATABASE_URL") or settings.database_url.unicode_string()
    engine = create_engine(db_url)

    with Session(engine) as session:
        org = _resolve_org(session, args.org_slug)
        admin_user_id = _resolve_admin_user_id(session, org.organization_id)
        failed = seed_demo_collection(session, org, admin_user_id)

    if failed:
        logger.warning("Completed with failures: %s", ", ".join(failed))
        return 1
    logger.info("Demo collection seeded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
