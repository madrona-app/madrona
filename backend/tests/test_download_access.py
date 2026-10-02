"""Tests for asset-level download access control.

Tests the compute_download_access() service function that determines
whether a user can download directly, must submit a request, or is blocked.
"""

from datetime import date, timedelta
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest

from app.services.download_access import compute_download_access


def _make_rights(**kwargs):
    """Create a mock MediaRights object."""
    defaults = {
        "rights_id": uuid4(),
        "media_id": uuid4(),
        "is_active": True,
        "rights_type": "copyright",
        "rights_status": None,
        "license_type": None,
        "usage_restrictions": None,
        "end_date": None,
    }
    defaults.update(kwargs)
    return MagicMock(**defaults)


class TestComputeDownloadAccess:
    """Unit tests for compute_download_access()."""

    def test_admin_always_direct(self):
        """Admin users always get direct download access."""
        db = MagicMock()
        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.admin", "media.view"],
            db=db,
        )
        assert result == "direct"
        # Should not even query the database
        db.query.assert_not_called()

    def test_platform_admin_always_direct(self):
        """Platform admins always get direct download access."""
        db = MagicMock()
        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["platform.admin"],
            db=db,
        )
        assert result == "direct"

    def test_no_rights_returns_request(self):
        """Assets with no rights records default to request."""
        db = MagicMock()
        query = db.query.return_value.filter.return_value
        query.all.return_value = []

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "request"

    def test_expired_rights_returns_blocked(self):
        """Assets with expired rights are blocked."""
        expired_right = _make_rights(
            end_date=date.today() - timedelta(days=1),
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [expired_right]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "blocked"

    def test_future_end_date_not_blocked(self):
        """Rights with a future end date are not expired."""
        right = _make_rights(
            end_date=date.today() + timedelta(days=30),
            rights_status="public_domain",
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [right]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "direct"

    def test_restrictions_return_request(self):
        """Assets with active restrictions require a request."""
        restriction = _make_rights(
            rights_type="restriction",
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [restriction]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "request"

    def test_usage_restrictions_array_returns_request(self):
        """Assets with usage_restrictions array require a request."""
        right = _make_rights(
            usage_restrictions=["No commercial use"],
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [right]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "request"

    def test_public_domain_returns_direct(self):
        """Public domain assets allow direct download."""
        right = _make_rights(
            rights_status="public_domain",
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [right]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "direct"

    def test_cc0_returns_direct(self):
        """CC0 assets allow direct download."""
        right = _make_rights(
            rights_status="cc0",
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [right]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "direct"

    def test_cc_by_license_returns_direct(self):
        """CC-BY licensed assets allow direct download."""
        right = _make_rights(
            license_type="CC-BY",
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [right]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "direct"

    def test_cc_by_nc_license_returns_direct(self):
        """CC-BY-NC licensed assets allow direct download."""
        right = _make_rights(
            license_type="CC-BY-NC",
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [right]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "direct"

    def test_granted_permission_returns_direct(self):
        """Explicitly granted permission allows direct download."""
        right = _make_rights(
            rights_type="permission",
            rights_status="granted",
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [right]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "direct"

    def test_in_copyright_no_license_returns_request(self):
        """In-copyright assets without an open license require a request."""
        right = _make_rights(
            rights_status="in_copyright",
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [right]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "request"

    def test_mixed_rights_restriction_wins(self):
        """If any active restriction exists, result is request even with open access."""
        open_right = _make_rights(
            rights_status="public_domain",
        )
        restriction = _make_rights(
            rights_type="restriction",
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [open_right, restriction]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "request"

    def test_mixed_rights_expired_wins(self):
        """If any right is expired, result is blocked even with other valid rights."""
        valid_right = _make_rights(
            rights_status="public_domain",
        )
        expired_right = _make_rights(
            end_date=date.today() - timedelta(days=1),
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [valid_right, expired_right]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "blocked"

    def test_admin_bypasses_expired(self):
        """Admin bypasses even expired rights."""
        db = MagicMock()
        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.admin"],
            db=db,
        )
        assert result == "direct"

    def test_license_case_insensitive(self):
        """License type matching is case-insensitive."""
        right = _make_rights(
            license_type="cc-by-sa",  # lowercase
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [right]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "direct"

    def test_empty_usage_restrictions_not_treated_as_restriction(self):
        """Empty usage_restrictions array does not trigger restriction."""
        right = _make_rights(
            rights_status="public_domain",
            usage_restrictions=[],
        )
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = [right]

        result = compute_download_access(
            media_id=uuid4(),
            organization_id=uuid4(),
            user_permissions=["media.view"],
            db=db,
        )
        assert result == "direct"


class TestEntryMediaSerializerDownloadAccess:
    """The Collections entry-media serializer must surface the rights-derived
    download_access (so the object workspace can offer inline download/request),
    but only when the caller passes the requesting user's permissions."""

    def _make_link(self):
        media = MagicMock(
            media_id=uuid4(),
            organization_id=uuid4(),
            filename="x.jpg",
            media_type="image",
            mime_type="image/jpeg",
        )
        return MagicMock(
            media=media,
            entry_item_id=uuid4(),
            is_primary=True,
            sort_order=0,
            caption=None,
            usage_type=None,
        )

    def test_omits_download_access_without_user_perms(self):
        import app.fastapi_app.routers.collections_procedures as cp

        with patch.object(cp, "_get_entry_media_urls", return_value=("t", "p")):
            result = cp._serialize_item_media_link(self._make_link(), MagicMock(), None)

        assert "download_access" not in result

    def test_includes_download_access_from_compute_when_perms_given(self):
        import app.fastapi_app.routers.collections_procedures as cp

        link = self._make_link()
        with patch.object(cp, "_get_entry_media_urls", return_value=("t", "p")), patch(
            "app.services.download_access.compute_download_access", return_value="request"
        ) as mock_compute:
            result = cp._serialize_item_media_link(
                link, MagicMock(), None, user_perms=["media.view"]
            )

        assert result["download_access"] == "request"
        # Computed against the link's own media + the supplied permissions.
        call_args = mock_compute.call_args[0]
        assert call_args[0] == link.media.media_id
        assert call_args[1] == link.media.organization_id
        assert call_args[2] == ["media.view"]
