"""
Tests for organization invitation service.

Tests generate_invitation_token, create_invitation, and accept_invitation
using the conftest db_session fixture. Email service is mocked.

Note: accept_invitation tests require patching datetime in the invitation
service because SQLite stores datetimes as naive (no timezone), but the
source code compares with datetime.now(timezone.utc) (aware). This causes
TypeError in SQLite-backed tests. We patch to use naive datetimes.
"""

import hashlib
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest

from app.models import Organization, OrganizationInvitation, OrganizationMembership, User
from app.services.invitation_service import (
    generate_invitation_token,
    create_invitation,
    accept_invitation,
    sanitize_for_ses_tag,
    INVITATION_EXPIRY_DAYS,
)


# ============================================================================
# FIXTURES
# ============================================================================

@pytest.fixture
def invite_org(db_session):
    """Create a test organization for invitation tests."""
    org = Organization(
        name="Invite Test Org",
        slug="invite-test-org",
        is_demo=False,
        status="active",
    )
    db_session.add(org)
    db_session.commit()
    return org


@pytest.fixture
def invite_admin(db_session, invite_org):
    """Create an admin user who sends invitations.

    Depends on invite_org to ensure the org exists before creating membership.
    """
    from app.models import Role

    role = Role(
        role_key="admin",
        display_name="Org Admin",
        description="Admin",
        is_system=False,
    )
    db_session.add(role)
    # accept_invitation resolves non-admin invitees to the viewer role; seed it
    # so acceptance tests can complete without a full role seeder run.
    viewer_role = db_session.query(Role).filter_by(role_key="viewer").first()
    if not viewer_role:
        viewer_role = Role(
            role_key="viewer",
            display_name="Viewer",
            description="Read-only",
            is_system=False,
        )
        db_session.add(viewer_role)
    db_session.flush()

    user = User(
        email="admin@invite-test.com",
        password_hash="not_used",
        status="active",
    )
    db_session.add(user)
    db_session.flush()

    membership = OrganizationMembership(
        organization_id=invite_org.organization_id,
        user_id=user.user_id,
        role="admin",
        role_id=role.role_id,
        status="active",
    )
    db_session.add(membership)
    db_session.commit()
    return user


# ============================================================================
# TOKEN GENERATION
# ============================================================================

class TestTokenGeneration:
    """Tests for secure token generation."""

    def test_returns_token_and_hash(self):
        """Token generation returns a token and SHA-256 hash."""
        token, token_hash = generate_invitation_token()

        assert isinstance(token, str)
        assert len(token) > 0

        # Hash should be 64-char hex string (SHA-256)
        assert isinstance(token_hash, str)
        assert len(token_hash) == 64
        assert all(c in "0123456789abcdef" for c in token_hash)

    def test_unique_tokens(self):
        """Each call produces unique values."""
        token1, hash1 = generate_invitation_token()
        token2, hash2 = generate_invitation_token()

        assert token1 != token2
        assert hash1 != hash2

    def test_hash_matches_sha256(self):
        """Token hash is valid SHA-256 of the token."""
        token, token_hash = generate_invitation_token()

        expected_hash = hashlib.sha256(token.encode()).hexdigest()
        assert token_hash == expected_hash


# ============================================================================
# SANITIZE FOR SES TAG
# ============================================================================

class TestSanitizeForSesTag:
    """Tests for SES tag sanitization."""

    def test_basic_string(self):
        """Simple alphanumeric strings pass through."""
        assert sanitize_for_ses_tag("TestOrg") == "TestOrg"

    def test_spaces_replaced(self):
        """Spaces become underscores."""
        assert sanitize_for_ses_tag("My Org") == "My_Org"

    def test_special_chars_removed(self):
        """Special characters (except allowed ones) are removed."""
        result = sanitize_for_ses_tag("Org #1 (test)")
        assert "#" not in result
        assert "(" not in result
        assert ")" not in result

    def test_email_chars_preserved(self):
        """The @ and . characters are preserved."""
        result = sanitize_for_ses_tag("user@example.com")
        assert "@" in result
        assert "." in result


# ============================================================================
# CREATE INVITATION
# ============================================================================

class TestCreateInvitation:
    """Tests for invitation creation."""

    @patch("app.services.invitation_service._send_invitation_email")
    def test_creates_invitation_with_token(
        self, mock_send_email, db_session, invite_org, invite_admin
    ):
        """Creating invitation generates secure token."""
        mock_send_email.return_value = True

        invitation, token = create_invitation(
            session=db_session,
            organization_id=str(invite_org.organization_id),
            email="newuser@example.com",
            role="member",
            invited_by_user_id=str(invite_admin.user_id),
        )

        # Token should be returned (not stored in DB)
        assert isinstance(token, str)
        assert len(token) > 0

        # Token hash should be stored (not plaintext)
        assert invitation.token_hash is not None
        assert invitation.token_hash != token
        assert len(invitation.token_hash) == 64

    @patch("app.services.invitation_service._send_invitation_email")
    def test_sets_expiry(self, mock_send_email, db_session, invite_org, invite_admin):
        """Invitation expires after configured days."""
        mock_send_email.return_value = True

        before = datetime.utcnow()
        invitation, token = create_invitation(
            session=db_session,
            organization_id=str(invite_org.organization_id),
            email="expiry-test@example.com",
            role="member",
            invited_by_user_id=str(invite_admin.user_id),
        )

        # SQLite stores datetimes as naive (strips timezone).
        # Use naive datetime for comparison.
        expected_min = before + timedelta(days=INVITATION_EXPIRY_DAYS)
        # Make both sides naive for comparison
        expires = invitation.expires_at
        if hasattr(expires, 'tzinfo') and expires.tzinfo is not None:
            expires = expires.replace(tzinfo=None)
        assert expires >= expected_min

    @patch("app.services.invitation_service._send_invitation_email")
    def test_rotates_token_on_duplicate(
        self, mock_send_email, db_session, invite_org, invite_admin
    ):
        """Re-inviting same email rotates token."""
        mock_send_email.return_value = True

        invitation1, token1 = create_invitation(
            session=db_session,
            organization_id=str(invite_org.organization_id),
            email="duplicate@example.com",
            role="member",
            invited_by_user_id=str(invite_admin.user_id),
        )
        first_hash = invitation1.token_hash

        invitation2, token2 = create_invitation(
            session=db_session,
            organization_id=str(invite_org.organization_id),
            email="duplicate@example.com",
            role="member",
            invited_by_user_id=str(invite_admin.user_id),
        )

        # Should reuse same invitation record
        assert invitation2.invitation_id == invitation1.invitation_id

        # Token should be different
        assert token2 != token1
        assert invitation2.token_hash != first_hash

    @patch("app.services.invitation_service._send_invitation_email")
    def test_validates_organization_exists(
        self, mock_send_email, db_session, invite_org, invite_admin
    ):
        """Cannot create invitation for non-existent organization."""
        with pytest.raises(ValueError, match="not found"):
            create_invitation(
                session=db_session,
                organization_id=str(uuid4()),
                email="newuser@example.com",
                role="member",
                invited_by_user_id=str(invite_admin.user_id),
            )

    @patch("app.services.invitation_service._send_invitation_email")
    def test_validates_role(
        self, mock_send_email, db_session, invite_org, invite_admin
    ):
        """Cannot create invitation with invalid role."""
        with pytest.raises(ValueError, match="Invalid role"):
            create_invitation(
                session=db_session,
                organization_id=str(invite_org.organization_id),
                email="newuser@example.com",
                role="superadmin",  # Invalid
                invited_by_user_id=str(invite_admin.user_id),
            )


# ============================================================================
# ACCEPT INVITATION
# ============================================================================

class TestAcceptInvitation:
    """Tests for invitation acceptance.

    accept_invitation compares expires_at (naive from SQLite) with
    datetime.now(timezone.utc) (timezone-aware), causing TypeError.
    We patch datetime.now in the invitation_service module to return
    naive datetimes for SQLite compatibility.

    Also, accept_invitation creates OrganizationMembership without role_id,
    but OrganizationMembership.role_id is NOT NULL. Tests that reach the
    membership creation step will hit an IntegrityError. We handle this
    by testing the validation behavior (which happens before membership
    creation) and skipping tests that require successful membership creation.
    """

    @pytest.fixture
    def pending_invitation(self, db_session, invite_org, invite_admin):
        """Create a pending invitation with naive datetime for SQLite."""
        token, token_hash = generate_invitation_token()
        invitation = OrganizationInvitation(
            organization_id=invite_org.organization_id,
            email="invited@example.com",
            token_hash=token_hash,
            role="member",
            invited_by=invite_admin.user_id,
            # Use naive datetime for SQLite compatibility
            expires_at=datetime.utcnow() + timedelta(days=7),
        )
        db_session.add(invitation)
        db_session.commit()
        return invitation, token

    @pytest.fixture
    def invited_user(self, db_session):
        """Create a user matching the invitation email."""
        user = User(
            email="invited@example.com",
            password_hash="not_used",
            status="active",
        )
        db_session.add(user)
        db_session.commit()
        return user

    def _make_naive_now(self, *args, **kwargs):
        """Return naive UTC datetime regardless of timezone argument."""
        return datetime.utcnow()

    @patch("app.services.invitation_service.datetime")
    def test_creates_membership(
        self, mock_dt, db_session, invite_org, pending_invitation, invited_user
    ):
        """Accepting invitation creates organization membership.

        Note: accept_invitation creates membership without role_id but
        role_id is NOT NULL. This test verifies the behavior up to the
        point of DB flush where IntegrityError occurs due to missing role_id.
        """
        # invitation_service was patched (May 2026) to coerce naive
        # expires_at to tz-aware before comparing against
        # datetime.now(timezone.utc). The mock here used to return
        # naive to dodge that pre-fix TypeError; now it has to return
        # tz-aware to match the real signature of `.now(timezone.utc)`.
        mock_dt.now.return_value = datetime.now(timezone.utc)
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)

        invitation, token = pending_invitation

        membership = accept_invitation(
            session=db_session,
            token=token,
            user_id=str(invited_user.user_id),
        )
        # Verify the membership. accept_invitation resolves role_id from the invitation.
        assert membership.organization_id == invite_org.organization_id
        assert str(membership.user_id) == str(invited_user.user_id)
        assert membership.role == "member"
        assert membership.role_id is not None

    @patch("app.services.invitation_service.datetime")
    def test_marks_used(
        self, mock_dt, db_session, pending_invitation, invited_user
    ):
        """Accepting invitation marks it as used."""
        # invitation_service was patched (May 2026) to coerce naive
        # expires_at to tz-aware before comparing against
        # datetime.now(timezone.utc). The mock here used to return
        # naive to dodge that pre-fix TypeError; now it has to return
        # tz-aware to match the real signature of `.now(timezone.utc)`.
        mock_dt.now.return_value = datetime.now(timezone.utc)
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)

        invitation, token = pending_invitation

        accept_invitation(
            session=db_session,
            token=token,
            user_id=str(invited_user.user_id),
        )

        # Reload invitation
        db_session.expire_all()
        updated = db_session.query(OrganizationInvitation).filter_by(
            invitation_id=invitation.invitation_id
        ).first()

        assert updated.used_at is not None

    @patch("app.services.invitation_service.datetime")
    def test_invalid_token_raises(self, mock_dt, db_session, pending_invitation, invited_user):
        """Invalid token raises error."""
        # invitation_service was patched (May 2026) to coerce naive
        # expires_at to tz-aware before comparing against
        # datetime.now(timezone.utc). The mock here used to return
        # naive to dodge that pre-fix TypeError; now it has to return
        # tz-aware to match the real signature of `.now(timezone.utc)`.
        mock_dt.now.return_value = datetime.now(timezone.utc)
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)

        with pytest.raises(ValueError, match="Invalid invitation token"):
            accept_invitation(
                session=db_session,
                token="totally_invalid_token",
                user_id=str(invited_user.user_id),
            )

    @patch("app.services.invitation_service.datetime")
    def test_expired_invitation_raises(
        self, mock_dt, db_session, invite_org, invite_admin, invited_user
    ):
        """Expired invitation cannot be accepted."""
        # invitation_service was patched (May 2026) to coerce naive
        # expires_at to tz-aware before comparing against
        # datetime.now(timezone.utc). The mock here used to return
        # naive to dodge that pre-fix TypeError; now it has to return
        # tz-aware to match the real signature of `.now(timezone.utc)`.
        mock_dt.now.return_value = datetime.now(timezone.utc)
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)

        token, token_hash = generate_invitation_token()
        invitation = OrganizationInvitation(
            organization_id=invite_org.organization_id,
            email="invited@example.com",
            token_hash=token_hash,
            role="member",
            invited_by=invite_admin.user_id,
            # Use naive datetime - expired
            expires_at=datetime.utcnow() - timedelta(days=1),
        )
        db_session.add(invitation)
        db_session.commit()

        with pytest.raises(ValueError, match="expired"):
            accept_invitation(
                session=db_session,
                token=token,
                user_id=str(invited_user.user_id),
            )

    @patch("app.services.invitation_service.datetime")
    def test_reuse_raises(
        self, mock_dt, db_session, pending_invitation, invited_user
    ):
        """Used invitation cannot be reused."""
        # invitation_service was patched (May 2026) to coerce naive
        # expires_at to tz-aware before comparing against
        # datetime.now(timezone.utc). The mock here used to return
        # naive to dodge that pre-fix TypeError; now it has to return
        # tz-aware to match the real signature of `.now(timezone.utc)`.
        mock_dt.now.return_value = datetime.now(timezone.utc)
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)

        invitation, token = pending_invitation

        # Accept once - may fail due to role_id, so we manually mark as used
        invitation.used_at = datetime.utcnow()
        db_session.commit()

        # Try to accept again -- should fail because it's already used
        with pytest.raises(ValueError, match="already been used"):
            accept_invitation(
                session=db_session,
                token=token,
                user_id=str(invited_user.user_id),
            )

    @patch("app.services.invitation_service.datetime")
    def test_email_mismatch_raises(
        self, mock_dt, db_session, pending_invitation
    ):
        """User email must match invitation email."""
        # invitation_service was patched (May 2026) to coerce naive
        # expires_at to tz-aware before comparing against
        # datetime.now(timezone.utc). The mock here used to return
        # naive to dodge that pre-fix TypeError; now it has to return
        # tz-aware to match the real signature of `.now(timezone.utc)`.
        mock_dt.now.return_value = datetime.now(timezone.utc)
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)

        _, token = pending_invitation

        # Create user with different email
        wrong_user = User(
            email="different@example.com",
            password_hash="not_used",
            status="active",
        )
        db_session.add(wrong_user)
        db_session.commit()

        with pytest.raises(ValueError, match="does not match"):
            accept_invitation(
                session=db_session,
                token=token,
                user_id=str(wrong_user.user_id),
            )

    @patch("app.services.invitation_service.datetime")
    def test_duplicate_membership_raises(
        self, mock_dt, db_session, invite_org, pending_invitation, invited_user
    ):
        """Cannot accept invitation if already a member."""
        # invitation_service was patched (May 2026) to coerce naive
        # expires_at to tz-aware before comparing against
        # datetime.now(timezone.utc). The mock here used to return
        # naive to dodge that pre-fix TypeError; now it has to return
        # tz-aware to match the real signature of `.now(timezone.utc)`.
        mock_dt.now.return_value = datetime.now(timezone.utc)
        mock_dt.side_effect = lambda *a, **kw: datetime(*a, **kw)

        invitation, token = pending_invitation

        from app.models import Role

        # Need a role for the existing membership
        role = db_session.query(Role).first()
        if not role:
            role = Role(
                role_key="test_member",
                display_name="Test Member",
                description="Test",
                is_system=False,
            )
            db_session.add(role)
            db_session.flush()

        # Create existing membership
        existing = OrganizationMembership(
            organization_id=invite_org.organization_id,
            user_id=invited_user.user_id,
            role="member",
            role_id=role.role_id,
            status="active",
        )
        db_session.add(existing)
        db_session.commit()

        with pytest.raises(ValueError, match="already a member"):
            accept_invitation(
                session=db_session,
                token=token,
                user_id=str(invited_user.user_id),
            )
