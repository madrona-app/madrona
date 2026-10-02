"""First-run install: create the organization and the first administrator.

`docker compose up` gives you a running system with no way into it. This is
the one operation that has to work before anyone can authenticate, so it is
reachable two ways — the CLI (`python -m seeds.bootstrap_admin`) and the install
wizard at /install — and both call the same function here. Two implementations
of "create the first admin" would drift, and the one that drifted would be the
one nobody ran.

The wizard's only guard is that it refuses once an organization exists
(`install_is_required`). That is the standard first-run pattern, and it is a real
guard rather than a token one: the window is between `docker compose up` and
the first submission, on an install that by definition has no data yet.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def slugify(name: str) -> str:
    """Slug for an organization name, with a usable fallback."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "museum"


def install_is_required(session: Session) -> bool:
    """True when nobody can sign in to anything yet.

    The marker is organization *memberships*, not organizations. Counting
    organizations looks like the obvious test and is always wrong: the boot
    seeds create a `system` organization on every start, because shared
    resources like frame styles and mount configs carry an FK to
    organizations and need somewhere to hang (see
    seeds/seed_exhibit_defaults.get_or_create_system_org). An instance that
    has never been touched therefore has one organization, no users and no
    memberships.

    Memberships are also the condition the wizard actually addresses. A user
    row with no membership — a half-finished provision, say — can sign in to
    nothing, so that install still needs finishing.
    """
    from app.models import OrganizationMembership

    return session.execute(
        select(func.count()).select_from(OrganizationMembership)
    ).scalar_one() == 0


def bootstrap_first_admin(
    session: Session,
    *,
    email: str,
    password: str,
    display_name: str | None = None,
    org_name: str = "My Museum",
    platform_admin: bool = False,
    with_demo_data: bool = False,
) -> dict[str, Any]:
    """Create (or reuse) an organization and an administrator in it.

    Enables every application and seeds the per-organization media
    configuration, which the boot seeds cannot do because no organization
    exists at boot time.

    Idempotent: re-running updates the password, tops up missing application
    grants, and leaves everything else alone. The caller owns the transaction.

    Must run on a session that bypasses RLS (the owner role): it writes
    org-scoped rows before any RLS context exists.
    """
    from app.models import (
        Application,
        Organization,
        OrganizationApplication,
        OrganizationMembership,
        Role,
        User,
    )
    from app.services.auth_utils import hash_password

    now = datetime.now(timezone.utc)
    email = email.strip().lower()
    slug = slugify(org_name)

    org = session.execute(
        select(Organization).where(Organization.slug == slug)
    ).scalars().first()
    if org is None:
        org = Organization(name=org_name, slug=slug, status="active")
        session.add(org)
        session.flush()
        logger.info("Created organization %r (%s)", org.name, org.slug)
    else:
        logger.info("Using existing organization %r (%s)", org.name, org.slug)

    user = session.execute(select(User).where(User.email == email)).scalars().first()
    if user is None:
        user = User(
            email=email,
            display_name=display_name or email.split("@")[0],
            status="active",
            password_hash=hash_password(password),
            email_verified_at=now,
        )
        session.add(user)
        session.flush()
        logger.info("Created user %s", email)
    else:
        user.password_hash = hash_password(password)
        user.status = "active"
        logger.info("Updated password for existing user %s", email)

    role_key = "platform_admin" if platform_admin else "admin"
    role = session.execute(select(Role).where(Role.role_key == role_key)).scalars().first()
    if role is None:
        raise LookupError(
            f"Role {role_key!r} not found — run the core seeds first "
            "(the backend entrypoint does this on boot)."
        )

    membership = session.execute(
        select(OrganizationMembership).where(
            OrganizationMembership.user_id == user.user_id,
            OrganizationMembership.organization_id == org.organization_id,
        )
    ).scalars().first()
    if membership is None:
        session.add(OrganizationMembership(
            user_id=user.user_id,
            organization_id=org.organization_id,
            role_id=role.role_id,
            role="admin",
            status="active",
        ))
        logger.info("Granted %s on %s", role_key, org.slug)
    else:
        membership.role_id = role.role_id
        membership.role = "admin"
        membership.status = "active"
        logger.info("Updated membership to %s", role_key)

    # Every application. A self-hosted operator standing up the whole platform
    # should not have to discover that Collections is hidden behind a grant.
    apps = session.execute(select(Application)).scalars().all()
    existing = {
        oa.application_id
        for oa in session.execute(
            select(OrganizationApplication).where(
                OrganizationApplication.organization_id == org.organization_id
            )
        ).scalars().all()
    }
    added = 0
    for app in apps:
        if app.application_id in existing:
            continue
        session.add(OrganizationApplication(
            organization_id=org.organization_id,
            application_id=app.application_id,
            enabled=True,
            enabled_at=now,
            enabled_by=user.user_id,
            config={},
        ))
        added += 1
    logger.info("Applications enabled: %d added, %d already present", added, len(existing))

    # Per-organization media configuration — derivative presets, the tag
    # vocabulary, watermark and metadata templates. Not something the boot
    # seeds can do: there is no organization at boot.
    from seeds.seed_media_config import (
        seed_derivative_sizes,
        seed_tag_definitions,
        seed_templates,
    )

    org_id = org.organization_id
    sizes = seed_derivative_sizes(session, org_id)
    tags = seed_tag_definitions(session, org_id)
    watermarks, metadata = seed_templates(session, org_id)
    logger.info(
        "Media config: %d derivative sizes, %d tags, %d watermark and %d metadata templates",
        sizes, tags, watermarks, metadata,
    )

    # Search indexes. Collections and media list views read exclusively from
    # OpenSearch, so an organization whose indexes were never provisioned
    # opens to "Search service is not available" or a permanently empty list —
    # a real account in a broken instance. The provisioning saga has an
    # index_search step for exactly this; a wizard install needs the same.
    #
    # Best-effort on purpose: OpenSearch may legitimately be disabled
    # (OPENSEARCH_ENABLED=false) or still starting when the operator submits
    # the form, and neither is a reason to refuse them an account. The caller
    # reports what happened.
    search_ready = _provision_search_indexes(org.organization_id)

    # Sample records, if asked for. Runs inline: the seeders read checked-in
    # manifests and fixture images rather than museum APIs, which measured 7
    # seconds end to end — the provisioning saga dispatches this async for
    # progress reporting, not because it is slow.
    #
    # Exactly once, which the endpoint's 409 guard already guarantees: the
    # seeder appends rather than upserting, so a second run duplicates every
    # object.
    demo_data_seeded = False
    if with_demo_data:
        demo_data_seeded = _seed_demo_data(session, org, user.user_id)

    return {
        "organization_id": str(org.organization_id),
        "organization_name": org.name,
        "organization_slug": org.slug,
        "email": user.email,
        "role": role_key,
        "applications_enabled": added + len(existing),
        "search_ready": search_ready,
        "demo_data_seeded": demo_data_seeded,
    }


def _provision_search_indexes(organization_id) -> bool:
    """Create the collections and media indexes/aliases for a new organization.

    Returns False rather than raising when search is unavailable: an install
    that hands over a working login and a warning beats one that refuses
    because a search node had not finished starting.
    """
    try:
        from app.search.collections.service import CollectionsSearchService
        from app.search.media.service import MediaSearchService

        if not CollectionsSearchService.is_available():
            logger.warning(
                "Search is unavailable, so the new organization has no indexes. "
                "Collection and media lists will be empty until someone reindexes."
            )
            return False

        CollectionsSearchService().setup_index()
        MediaSearchService().setup_index()
        logger.info("Search indexes provisioned for organization %s", organization_id)
        return True
    except Exception as exc:  # noqa: BLE001 - never fail an install over search
        logger.error(
            "Could not provision search indexes for organization %s: %s. "
            "Collection and media lists will be empty until someone reindexes.",
            organization_id, exc,
        )
        return False


def _seed_demo_data(session: Session, org, admin_user_id) -> bool:
    """Seed the sample collection into a newly created organization.

    Best-effort, like search provisioning: an operator who ticked the box and
    got an empty catalogue is disappointed, but one who cannot log in at all
    because a fixture was missing is blocked. Failures are logged with the
    command to run by hand.
    """
    try:
        from seeds.seed_demo_collection import seed_demo_collection

        failed = seed_demo_collection(session, org, admin_user_id)
        if failed:
            logger.warning(
                "Demo data seeded with failures in: %s. Re-run by hand with "
                "`python -m seeds.seed_demo_collection --org-slug %s` only if "
                "you first remove what landed — the seeder appends.",
                ", ".join(failed), org.slug,
            )
            return False
        logger.info("Demo collection seeded for organization %s", org.slug)
        return True
    except Exception as exc:  # noqa: BLE001 - never fail an install over samples
        logger.error(
            "Could not seed demo data for organization %s: %s. The account is "
            "usable; run `python -m seeds.seed_demo_collection --org-slug %s` "
            "to add samples later.",
            org.slug, exc, org.slug,
        )
        return False
