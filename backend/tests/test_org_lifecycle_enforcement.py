"""An organization that is not active cannot be used.

The public surfaces already filtered on `Organization.status == "active"`;
the authenticated path checked only `user.status`, so an operator could mark
an organization suspended and every member carried on working. The lever
existed and moved nothing.

This is a platform primitive, not a commercial one — it knows nothing about
plans or payment. It is what lets an operator take an organization out of
service: decommissioning, offboarding, abuse response, or an external control
plane deciding what "in service" means.
"""

import pytest
from fastapi import HTTPException

from app.fastapi_app.dependencies.auth import assert_organization_usable


def _set_status(db_session, org, status: str) -> None:
    """Write the status through db_session.

    `auth_setup` builds its organization on a different session, so mutating
    the returned object and flushing here writes nothing — the query still
    reads 'active'. Update by primary key instead.
    """
    from app.models import Organization

    db_session.query(Organization).filter(
        Organization.organization_id == org.organization_id
    ).update({"status": status})
    db_session.flush()


class TestAssertOrganizationUsable:
    def test_active_organization_passes(self, db_session, auth_setup):
        _, org, _ = auth_setup
        assert_organization_usable(db_session, org.organization_id) is None

    def test_suspended_organization_is_refused(self, db_session, auth_setup):
        _, org, _ = auth_setup
        _set_status(db_session, org, "suspended")

        with pytest.raises(HTTPException) as exc:
            assert_organization_usable(db_session, org.organization_id)

        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "organization_unavailable"
        # The status travels with the error so a control plane or the UI can
        # tell "suspended" from "still provisioning".
        assert exc.value.detail["details"]["status"] == "suspended"

    def test_pending_organization_is_refused(self, db_session, auth_setup):
        """`pending` means the provisioning saga has not finished."""
        _, org, _ = auth_setup
        _set_status(db_session, org, "pending")

        with pytest.raises(HTTPException) as exc:
            assert_organization_usable(db_session, org.organization_id)
        assert exc.value.detail["details"]["status"] == "pending"

    def test_no_organization_context_is_not_this_checks_business(self, db_session):
        assert_organization_usable(db_session, None) is None

    def test_unknown_organization_is_not_this_checks_business(self, db_session):
        """Membership and RLS answer 'does this exist'.

        Reporting "unavailable" for an organization that does not exist would
        be a worse error than the 403/404 the caller is about to get anyway.
        """
        import uuid

        assert_organization_usable(db_session, uuid.uuid4()) is None


class TestSuspendedOrgOverHttp:
    def test_members_lose_access_when_the_org_is_suspended(
        self, viewer_auth_setup, db_session
    ):
        """The end-to-end shape a control plane relies on.

        Uses the viewer fixture, not auth_setup: that one's user holds
        platform.admin, and platform admins bypass require_permission before
        this check runs — deliberately, since the account that reactivates a
        suspended organization has to be able to reach it. Asserting against
        an admin would have tested nothing.
        """
        auth_client, org, _ = viewer_auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/objects"

        before = auth_client.get(url)
        assert before.status_code != 403, "precondition: access works while active"

        _set_status(db_session, org, "suspended")
        db_session.commit()

        after = auth_client.get(url)
        assert after.status_code == 403
        assert after.get_json()["error"]["code"] == "organization_unavailable"
