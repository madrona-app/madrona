"""
Tests for POST /api/platform/provision?mode=validate (dry-run).

Verifies that validate mode:
- Returns normalized slug/email
- Reports warnings (slug taken, email exists, unknown app keys)
- Never creates a provisioning job row
- Never mutates DB/Cognito/SES
"""

import uuid

import pytest

from app.models import (
    Organization,
    User,
    OrganizationInvitation,
    Application,
    OrgProvisioningJob,
)
from app.services.provisioning_service import ProvisioningService


@pytest.fixture
def session(db_session):
    """The shared Postgres session from conftest.

    This module used to build its own in-memory SQLite engine and create five
    tables by name. SQLite has no schemas and cannot compile JSONB, so such a
    fixture can only ever hold a flattened subset of the schema — the reason
    conftest dropped its own SQLite engine and `_adapt_metadata_for_sqlite`.
    conftest's db_session runs each test inside a savepoint on the real
    madrona_test database and rolls back on teardown, so the manual delete
    pass this fixture used to do is no longer needed either.
    """
    return db_session


def _valid_payload(**overrides):
    base = {
        "organization": {"name": "Test Museum"},
        "admin": {"email": "admin@test.org", "name": "Admin User"},
        "applications": [{"key": "collections"}],
    }
    base.update(overrides)
    return base


class TestValidateOnly:

    def test_validate_returns_normalized_values(self, session):
        """Validate mode returns normalized slug and email."""
        # Add an app to the catalog
        session.add(Application(application_id=uuid.uuid4(), key="collections", display_name="Collections"))
        session.commit()

        service = ProvisioningService(session)
        result = service.validate_only(_valid_payload())

        assert result["valid"] is True
        assert result["normalized"]["org_slug"] == "test-museum"
        assert result["normalized"]["admin_email"] == "admin@test.org"
        assert result["normalized"]["admin_name"] == "Admin User"
        assert result["errors"] == []

    def test_validate_warns_slug_taken(self, session):
        """Validate mode warns when slug already exists."""
        org_id = uuid.uuid4()
        session.add(Organization(organization_id=org_id, name="Existing", slug="test-museum", status="active"))
        session.commit()

        service = ProvisioningService(session)
        result = service.validate_only(_valid_payload())

        assert result["valid"] is True
        assert any("slug 'test-museum' is already taken" in w for w in result["warnings"])

    def test_validate_warns_email_exists(self, session):
        """Validate mode warns when admin email is already a user."""
        session.add(User(
            user_id=uuid.uuid4(), email="admin@test.org", display_name="Existing",
            password_hash="x", status="active",
        ))
        session.commit()

        service = ProvisioningService(session)
        result = service.validate_only(_valid_payload())

        assert result["valid"] is True
        assert any("email 'admin@test.org' already exists" in w for w in result["warnings"])

    def test_validate_warns_open_invitation(self, session):
        """Validate mode warns when there's an open invitation for the email."""
        inviter_id = uuid.uuid4()
        session.add(User(
            user_id=inviter_id, email="inviter@test.org", display_name="Inviter",
            password_hash="x", status="active",
        ))
        # The invitation's organization has to exist. Under the old in-memory
        # SQLite fixture foreign keys were not enforced, so a random UUID here
        # was accepted; Postgres rejects it.
        org_id = uuid.uuid4()
        session.add(Organization(
            organization_id=org_id, name="Invite Org", slug=f"invite-org-{org_id.hex[:8]}",
            status="active",
        ))
        session.flush()
        from datetime import datetime, timedelta, timezone
        session.add(OrganizationInvitation(
            invitation_id=uuid.uuid4(),
            organization_id=org_id,
            email="admin@test.org",
            role="admin",
            token_hash="abc123",
            invited_by=inviter_id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        ))
        session.commit()

        service = ProvisioningService(session)
        result = service.validate_only(_valid_payload())

        assert result["valid"] is True
        assert any("open invitation" in w for w in result["warnings"])

    def test_validate_warns_unknown_app_key(self, session):
        """Validate mode warns about unknown application keys."""
        service = ProvisioningService(session)
        result = service.validate_only(_valid_payload(
            applications=[{"key": "collections"}, {"key": "nonexistent_app"}]
        ))

        assert result["valid"] is True
        assert any("nonexistent_app" in w for w in result["warnings"])

    def test_validate_missing_fields_returns_errors(self, session):
        """Validate mode returns errors for missing required fields."""
        service = ProvisioningService(session)
        result = service.validate_only({"organization": {}, "admin": {}})

        assert result["valid"] is False
        assert len(result["errors"]) == 3
        assert any("organization.name" in e for e in result["errors"])
        assert any("admin.email" in e for e in result["errors"])
        assert any("admin.name" in e for e in result["errors"])

    def test_validate_does_not_create_job_row(self, session):
        """Validate mode must not create an OrgProvisioningJob record."""
        service = ProvisioningService(session)
        service.validate_only(_valid_payload())
        session.flush()

        count = session.query(OrgProvisioningJob).count()
        assert count == 0, "validate_only must not create a job row"

    def test_validate_no_warnings_when_clean(self, session):
        """Clean payload with valid app produces no warnings."""
        session.add(Application(application_id=uuid.uuid4(), key="collections", display_name="Collections"))
        session.commit()

        service = ProvisioningService(session)
        result = service.validate_only(_valid_payload())

        assert result["valid"] is True
        assert result["warnings"] == []
