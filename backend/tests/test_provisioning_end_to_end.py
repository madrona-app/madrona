"""
End-to-end provisioning + activation test.

One test exercising the full sandbox-org provisioning saga (Cognito
mocked, SES mocked, real Postgres), then the post-saga activation
flow. Designed to fail on every one of the eight historical bugs:

    1. Cognito UsernameExistsException rewrap as CognitoAuthError —
       second-run create_cognito_user must succeed idempotently.
    2. SES MessageTag rejects spaces/commas/etc. in freeform org names —
       welcome email send must succeed for "E2E Test Museum, Inc."
    3. invitation_token=null on rerun of create_admin_user — rerun must
       return a fresh plaintext token so the activation URL is valid.
    4. welcome_email_sent_at sticky across reruns — rerun handler must
       clear the marker so SES is called a second time.
    5. APP_BASE_URL defaulting to localhost — every emailed link must
       use the configured app_base_url, https://, and not localhost.
    6. RLS hides invitation from pre-auth /verify and /activate — the
       handlers must use the admin (BYPASSRLS) session.
    7. Procedure seeders skip-if-any — acquisitions step must top-up
       to cover newly-added objects, not short-circuit.
    8. (Met curated list staleness is verified offline via the
       preflight script, not in this test — see backend/docs/
       sandbox_provisioning_audit.md.)

The test invokes endpoint handlers directly (mirroring
tests/test_provisioning_cancel_rerun.py) because the FastAPI
TestClient hangs on macOS via the auth_setup chain.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import pytest
from botocore.exceptions import ClientError


TEST_APP_BASE_URL = "https://test.madrona.local"
TEST_ADMIN_EMAIL = "e2e-admin@madrona.test"
TEST_ORG_NAME = "E2E Test Museum, Inc."
ORG_SLUG = "e2e-test-museum-inc"
PRIMARY_PASSWORD = "ActivationP4ss!word"


# ---------------------------------------------------------------------------
# Catalog + role seeding
# ---------------------------------------------------------------------------


def _seed_catalog(db_session) -> dict:
    """Create the Application catalog, admin Role, and a platform-admin User.

    The platform-admin user exists because the saga writes
    `enabled_by=performer_id` on every OrganizationApplication row and
    the FK requires a real users.user_id.
    """
    from app.models import Application, Role, User

    platform_admin = User(
        email="platform-admin@madrona.test",
        display_name="Platform Admin",
        status="active",
    )
    db_session.add(platform_admin)

    apps = {}
    for key, display in (("collections", "Collections"), ("media", "Media")):
        app_row = Application(
            key=key,
            display_name=display,
            description=f"{display} application",
            icon=display,
            status="active",
        )
        db_session.add(app_row)
        apps[key] = app_row

    admin_role = Role(
        role_key="admin",
        display_name="Org Admin",
        description="Full org admin",
        is_system=True,
    )
    db_session.add(admin_role)
    db_session.flush()

    return {
        "apps": apps,
        "admin_role": admin_role,
        "platform_admin_id": platform_admin.user_id,
    }


# ---------------------------------------------------------------------------
# AWS stubs
# ---------------------------------------------------------------------------


class _Recorder:
    """Captures every call so the test can assert on the AWS payload."""

    def __init__(self):
        self.cognito_create_user: list[dict] = []
        self.cognito_set_password: list[dict] = []
        self.cognito_delete_user: list[str] = []
        self.ses_send_email: list[dict] = []

    def reset_ses(self) -> None:
        self.ses_send_email = []


@pytest.fixture
def aws_recorder(monkeypatch):
    """Patch Cognito + SES boundaries and capture every call."""
    rec = _Recorder()

    # ---- Cognito ----
    existing_users: dict[str, dict] = {}

    def fake_create_user(email, temporary_password, suppress_welcome=False):
        rec.cognito_create_user.append({
            "email": email,
            "temporary_password": temporary_password,
            "suppress_welcome": suppress_welcome,
        })
        if email.lower() in existing_users:
            # Simulate the CognitoService rewrap: AWS would raise a
            # botocore.ClientError(UsernameExistsException), but
            # `CognitoService._handle_client_error` rewraps every
            # ClientError as a domain CognitoAuthError. Bug #1 was that
            # `_step_create_cognito_user` only caught raw ClientError,
            # so the rewrap escaped uncaught.
            from app.services.cognito import CognitoAuthError
            raise CognitoAuthError(
                "User account already exists.",
                code="UsernameExistsException",
            )
        existing_users[email.lower()] = {
            "email": email.lower(),
            "password": temporary_password,
            "status": "FORCE_CHANGE_PASSWORD",
        }
        return {"Username": email.lower(), "UserStatus": "FORCE_CHANGE_PASSWORD"}

    def fake_set_password(email, password, permanent=True):
        rec.cognito_set_password.append({
            "email": email,
            "password": password,
            "permanent": permanent,
        })
        u = existing_users.setdefault(email.lower(), {})
        u["password"] = password
        u["status"] = "CONFIRMED" if permanent else "FORCE_CHANGE_PASSWORD"

    def fake_delete_user(email):
        rec.cognito_delete_user.append(email)
        existing_users.pop(email.lower(), None)

    monkeypatch.setattr(
        "app.services.cognito.cognito_admin_create_user", fake_create_user
    )
    monkeypatch.setattr(
        "app.services.provisioning_service.cognito_admin_create_user",
        fake_create_user,
    )
    monkeypatch.setattr(
        "app.services.cognito.cognito_admin_set_user_password", fake_set_password
    )
    monkeypatch.setattr(
        "app.fastapi_app.routers.auth.cognito_admin_set_user_password",
        fake_set_password,
    )
    monkeypatch.setattr(
        "app.services.cognito.cognito_admin_delete_user", fake_delete_user
    )

    # ---- SES ----
    fake_ses_client = MagicMock()

    def fake_send_email(**params):
        rec.ses_send_email.append(params)
        # SES MessageTag values must match this regex; bug #2 was that
        # `EmailService.send_email` passed unsanitized freeform org
        # names which 400'd at the SES boundary.
        for tag in params.get("EmailTags", []):
            if not re.fullmatch(r"[A-Za-z0-9_\-.@]+", tag["Value"]):
                err = ClientError(
                    {
                        "Error": {
                            "Code": "BadRequestException",
                            "Message": (
                                f"1 validation error detected: Value '{tag['Value']}' at "
                                "'tags' failed to satisfy constraint"
                            ),
                        }
                    },
                    "SendEmail",
                )
                raise err
        return {"MessageId": "test-msg-" + uuid4().hex[:8]}

    fake_ses_client.send_email.side_effect = fake_send_email

    # Force EmailService to use our stub instead of constructing a real
    # boto3 client (which would try to reach AWS).
    from app.services import email_service as email_mod
    email_mod._email_service = None  # reset singleton
    monkeypatch.setattr(
        email_mod.EmailService,
        "client",
        property(lambda self: fake_ses_client),
    )

    # `check_email_deliverable` does a real DB lookup that's irrelevant
    # to this test — short-circuit so every recipient is deliverable.
    monkeypatch.setattr(
        "app.services.email_event_service.check_email_deliverable",
        lambda email: True,
    )

    yield rec

    email_mod._email_service = None


@pytest.fixture
def app_base_url(monkeypatch):
    """Set settings.app_base_url to a real https:// host for this test.

    Bug #5 was the default `http://localhost:5173` leaking into staging
    activation links. We force a fresh-looking https URL here and
    assert downstream that the rendered email actually contains it.
    """
    from app.config import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "app_base_url", TEST_APP_BASE_URL)
    monkeypatch.setattr(settings, "email_enabled", True)
    return TEST_APP_BASE_URL


# ---------------------------------------------------------------------------
# Provisioning payload
# ---------------------------------------------------------------------------


def _sandbox_payload(with_demo_data: bool = True) -> dict:
    return {
        "organization": {
            "name": TEST_ORG_NAME,
            "slug": ORG_SLUG,
        },
        "admin": {
            "email": TEST_ADMIN_EMAIL,
            "name": "E2E Test Admin",
        },
        "applications": [
            {"key": "collections"},
            {"key": "media"},
        ],
        "with_demo_data": with_demo_data,
    }


def _run_saga(
    db_session,
    *,
    with_demo_data: bool = False,
    performer_id: UUID | None = None,
) -> "OrgProvisioningJob":  # type: ignore[name-defined]
    """Create + run a provisioning job synchronously against db_session.

    Returns the persisted OrgProvisioningJob. with_demo_data is False
    by default because the manifest seeders pull image bytes from S3
    and the sandbox seeder paths are exercised separately (loud-failure
    guards still test their idempotency contracts in other tests).
    """
    from app.services.provisioning_service import ProvisioningService

    service = ProvisioningService(db_session, performer_id=performer_id)
    job = service.create_job(_sandbox_payload(with_demo_data=with_demo_data))
    service.run_job(job)
    db_session.refresh(job)
    return job


# ---------------------------------------------------------------------------
# Test 1: full provisioning + activation
# ---------------------------------------------------------------------------


class TestEndToEndProvisioningAndActivation:
    """Covers bugs 1, 2, 5, 6, and the welcome-email render correctness
    asserts (audit class C7)."""

    def test_full_flow(self, db_session, aws_recorder, app_base_url):
        catalog = _seed_catalog(db_session)
        db_session.commit()

        # ---- Provision ----
        job = _run_saga(
            db_session,
            with_demo_data=False,
            performer_id=catalog["platform_admin_id"],
        )

        # Every step must complete with no error.
        for step_key, step in job.steps.items():
            if step.get("status") == "skipped":
                continue
            assert step.get("status") == "completed", (
                f"step {step_key} did not complete: {step}"
            )
            assert step.get("error") is None, (
                f"step {step_key} has error: {step.get('error')}"
            )
        assert job.status == "completed"

        # ---- SES payload ----
        assert len(aws_recorder.ses_send_email) == 1, (
            "expected exactly one SES SendEmail call"
        )
        ses_call = aws_recorder.ses_send_email[0]
        tags = ses_call.get("EmailTags", [])
        # C4: every tag value must match the SES character class
        assert tags, "SES SendEmail must include EmailTags"
        for tag in tags:
            assert re.fullmatch(r"[A-Za-z0-9_\-.@]+", tag["Value"]), (
                f"SES tag value {tag['Value']!r} contains forbidden characters"
            )

        # C7: render correctness
        body = ses_call["Content"]["Simple"]["Body"]
        html = body["Html"]["Data"]
        text = body["Text"]["Data"]

        anchor_hrefs = re.findall(r'href="([^"]+)"', html)
        activation_anchors = [h for h in anchor_hrefs if "/activate?token=" in h]
        assert len(activation_anchors) == 1, (
            f"expected exactly one activation anchor, got {anchor_hrefs!r}"
        )
        activation_url = activation_anchors[0]
        assert activation_url.startswith(TEST_APP_BASE_URL + "/activate?token="), (
            f"activation anchor must use configured app_base_url, got {activation_url!r}"
        )
        assert activation_url.startswith("https://"), (
            "activation URL must be https"
        )
        assert "localhost" not in activation_url, (
            "activation URL must not point at localhost"
        )
        assert activation_url in text, (
            "plaintext body must contain the activation URL verbatim"
        )
        assert TEST_ORG_NAME in html
        assert TEST_ORG_NAME in text

        # Token in URL must match the create_admin_user step result
        admin_step = job.steps["create_admin_user"]["result"]
        token_from_step = admin_step["invitation_token"]
        assert token_from_step, "create_admin_user must return a plaintext token"
        assert (
            activation_url
            == f"{TEST_APP_BASE_URL}/activate?token={token_from_step}"
        )

        # ---- Verify endpoint (pre-auth, must bypass RLS) ----
        from app.fastapi_app.routers.auth import verify_invitation

        verify_request = MagicMock()
        verify_request.cookies = {}
        verify_request.client = MagicMock(host="127.0.0.1")
        verify_request.headers = {}
        verify_response = verify_invitation(
            token=token_from_step,
            request=verify_request,
            db=db_session,
        )
        # The route returns a dict on success; only error paths return JSONResponse.
        assert isinstance(verify_response, dict)
        assert verify_response["valid"] is True
        assert verify_response["email"] == TEST_ADMIN_EMAIL
        assert verify_response["organization_id"] == str(job.organization_id)

        # ---- Activate (pre-auth) ----
        from app.fastapi_app.routers.auth import activate_account
        from app.fastapi_app.schemas.auth import ActivateAccountBody

        activate_request = MagicMock()
        activate_request.cookies = {}
        activate_request.client = MagicMock(host="127.0.0.1")
        activate_request.headers = {}
        body = ActivateAccountBody(token=token_from_step, password=PRIMARY_PASSWORD)
        response = activate_account(
            body=body, request=activate_request, db=db_session
        )
        status, payload = _decode_response(response)
        assert status == 200, f"activate failed: {payload}"
        assert payload["active_organization_id"] == str(job.organization_id)
        assert payload["email"].lower() == TEST_ADMIN_EMAIL.lower()
        assert payload["access_token"]

        # Cognito must have been told to set the user's password
        assert any(
            c["email"].lower() == TEST_ADMIN_EMAIL.lower()
            and c["password"] == PRIMARY_PASSWORD
            for c in aws_recorder.cognito_set_password
        ), "activate must call admin_set_user_password with the supplied password"

        # ---- Second activation is rejected ----
        try:
            response2 = activate_account(
                body=body, request=activate_request, db=db_session
            )
            status2, payload2 = _decode_response(response2)
        except Exception as exc:  # HTTPException allowed
            from fastapi import HTTPException
            assert isinstance(exc, HTTPException)
            assert exc.status_code == 409
        else:
            assert status2 == 409, (
                f"second activate must return 409 (used_at set), got {status2}: {payload2}"
            )


# ---------------------------------------------------------------------------
# Test 2: rerun safety — closes bugs 1, 3, 4, 7
# ---------------------------------------------------------------------------


class TestRerunSafety:
    def test_cognito_username_exists_rewrap_is_idempotent(
        self, db_session, aws_recorder, app_base_url
    ):
        """Bug #1: the CognitoService _handle_client_error path rewraps
        UsernameExistsException as CognitoAuthError, and the saga step
        must treat that rewrap as the same idempotent outcome."""
        catalog = _seed_catalog(db_session)
        db_session.commit()

        # First run creates the Cognito user.
        job = _run_saga(db_session, performer_id=catalog["platform_admin_id"])
        assert job.status == "completed"
        first_cog_step = job.steps["create_cognito_user"]["result"]
        assert first_cog_step["cognito_user_created"] is True

        # Now force the next admin_create_user call to raise the rewrap.
        # Re-run the cognito step in isolation by resetting it and
        # invoking the step method directly.
        from app.services.provisioning_service import ProvisioningService
        from sqlalchemy.orm.attributes import flag_modified

        job.steps["create_cognito_user"] = {
            "status": "pending",
            "started_at": None,
            "completed_at": None,
            "result": None,
            "error": None,
        }
        flag_modified(job, "steps")
        db_session.commit()

        service = ProvisioningService(
            db_session, performer_id=catalog["platform_admin_id"]
        )
        # Direct step call — the second invocation will hit the
        # existing-user branch and raise the rewrapped CognitoAuthError;
        # the step must catch it.
        result = service._step_create_cognito_user(job)
        assert result["already_existed"] is True, (
            "step must treat UsernameExistsException (rewrapped) as idempotent"
        )

    def test_create_admin_user_rerun_rotates_token(
        self, db_session, aws_recorder, app_base_url
    ):
        """Bug #3: rerun of create_admin_user when an unused invitation
        already exists must rotate the token AND surface a fresh
        plaintext value in the step result."""
        catalog = _seed_catalog(db_session)
        db_session.commit()

        job = _run_saga(db_session, performer_id=catalog["platform_admin_id"])
        first_token = job.steps["create_admin_user"]["result"]["invitation_token"]
        assert first_token

        # Reset only the create_admin_user step.
        from app.services.provisioning_service import ProvisioningService
        from sqlalchemy.orm.attributes import flag_modified

        job.steps["create_admin_user"] = {
            "status": "pending",
            "started_at": None,
            "completed_at": None,
            "result": None,
            "error": None,
        }
        flag_modified(job, "steps")
        db_session.commit()

        service = ProvisioningService(
            db_session, performer_id=catalog["platform_admin_id"]
        )
        result = service._step_create_admin_user(job)
        second_token = result["invitation_token"]

        assert second_token is not None, (
            "create_admin_user rerun must return a fresh plaintext invitation_token "
            "(bug #3 left this null)"
        )
        assert second_token != first_token, (
            "rerun must rotate the token, not reuse the prior one"
        )

        # The DB row's token_hash must match the NEW token.
        import hashlib
        from app.models import OrganizationInvitation
        invitation = (
            db_session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id)
            .first()
        )
        assert (
            invitation.token_hash
            == hashlib.sha256(second_token.encode()).hexdigest()
        )

    def test_rerun_handler_clears_welcome_email_marker(
        self, db_session, aws_recorder, app_base_url
    ):
        """Bug #4: rerun_provisioning_step must clear
        job.welcome_email_sent_at when the welcome step is in the
        reset window, otherwise the step short-circuits on the durable
        dedupe marker and SES is never called again.

        Observable signal: the rerun cascades into a fresh saga run.
        If the marker survives, `_step_send_welcome_email` returns
        `skipped_dedupe: True` and no new SES call lands. If the
        handler resets the marker, the step calls SES and the new
        send_welcome_email step result has `skipped_dedupe` falsy.
        """
        catalog = _seed_catalog(db_session)
        db_session.commit()

        job = _run_saga(db_session, performer_id=catalog["platform_admin_id"])
        first_marker = job.welcome_email_sent_at
        assert first_marker is not None
        assert len(aws_recorder.ses_send_email) == 1

        aws_recorder.reset_ses()

        from app.fastapi_app.routers.platform_admin import rerun_provisioning_step
        from app.fastapi_app.dependencies.auth import AuthContext

        auth = AuthContext(
            user_id=catalog["platform_admin_id"],
            email="platform-admin@madrona.test",
            active_organization_id=None,
            mfa_verified=True,
            mfa_at=None,
        )
        rerun_provisioning_step(
            job_id=job.job_id,
            step_key="send_welcome_email",
            auth=auth,
            db=db_session,
            admin_db=db_session,
        )

        db_session.refresh(job)
        new_send_result = job.steps["send_welcome_email"].get("result") or {}
        assert new_send_result.get("email_sent") is True, (
            f"after rerun, send_welcome_email result was {new_send_result!r}"
        )
        assert not new_send_result.get("skipped_dedupe"), (
            "send_welcome_email short-circuited on the stale marker (bug #4)"
        )
        assert len(aws_recorder.ses_send_email) == 1, (
            "SES must be called once more after rerun cleared the marker"
        )
        # The saga re-sets the marker after the new send completes — so the
        # marker is non-None again, and it must be later than the first run's.
        assert (
            job.welcome_email_sent_at is not None
            and job.welcome_email_sent_at > first_marker
        )

    def test_acquisitions_seeder_tops_up_to_target(self, db_session, app_base_url):
        """Bug #7: the acquisitions seeder must top-up (cover new
        objects on a second run) rather than skip-if-any."""
        from app.models import Organization, User
        from app.models.objects import CollectionObject
        from app.models.procedures import Acquisition, AcquisitionObject
        from app.services.sandbox_seeder import (
            seed_acquisitions,
            seed_reference_data,
        )

        # Real user for created_by audit FKs on CollectionObject rows
        # and acquisition links.
        user = User(
            email="topup-admin@madrona.test",
            display_name="Topup Admin",
            status="active",
        )
        db_session.add(user)
        db_session.flush()
        admin_user_id = user.user_id

        # Minimal org + reference data so the acquisitions seeder has
        # constituents to pull as donors.
        org = Organization(
            name=TEST_ORG_NAME, slug=ORG_SLUG, status="active", is_demo=True
        )
        db_session.add(org)
        db_session.flush()

        seed_reference_data(db_session, org.organization_id)

        # First batch of objects.
        first_objects = []
        for i in range(5):
            obj = CollectionObject(
                organization_id=org.organization_id,
                object_number=f"MET-{1000 + i}",
                created_by=admin_user_id,
                updated_by=admin_user_id,
            )
            db_session.add(obj)
            first_objects.append(obj)
        db_session.flush()
        # Capture object_ids before any later flush expires the attrs.
        first_object_ids = {obj.object_id for obj in first_objects}
        db_session.commit()

        first_result = seed_acquisitions(
            db_session,
            org_id=org.organization_id,
            admin_user_id=admin_user_id,
        )
        assert first_result["acquisitions_created"] > 0
        assert first_result["acquisition_objects_created"] >= len(first_objects)
        first_acq_count = (
            db_session.query(Acquisition)
            .filter_by(organization_id=org.organization_id)
            .count()
        )
        first_link_count = (
            db_session.query(AcquisitionObject)
            .filter(AcquisitionObject.organization_id == org.organization_id)
            .count()
        )

        # Add new objects mimicking a richer manifest expansion.
        new_objects = []
        for i in range(7):
            obj = CollectionObject(
                organization_id=org.organization_id,
                object_number=f"SI-{2000 + i}",
                created_by=admin_user_id,
                updated_by=admin_user_id,
            )
            db_session.add(obj)
            new_objects.append(obj)
        db_session.flush()
        new_object_ids = {obj.object_id for obj in new_objects}
        db_session.commit()

        second_result = seed_acquisitions(
            db_session,
            org_id=org.organization_id,
            admin_user_id=admin_user_id,
        )

        # The seeder must NOT skip: it must cover the new SI objects.
        assert second_result["skipped_at_target"] is False, (
            "second run must top-up; bug #7 short-circuited when any "
            "acquisitions existed in the org"
        )
        assert second_result["acquisition_objects_created"] >= len(new_objects)

        # Acquisitions count grew but no acquisition_number collisions.
        new_acq_count = (
            db_session.query(Acquisition)
            .filter_by(organization_id=org.organization_id)
            .count()
        )
        assert new_acq_count > first_acq_count

        # Year-sequence invariant: acquisition_numbers are unique
        numbers = [
            row[0]
            for row in db_session.query(Acquisition.acquisition_number)
            .filter_by(organization_id=org.organization_id)
            .all()
        ]
        assert len(numbers) == len(set(numbers)), (
            "acquisition_number collisions across runs"
        )

        # Every new SI object is now covered.
        covered_ids = {
            row[0]
            for row in db_session.query(AcquisitionObject.object_id)
            .filter(AcquisitionObject.organization_id == org.organization_id)
            .all()
        }
        for new_id in new_object_ids:
            assert new_id in covered_ids, (
                f"new object {new_id} not covered after top-up"
            )


# ---------------------------------------------------------------------------
# Test 3: pre-auth RLS — bug #6
# ---------------------------------------------------------------------------


class TestPreAuthRLSIsolation:
    """Bug #6: the activate / verify handlers must use the BYPASSRLS
    admin session because pre-auth requests have no current_org_id
    GUC set, and `organization_invitations` policy is
    `organization_id = current_org_id()` — so the standard RLS-enforced
    session would filter every invitation out and return "Invitation
    token not found."

    The local test DB connects as the `madrona` superuser, which
    bypasses RLS regardless of FORCE — so we can't actually reproduce
    the RLS filter with a runtime query. Instead we verify the
    *contract*: each pre-auth handler declares `Depends(get_admin_db)`
    on its `db` parameter. A regression that drops back to
    `Depends(get_db)` flips this signature and the assertion fails
    before any DB interaction.
    """

    def test_preauth_handlers_use_admin_db_dep(self):
        from inspect import signature
        from app.database import get_admin_db
        from app.fastapi_app.routers.auth import (
            activate_account,
            verify_invitation,
        )

        for handler in (activate_account, verify_invitation):
            sig = signature(handler)
            db_param = sig.parameters.get("db")
            assert db_param is not None, f"{handler.__name__} has no db parameter"
            default = db_param.default
            # FastAPI Depends — peek at the wrapped dependency.
            dep_callable = getattr(default, "dependency", None)
            assert dep_callable is get_admin_db, (
                f"{handler.__name__} db dep is {dep_callable}, "
                f"expected get_admin_db (bug #6 regression)"
            )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _decode_response(response) -> tuple[int, dict]:
    """JSONResponse → (status_code, parsed_body). dict passthrough."""
    if isinstance(response, dict):
        return 200, response
    body = response.body if hasattr(response, "body") else b"{}"
    if isinstance(body, bytes):
        body = body.decode("utf-8")
    return response.status_code, json.loads(body) if body else {}
