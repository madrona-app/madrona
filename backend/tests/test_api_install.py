"""First-run install: /api/install and its guard.

The endpoint exists so a self-hosted operator does not have to run
`python -m seeds.bootstrap_admin --password '...'` in a shell before they can
log in. Its only protection is that it refuses once an organization exists, so
that refusal is what these tests spend most of their effort on.
"""

import uuid

import pytest

from app.services.install_service import bootstrap_first_admin, install_is_required


@pytest.fixture
def applications(db_session):
    """A couple of applications for the service to enable.

    Real deployments get these from the boot seeds. Enabling *every*
    application is the behaviour worth pinning: a self-hosted operator who ends
    up with one app granted has an install that looks broken.
    """
    from app.models import Application

    created = []
    for key in ("collections", "media"):
        existing = db_session.query(Application).filter_by(key=key).first()
        if existing:
            created.append(existing)
            continue
        app = Application(key=key, display_name=key.title(), default_enabled=True)
        db_session.add(app)
        created.append(app)
    db_session.flush()
    return created


@pytest.fixture
def platform_admin_role(db_session):
    """The role bootstrap_first_admin grants.

    The boot seeds create it in a real deployment; the test database is built
    from Base.metadata, so the role has to exist before the service can find
    it. Its absence is itself a case worth covering — see
    test_missing_role_is_reported_clearly.
    """
    from app.models import Role

    existing = db_session.query(Role).filter_by(role_key="platform_admin").first()
    if existing:
        return existing
    role = Role(
        role_key="platform_admin",
        display_name="Platform Admin",
        description="Instance operator",
        is_system=True,
    )
    db_session.add(role)
    db_session.flush()
    return role


class TestInstallStatus:
    def test_reports_not_required_when_an_organization_exists(self, client, auth_setup):
        """A configured instance must not advertise itself as installable."""
        resp = client.get("/api/install/status")
        assert resp.status_code == 200
        assert resp.get_json() == {"install_required": False}

    def test_status_needs_no_authentication(self, client, auth_setup):
        """Callable before anyone can log in — that is the whole point."""
        resp = client.get("/api/install/status")
        assert resp.status_code == 200


class TestInstallGuard:
    def test_refuses_once_an_organization_exists(self, client, auth_setup):
        """The guard, stated as a test: a second install is a 409, not a second org."""
        resp = client.post(
            "/api/install",
            json={
                "email": "intruder@example.org",
                "password": "a-sufficiently-long-password",
                "organization_name": "Second Museum",
            },
            content_type="application/json",
        )
        assert resp.status_code == 409
        assert "already installed" in resp.get_json()["error"]["message"].lower()

    def test_short_password_is_rejected(self, client, auth_setup):
        """8 characters, matching activate and password-change."""
        resp = client.post(
            "/api/install",
            json={
                "email": "operator@example.org",
                "password": "short",
                "organization_name": "My Museum",
            },
            content_type="application/json",
        )
        assert resp.status_code == 422

    def test_malformed_email_is_rejected(self, client, auth_setup):
        resp = client.post(
            "/api/install",
            json={
                "email": "not-an-email",
                "password": "a-sufficiently-long-password",
                "organization_name": "My Museum",
            },
            content_type="application/json",
        )
        assert resp.status_code == 422


class TestBootstrapFirstAdmin:
    """The shared implementation, exercised directly.

    The CLI and the wizard both call this; testing it here rather than only
    through the endpoint is what keeps the CLI covered.
    """

    def test_creates_organization_admin_and_media_config(self, db_session, platform_admin_role, applications):
        suffix = uuid.uuid4().hex[:8]
        result = bootstrap_first_admin(
            db_session,
            email=f"curator-{suffix}@example.org",
            password="a-sufficiently-long-password",
            org_name=f"Museum {suffix}",
            platform_admin=True,
        )
        db_session.flush()

        assert result["email"] == f"curator-{suffix}@example.org"
        assert result["organization_slug"] == f"museum-{suffix}"
        assert result["role"] == "platform_admin"
        # Every application, not just one — a self-hosted operator should not
        # find Collections missing.
        assert result["applications_enabled"] == len(applications)

    def test_is_idempotent_on_a_second_run(self, db_session, platform_admin_role):
        """Re-running resets the password rather than failing or duplicating."""
        suffix = uuid.uuid4().hex[:8]
        args = dict(
            email=f"curator-{suffix}@example.org",
            org_name=f"Museum {suffix}",
            platform_admin=True,
        )
        first = bootstrap_first_admin(db_session, password="first-password-here", **args)
        db_session.flush()
        second = bootstrap_first_admin(db_session, password="second-password-here", **args)
        db_session.flush()

        assert first["organization_id"] == second["organization_id"]
        assert first["email"] == second["email"]

    def test_missing_role_is_reported_clearly(self, db_session):
        """A LookupError, not an AttributeError 500.

        The role is missing only when the boot seeds did not run, which means
        the backend started abnormally; the endpoint turns this into a 503
        saying so rather than a bare stack trace.
        """
        with pytest.raises(LookupError, match="run the core seeds first"):
            bootstrap_first_admin(
                db_session,
                email=f"nobody-{uuid.uuid4().hex[:8]}@example.org",
                password="a-sufficiently-long-password",
                org_name=f"Roleless {uuid.uuid4().hex[:8]}",
                platform_admin=True,
            )

    def test_install_is_not_required_once_a_membership_exists(self, db_session, auth_setup):
        """Memberships are the marker, not organizations.

        The boot seeds create a `system` organization on every start so that
        shared resources (frame styles, mount configs) have an organization_id
        to hang off. Counting organizations therefore reports "installed" on an
        instance nobody has ever touched, and the wizard would never appear —
        which is exactly what happened the first time this was run against a
        genuinely empty database.
        """
        assert install_is_required(db_session) is False
