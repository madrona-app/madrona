"""
Tests for provisioning job saga (ProvisioningService + OrgProvisioningJob).

Uses a standalone SQLite in-memory database with only the tables needed
for provisioning. External services (Cognito, SES) are mocked.
"""

import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.database import Base
from app.models import (
    Application,
    Organization,
    OrganizationApplication,
    OrganizationInvitation,
    OrganizationMembership,
    ProvisioningAuditLog,
    Role,
    User,
    OrgProvisioningJob,
)
from app.services.provisioning_service import (
    PROVISIONING_STEPS,
    ConcurrentJobError,
    PayloadMismatchError,
    ProvisioningError,
    ProvisioningService,
    compute_idempotency_key,
    compute_request_fingerprint,
)
from app.services.invitation_service import INVITATION_EXPIRY_DAYS

@pytest.fixture()
def session(db_session):
    """The shared Postgres session from conftest.

    This module used to stand up its own in-memory SQLite engine holding a
    hand-listed set of provisioning tables. SQLite has no schemas and cannot
    compile JSONB, so that fixture could only ever model a flattened subset —
    which is why a provisioning step touching the media schema could not be
    tested here at all. db_session runs each test in a savepoint on
    madrona_test and rolls back on teardown.
    """
    return db_session


SAMPLE_PAYLOAD = {
    "organization": {"name": "Test Museum", "slug": "test-museum"},
    "applications": [{"key": "collections"}],
    "contract": {"start_date": "2026-02-01", "end_date": "2027-01-31"},
    "admin": {"email": "admin@testmuseum.org", "name": "Jane Admin"},
    "onboarding": {"csm_name": "Alex", "csm_email": "alex@example.com"},
}


def _seed_application(session):
    """Seed an Application so enable_applications can find it."""
    app = Application(
        key="collections",
        display_name="Collections",
        description="Collections management",
        icon="archive",
    )
    session.add(app)
    session.flush()
    return app


def _seed_role(session):
    """Seed the org_admin role."""
    role = Role(
        role_key="admin",
        display_name="Organization Admin",
        description="Org admin role",
    )
    session.add(role)
    session.flush()
    return role


def _seed_platform_admin(session):
    """Seed a platform admin user to act as the performer."""
    user = User(
        email="platform-admin@example.com",
        display_name="Platform Admin",
        status="active",
    )
    session.add(user)
    session.flush()
    return user


# ---------------------------------------------------------------------------
# TestProvisioningJobLifecycle
# ---------------------------------------------------------------------------


class TestProvisioningJobLifecycle:
    """Test happy path, idempotency, failure, and retry."""

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_create_job_and_run_happy_path(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """All 6 steps complete successfully."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        assert job.status == "pending"
        assert job.idempotency_key == compute_idempotency_key("test-museum", "admin@testmuseum.org")

        service.run_job(job)

        assert job.status == "completed"
        assert job.organization_id is not None
        assert job.admin_user_id is not None
        assert job.error_message is None

        # Verify all steps are completed
        for step_key in PROVISIONING_STEPS:
            assert job.steps[step_key]["status"] == "completed", f"Step {step_key} not completed"

        # Verify DB records
        org = session.query(Organization).filter_by(slug="test-museum").first()
        assert org is not None
        assert org.name == "Test Museum"

        # The org actually received its media configuration. Asserting on the
        # rows rather than the step's own result, so a step that reports
        # success while writing nothing still fails here. Until this step
        # existed, nothing called seed_media_config on any path and every
        # organization ran with an empty Media tag vocabulary.
        from app.models.media import MediaTagDefinition, MediaTagValue

        tags = (
            session.query(MediaTagDefinition)
            .filter_by(organization_id=org.organization_id)
            .all()
        )
        assert tags, "provisioning left the org with no media tag definitions"
        assert job.steps["seed_media_config"]["result"]["tag_definitions"] == len(tags)

        sensitivity = next(
            (d for d in tags if d.display_name == "Sensitivity"), None
        )
        assert sensitivity is not None, "the Sensitivity tag group was not seeded"
        values = {
            v.value
            for v in session.query(MediaTagValue).filter_by(
                definition_id=sensitivity.definition_id
            )
        }
        assert {"NAGPRA", "Sacred", "Restricted Viewing"} <= values

        user = session.query(User).filter_by(email="admin@testmuseum.org").first()
        assert user is not None

        membership = (
            session.query(OrganizationMembership)
            .filter_by(organization_id=org.organization_id, user_id=user.user_id)
            .first()
        )
        assert membership is not None
        assert membership.role == "admin"

        mock_cognito.assert_called_once()
        mock_email.send_welcome_email.assert_called_once()

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_send_welcome_email_skips_when_admin_already_activated(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Once the admin accepts their invitation (used_at set),
        create_admin_user can no longer rotate a token, so send_welcome_email
        must skip gracefully — not fail and loop forever on "rerun
        create_admin_user to rotate a fresh token" (which never can)."""
        from datetime import datetime, timezone

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)
        assert job.status == "completed"

        # The admin accepts their invitation.
        invitation = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id, email="admin@testmuseum.org")
            .first()
        )
        invitation.used_at = datetime.now(timezone.utc)
        session.commit()

        # Re-running create_admin_user now reports already-activated with no
        # token to mint (the unbreakable-loop trigger).
        result = service._step_create_admin_user(job)
        assert result["invitation_token"] is None
        assert result["admin_already_activated"] is True

        # send_welcome_email must skip rather than raise — and not send.
        job.steps["create_admin_user"]["result"] = result
        job.welcome_email_sent_at = None
        mock_email.send_welcome_email.reset_mock()

        send_result = service._step_send_welcome_email(job)
        assert send_result == {"email_sent": False, "skipped_already_activated": True}
        mock_email.send_welcome_email.assert_not_called()

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_sandbox_steps_skipped_when_with_demo_data_false(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Default enterprise provisioning: all four sandbox steps are no-ops."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)  # no with_demo_data
        service.run_job(job)

        assert job.status == "completed"
        for step_key in (
            "seed_reference_data",
            "seed_collections_met",
            "seed_collections_smithsonian",
            "seed_collections_rijks",
        ):
            step = job.steps[step_key]
            assert step["status"] == "completed", f"Step {step_key} not completed"
            assert step["result"] == {
                "skipped": True,
                "reason": "with_demo_data=false",
            }, f"Step {step_key} did not short-circuit cleanly"

        # Org should NOT be flagged is_demo when with_demo_data is absent.
        org = session.query(Organization).filter_by(slug="test-museum").first()
        assert org.is_demo is False

    # Patches target the names re-exported from the package, since the
    # saga step does `from app.services.sandbox_seeder import seed_*` —
    # patching the submodule names would only catch direct callers of
    # the submodule, not the lazy re-import in provisioning_service.
    @patch("app.search.collections.service.CollectionsSearchService.is_available", return_value=True)
    @patch("app.search.media.service.get_media_search_service")
    @patch("app.search.collections.service.get_collections_search_service")
    @patch("app.services.sandbox_seeder.seed_condition_reports")
    @patch("app.services.sandbox_seeder.seed_conservation")
    @patch("app.services.sandbox_seeder.seed_exhibitions")
    @patch("app.services.sandbox_seeder.seed_loans")
    @patch("app.services.sandbox_seeder.seed_acquisitions")
    @patch("app.services.sandbox_seeder.seed_collections_from_manifest")
    @patch("app.services.sandbox_seeder.seed_reference_data")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_sandbox_steps_run_when_with_demo_data_true(
        self,
        mock_settings,
        mock_cognito,
        mock_email_svc,
        mock_seed_ref,
        mock_seed_manifest,
        mock_seed_acq,
        mock_seed_loans,
        mock_seed_exh,
        mock_seed_cons,
        mock_seed_cr,
        mock_search_collections,
        mock_search_media,
        mock_is_available,
        session,
    ):
        """Sandbox provisioning: all sandbox seeders are invoked and their
        results land on the job step. Org is_demo=True. Seeders are mocked
        because the saga test runs against SQLite (no S3, no live APIs).

        All three collection seeders (Met/SI/Rijks) now route through the
        same `seed_collections_from_manifest` function with different
        `source` kwargs. `side_effect` returns a per-source result dict.
        """
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        mock_seed_ref.return_value = {
            "departments_created": 5,
            "locations_created": 20,
            "contacts_created": 15,
        }

        # Single function, three invocations keyed on the `source` kwarg.
        _manifest_results = {
            "met": {
                "source": "met", "manifest_size": 71, "objects_added_this_run": 71,
                "objects_skipped_existing": 0, "titles_created": 71,
                "parts_created": 71, "media_created": 71, "media_links_created": 71,
            },
            "smithsonian": {
                "source": "smithsonian", "skipped": True,
                "reason": "manifest not available",
                "objects_added_this_run": 0, "objects_skipped_existing": 0,
                "manifest_size": 0,
            },
            "rijks": {
                "source": "rijks", "skipped": True,
                "reason": "manifest is empty",
                "objects_added_this_run": 0, "objects_skipped_existing": 0,
                "manifest_size": 0,
            },
        }
        mock_seed_manifest.side_effect = lambda *a, source=None, **kw: _manifest_results[source]
        mock_seed_acq.return_value = {
            "acquisitions_created": 12,
            "acquisition_objects_created": 30,
            "skipped_at_target": False,
        }
        mock_seed_loans.return_value = {
            "loans_in_created": 4,
            "loan_in_objects_created": 5,
            "loans_out_created": 4,
            "loan_out_objects_created": 6,
            "skipped_at_target": False,
        }
        mock_seed_exh.return_value = {
            "venues_created": 1,
            "exhibitions_created": 3,
            "exhibition_objects_created": 19,
            "skipped_at_target": False,
        }
        mock_seed_cons.return_value = {
            "treatments_created": 7,
            "skipped_at_target": False,
        }
        mock_seed_cr.return_value = {
            "reports_created": 18,
            "skipped_at_target": False,
        }
        # index_search step reindexes OpenSearch from the seeded rows. Mock the
        # search-service getters so the saga doesn't reach a live cluster; the
        # returned stats must be JSON-serializable (they persist to job.steps).
        mock_search_collections.return_value.reindex_organization.return_value = {
            "total": 71, "indexed": 71, "errors": [],
        }
        mock_search_media.return_value.reindex_organization.return_value = {
            "indexed": 71, "failed": 0,
        }

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        sandbox_payload = {**SAMPLE_PAYLOAD, "with_demo_data": True}

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(sandbox_payload)
        service.run_job(job)

        assert job.status == "completed"

        # Reference seeder gets one call; manifest seeder gets one call per source.
        org = session.query(Organization).filter_by(slug="test-museum").first()
        # seed_reference_data now also receives the admin user as the actor
        # (routes locations/contacts through the create services).
        ref_args = mock_seed_ref.call_args
        assert ref_args.args[0] is session
        assert ref_args.args[1] == org.organization_id
        assert ref_args.args[2] is not None  # admin_user_id actor
        assert mock_seed_manifest.call_count == 3
        sources_called = {call.kwargs.get("source") for call in mock_seed_manifest.call_args_list}
        assert sources_called == {"met", "smithsonian", "rijks"}

        # Result dicts surface in job.steps[<step>].result for the UI.
        ref_step = job.steps["seed_reference_data"]
        assert ref_step["result"]["skipped"] is False
        assert ref_step["result"]["departments_created"] == 5

        met_step = job.steps["seed_collections_met"]
        assert met_step["result"]["objects_added_this_run"] == 71

        si_step = job.steps["seed_collections_smithsonian"]
        # The manifest seeder short-circuits with `skipped: true` when
        # the source manifest isn't shipped (or is empty). The step
        # method spreads that result into its own dict; since `skipped`
        # is in both, the seeder's value (True) wins via the later
        # kwarg — correct behavior for a graceful skip.
        assert si_step["result"]["skipped"] is True
        assert si_step["result"]["reason"] == "manifest not available"

        # Org marked is_demo=True for filtering / cleanup tooling.
        assert org.is_demo is True
        # Demo org starts 'pending' and is flipped to 'active' only by the final
        # activate_organization step — after seeding + indexing both succeed.
        assert org.status == "active"
        activate_step = job.steps["activate_organization"]
        assert activate_step["result"]["activated"] is True
        assert activate_step["result"]["previous_status"] == "pending"

        # Search indexes built from the seeded rows (so list/search views,
        # which read OpenSearch exclusively, aren't empty on a fresh org).
        mock_search_collections.return_value.reindex_organization.assert_called_once()
        mock_search_media.return_value.reindex_organization.assert_called_once()
        index_step = job.steps["index_search"]
        assert index_step["result"]["skipped"] is False
        assert index_step["result"]["collections"] == {"total": 71, "indexed": 71, "errors": []}
        # setup_index() is called (fresh cluster has no index/alias).
        mock_search_collections.return_value.setup_index.assert_called_once()

    @patch("app.search.collections.service.CollectionsSearchService.is_available", return_value=True)
    @patch("app.search.media.service.get_media_search_service")
    @patch("app.search.collections.service.get_collections_search_service")
    @patch("app.services.sandbox_seeder.seed_condition_reports", return_value={"reports_created": 0, "skipped_at_target": False})
    @patch("app.services.sandbox_seeder.seed_conservation", return_value={"treatments_created": 0, "skipped_at_target": False})
    @patch("app.services.sandbox_seeder.seed_exhibitions", return_value={"exhibitions_created": 0, "skipped_at_target": False})
    @patch("app.services.sandbox_seeder.seed_loans", return_value={"loans_out_created": 0, "skipped_at_target": False})
    @patch("app.services.sandbox_seeder.seed_acquisitions", return_value={"acquisitions_created": 0, "skipped_at_target": False})
    @patch("app.services.sandbox_seeder.seed_collections_from_manifest", return_value={"objects_added_this_run": 0, "skipped": True})
    @patch("app.services.sandbox_seeder.seed_reference_data", return_value={"departments_created": 0})
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_demo_org_stays_pending_when_index_search_fails(
        self,
        mock_settings,
        mock_cognito,
        mock_email_svc,
        mock_seed_ref,
        mock_seed_manifest,
        mock_seed_acq,
        mock_seed_loans,
        mock_seed_exh,
        mock_seed_cons,
        mock_seed_cr,
        mock_search_collections,
        mock_search_media,
        mock_is_available,
        session,
    ):
        """The core guarantee: if indexing fails, the demo org never flips to
        'active' — it stays 'pending' (hidden from Discover) and the
        activate_organization step never runs."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        # Collections reindex comes back partial -> index_search raises.
        mock_search_collections.return_value.reindex_organization.return_value = {
            "total": 71, "indexed": 0, "errors": ["boom"],
        }
        mock_search_media.return_value.reindex_organization.return_value = {
            "indexed": 0, "failed": 0,
        }

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job({**SAMPLE_PAYLOAD, "with_demo_data": True})
        with pytest.raises(ProvisioningError):
            service.run_job(job)

        assert job.status == "failed"
        assert job.error_step == "index_search"

        org = session.query(Organization).filter_by(slug="test-museum").first()
        assert org.is_demo is True
        # Never activated — stays pending so it can't surface half-built.
        assert org.status == "pending"
        assert job.steps["activate_organization"]["status"] != "completed"

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_create_job_idempotent(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Same payload returns same job, not a duplicate."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)

        job1 = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job1)

        # Second call with same payload
        job2 = service.create_job(SAMPLE_PAYLOAD)

        assert job2.job_id == job1.job_id
        assert job2.status == "completed"

        # Only one org in DB
        orgs = session.query(Organization).filter_by(slug="test-museum").all()
        assert len(orgs) == 1

    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_failed_job_returns_error_info(
        self, mock_settings, mock_cognito, session
    ):
        """When Cognito fails, job records the error step and message."""
        from botocore.exceptions import ClientError

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "Service unavailable"}},
            "AdminCreateUser",
        )

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        with pytest.raises(ProvisioningError) as exc_info:
            service.run_job(job)

        assert exc_info.value.step == "create_cognito_user"
        assert job.status == "failed"
        assert job.error_step == "create_cognito_user"
        assert job.error_message is not None

        # Steps 1-4 should be completed
        for step_key in PROVISIONING_STEPS[:4]:
            assert job.steps[step_key]["status"] == "completed"
        assert job.steps["create_cognito_user"]["status"] == "failed"

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_retry_resumes_from_failed_step(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Retry skips completed steps and resumes from the failed one."""
        from botocore.exceptions import ClientError

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        # First attempt: Cognito fails
        mock_cognito.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "Service unavailable"}},
            "AdminCreateUser",
        )

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        assert job.status == "failed"
        assert job.error_step == "create_cognito_user"

        # Retry: Cognito succeeds this time
        mock_cognito.side_effect = None
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_cognito.reset_mock()

        job.retry_count += 1
        service.run_job(job)

        assert job.status == "completed"
        assert job.error_message is None

        # Cognito should be called exactly once on retry (not for earlier steps)
        mock_cognito.assert_called_once()

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_cognito_user_already_exists_via_cognito_auth_error(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """UsernameExistsException is rewrapped by CognitoService as
        CognitoAuthError(code="UsernameExistsException"). The saga must
        treat that rewrap as the same idempotent outcome — proceed, do not
        fail the job — otherwise reruns after a partial provision get stuck
        forever at create_cognito_user."""
        from app.services.cognito import CognitoAuthError

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        # Surface the error the way CognitoService actually does it
        # (via the generic else branch of _handle_client_error), not as
        # a raw boto ClientError.
        mock_cognito.side_effect = CognitoAuthError(
            "User account already exists",
            "UsernameExistsException",
        )

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        assert job.status == "completed"
        assert job.error_message is None
        step = job.steps["create_cognito_user"]
        assert step["status"] == "completed"
        assert step["result"]["already_existed"] is True
        assert step["result"]["cognito_user_created"] is False

    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_cognito_auth_error_other_code_still_fails(
        self, mock_settings, mock_cognito, session
    ):
        """A CognitoAuthError with a different code (e.g. throttling) must
        still bubble up as a failure — we only swallow the
        UsernameExistsException rewrap."""
        from app.services.cognito import CognitoAuthError

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.side_effect = CognitoAuthError(
            "Service unavailable",
            "InternalErrorException",
        )

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        with pytest.raises(ProvisioningError) as exc_info:
            service.run_job(job)

        assert exc_info.value.step == "create_cognito_user"
        assert job.status == "failed"
        assert job.error_step == "create_cognito_user"


# ---------------------------------------------------------------------------
# TestProvisioningStepIdempotency
# ---------------------------------------------------------------------------


class TestProvisioningStepIdempotency:
    """Test that individual steps are idempotent when run twice."""

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_create_org_idempotent(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Running create_organization twice creates only one org."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        step_result = job.steps["create_organization"]["result"]
        assert step_result["already_existed"] is False

        orgs = session.query(Organization).filter_by(slug="test-museum").all()
        assert len(orgs) == 1

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_enable_apps_idempotent(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Running enable_applications twice creates no duplicate subscriptions."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        org_apps = (
            session.query(OrganizationApplication)
            .filter_by(organization_id=job.organization_id)
            .all()
        )
        assert len(org_apps) == 1

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_create_admin_idempotent(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Running create_admin_user twice creates one user/membership/invitation."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        users = session.query(User).filter_by(email="admin@testmuseum.org").all()
        assert len(users) == 1

        memberships = (
            session.query(OrganizationMembership)
            .filter_by(organization_id=job.organization_id)
            .all()
        )
        assert len(memberships) == 1

        invitations = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id, email="admin@testmuseum.org")
            .all()
        )
        assert len(invitations) == 1

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_create_admin_rerun_rotates_invitation_token(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """The bug: invitation tokens are stored hashed, so a rerun of
        create_admin_user used to return invitation_token=null when the
        invitation already existed. That bubbled into send_welcome_email
        as an empty activation_url → welcome button + direct link both
        blank in the sent email.

        Fix: when an unused invitation exists, rotate the token (issue a
        new plaintext, update token_hash + expires_at) so the saga can
        actually send a working welcome link on rerun."""
        import hashlib

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        # First run: invitation_token populated, hash stored.
        first_token = job.steps["create_admin_user"]["result"]["invitation_token"]
        assert first_token, "first run should issue a token"
        first_hash = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id)
            .first()
            .token_hash
        )
        assert first_hash == hashlib.sha256(first_token.encode()).hexdigest()

        # Reset the step + downstream to pending and rerun the saga.
        from sqlalchemy.orm.attributes import flag_modified
        for step_key in (
            "create_admin_user", "create_cognito_user", "send_welcome_email",
        ):
            job.steps[step_key] = {
                "status": "pending", "started_at": None,
                "completed_at": None, "result": None, "error": None,
            }
        job.status = "failed"
        job.error_step = None
        job.error_message = None
        flag_modified(job, "steps")
        session.commit()

        service.run_job(job)
        second_token = job.steps["create_admin_user"]["result"]["invitation_token"]
        assert second_token, "rerun must issue a fresh token (not None)"
        assert second_token != first_token, "rerun should rotate, not reuse"

        # The DB now stores the new hash; only one invitation row exists.
        invs = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id)
            .all()
        )
        assert len(invs) == 1
        assert invs[0].token_hash == hashlib.sha256(second_token.encode()).hexdigest()
        assert invs[0].used_at is None

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_send_welcome_email_fails_when_invitation_token_missing(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Defensive: if a prior version of create_admin_user populated
        the step result with invitation_token=null, send_welcome_email
        must refuse rather than mail a blank-button email. The operator
        gets a clear "rerun create_admin_user" message instead of a
        silent broken-link delivery."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        # Simulate the legacy-state shape: a completed create_admin_user
        # whose result has invitation_token=null. Then reset just the
        # welcome step and rerun — that's the same shape as the staging
        # bug we hit.
        from sqlalchemy.orm.attributes import flag_modified
        job.steps["create_admin_user"]["result"]["invitation_token"] = None
        job.steps["send_welcome_email"] = {
            "status": "pending", "started_at": None,
            "completed_at": None, "result": None, "error": None,
        }
        job.welcome_email_sent_at = None  # clear durable dedupe
        job.status = "failed"
        job.error_step = None
        flag_modified(job, "steps")
        session.commit()

        with pytest.raises(ProvisioningError) as exc:
            service.run_job(job)
        assert exc.value.step == "send_welcome_email"
        assert "invitation_token" in str(exc.value)
        assert mock_email.send_welcome_email.call_count == 1  # only the first (good) run


# ---------------------------------------------------------------------------
# TestProvisioningInspection
# ---------------------------------------------------------------------------


class TestProvisioningInspection:
    """Test job inspection queries."""

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_get_completed_job(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Completed job returns all step details."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        # Re-fetch from DB to verify persistence
        fetched = session.query(OrgProvisioningJob).filter_by(job_id=job.job_id).first()
        assert fetched.status == "completed"
        assert fetched.organization_id is not None
        assert fetched.admin_user_id is not None
        assert fetched.completed_at is not None

        for step_key in PROVISIONING_STEPS:
            step = fetched.steps[step_key]
            assert step["status"] == "completed"
            assert step["started_at"] is not None
            assert step["completed_at"] is not None
            assert step["result"] is not None

    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_get_failed_job_shows_error_step(
        self, mock_settings, mock_cognito, session
    ):
        """Failed job shows error_step and error_message."""
        from botocore.exceptions import ClientError

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "boom"}},
            "AdminCreateUser",
        )

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        fetched = session.query(OrgProvisioningJob).filter_by(job_id=job.job_id).first()
        assert fetched.status == "failed"
        assert fetched.error_step == "create_cognito_user"
        assert fetched.error_message is not None

    def test_get_nonexistent_job_404(self, session):
        """Querying a non-existent job_id returns None."""
        result = (
            session.query(OrgProvisioningJob)
            .filter_by(job_id=uuid.uuid4())
            .first()
        )
        assert result is None


# ---------------------------------------------------------------------------
# TestProvisioningRetry
# ---------------------------------------------------------------------------


class TestProvisioningRetry:
    """Test retry constraints."""

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_retry_completed_job_is_noop(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """A completed job cannot be re-run (status is not 'failed')."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        assert job.status == "completed"

        # Attempting create_job again returns the completed job
        job2 = service.create_job(SAMPLE_PAYLOAD)
        assert job2.job_id == job.job_id
        assert job2.status == "completed"

    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_retry_count_is_informational_only(
        self, mock_settings, mock_cognito, session
    ):
        """retry_count is no longer enforced as a cap.

        The retry endpoint used to refuse retries when
        `retry_count >= max_retries`. That cap was removed (3a98fb39)
        because retries are user-initiated, not automatic. retry_count
        remains as informational telemetry on the row.
        """
        from botocore.exceptions import ClientError

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "boom"}},
            "AdminCreateUser",
        )

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        assert job.status == "failed"

        # Even with retry_count past the old cap, retry_count is just
        # a counter; nothing in the saga or model enforces it.
        job.retry_count = job.max_retries + 5
        session.commit()
        assert job.retry_count > job.max_retries  # No cap enforced.


# ---------------------------------------------------------------------------
# TestIdempotencyKey
# ---------------------------------------------------------------------------


class TestIdempotencyKey:
    """Test idempotency key computation."""

    def test_same_input_same_key(self):
        k1 = compute_idempotency_key("test-museum", "admin@test.org")
        k2 = compute_idempotency_key("test-museum", "admin@test.org")
        assert k1 == k2

    def test_different_slug_different_key(self):
        k1 = compute_idempotency_key("museum-a", "admin@test.org")
        k2 = compute_idempotency_key("museum-b", "admin@test.org")
        assert k1 != k2

    def test_different_email_different_key(self):
        k1 = compute_idempotency_key("test-museum", "a@test.org")
        k2 = compute_idempotency_key("test-museum", "b@test.org")
        assert k1 != k2

    def test_key_is_sha256_hex(self):
        key = compute_idempotency_key("test", "admin@test.org")
        assert len(key) == 64
        assert all(c in "0123456789abcdef" for c in key)


# ---------------------------------------------------------------------------
# TestPayloadFingerprint (A1)
# ---------------------------------------------------------------------------


class TestPayloadFingerprint:
    """Test request fingerprint and payload-diff guard."""

    def test_same_payload_same_fingerprint(self):
        fp1 = compute_request_fingerprint(SAMPLE_PAYLOAD)
        fp2 = compute_request_fingerprint(SAMPLE_PAYLOAD)
        assert fp1 == fp2
        assert len(fp1) == 64

    def test_different_apps_different_fingerprint(self):
        """Different enabled_applications produce different fingerprint."""
        payload_a = {**SAMPLE_PAYLOAD}
        payload_b = {
            **SAMPLE_PAYLOAD,
            "applications": [{"key": "media"}],
        }
        assert compute_request_fingerprint(payload_a) != compute_request_fingerprint(payload_b)

    def test_different_onboarding_same_fingerprint(self):
        """Onboarding info (CSM, schedule) does not affect fingerprint."""
        payload_with_onboarding = {
            **SAMPLE_PAYLOAD,
            "onboarding": {
                "csm_name": "Different Person",
                "csm_email": "other@example.com",
                "scheduled_datetime": "2026-06-01T10:00:00-05:00",
            },
        }
        assert compute_request_fingerprint(SAMPLE_PAYLOAD) == compute_request_fingerprint(
            payload_with_onboarding
        )

    def test_app_order_does_not_affect_fingerprint(self):
        """Applications in different order produce the same fingerprint."""
        payload_a = {
            **SAMPLE_PAYLOAD,
            "applications": [
                {"key": "collections"},
                {"key": "media"},
            ],
        }
        payload_b = {
            **SAMPLE_PAYLOAD,
            "applications": [
                {"key": "media"},
                {"key": "collections"},
            ],
        }
        assert compute_request_fingerprint(payload_a) == compute_request_fingerprint(payload_b)

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_same_slug_email_different_apps_returns_409(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Same slug/email but different applications raises PayloadMismatchError."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)

        # First job with collections
        job1 = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job1)

        # Second job with same slug/email but different apps
        different_payload = {
            **SAMPLE_PAYLOAD,
            "applications": [{"key": "media"}],
        }

        with pytest.raises(PayloadMismatchError) as exc_info:
            service.create_job(different_payload)

        assert exc_info.value.existing_job_id == job1.job_id

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_same_payload_returns_same_job(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Exact same payload returns existing job (not a new one)."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)

        job1 = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job1)

        # Exact same payload — should return the completed job
        job2 = service.create_job(SAMPLE_PAYLOAD)
        assert job2.job_id == job1.job_id
        assert job2.status == "completed"


# ---------------------------------------------------------------------------
# TestConcurrencyGuard (A2)
# ---------------------------------------------------------------------------


class TestConcurrencyGuard:
    """Test atomic status transition prevents concurrent execution."""

    def test_running_job_rejects_second_run(self, session):
        """A job already in 'running' status cannot be claimed by run_job."""
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        # Manually set to running to simulate a concurrent run
        job.status = "running"
        session.commit()

        with pytest.raises(ConcurrentJobError) as exc_info:
            service.run_job(job)

        assert str(job.job_id) in str(exc_info.value.job_id)

    def test_completed_job_rejects_run(self, session):
        """A completed job cannot be re-run via run_job."""
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        # Manually set to completed
        job.status = "completed"
        session.commit()

        with pytest.raises(ConcurrentJobError):
            service.run_job(job)

    def test_running_job_via_create_job_returns_409(self, session):
        """create_job raises ProvisioningError if job is already running."""
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        job.status = "running"
        session.commit()

        with pytest.raises(ProvisioningError) as exc_info:
            service.create_job(SAMPLE_PAYLOAD)

        assert "already running" in str(exc_info.value)


# ---------------------------------------------------------------------------
# TestEmailDedupe (A3)
# ---------------------------------------------------------------------------


class TestEmailDedupe:
    """Test that welcome email is not sent twice on retry."""

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_email_sent_sets_durable_marker(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Successful email send sets welcome_email_sent_at on the job."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        assert job.welcome_email_sent_at is not None
        mock_email.send_welcome_email.assert_called_once()

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_email_not_resent_on_retry_when_marker_set(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """If welcome_email_sent_at is set, retry skips re-sending."""
        from datetime import datetime, timezone

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        # Run all steps normally
        service.run_job(job)
        assert job.welcome_email_sent_at is not None
        assert mock_email.send_welcome_email.call_count == 1

        # Simulate: mark email step as failed (as if commit failed after send)
        # but welcome_email_sent_at is set (durable marker survived)
        job.steps["send_welcome_email"]["status"] = "failed"
        job.status = "failed"
        job.error_step = "send_welcome_email"
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(job, "steps")
        session.commit()

        mock_email.send_welcome_email.reset_mock()

        # Retry — should skip email send due to durable marker
        job.retry_count += 1
        service.run_job(job)

        assert job.status == "completed"
        # Email should NOT have been called again
        mock_email.send_welcome_email.assert_not_called()
        # Step result should indicate dedupe
        assert job.steps["send_welcome_email"]["result"]["skipped_dedupe"] is True


# ---------------------------------------------------------------------------
# TestResendInvite (B1)
# ---------------------------------------------------------------------------


class TestResendInvite:
    """Test resend invite endpoint logic."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_invite_happy_path(
        self, mock_settings, mock_cognito, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """Resend ensures Cognito, creates new token, sends email, no duplicate membership."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        # Cognito user exists (created during initial provisioning)
        mock_cognito_svc = MagicMock()
        mock_cognito_svc.user_pool_id = "test-pool"
        mock_cognito_svc.client.admin_get_user.return_value = {
            "Username": "admin@testmuseum.org",
            "UserStatus": "CONFIRMED",
            "UserAttributes": [
                {"Name": "email_verified", "Value": "true"},
            ],
        }
        mock_cognito_svc_fn.return_value = mock_cognito_svc

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)
        assert job.status == "completed"

        # Reset mock to track resend call
        mock_email.send_welcome_email.reset_mock()

        result = service.resend_invite(job, force=True)

        assert result["email"] == "admin@testmuseum.org"
        assert result["sent_at"] is not None
        assert result["invitation_id"] is not None
        assert result.get("already_active") is None
        assert result["cognito_created"] is False
        mock_email.send_welcome_email.assert_called_once()

        # Still only one membership
        memberships = (
            session.query(OrganizationMembership)
            .filter_by(organization_id=job.organization_id)
            .all()
        )
        assert len(memberships) == 1

        # Still only one user
        users = session.query(User).filter_by(email="admin@testmuseum.org").all()
        assert len(users) == 1

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_invite_dedupe_skips_recent(
        self, mock_settings, mock_cognito, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """Resend within 10 minutes is skipped (dedupe) unless force=true."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc = MagicMock()
        mock_cognito_svc.user_pool_id = "test-pool"
        mock_cognito_svc.client.admin_get_user.return_value = {
            "Username": "admin@testmuseum.org",
            "UserStatus": "CONFIRMED",
            "UserAttributes": [
                {"Name": "email_verified", "Value": "true"},
            ],
        }
        mock_cognito_svc_fn.return_value = mock_cognito_svc

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        # First resend (force to bypass any recent send)
        service.resend_invite(job, force=True)

        # Second resend without force — should dedupe (last_sent_at < 10 min ago)
        mock_email.send_welcome_email.reset_mock()
        result = service.resend_invite(job, force=False)
        assert result.get("dedupe_skipped") is True
        mock_email.send_welcome_email.assert_not_called()

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_invite_already_active_user(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Resend for an already-active user returns already_active flag."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        # Mark admin user as active (simulating they already activated)
        admin_user = session.query(User).filter_by(email="admin@testmuseum.org").first()
        admin_user.status = "active"
        session.commit()

        mock_email.send_welcome_email.reset_mock()
        result = service.resend_invite(job)

        assert result["already_active"] is True
        mock_email.send_welcome_email.assert_not_called()

    def test_resend_invite_rejects_non_completed_job(self, session):
        """Cannot resend invite for a job that is not completed."""
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        with pytest.raises(ProvisioningError) as exc_info:
            service.resend_invite(job)

        assert "status 'pending'" in str(exc_info.value)


# ---------------------------------------------------------------------------
# TestTokenLifecycle (B2)
# ---------------------------------------------------------------------------


class TestTokenLifecycle:
    """Test token expiry and rotation behavior."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_rotates_token_and_extends_expiry(
        self, mock_settings, mock_cognito, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """Resend on a valid invite rotates the token hash and extends expiry."""
        from datetime import datetime, timezone

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc = MagicMock()
        mock_cognito_svc.user_pool_id = "test-pool"
        mock_cognito_svc.client.admin_get_user.return_value = {
            "Username": "admin@testmuseum.org",
            "UserStatus": "CONFIRMED",
            "UserAttributes": [
                {"Name": "email_verified", "Value": "true"},
            ],
        }
        mock_cognito_svc_fn.return_value = mock_cognito_svc

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        # Get original invite
        invite_before = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id, email="admin@testmuseum.org")
            .first()
        )
        old_token_hash = invite_before.token_hash
        old_expires = invite_before.expires_at

        # Resend with force
        result = service.resend_invite(job, force=True)
        assert result["reused_token"] is True

        # Verify token was rotated
        session.refresh(invite_before)
        assert invite_before.token_hash != old_token_hash
        # Expiry should be extended (at least as late as old)
        assert invite_before.expires_at >= old_expires
        # last_sent_at should be set
        assert invite_before.last_sent_at is not None

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_creates_new_invite_when_expired(
        self, mock_settings, mock_cognito, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """Resend when invite is expired creates a new invite record."""
        from datetime import datetime, timezone, timedelta

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc = MagicMock()
        mock_cognito_svc.user_pool_id = "test-pool"
        mock_cognito_svc.client.admin_get_user.return_value = {
            "Username": "admin@testmuseum.org",
            "UserStatus": "CONFIRMED",
            "UserAttributes": [
                {"Name": "email_verified", "Value": "true"},
            ],
        }
        mock_cognito_svc_fn.return_value = mock_cognito_svc

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        # Expire the existing invite
        invite = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id, email="admin@testmuseum.org")
            .first()
        )
        invite.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        session.commit()

        old_invite_id = invite.invitation_id

        # Resend — should create new invite
        result = service.resend_invite(job, force=True)
        assert result.get("reused_token") is False  # New invite, not reused

        # Should now have 2 invite records (old expired + new valid)
        invites = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id, email="admin@testmuseum.org")
            .all()
        )
        assert len(invites) == 2
        now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
        valid = [i for i in invites if i.expires_at.replace(tzinfo=None) > now_naive]
        assert len(valid) == 1
        assert valid[0].invitation_id != old_invite_id


# ---------------------------------------------------------------------------
# TestReconciliation (B3)
# ---------------------------------------------------------------------------


class TestReconciliation:
    """Test reconciliation of partial provisioning states."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.get_settings")
    def test_reconcile_creates_missing_cognito_user(
        self, mock_settings, mock_email_svc, mock_cognito_create, mock_cognito_svc_fn, session
    ):
        """Reconcile creates Cognito user when missing."""
        from botocore.exceptions import ClientError

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        # Initial provisioning: cognito fails
        mock_cognito_create.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "Service unavailable"}},
            "AdminCreateUser",
        )

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        assert job.status == "failed"
        assert job.error_step == "create_cognito_user"

        # Reconcile: cognito get_user returns not found, create succeeds
        mock_cognito_svc = MagicMock()
        mock_cognito_svc.user_pool_id = "test-pool"
        mock_cognito_svc.client.admin_get_user.side_effect = ClientError(
            {"Error": {"Code": "UserNotFoundException", "Message": "Not found"}},
            "AdminGetUser",
        )
        mock_cognito_svc_fn.return_value = mock_cognito_svc

        mock_cognito_create.side_effect = None
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}

        result = service.reconcile(job)

        assert "created_cognito_user" in result["actions"]
        assert result["cognito_user"] == "ensured"
        mock_cognito_create.assert_called()

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.get_settings")
    def test_reconcile_creates_missing_invite(
        self, mock_settings, mock_email_svc, mock_cognito_create, mock_cognito_svc_fn, session
    ):
        """Reconcile creates invitation when Cognito user exists but invite is missing."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        # Delete all invitations to simulate missing invite
        session.query(OrganizationInvitation).filter_by(
            organization_id=job.organization_id
        ).delete()
        session.commit()

        # Cognito user exists
        mock_cognito_svc = MagicMock()
        mock_cognito_svc.user_pool_id = "test-pool"
        mock_cognito_svc.client.admin_get_user.return_value = {
            "Username": "admin@testmuseum.org",
            "UserStatus": "CONFIRMED",
            "UserAttributes": [
                {"Name": "email_verified", "Value": "true"},
            ],
        }
        mock_cognito_svc_fn.return_value = mock_cognito_svc

        # Mark user as invited (not yet active) so reconcile creates invite
        user = session.query(User).filter_by(email="admin@testmuseum.org").first()
        user.status = "invited"
        session.commit()

        result = service.reconcile(job)

        assert "created_invitation" in result["actions"]
        assert result["cognito_user"] == "ensured"

        # Verify a new invite was created
        invites = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id, email="admin@testmuseum.org")
            .all()
        )
        assert len(invites) == 1

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.get_settings")
    def test_reconcile_no_action_when_complete(
        self, mock_settings, mock_email_svc, mock_cognito_create, mock_cognito_svc_fn, session
    ):
        """Reconcile on a fully complete job takes no actions."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        # Cognito user exists
        mock_cognito_svc = MagicMock()
        mock_cognito_svc.user_pool_id = "test-pool"
        mock_cognito_svc.client.admin_get_user.return_value = {
            "Username": "admin@testmuseum.org",
            "UserStatus": "CONFIRMED",
            "UserAttributes": [
                {"Name": "email_verified", "Value": "true"},
            ],
        }
        mock_cognito_svc_fn.return_value = mock_cognito_svc

        result = service.reconcile(job)

        assert result["actions"] == []
        assert result["cognito_user"] == "ensured"


# ---------------------------------------------------------------------------
# TestEventLog (A3 — Audit Logging)
# ---------------------------------------------------------------------------


class TestEventLog:
    """Test that provisioning operations produce durable audit events."""

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_happy_path_logs_all_events(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Completed job has job_created + job_started + step events + job_completed."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        log = job.event_log
        assert isinstance(log, list)

        actions = [e["action"] for e in log]

        # Must have job_created
        assert actions[0] == "job_created"
        assert log[0]["details"]["org_slug"] == "test-museum"
        assert log[0]["details"]["admin_email"] == "admin@testmuseum.org"
        assert log[0]["actor_id"] == str(admin.user_id)

        # Must have job_started
        assert "job_started" in actions

        # Must have step_started and step_completed for each step
        for step_key in PROVISIONING_STEPS:
            step_starts = [e for e in log if e["action"] == "step_started" and e["details"]["step"] == step_key]
            step_completes = [e for e in log if e["action"] == "step_completed" and e["details"]["step"] == step_key]
            assert len(step_starts) == 1, f"Missing step_started for {step_key}"
            assert len(step_completes) == 1, f"Missing step_completed for {step_key}"

        # Must end with job_completed
        assert actions[-1] == "job_completed"

        # Every event has timestamp
        for event in log:
            assert "timestamp" in event

        # No secrets in log
        log_str = str(log)
        assert "password" not in log_str.lower() or "temp_password" not in log_str
        assert "token" not in log_str.lower() or "invitation_token" not in log_str

    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_failed_job_logs_step_failed_and_job_failed(
        self, mock_settings, mock_cognito, session
    ):
        """Failed job records step_failed + job_failed events."""
        from botocore.exceptions import ClientError

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "Service unavailable"}},
            "AdminCreateUser",
        )

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        actions = [e["action"] for e in job.event_log]

        assert "step_failed" in actions
        assert "job_failed" in actions

        # step_failed should reference create_cognito_user
        failed_events = [e for e in job.event_log if e["action"] == "step_failed"]
        assert len(failed_events) == 1
        assert failed_events[0]["details"]["step"] == "create_cognito_user"
        assert "error" in failed_events[0]["details"]

        # job_failed should reference the error step
        job_failed = [e for e in job.event_log if e["action"] == "job_failed"]
        assert len(job_failed) == 1
        assert job_failed[0]["details"]["error_step"] == "create_cognito_user"

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_retry_adds_second_job_started(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Retry logs a second job_started event with updated retry_count."""
        from botocore.exceptions import ClientError

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        # First attempt: Cognito fails
        mock_cognito.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "boom"}},
            "AdminCreateUser",
        )

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        # Retry
        mock_cognito.side_effect = None
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        job.retry_count += 1
        service.run_job(job)

        job_started_events = [e for e in job.event_log if e["action"] == "job_started"]
        assert len(job_started_events) == 2
        # Second start should show retry_count=1
        assert job_started_events[1]["details"]["retry_count"] == 1

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_invite_logged(
        self, mock_settings, mock_cognito, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """Resend invite operation is recorded in event_log."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc = MagicMock()
        mock_cognito_svc.user_pool_id = "test-pool"
        mock_cognito_svc.client.admin_get_user.return_value = {
            "Username": "admin@testmuseum.org",
            "UserStatus": "CONFIRMED",
            "UserAttributes": [
                {"Name": "email_verified", "Value": "true"},
            ],
        }
        mock_cognito_svc_fn.return_value = mock_cognito_svc

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        events_before = len(job.event_log)
        service.resend_invite(job, force=True)

        resend_events = [e for e in job.event_log if e["action"] == "resend_invite"]
        assert len(resend_events) == 1
        assert resend_events[0]["details"]["admin_email"] == "admin@testmuseum.org"
        assert len(job.event_log) == events_before + 1

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.get_settings")
    def test_reconcile_logged(
        self, mock_settings, mock_email_svc, mock_cognito_create, mock_cognito_svc_fn, session
    ):
        """Reconcile operation is recorded in event_log."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        # Cognito user exists
        mock_cognito_svc = MagicMock()
        mock_cognito_svc.user_pool_id = "test-pool"
        mock_cognito_svc.client.admin_get_user.return_value = {
            "Username": "admin@testmuseum.org",
            "UserStatus": "CONFIRMED",
            "UserAttributes": [
                {"Name": "email_verified", "Value": "true"},
            ],
        }
        mock_cognito_svc_fn.return_value = mock_cognito_svc

        events_before = len(job.event_log)
        service.reconcile(job)

        reconcile_events = [e for e in job.event_log if e["action"] == "reconcile"]
        assert len(reconcile_events) == 1
        assert "actions" in reconcile_events[0]["details"]
        assert len(job.event_log) == events_before + 1

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_event_log_no_secrets(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Event log never contains tokens, passwords, or client secrets."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        log_json = str(job.event_log)
        # No invitation tokens should appear
        assert "invitation_token" not in log_json
        # No passwords
        assert "password" not in log_json.lower()
        assert "client_secret" not in log_json.lower()


# ---------------------------------------------------------------------------
# TestJobList (B1 — List Endpoint)
# ---------------------------------------------------------------------------


class TestJobList:
    """Test job listing with filtering, search, and pagination."""

    def _create_jobs(self, session, service, count, slug_prefix="museum", status_override=None):
        """Create multiple provisioning jobs with distinct slugs."""
        jobs = []
        for i in range(count):
            payload = {
                **SAMPLE_PAYLOAD,
                "organization": {"name": f"{slug_prefix} {i}", "slug": f"{slug_prefix}-{i}"},
                "admin": {"email": f"admin{i}@{slug_prefix}.org", "name": f"Admin {i}"},
            }
            job = OrgProvisioningJob(
                idempotency_key=f"key-{slug_prefix}-{i}",
                request_fingerprint=f"fp-{slug_prefix}-{i}",
                status=status_override or "completed",
                request_payload=payload,
                steps={},
                organization_slug=f"{slug_prefix}-{i}",
                admin_email=f"admin{i}@{slug_prefix}.org",
                event_log=[],
            )
            session.add(job)
            jobs.append(job)
        session.commit()
        return jobs

    def test_list_all_jobs(self, session):
        """List returns all jobs with correct pagination metadata."""
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        jobs = self._create_jobs(session, service, 5)

        all_jobs = (
            session.query(OrgProvisioningJob)
            .order_by(OrgProvisioningJob.created_at.desc())
            .all()
        )
        assert len(all_jobs) == 5

    def test_filter_by_status(self, session):
        """Filter by status returns only matching jobs."""
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        self._create_jobs(session, service, 3, slug_prefix="completed", status_override="completed")
        self._create_jobs(session, service, 2, slug_prefix="failed", status_override="failed")

        completed = (
            session.query(OrgProvisioningJob)
            .filter_by(status="completed")
            .all()
        )
        assert len(completed) == 3

        failed = (
            session.query(OrgProvisioningJob)
            .filter_by(status="failed")
            .all()
        )
        assert len(failed) == 2

    def test_search_by_slug(self, session):
        """Search by slug substring matches correct jobs."""
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        self._create_jobs(session, service, 2, slug_prefix="art-gallery")
        self._create_jobs(session, service, 2, slug_prefix="natural-history")

        results = (
            session.query(OrgProvisioningJob)
            .filter(OrgProvisioningJob.organization_slug.ilike("%art-gallery%"))
            .all()
        )
        assert len(results) == 2
        assert all("art-gallery" in j.organization_slug for j in results)

    def test_pagination_limit_offset(self, session):
        """Limit and offset produce correct page slices."""
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        self._create_jobs(session, service, 10)

        # First page
        page1 = (
            session.query(OrgProvisioningJob)
            .order_by(OrgProvisioningJob.created_at.desc())
            .offset(0)
            .limit(3)
            .all()
        )
        assert len(page1) == 3

        # Second page
        page2 = (
            session.query(OrgProvisioningJob)
            .order_by(OrgProvisioningJob.created_at.desc())
            .offset(3)
            .limit(3)
            .all()
        )
        assert len(page2) == 3

        # No overlap
        page1_ids = {j.job_id for j in page1}
        page2_ids = {j.job_id for j in page2}
        assert page1_ids.isdisjoint(page2_ids)

    def test_empty_list(self, session):
        """Empty DB returns empty jobs array."""
        results = session.query(OrgProvisioningJob).all()
        assert results == []

    def test_search_by_admin_email(self, session):
        """Search by admin_email column matches correct jobs."""
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        self._create_jobs(session, service, 2, slug_prefix="alpha")
        self._create_jobs(session, service, 2, slug_prefix="beta")

        results = (
            session.query(OrgProvisioningJob)
            .filter(OrgProvisioningJob.admin_email.ilike("%alpha%"))
            .all()
        )
        assert len(results) == 2

    def test_create_job_sets_admin_email(self, session):
        """create_job populates the admin_email column from the payload."""
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        assert job.admin_email == "admin@testmuseum.org"


# ---------------------------------------------------------------------------
# TestJobTimeline (B2 — Timeline Response Enhancement)
# ---------------------------------------------------------------------------


class TestJobTimeline:
    """Test timeline generation from job step data."""

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_timeline_completed_job(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Completed job timeline has all 6 steps with status=completed and durations."""
        from app.fastapi_app.routers.platform_admin import _build_job_timeline

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        timeline = _build_job_timeline(job)
        assert len(timeline) == len(PROVISIONING_STEPS)

        for entry in timeline:
            assert entry["status"] == "completed"
            assert entry["started_at"] is not None
            assert entry["completed_at"] is not None
            assert entry["duration_ms"] is not None
            assert entry["duration_ms"] >= 0
            assert entry["error"] is None

        # Verify step order matches PROVISIONING_STEPS
        assert [t["step"] for t in timeline] == PROVISIONING_STEPS

    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_timeline_failed_job(self, mock_settings, mock_cognito, session):
        """Failed job timeline shows error on the failed step."""
        from botocore.exceptions import ClientError
        from app.fastapi_app.routers.platform_admin import _build_job_timeline

        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "boom"}},
            "AdminCreateUser",
        )

        _seed_application(session)
        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        timeline = _build_job_timeline(job)

        # Look steps up by name. Indexing into the timeline made this test
        # depend on how many steps happen to precede the failure, so inserting
        # a step anywhere earlier in PROVISIONING_STEPS broke it for no real
        # reason.
        by_name = {entry["step"]: entry for entry in timeline}
        order = [entry["step"] for entry in timeline]

        cognito_step = by_name["create_cognito_user"]
        assert cognito_step["status"] == "failed"
        assert cognito_step["error"] is not None

        # Everything before the failure ran.
        for entry in timeline[: order.index("create_cognito_user")]:
            assert entry["status"] == "completed"

        # Everything after it did not.
        for entry in timeline[order.index("create_cognito_user") + 1 :]:
            assert entry["status"] == "pending"

        assert by_name["send_welcome_email"]["status"] == "pending"

    def test_timeline_pending_job(self, session):
        """Pending job (no steps run) timeline shows all steps as pending."""
        from app.fastapi_app.routers.platform_admin import _build_job_timeline

        _seed_role(session)
        admin = _seed_platform_admin(session)
        session.commit()

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        timeline = _build_job_timeline(job)
        assert len(timeline) == len(PROVISIONING_STEPS)

        for entry in timeline:
            assert entry["status"] == "pending"
            assert entry["started_at"] is None
            assert entry["completed_at"] is None
            assert entry["duration_ms"] is None
            assert entry["error"] is None


# ---------------------------------------------------------------------------
# TestEmailMasking (B1 — Email Privacy)
# ---------------------------------------------------------------------------


class TestEmailMasking:
    """Test admin email masking in list responses."""

    def test_mask_standard_email(self):
        from app.fastapi_app.routers.platform_admin import _mask_email
        assert _mask_email("jane@museum.org") == "j***@museum.org"

    def test_mask_long_local(self):
        from app.fastapi_app.routers.platform_admin import _mask_email
        assert _mask_email("administrator@example.com") == "a***@example.com"

    def test_mask_single_char_local(self):
        from app.fastapi_app.routers.platform_admin import _mask_email
        assert _mask_email("j@example.com") == "j@example.com"

    def test_mask_none(self):
        from app.fastapi_app.routers.platform_admin import _mask_email
        assert _mask_email(None) is None

    def test_mask_empty_string(self):
        from app.fastapi_app.routers.platform_admin import _mask_email
        assert _mask_email("") == ""

    def test_mask_no_at_sign(self):
        from app.fastapi_app.routers.platform_admin import _mask_email
        assert _mask_email("not-an-email") == "not-an-email"
