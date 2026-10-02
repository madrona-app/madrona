"""
Seed E2E test user and organization for Playwright tests.

Creates:
- A test organization with slug 'e2e-test-org'
- A test user with known credentials
- Organization membership with admin role

Run with:
    python -m seeds.seed_e2e_test_data

Or with custom values:
    python -m seeds.seed_e2e_test_data --email custom@example.com --password CustomPass123!

This script is idempotent - safe to run multiple times.
Existing data will be updated rather than duplicated.
"""

import argparse
import logging
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import base64
import os

from botocore.exceptions import ClientError

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import (
    Application,
    CollectionObject,
    CollectionObjectMedia,
    Deaccession,
    LoanIn,
    LoanOut,
    Media,
    ObjectEntry,
    ObjectExit,
    ObjectTitle,
    Organization,
    OrganizationApplication,
    OrganizationMembership,
    Role,
    User,
)
from app.services.auth_utils import hash_password
from app.services.cognito import (
    cognito_admin_create_user,
    cognito_admin_set_user_password,
    CognitoAuthError,
)

logger = logging.getLogger(__name__)

# Default test credentials
DEFAULT_EMAIL = "e2e-test@example.com"
DEFAULT_PASSWORD = "E2E-Test-Password-123!"
DEFAULT_ORG_SLUG = "e2e-test-org"
DEFAULT_ORG_NAME = "E2E Test Organization"
DEFAULT_DISPLAY_NAME = "E2E Test User"


# A 1x1 JPEG. Small enough to inline, real enough that a browser fires onLoad
# and an image-processing library can open it.
_TINY_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA"
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
)


def _upload_seed_media(session: Session, org_id) -> None:
    """Put real bytes behind the seeded Media rows.

    The rows carry an s3_key, but nothing ever uploaded an object to match, so
    every presigned URL 404'd. The browser then never fired onLoad, the
    thumbnail stayed at opacity-0, and the IIIF viewer spec timed out trying to
    click an image that was invisible — after the same spec had spent months
    skipping for an unrelated reason. A fixture that promises media should
    provide media.

    Best-effort: a developer without object storage running still gets a
    working seed, just without images.
    """
    from app.models import Media as _Media

    try:
        from app.services.uploads import DEFAULT_REGION, get_media_bucket, get_s3_client

        client = get_s3_client()
        bucket = get_media_bucket(DEFAULT_REGION)
    except Exception as exc:  # noqa: BLE001 - object storage is optional here
        print(f"~ Skipped media upload (storage unavailable): {exc}")
        return

    # Images are served from a rendition, never the original master, so a
    # Media row with no derivative has no display URL at all and nothing
    # renders. Give each seeded image a "large" derivative so it behaves like
    # a real one.
    from app.models.media import MediaDerivative as _Derivative

    rows = session.execute(
        select(_Media.media_id, _Media.s3_key).where(_Media.organization_id == org_id)
    ).all()

    keys = [r[1] for r in rows]
    for media_id, s3_key in rows:
        existing = session.execute(
            select(_Derivative.derivative_id if hasattr(_Derivative, "derivative_id") else _Derivative.media_id)
            .where(_Derivative.media_id == media_id)
        ).first()
        if existing:
            continue
        derivative_key = s3_key.replace("/images/", "/derivatives/").replace(".jpg", "-large.jpeg")
        session.add(
            _Derivative(
                media_id=media_id,
                organization_id=org_id,
                derivative_type="large",
                format="jpeg",
                s3_key=derivative_key,
                width=1600,
                height=1200,
                file_size=len(_TINY_JPEG),
            )
        )
        keys.append(derivative_key)
        print(f"+ Seeded derivative for {s3_key}")
    session.flush()

    for key in keys:
        try:
            client.head_object(Bucket=bucket, Key=key)
        except ClientError:
            try:
                client.put_object(
                    Bucket=bucket, Key=key, Body=_TINY_JPEG, ContentType="image/jpeg"
                )
                print(f"+ Uploaded seed media object {key}")
            except Exception as exc:  # noqa: BLE001
                print(f"~ Could not upload {key}: {exc}")


def _index_seeded_records(session: Session, org_id) -> None:
    """Put the seeded records into the search index.

    The collections list is served by OpenSearch, not the database, so rows
    this seed creates are invisible to the UI until something indexes them.
    The effect is a fixture that looks correct in psql and empty in the
    application: the discoverable object with media exists, but the list page
    reports a different total and a search for its number finds nothing —
    which is also why specs that create a record and then look for it in the
    list have been flaky.

    Best-effort: a developer without OpenSearch running still gets a usable
    seed, just one whose list pages are empty.
    """
    try:
        from app.search.collections.service import CollectionsSearchService

        result = CollectionsSearchService().reindex_organization(session, org_id)
        print(f"+ Indexed seeded records: {result}")
    except Exception as exc:  # noqa: BLE001 - search is optional for the seed
        print(f"~ Skipped search indexing (unavailable): {exc}")


def _seed_domain_data(session: Session, org_id) -> dict:
    """Idempotently seed a small, deterministic dataset so read/list/detail and
    IIIF E2E specs have content instead of skipping. Keyed on stable object
    numbers, so re-runs are no-ops.

    Seeds one *discoverable* object with a published primary image (public IIIF
    manifest returns 200) plus an *unpublished* media item (so the
    publish-to-expose guard has something to exclude), and one
    non-discoverable object (negative case / list content).
    """
    created: dict = {}

    def _image(suffix: str, *, published: bool) -> Media:
        return Media(
            organization_id=org_id,
            s3_key=f"orgs/{org_id}/media/images/e2e-{suffix}.jpg",
            filename=f"e2e-{suffix}.jpg",
            file_size=12345,
            mime_type="image/jpeg",
            media_type="image",
            width=1600,
            height=1200,
            title=f"E2E {suffix} image",
            processing_status="completed",
            is_published=published,
        )

    obj = session.execute(
        select(CollectionObject).where(
            CollectionObject.organization_id == org_id,
            CollectionObject.object_number == "E2E-OBJ-001",
        )
    ).scalar_one_or_none()
    if obj is None:
        obj = CollectionObject(
            organization_id=org_id,
            object_number="E2E-OBJ-001",
            object_name="E2E Discoverable Object",
            brief_description="Seeded discoverable object for E2E/IIIF.",
            is_discoverable=True,
        )
        session.add(obj)
        session.flush()
        session.add(ObjectTitle(
            organization_id=org_id,
            object_id=obj.object_id,
            title="E2E Discoverable Object",
            is_preferred=True,
        ))
        pub, unpub = _image("published", published=True), _image("unpublished", published=False)
        session.add_all([pub, unpub])
        session.flush()
        session.add_all([
            CollectionObjectMedia(object_id=obj.object_id, media_id=pub.media_id, is_primary=True, sort_order=0),
            CollectionObjectMedia(object_id=obj.object_id, media_id=unpub.media_id, is_primary=False, sort_order=1),
        ])
        print("+ Seeded discoverable object E2E-OBJ-001 (published + unpublished media)")
    created["object_id"] = str(obj.object_id)

    obj2 = session.execute(
        select(CollectionObject).where(
            CollectionObject.organization_id == org_id,
            CollectionObject.object_number == "E2E-OBJ-002",
        )
    ).scalar_one_or_none()
    if obj2 is None:
        obj2 = CollectionObject(
            organization_id=org_id,
            object_number="E2E-OBJ-002",
            object_name="E2E Internal Object",
            brief_description="Seeded non-discoverable object.",
            is_discoverable=False,
        )
        session.add(obj2)
        session.flush()
        session.add(ObjectTitle(
            organization_id=org_id,
            object_id=obj2.object_id,
            title="E2E Internal Object",
            is_preferred=True,
        ))
        print("+ Seeded non-discoverable object E2E-OBJ-002")
    created["object2_id"] = str(obj2.object_id)

    _seed_procedures(session, org_id, obj.object_id)
    return created


def _seed_procedures(session: Session, org_id, object_id) -> None:
    """Idempotently seed one record per shipment-linking procedure (loan in/out,
    object entry/exit, deaccession) so those workspace specs run instead of
    skipping for lack of a record. Keyed on stable numbers; statuses default so
    each record appears in its list page.
    """
    from datetime import date

    def _get_or_create(model, number_field, number, **fields):
        existing = session.execute(
            select(model).where(
                model.organization_id == org_id,
                getattr(model, number_field) == number,
            )
        ).scalar_one_or_none()
        if existing is None:
            session.add(model(organization_id=org_id, **{number_field: number}, **fields))
            session.flush()
            print(f"+ Seeded {model.__name__} {number}")

    _get_or_create(LoanIn, "loan_number", "LI-E2E-001", loan_purpose="exhibition")
    _get_or_create(LoanOut, "loan_number", "LO-E2E-001", loan_purpose="exhibition")
    _get_or_create(ObjectEntry, "entry_number", "EN-E2E-001",
                   entry_date=date(2026, 1, 1), entry_reason="gift_offer")
    _get_or_create(ObjectExit, "exit_number", "EX-E2E-001",
                   exit_date=date(2026, 1, 1), exit_reason="transfer")
    _get_or_create(Deaccession, "deaccession_number", "DA-E2E-001",
                   object_id=object_id, reason="other")

    # One record per remaining workspace type. render-stability and the button
    # sweep open a record from each list; with no record they skipped, and a
    # skip is indistinguishable from a pass in a run summary. These detail
    # pages were therefore never rendered by any test.
    from datetime import datetime, timezone
    from decimal import Decimal

    from app.models import (
        ConditionReport,
        ConservationTreatment,
        Exhibition,
        IncidentReport,
        Valuation,
    )

    _get_or_create(ConservationTreatment, "treatment_number", "CT-E2E-001",
                   object_id=object_id, is_external=False,
                   treatment_type="remedial", status="proposed")
    _get_or_create(ConditionReport, "report_number", "CR-E2E-001",
                   report_type="intake", report_date=date(2026, 1, 1),
                   conservation_needed=False, status="draft")
    _get_or_create(IncidentReport, "report_number", "IR-E2E-001",
                   report_date=date(2026, 1, 1), incident_type="damage",
                   incident_date_approximate=False,
                   discovered_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
                   incident_description="Seeded incident for E2E coverage.")
    _get_or_create(Exhibition, "title", "E2E Exhibition")
    _get_or_create(Valuation, "valuation_type", "insurance",
                   valuation_amount=Decimal("1000.00"), valuation_currency="USD",
                   valuation_date=date(2026, 1, 1), is_current=True)


def seed_e2e_test_data(
    email: str = DEFAULT_EMAIL,
    password: str = DEFAULT_PASSWORD,
    org_slug: str = DEFAULT_ORG_SLUG,
    org_name: str = DEFAULT_ORG_NAME,
    display_name: str = DEFAULT_DISPLAY_NAME,
    platform_admin_emails: list[str] | None = None,
    enable_all_apps: bool = False,
    include_contract_apps: bool = False,
    org_id: str | None = None,
) -> dict:
    """
    Create E2E test organization and user.

    Optional extras for preview/demo environments:
      - platform_admin_emails: upsert each email as a User (Cognito-only if new)
        and give them a membership with role=platform_admin in the seeded org.
      - enable_all_apps: enable every active Application on the seeded org.
      - include_contract_apps: when enable_all_apps is set, include apps where
        requires_contract=True (otherwise limited to contract-free apps).

    Returns dict with created/updated entity IDs.
    """
    settings = Settings()
    # Seeds create organizations and cross-org rows, which the tenant-scoped
    # RLS policies forbid to the application role. DATABASE_URL points at
    # madrona_app (NOBYPASSRLS) on any correctly configured deployment, so
    # this failed with "new row violates row-level security policy for table
    # organizations". It only ever worked where DATABASE_URL happened to be a
    # superuser. Prefer the owner role, exactly as seeds/bootstrap_admin.py
    # does, and fall back only when it is unset.
    db_url = os.environ.get("ALEMBIC_DATABASE_URL") or settings.database_url.unicode_string()
    engine = create_engine(db_url)

    result = {
        "organization_id": None,
        "user_id": None,
        "membership_id": None,
        "org_slug": org_slug,
        "email": email,
    }

    with Session(engine) as session:
        # =====================================================================
        # 1. Create or update organization
        # =====================================================================
        org = session.execute(
            select(Organization).where(Organization.slug == org_slug)
        ).scalar_one_or_none()

        if org:
            print(f"✓ Organization exists: {org_name} ({org_slug})")
        else:
            org = Organization(
                name=org_name,
                slug=org_slug,
                is_demo=False,
                status="active",
            )
            if org_id:
                # Deterministic id so e2e URLs (/organizations/<id>/...) and
                # PLAYWRIGHT_TEST_ORG_ID are stable across fresh CI databases.
                org.organization_id = uuid.UUID(org_id)
            session.add(org)
            session.flush()
            print(f"+ Created organization: {org_name} ({org_slug}) [{org.organization_id}]")

        result["organization_id"] = str(org.organization_id)

        # =====================================================================
        # 2. Create or update user
        # =====================================================================
        user = session.execute(
            select(User).where(User.email == email)
        ).scalar_one_or_none()

        password_hash = hash_password(password)

        if user:
            # Update password hash in case it changed
            user.password_hash = password_hash
            user.status = "active"
            user.email_status = "active"
            print(f"✓ User exists: {email} (password updated)")
        else:
            user = User(
                email=email,
                password_hash=password_hash,
                display_name=display_name,
                status="active",
                email_status="active",
            )
            session.add(user)
            session.flush()
            print(f"+ Created user: {email}")

        result["user_id"] = str(user.user_id)

        # =====================================================================
        # 3. Get admin role
        # =====================================================================
        admin_role = session.execute(
            select(Role).where(Role.role_key == "admin")
        ).scalar_one_or_none()

        if not admin_role:
            print("Warning: admin role not found. Run seed_roles first.")
            print("  Skipping membership creation.")
            session.commit()
            return result

        # =====================================================================
        # 4. Create membership if it doesn't exist (don't overwrite existing role)
        # =====================================================================
        membership = session.execute(
            select(OrganizationMembership).where(
                OrganizationMembership.organization_id == org.organization_id,
                OrganizationMembership.user_id == user.user_id,
            )
        ).scalar_one_or_none()

        if membership:
            # Don't overwrite role — user may have been promoted to platform_admin
            membership.status = "active"
            current_role = session.execute(
                select(Role.role_key).where(Role.role_id == membership.role_id)
            ).scalar_one_or_none()
            print(f"  Membership exists: {email} -> {org_slug} (role={current_role}, kept)")
        else:
            membership = OrganizationMembership(
                organization_id=org.organization_id,
                user_id=user.user_id,
                role="admin",  # Legacy column
                role_id=admin_role.role_id,
                status="active",
            )
            session.add(membership)
            session.flush()
            print(f"+ Created membership: {email} -> {org_slug} (admin)")

        result["membership_id"] = str(membership.membership_id)

        # =====================================================================
        # 5. Enable applications for the seeded org (optional)
        # =====================================================================
        if enable_all_apps:
            q = select(Application).where(Application.status == "active")
            if not include_contract_apps:
                q = q.where(Application.requires_contract.is_(False))
            apps = session.execute(q).scalars().all()

            for app in apps:
                link = session.execute(
                    select(OrganizationApplication).where(
                        OrganizationApplication.organization_id == org.organization_id,
                        OrganizationApplication.application_id == app.application_id,
                    )
                ).scalar_one_or_none()
                if link:
                    link.enabled = True
                    print(f"  App already enabled: {app.key}")
                else:
                    session.add(
                        OrganizationApplication(
                            organization_id=org.organization_id,
                            application_id=app.application_id,
                            enabled=True,
                        )
                    )
                    print(f"+ Enabled application: {app.key}")

        # =====================================================================
        # 6. Promote additional users to platform_admin (optional)
        # =====================================================================
        if platform_admin_emails:
            pa_role = session.execute(
                select(Role).where(Role.role_key == "platform_admin")
            ).scalar_one_or_none()

            if not pa_role:
                print(
                    "Warning: platform_admin role not found. "
                    "Run seed_roles_and_permissions first. Skipping platform-admin promotions."
                )
            else:
                for pa_email in platform_admin_emails:
                    pa_email = pa_email.strip().lower()
                    if not pa_email:
                        continue

                    pa_user = session.execute(
                        select(User).where(User.email == pa_email)
                    ).scalar_one_or_none()

                    if not pa_user:
                        # Minimal Cognito-only user; login populates cognito_sub.
                        pa_user = User(
                            email=pa_email,
                            status="active",
                            email_status="active",
                        )
                        session.add(pa_user)
                        session.flush()
                        print(f"+ Created platform-admin user (Cognito-only): {pa_email}")
                    else:
                        print(f"✓ Platform-admin user exists: {pa_email}")

                    pa_membership = session.execute(
                        select(OrganizationMembership).where(
                            OrganizationMembership.organization_id == org.organization_id,
                            OrganizationMembership.user_id == pa_user.user_id,
                        )
                    ).scalar_one_or_none()

                    if pa_membership:
                        pa_membership.role = "platform_admin"
                        pa_membership.role_id = pa_role.role_id
                        pa_membership.status = "active"
                        print(f"  Promoted membership to platform_admin: {pa_email}")
                    else:
                        session.add(
                            OrganizationMembership(
                                organization_id=org.organization_id,
                                user_id=pa_user.user_id,
                                role="platform_admin",
                                role_id=pa_role.role_id,
                                status="active",
                            )
                        )
                        print(f"+ Created platform_admin membership: {pa_email} -> {org_slug}")

        # Representative domain data so read/list/detail and IIIF specs have
        # content instead of skipping (idempotent — keyed on object numbers).
        result.update(_seed_domain_data(session, org.organization_id))
        session.flush()
        _upload_seed_media(session, org.organization_id)
        _index_seeded_records(session, org.organization_id)

        session.commit()

    # =========================================================================
    # Cognito User
    # =========================================================================
    try:
        cognito_admin_create_user(
            email=email,
            temporary_password=password,
            suppress_welcome=True,
        )
        print(f"+ Created Cognito user: {email}")
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code == 'UsernameExistsException':
            print(f"✓ Cognito user already exists: {email}")
        else:
            print(f"⚠ Failed to create Cognito user: {e}")
    except CognitoAuthError as e:
        print(f"⚠ Failed to create Cognito user: {e}")
    except Exception as e:
        print(f"⚠ Cognito not available (local dev?): {e}")

    # Set permanent password so user can log in directly
    try:
        cognito_admin_set_user_password(
            email=email,
            password=password,
            permanent=True,
        )
        print(f"✓ Set permanent Cognito password for: {email}")
    except CognitoAuthError as e:
        print(f"⚠ Failed to set Cognito password: {e}")
    except Exception as e:
        print(f"⚠ Cognito not available (local dev?): {e}")

    # =========================================================================
    # Summary
    # =========================================================================
    print("\n" + "=" * 60)
    print("E2E Test Data Ready")
    print("=" * 60)
    print(f"  Organization: {org_name}")
    print(f"  Org Slug:     {org_slug}")
    print(f"  Org ID:       {result['organization_id']}")
    print(f"  User Email:   {email}")
    print(f"  User ID:      {result['user_id']}")
    print(f"  Password:     {password}")
    print("=" * 60)
    print("\nSet these environment variables for Playwright:")
    print(f'  export PLAYWRIGHT_TEST_EMAIL="{email}"')
    print(f'  export PLAYWRIGHT_TEST_PASSWORD="{password}"')
    print(f'  export PLAYWRIGHT_TEST_ORG_ID="{org_slug}"')
    print("=" * 60)

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Seed E2E test user and organization"
    )
    parser.add_argument(
        "--email",
        default=DEFAULT_EMAIL,
        help=f"Test user email (default: {DEFAULT_EMAIL})",
    )
    parser.add_argument(
        "--password",
        default=DEFAULT_PASSWORD,
        help=f"Test user password (default: {DEFAULT_PASSWORD})",
    )
    parser.add_argument(
        "--org-slug",
        default=DEFAULT_ORG_SLUG,
        help=f"Organization slug (default: {DEFAULT_ORG_SLUG})",
    )
    parser.add_argument(
        "--org-name",
        default=DEFAULT_ORG_NAME,
        help=f"Organization name (default: {DEFAULT_ORG_NAME})",
    )
    parser.add_argument(
        "--display-name",
        default=DEFAULT_DISPLAY_NAME,
        help=f"User display name (default: {DEFAULT_DISPLAY_NAME})",
    )
    parser.add_argument(
        "--platform-admin-emails",
        default="",
        help="Comma-separated emails to promote to platform_admin on the seeded org. "
        "Creates minimal Cognito-only User rows if they don't exist.",
    )
    parser.add_argument(
        "--enable-all-apps",
        action="store_true",
        help="Enable every active Application on the seeded org (preview/demo mode).",
    )
    parser.add_argument(
        "--include-contract-apps",
        action="store_true",
        help="When --enable-all-apps is set, include apps where requires_contract=True.",
    )
    parser.add_argument(
        "--org-id",
        default=None,
        help="Deterministic organization UUID (used for stable e2e URLs).",
    )

    args = parser.parse_args()

    platform_admin_emails = [
        e for e in (x.strip() for x in args.platform_admin_emails.split(",")) if e
    ]

    seed_e2e_test_data(
        email=args.email,
        password=args.password,
        org_slug=args.org_slug,
        org_name=args.org_name,
        display_name=args.display_name,
        platform_admin_emails=platform_admin_emails,
        enable_all_apps=args.enable_all_apps,
        include_contract_apps=args.include_contract_apps,
        org_id=args.org_id,
    )


if __name__ == "__main__":
    main()
