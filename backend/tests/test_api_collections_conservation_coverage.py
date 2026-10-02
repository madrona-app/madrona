"""
Integration tests for collections_conservation router.

Covers conservation treatments, object exits, and deaccessions under:
    /api/organizations/<org_id>/collections/conservation
    /api/organizations/<org_id>/collections/exits
    /api/organizations/<org_id>/collections/deaccessions

The router orchestrates three procedures with status workflows
(conservation treatment: proposed → approved → in_progress → completed;
object exit: pending → dispatched → acknowledged; deaccession:
proposed → committee_reviewed → approved → completed). Each procedure
has dedicated transition endpoints plus generic update paths.

Target: raise collections_conservation.py coverage from 12% (545 stmts).
"""

from uuid import UUID, uuid4

import pytest

from app.models import (
    CollectionObject,
    ConservationTreatment,
    Deaccession,
    DeaccessionAudit,
    DeaccessionVote,
    ObjectExit,
)
from tests.conftest import _create_permission, _create_role_permission


# ============================================================================
# Helpers
# ============================================================================


def _grant_perms(db_session, auth_setup, *perm_keys):
    """Attach additional permissions to the role seeded by auth_setup.

    The shared auth_setup fixture seeds only collections/conservation view+edit
    keys; it's missing conservation.approve, all exits.* keys, exits.rollback,
    and the entire deaccession.* family. Tests that exercise those endpoints
    tack the missing keys onto the existing admin role.
    """
    from app.models import OrganizationMembership, Role

    _, org, user = auth_setup
    membership = (
        db_session.query(OrganizationMembership)
        .filter_by(user_id=user.user_id, organization_id=org.organization_id)
        .first()
    )
    role = db_session.query(Role).filter_by(role_id=membership.role_id).first()
    for key in perm_keys:
        perm = _create_permission(db_session, key)
        _create_role_permission(db_session, role, perm)
    db_session.commit()


def _make_object(db_session, org_id, object_number="OBJ-1"):
    """Insert a minimal CollectionObject and return it."""
    obj = CollectionObject(
        organization_id=org_id,
        object_number=object_number,
        object_name="Test Object",
    )
    db_session.add(obj)
    db_session.commit()
    return obj


def _conservation_url(org, treatment_id=None, suffix=""):
    base = f"/api/organizations/{org.organization_id}/collections/conservation"
    if treatment_id is None:
        return base + suffix
    return f"{base}/{treatment_id}{suffix}"


def _exits_url(org, exit_id=None, suffix=""):
    base = f"/api/organizations/{org.organization_id}/collections/exits"
    if exit_id is None:
        return base + suffix
    return f"{base}/{exit_id}{suffix}"


def _deaccession_url(org, deacc_id=None, suffix=""):
    base = f"/api/organizations/{org.organization_id}/collections/deaccessions"
    if deacc_id is None:
        return base + suffix
    return f"{base}/{deacc_id}{suffix}"


def _error_message(body):
    """Extract the human-friendly message from a FastAPI error response."""
    detail = body.get("detail") or body.get("error") or {}
    if isinstance(detail, dict):
        return detail.get("message", "") or detail.get("code", "")
    return str(detail)


def _error_code(body):
    detail = body.get("detail") or body.get("error") or {}
    if isinstance(detail, dict):
        return detail.get("code")
    return None


# ============================================================================
# CONSERVATION TREATMENTS
# ============================================================================


class TestCreateConservationTreatment:
    def test_create_minimal(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id)

        resp = auth_client.post(
            _conservation_url(org),
            json={
                "object_id": str(obj.object_id),
                "treatment_type": "cleaning",
            },
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["treatment_type"] == "cleaning"
        assert data["object_id"] == str(obj.object_id)
        assert data["status"] == "proposed"
        assert data["treatment_number"].startswith("CON")
        assert data["organization_id"] == str(org.organization_id)

    def test_create_full_payload(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id, "OBJ-FULL")

        resp = auth_client.post(
            _conservation_url(org),
            json={
                "object_id": str(obj.object_id),
                "treatment_type": "remedial",
                "conservator_name": "Dr. Jane Smith",
                "conservator_institution": "Getty Conservation Institute",
                "proposal_summary": "Clean surface, consolidate flaking",
                "estimated_duration_days": 30,
                "estimated_cost": 1500.00,
                "treatment_note": "Handle with care",
            },
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["conservator_name"] == "Dr. Jane Smith"
        assert data["estimated_duration_days"] == 30
        assert data["estimated_cost"] == 1500.00

    def test_create_missing_treatment_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id)

        resp = auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj.object_id)},
        )
        assert resp.status_code == 422
        body = resp.get_json()
        assert "treatment_type" in _error_message(body).lower() or _error_code(body) == "validation_error"

    def test_create_missing_object_id(self, auth_setup):
        auth_client, org, _ = auth_setup

        resp = auth_client.post(
            _conservation_url(org),
            json={"treatment_type": "cleaning"},
        )
        assert resp.status_code == 422
        body = resp.get_json()
        msg = _error_message(body).lower()
        assert "object" in msg


class TestListConservationTreatments:
    def test_list_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_conservation_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_returns_created(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id)
        auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj.object_id), "treatment_type": "cleaning"},
        )

        resp = auth_client.get(_conservation_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert len(data["items"]) == 1
        assert data["items"][0]["treatment_type"] == "cleaning"

    def test_list_status_filter(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id)
        auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj.object_id), "treatment_type": "cleaning"},
        )

        # Only "proposed" rows exist; asking for "completed" must filter them out.
        resp = auth_client.get(_conservation_url(org) + "?status=completed")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 0

        resp = auth_client.get(_conservation_url(org) + "?status=proposed")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1

    def test_list_treatment_type_filter(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id, "F-1")
        obj2 = _make_object(db_session, org.organization_id, "F-2")

        auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj.object_id), "treatment_type": "cleaning"},
        )
        auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj2.object_id), "treatment_type": "repair"},
        )

        resp = auth_client.get(_conservation_url(org) + "?treatment_type=repair")
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["treatment_type"] == "repair"

    def test_list_object_id_filter(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id, "OBJ-A")
        obj2 = _make_object(db_session, org.organization_id, "OBJ-B")

        auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj.object_id), "treatment_type": "cleaning"},
        )
        auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj2.object_id), "treatment_type": "repair"},
        )

        resp = auth_client.get(_conservation_url(org) + f"?object_id={obj2.object_id}")
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["object_id"] == str(obj2.object_id)

    def test_list_search_query(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id)
        auth_client.post(
            _conservation_url(org),
            json={
                "object_id": str(obj.object_id),
                "treatment_type": "cleaning",
                "conservator_name": "Rembrandt Labs",
                "treatment_note": "Varnish removal",
            },
        )
        auth_client.post(
            _conservation_url(org),
            json={
                "object_id": str(obj.object_id),
                "treatment_type": "repair",
                "conservator_name": "Example Conservators",
            },
        )

        resp = auth_client.get(_conservation_url(org) + "?q=Rembrandt")
        assert resp.get_json()["total"] == 1

    def test_list_pagination(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id)
        for _ in range(3):
            auth_client.post(
                _conservation_url(org),
                json={"object_id": str(obj.object_id), "treatment_type": "cleaning"},
            )

        resp = auth_client.get(_conservation_url(org) + "?limit=2&offset=0")
        data = resp.get_json()
        assert data["total"] == 3
        assert len(data["items"]) == 2
        assert data["limit"] == 2
        assert data["offset"] == 0


class TestGetConservationTreatment:
    def test_get_existing(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj.object_id), "treatment_type": "analysis"},
        ).get_json()

        resp = auth_client.get(_conservation_url(org, created["treatment_id"]))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["treatment_id"] == created["treatment_id"]
        assert data["treatment_type"] == "analysis"

    def test_get_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_conservation_url(org, uuid4()))
        assert resp.status_code == 404
        assert _error_code(resp.get_json()) == "not_found"

    def test_get_wrong_org(self, auth_setup, db_session):
        """A treatment created under a different org cannot be fetched."""
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj.object_id), "treatment_type": "cleaning"},
        ).get_json()

        stranger_org = UUID("11111111-1111-1111-1111-111111111111")
        resp = auth_client.get(
            f"/api/organizations/{stranger_org}/collections/conservation/{created['treatment_id']}"
        )
        # The require_permission dep rejects cross-org access as forbidden
        # before the 404 branch runs.
        assert resp.status_code in (403, 404)


class TestUpdateConservationTreatment:
    def test_update_fields(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj.object_id), "treatment_type": "cleaning"},
        ).get_json()

        resp = auth_client.put(
            _conservation_url(org, created["treatment_id"]),
            json={
                "treatment_note": "Updated note",
                "conservator_name": "Revised Lab",
                "estimated_duration_days": 45,
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["treatment_note"] == "Updated note"
        assert data["conservator_name"] == "Revised Lab"
        assert data["estimated_duration_days"] == 45

    def test_update_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.put(
            _conservation_url(org, uuid4()),
            json={"treatment_note": "x"},
        )
        assert resp.status_code == 404

    def test_update_cannot_remove_object_id(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj.object_id), "treatment_type": "cleaning"},
        ).get_json()

        resp = auth_client.put(
            _conservation_url(org, created["treatment_id"]),
            json={"object_id": None},
        )
        assert resp.status_code == 422

    def test_update_protected_fields_ignored(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj.object_id), "treatment_type": "cleaning"},
        ).get_json()

        original_number = created["treatment_number"]
        fake_id = str(uuid4())
        resp = auth_client.put(
            _conservation_url(org, created["treatment_id"]),
            json={
                "treatment_number": "HACK-999",
                "organization_id": fake_id,
                "treatment_note": "legit",
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["treatment_number"] == original_number
        assert data["organization_id"] == str(org.organization_id)
        assert data["treatment_note"] == "legit"

    def test_update_with_stale_version_conflict(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj.object_id), "treatment_type": "cleaning"},
        ).get_json()

        # Version 1 exists; client sends version 99 → conflict.
        resp = auth_client.put(
            _conservation_url(org, created["treatment_id"]),
            json={"version": 99, "treatment_note": "stale"},
        )
        assert resp.status_code == 409
        assert _error_code(resp.get_json()) == "conflict"


class TestConservationTransitions:
    """Conservation has /approve, /start, /complete. Each requires a specific
    prior status (proposed / approved / in_progress). Any other current status
    must yield 409 invalid_transition."""

    def _seed_treatment(self, auth_client, org, db_session, status=None):
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _conservation_url(org),
            json={"object_id": str(obj.object_id), "treatment_type": "cleaning"},
        ).get_json()
        # Optional: force a non-default status directly in the DB for
        # transition tests that start mid-workflow.
        if status and status != "proposed":
            treatment = (
                db_session.query(ConservationTreatment)
                .filter_by(treatment_id=UUID(created["treatment_id"]))
                .first()
            )
            treatment.status = status
            db_session.commit()
        return created

    def test_approve_from_proposed(self, auth_setup, db_session):
        _grant_perms(db_session, auth_setup, "conservation.approve")
        auth_client, org, _ = auth_setup
        created = self._seed_treatment(auth_client, org, db_session)

        resp = auth_client.post(_conservation_url(org, created["treatment_id"], "/approve"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "approved"
        assert data["approval_date"] is not None

    def test_approve_rejects_when_already_approved(self, auth_setup, db_session):
        _grant_perms(db_session, auth_setup, "conservation.approve")
        auth_client, org, _ = auth_setup
        created = self._seed_treatment(auth_client, org, db_session, status="approved")

        resp = auth_client.post(_conservation_url(org, created["treatment_id"], "/approve"))
        assert resp.status_code == 409
        assert _error_code(resp.get_json()) == "invalid_transition"

    def test_approve_not_found(self, auth_setup, db_session):
        _grant_perms(db_session, auth_setup, "conservation.approve")
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_conservation_url(org, uuid4(), "/approve"))
        assert resp.status_code == 404

    def test_start_requires_approved(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        # Still "proposed" — /start should reject with 409.
        created = self._seed_treatment(auth_client, org, db_session)

        resp = auth_client.post(_conservation_url(org, created["treatment_id"], "/start"))
        assert resp.status_code == 409
        assert _error_code(resp.get_json()) == "invalid_transition"

    def test_start_from_approved(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        created = self._seed_treatment(auth_client, org, db_session, status="approved")

        resp = auth_client.post(_conservation_url(org, created["treatment_id"], "/start"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "in_progress"
        assert data["start_date"] is not None

    def test_complete_requires_in_progress(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        created = self._seed_treatment(auth_client, org, db_session, status="approved")

        resp = auth_client.post(_conservation_url(org, created["treatment_id"], "/complete"))
        assert resp.status_code == 409

    def test_complete_from_in_progress(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        created = self._seed_treatment(auth_client, org, db_session, status="in_progress")
        # Set start_date so actual_duration_days math runs.
        treatment = (
            db_session.query(ConservationTreatment)
            .filter_by(treatment_id=UUID(created["treatment_id"]))
            .first()
        )
        from datetime import date, timedelta
        treatment.start_date = date.today() - timedelta(days=5)
        db_session.commit()

        resp = auth_client.post(_conservation_url(org, created["treatment_id"], "/complete"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "completed"
        assert data["end_date"] is not None
        assert data["actual_duration_days"] == 5

    def test_full_lifecycle(self, auth_setup, db_session):
        """Proposed → approved → in_progress → completed, via transition endpoints."""
        _grant_perms(db_session, auth_setup, "conservation.approve")
        auth_client, org, _ = auth_setup
        created = self._seed_treatment(auth_client, org, db_session)
        tid = created["treatment_id"]

        assert auth_client.post(_conservation_url(org, tid, "/approve")).get_json()["status"] == "approved"
        assert auth_client.post(_conservation_url(org, tid, "/start")).get_json()["status"] == "in_progress"
        assert auth_client.post(_conservation_url(org, tid, "/complete")).get_json()["status"] == "completed"


# ============================================================================
# OBJECT EXITS
# ============================================================================


@pytest.fixture
def exits_auth(auth_setup, db_session):
    """auth_setup + the four exits.* permissions the router needs."""
    _grant_perms(
        db_session,
        auth_setup,
        "exits.rollback",
    )
    # exits.view / create / edit are already in conftest.
    return auth_setup


class TestCreateObjectExit:
    def test_create_minimal(self, exits_auth):
        auth_client, org, _ = exits_auth

        resp = auth_client.post(
            _exits_url(org),
            json={"exit_reason": "loan_return"},
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["exit_reason"] == "loan_return"
        assert data["status"] == "pending"
        assert data["exit_number"].startswith("EX")
        assert data["authorization_id"] is not None  # populated from auth.user_id

    def test_create_with_recipient_and_insurance(self, exits_auth):
        auth_client, org, _ = exits_auth

        resp = auth_client.post(
            _exits_url(org),
            json={
                "exit_reason": "conservation",
                "recipient_name": "Getty",
                "recipient_address": {"street": "1200 Getty Center Dr"},
                "exit_method": "courier",
                "insurance_value": 25000.0,
                "insurance_currency": "USD",
                "exit_note": "Offsite cleaning",
            },
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["recipient_name"] == "Getty"
        assert data["insurance_value"] == 25000.0
        assert data["exit_method"] == "courier"

    def test_create_missing_exit_reason(self, exits_auth):
        auth_client, org, _ = exits_auth

        resp = auth_client.post(_exits_url(org), json={"recipient_name": "x"})
        assert resp.status_code == 422
        msg = _error_message(resp.get_json()).lower()
        assert "exit_reason" in msg


class TestListObjectExits:
    def test_list_empty(self, exits_auth):
        auth_client, org, _ = exits_auth
        resp = auth_client.get(_exits_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_filters(self, exits_auth):
        auth_client, org, _ = exits_auth
        auth_client.post(
            _exits_url(org),
            json={"exit_reason": "loan_return", "recipient_name": "Alpha Gallery"},
        )
        auth_client.post(
            _exits_url(org),
            json={"exit_reason": "conservation", "recipient_name": "Beta Lab"},
        )

        # exit_reason filter
        resp = auth_client.get(_exits_url(org) + "?exit_reason=conservation")
        assert resp.get_json()["total"] == 1

        # status filter — both are "pending"
        resp = auth_client.get(_exits_url(org) + "?status=pending")
        assert resp.get_json()["total"] == 2

        # search q by recipient_name
        resp = auth_client.get(_exits_url(org) + "?q=Alpha")
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["recipient_name"] == "Alpha Gallery"

    def test_list_reference_type_filter(self, exits_auth):
        auth_client, org, _ = exits_auth
        ref_id = uuid4()
        auth_client.post(
            _exits_url(org),
            json={
                "exit_reason": "deaccession",
                "reference_type": "deaccession",
                "reference_id": str(ref_id),
            },
        )
        auth_client.post(
            _exits_url(org),
            json={"exit_reason": "loan_return"},
        )

        resp = auth_client.get(_exits_url(org) + "?reference_type=deaccession")
        assert resp.get_json()["total"] == 1

        resp = auth_client.get(_exits_url(org) + f"?reference_id={ref_id}")
        assert resp.get_json()["total"] == 1


class TestGetObjectExit:
    def test_get_existing_with_items(self, exits_auth, db_session):
        from app.models import ObjectExitItem

        auth_client, org, _ = exits_auth
        created = auth_client.post(
            _exits_url(org), json={"exit_reason": "loan_return"}
        ).get_json()

        # Attach an exit item directly so the items include branch is exercised.
        obj = _make_object(db_session, org.organization_id)
        item = ObjectExitItem(
            exit_id=UUID(created["exit_id"]),
            organization_id=org.organization_id,
            object_id=obj.object_id,
            brief_description="widget",
        )
        db_session.add(item)
        db_session.commit()

        resp = auth_client.get(_exits_url(org, created["exit_id"]))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["exit_id"] == created["exit_id"]
        assert len(data["items"]) == 1
        assert data["items"][0]["brief_description"] == "widget"

    def test_get_not_found(self, exits_auth):
        auth_client, org, _ = exits_auth
        resp = auth_client.get(_exits_url(org, uuid4()))
        assert resp.status_code == 404
        assert _error_code(resp.get_json()) == "not_found"


class TestUpdateObjectExit:
    def test_update_fields(self, exits_auth):
        auth_client, org, _ = exits_auth
        created = auth_client.post(
            _exits_url(org), json={"exit_reason": "loan_return"}
        ).get_json()

        resp = auth_client.put(
            _exits_url(org, created["exit_id"]),
            json={
                "exit_note": "Revised handling note",
                "insurance_value": 5000.0,
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["exit_note"] == "Revised handling note"
        assert data["insurance_value"] == 5000.0

    def test_update_clear_optional_id_field(self, exits_auth, db_session):
        """Passing "" or None for a *_id field should clear it (router
        explicitly handles this branch)."""
        auth_client, org, _ = exits_auth
        # Create an ObjectEntry we can link and then unlink.
        from app.models import ObjectEntry

        entry = ObjectEntry(
            organization_id=org.organization_id,
            entry_number="EN-ClearTest",
            entry_reason="loan_consideration",
            entry_date=__import__("datetime").date.today(),
        )
        db_session.add(entry)
        db_session.commit()

        created = auth_client.post(
            _exits_url(org),
            json={
                "exit_reason": "loan_return",
                "entry_id": str(entry.entry_id),
            },
        ).get_json()
        assert created["entry_id"] == str(entry.entry_id)

        # Now unlink via empty string.
        resp = auth_client.put(
            _exits_url(org, created["exit_id"]),
            json={"entry_id": ""},
        )
        assert resp.status_code == 200
        assert resp.get_json()["entry_id"] is None

    def test_update_invalid_status(self, exits_auth):
        auth_client, org, _ = exits_auth
        created = auth_client.post(
            _exits_url(org), json={"exit_reason": "loan_return"}
        ).get_json()

        resp = auth_client.put(
            _exits_url(org, created["exit_id"]),
            json={"status": "not_a_valid_status"},
        )
        assert resp.status_code == 409
        assert _error_code(resp.get_json()) == "invalid_status"

    def test_update_not_found(self, exits_auth):
        auth_client, org, _ = exits_auth
        resp = auth_client.put(_exits_url(org, uuid4()), json={"exit_note": "x"})
        assert resp.status_code == 404


class TestExitTransitions:
    def test_dispatch_from_pending(self, exits_auth):
        auth_client, org, _ = exits_auth
        created = auth_client.post(
            _exits_url(org), json={"exit_reason": "loan_return"}
        ).get_json()

        resp = auth_client.post(_exits_url(org, created["exit_id"], "/dispatch"))
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "dispatched"

    def test_dispatch_rejects_from_acknowledged(self, exits_auth, db_session):
        auth_client, org, _ = exits_auth
        created = auth_client.post(
            _exits_url(org), json={"exit_reason": "loan_return"}
        ).get_json()
        ex = (
            db_session.query(ObjectExit)
            .filter_by(exit_id=UUID(created["exit_id"]))
            .first()
        )
        ex.status = "acknowledged"
        db_session.commit()

        resp = auth_client.post(_exits_url(org, created["exit_id"], "/dispatch"))
        assert resp.status_code == 409
        assert _error_code(resp.get_json()) == "invalid_transition"

    def test_dispatch_not_found(self, exits_auth):
        auth_client, org, _ = exits_auth
        resp = auth_client.post(_exits_url(org, uuid4(), "/dispatch"))
        assert resp.status_code == 404

    def test_acknowledge_from_dispatched(self, exits_auth):
        auth_client, org, _ = exits_auth
        created = auth_client.post(
            _exits_url(org), json={"exit_reason": "loan_return"}
        ).get_json()
        auth_client.post(_exits_url(org, created["exit_id"], "/dispatch"))

        resp = auth_client.post(
            _exits_url(org, created["exit_id"], "/acknowledge"),
            json={
                "acknowledged_by": "Alice Receiver",
                "receipt_reference": "REC-001",
                "receipt_note": "All items intact",
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "acknowledged"
        assert data["receipt_acknowledged"] is True
        assert data["receipt_acknowledged_by"] == "Alice Receiver"
        assert data["receipt_reference"] == "REC-001"

    def test_acknowledge_rejects_from_pending(self, exits_auth):
        auth_client, org, _ = exits_auth
        created = auth_client.post(
            _exits_url(org), json={"exit_reason": "loan_return"}
        ).get_json()

        resp = auth_client.post(_exits_url(org, created["exit_id"], "/acknowledge"))
        assert resp.status_code == 409

    def test_acknowledge_not_found(self, exits_auth):
        auth_client, org, _ = exits_auth
        resp = auth_client.post(_exits_url(org, uuid4(), "/acknowledge"))
        assert resp.status_code == 404

    def test_rollback_requires_target_status(self, exits_auth):
        auth_client, org, _ = exits_auth
        created = auth_client.post(
            _exits_url(org), json={"exit_reason": "loan_return"}
        ).get_json()
        auth_client.post(_exits_url(org, created["exit_id"], "/dispatch"))

        resp = auth_client.post(
            _exits_url(org, created["exit_id"], "/rollback"),
            json={"reason": "changed plans"},
        )
        assert resp.status_code == 422
        msg = _error_message(resp.get_json()).lower()
        assert "target_status" in msg

    def test_rollback_requires_reason(self, exits_auth):
        auth_client, org, _ = exits_auth
        created = auth_client.post(
            _exits_url(org), json={"exit_reason": "loan_return"}
        ).get_json()
        auth_client.post(_exits_url(org, created["exit_id"], "/dispatch"))

        resp = auth_client.post(
            _exits_url(org, created["exit_id"], "/rollback"),
            json={"target_status": "pending", "reason": "   "},
        )
        assert resp.status_code == 422
        msg = _error_message(resp.get_json()).lower()
        assert "reason" in msg

    def test_rollback_success(self, exits_auth):
        auth_client, org, _ = exits_auth
        created = auth_client.post(
            _exits_url(org), json={"exit_reason": "loan_return"}
        ).get_json()
        auth_client.post(_exits_url(org, created["exit_id"], "/dispatch"))

        resp = auth_client.post(
            _exits_url(org, created["exit_id"], "/rollback"),
            json={"target_status": "pending", "reason": "Recipient delayed"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "pending"

    def test_rollback_not_found(self, exits_auth):
        auth_client, org, _ = exits_auth
        resp = auth_client.post(
            _exits_url(org, uuid4(), "/rollback"),
            json={"target_status": "pending", "reason": "oops"},
        )
        assert resp.status_code == 404


# ============================================================================
# DEACCESSIONS
# ============================================================================


@pytest.fixture
def deacc_auth(auth_setup, db_session):
    """auth_setup + the full deaccession.* permission family."""
    _grant_perms(
        db_session,
        auth_setup,
        "deaccession.view",
        "deaccession.create",
        "deaccession.edit",
        "deaccession.review",
        "deaccession.approve",
        "deaccession.complete",
        "deaccession.rollback",
    )
    return auth_setup


class TestCreateDeaccession:
    def test_create_minimal(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        obj = _make_object(db_session, org.organization_id)

        resp = auth_client.post(
            _deaccession_url(org),
            json={
                "object_id": str(obj.object_id),
                "reason": "duplicate",
            },
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["reason"] == "duplicate"
        assert data["object_id"] == str(obj.object_id)
        assert data["status"] == "proposed"
        assert data["deaccession_number"].startswith("DA")

    def test_create_full_payload(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        obj = _make_object(db_session, org.organization_id)

        resp = auth_client.post(
            _deaccession_url(org),
            json={
                "object_id": str(obj.object_id),
                "reason": "outside_scope",
                "reason_detail": "Out of collecting scope after rewrite",
                "justification": "Board policy 2024-12",
                "disposal_method": "transfer",
                "recipient_name": "University Museum",
                "committee_review_required": True,
                "board_approval_required": False,
                "deaccession_note": "Priority disposal",
            },
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["reason_detail"] == "Out of collecting scope after rewrite"
        assert data["board_approval_required"] is False
        assert data["recipient_name"] == "University Museum"

    def test_create_missing_required_fields(self, deacc_auth):
        auth_client, org, _ = deacc_auth

        resp = auth_client.post(_deaccession_url(org), json={})
        assert resp.status_code == 422
        body = resp.get_json()
        # The router reports both missing fields in `fields`.
        detail = body.get("detail") or body.get("error") or {}
        if isinstance(detail, dict):
            fields = detail.get("fields", [])
            assert "object_id" in fields and "reason" in fields

    def test_create_writes_audit_row(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        obj = _make_object(db_session, org.organization_id)

        created = auth_client.post(
            _deaccession_url(org),
            json={"object_id": str(obj.object_id), "reason": "duplicate"},
        ).get_json()

        audits = (
            db_session.query(DeaccessionAudit)
            .filter_by(deaccession_id=UUID(created["deaccession_id"]))
            .all()
        )
        # The create handler writes exactly one "created" audit row.
        assert len(audits) == 1
        assert audits[0].action == "created"


class TestListDeaccessions:
    def test_list_filters_and_search(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        obj = _make_object(db_session, org.organization_id, "DEAC-A")
        obj2 = _make_object(db_session, org.organization_id, "DEAC-B")

        auth_client.post(
            _deaccession_url(org),
            json={
                "object_id": str(obj.object_id),
                "reason": "duplicate",
                "recipient_name": "Alpha Trust",
            },
        )
        auth_client.post(
            _deaccession_url(org),
            json={
                "object_id": str(obj2.object_id),
                "reason": "outside_scope",
                "recipient_name": "Beta Trust",
            },
        )

        resp = auth_client.get(_deaccession_url(org))
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 2

        resp = auth_client.get(_deaccession_url(org) + "?reason=duplicate")
        assert resp.get_json()["total"] == 1

        resp = auth_client.get(_deaccession_url(org) + "?status=proposed")
        assert resp.get_json()["total"] == 2

        resp = auth_client.get(_deaccession_url(org) + "?q=Alpha")
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["recipient_name"] == "Alpha Trust"


class TestGetDeaccession:
    def test_get_includes_audit_trail(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _deaccession_url(org),
            json={"object_id": str(obj.object_id), "reason": "duplicate"},
        ).get_json()

        resp = auth_client.get(_deaccession_url(org, created["deaccession_id"]))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["deaccession_id"] == created["deaccession_id"]
        assert "audit_trail" in data
        assert len(data["audit_trail"]) >= 1
        assert data["audit_trail"][0]["action"] == "created"

    def test_get_not_found(self, deacc_auth):
        auth_client, org, _ = deacc_auth
        resp = auth_client.get(_deaccession_url(org, uuid4()))
        assert resp.status_code == 404
        assert _error_code(resp.get_json()) == "not_found"


class TestUpdateDeaccession:
    def test_update_fields_writes_audit(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _deaccession_url(org),
            json={"object_id": str(obj.object_id), "reason": "duplicate"},
        ).get_json()

        resp = auth_client.put(
            _deaccession_url(org, created["deaccession_id"]),
            json={
                "reason_detail": "Updated justification",
                "disposal_method": "sale",
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["reason_detail"] == "Updated justification"
        assert data["disposal_method"] == "sale"

        # "created" + one "field_updated" per changed field = 3 rows.
        audits = (
            db_session.query(DeaccessionAudit)
            .filter_by(deaccession_id=UUID(created["deaccession_id"]))
            .all()
        )
        field_audits = [a for a in audits if a.action == "field_updated"]
        assert len(field_audits) == 2

    def test_update_not_found(self, deacc_auth):
        auth_client, org, _ = deacc_auth
        resp = auth_client.put(
            _deaccession_url(org, uuid4()),
            json={"reason_detail": "x"},
        )
        assert resp.status_code == 404

    def test_update_invalid_status_409(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _deaccession_url(org),
            json={"object_id": str(obj.object_id), "reason": "duplicate"},
        ).get_json()

        resp = auth_client.put(
            _deaccession_url(org, created["deaccession_id"]),
            json={"status": "totally_bogus"},
        )
        assert resp.status_code == 409
        assert _error_code(resp.get_json()) == "invalid_status"

    def test_update_status_to_completed_deaccessions_object(self, deacc_auth, db_session):
        """When a deaccession flips to 'completed' via PUT, the linked
        CollectionObject's object_status must switch to 'deaccessioned'."""
        auth_client, org, _ = deacc_auth
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _deaccession_url(org),
            json={"object_id": str(obj.object_id), "reason": "duplicate"},
        ).get_json()

        resp = auth_client.put(
            _deaccession_url(org, created["deaccession_id"]),
            json={"status": "completed"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "completed"

        db_session.expire_all()
        refreshed = (
            db_session.query(CollectionObject).filter_by(object_id=obj.object_id).first()
        )
        assert refreshed.object_status == "deaccessioned"

    def test_update_stale_version_conflict(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _deaccession_url(org),
            json={"object_id": str(obj.object_id), "reason": "duplicate"},
        ).get_json()

        resp = auth_client.put(
            _deaccession_url(org, created["deaccession_id"]),
            json={"version": 999, "reason_detail": "stale"},
        )
        assert resp.status_code == 409
        assert _error_code(resp.get_json()) == "conflict"


class TestDeaccessionTransitions:
    def _seed(self, auth_client, org, db_session, status="proposed"):
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _deaccession_url(org),
            json={"object_id": str(obj.object_id), "reason": "duplicate"},
        ).get_json()
        if status != "proposed":
            deacc = (
                db_session.query(Deaccession)
                .filter_by(deaccession_id=UUID(created["deaccession_id"]))
                .first()
            )
            deacc.status = status
            db_session.commit()
        return created

    def test_review_records_vote_rows(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        created = self._seed(auth_client, org, db_session)

        resp = auth_client.post(
            _deaccession_url(org, created["deaccession_id"], "/review"),
            json={
                "recommendation": "approve",
                "note": "Unanimous",
                "members": [
                    {"member_name": "Alice", "role": "Chair", "vote": "yes"},
                    {"member_name": "Bob", "role": "Member", "vote": "yes"},
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "committee_reviewed"
        assert data["committee_recommendation"] == "approve"

        votes = (
            db_session.query(DeaccessionVote)
            .filter_by(deaccession_id=UUID(created["deaccession_id"]))
            .all()
        )
        assert len(votes) == 2
        assert {v.voter_name for v in votes} == {"Alice", "Bob"}

    def test_review_not_found(self, deacc_auth):
        auth_client, org, _ = deacc_auth
        resp = auth_client.post(_deaccession_url(org, uuid4(), "/review"))
        assert resp.status_code == 404

    def test_approve_from_committee_reviewed(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        created = self._seed(auth_client, org, db_session, status="committee_reviewed")

        resp = auth_client.post(
            _deaccession_url(org, created["deaccession_id"], "/approve"),
            json={
                "reference": "BOARD-2024-05",
                "resolution": "Approved unanimously",
                "note": "Sale to University",
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "approved"
        assert data["board_approval_reference"] == "BOARD-2024-05"

    def test_approve_rejects_from_proposed(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        created = self._seed(auth_client, org, db_session)

        resp = auth_client.post(
            _deaccession_url(org, created["deaccession_id"], "/approve"),
            json={},
        )
        assert resp.status_code == 409
        assert _error_code(resp.get_json()) == "invalid_transition"

    def test_approve_not_found(self, deacc_auth):
        auth_client, org, _ = deacc_auth
        resp = auth_client.post(_deaccession_url(org, uuid4(), "/approve"))
        assert resp.status_code == 404

    def test_complete_updates_object_status(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _deaccession_url(org),
            json={"object_id": str(obj.object_id), "reason": "duplicate"},
        ).get_json()
        # Fast-forward to approved so /complete is legal.
        deacc = (
            db_session.query(Deaccession)
            .filter_by(deaccession_id=UUID(created["deaccession_id"]))
            .first()
        )
        deacc.status = "approved"
        db_session.commit()

        resp = auth_client.post(_deaccession_url(org, created["deaccession_id"], "/complete"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "completed"
        assert data["completion_date"] is not None

        db_session.expire_all()
        obj_after = (
            db_session.query(CollectionObject).filter_by(object_id=obj.object_id).first()
        )
        assert obj_after.object_status == "deaccessioned"

    def test_complete_not_found(self, deacc_auth):
        auth_client, org, _ = deacc_auth
        resp = auth_client.post(_deaccession_url(org, uuid4(), "/complete"))
        assert resp.status_code == 404

    def test_audit_trail_endpoint(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        created = self._seed(auth_client, org, db_session)

        resp = auth_client.get(_deaccession_url(org, created["deaccession_id"], "/audit"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] >= 1
        assert data["audit_trail"][0]["action"] == "created"

    def test_audit_trail_not_found(self, deacc_auth):
        auth_client, org, _ = deacc_auth
        resp = auth_client.get(_deaccession_url(org, uuid4(), "/audit"))
        assert resp.status_code == 404

    def test_rollback_requires_target_status(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        created = self._seed(auth_client, org, db_session, status="under_review")

        resp = auth_client.post(
            _deaccession_url(org, created["deaccession_id"], "/rollback"),
            json={"reason": "mistake"},
        )
        assert resp.status_code == 422

    def test_rollback_requires_reason(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        created = self._seed(auth_client, org, db_session, status="under_review")

        resp = auth_client.post(
            _deaccession_url(org, created["deaccession_id"], "/rollback"),
            json={"target_status": "proposed", "reason": ""},
        )
        assert resp.status_code == 422

    def test_rollback_success(self, deacc_auth, db_session):
        auth_client, org, _ = deacc_auth
        created = self._seed(auth_client, org, db_session, status="under_review")

        resp = auth_client.post(
            _deaccession_url(org, created["deaccession_id"], "/rollback"),
            json={"target_status": "proposed", "reason": "Board requested revisions"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "proposed"

    def test_rollback_past_committee_reviewed_clears_votes(self, deacc_auth, db_session):
        """Rolling back past "committee_reviewed" must delete all
        DeaccessionVote rows for that deaccession (router special-case)."""
        auth_client, org, _ = deacc_auth
        created = self._seed(auth_client, org, db_session)

        # Drive through /review to accumulate votes.
        auth_client.post(
            _deaccession_url(org, created["deaccession_id"], "/review"),
            json={
                "recommendation": "approve",
                "members": [{"member_name": "V1", "vote": "yes"}],
            },
        )
        votes_before = (
            db_session.query(DeaccessionVote)
            .filter_by(deaccession_id=UUID(created["deaccession_id"]))
            .count()
        )
        assert votes_before == 1

        resp = auth_client.post(
            _deaccession_url(org, created["deaccession_id"], "/rollback"),
            json={"target_status": "proposed", "reason": "Resetting review"},
        )
        assert resp.status_code == 200

        db_session.expire_all()
        votes_after = (
            db_session.query(DeaccessionVote)
            .filter_by(deaccession_id=UUID(created["deaccession_id"]))
            .count()
        )
        assert votes_after == 0

    def test_rollback_past_completed_reverts_object(self, deacc_auth, db_session):
        """Rolling back past 'completed' must restore the linked object's
        object_status from 'deaccessioned' back to 'accessioned'."""
        auth_client, org, _ = deacc_auth
        obj = _make_object(db_session, org.organization_id)
        created = auth_client.post(
            _deaccession_url(org),
            json={"object_id": str(obj.object_id), "reason": "duplicate"},
        ).get_json()
        # Seed the terminal state: deaccession=completed, object=deaccessioned.
        deacc = (
            db_session.query(Deaccession)
            .filter_by(deaccession_id=UUID(created["deaccession_id"]))
            .first()
        )
        deacc.status = "completed"
        obj.object_status = "deaccessioned"
        db_session.commit()

        resp = auth_client.post(
            _deaccession_url(org, created["deaccession_id"], "/rollback"),
            json={"target_status": "approved", "reason": "Error, reverse disposal"},
        )
        assert resp.status_code == 200

        db_session.expire_all()
        obj_after = (
            db_session.query(CollectionObject).filter_by(object_id=obj.object_id).first()
        )
        assert obj_after.object_status == "accessioned"

    def test_rollback_not_found(self, deacc_auth):
        auth_client, org, _ = deacc_auth
        resp = auth_client.post(
            _deaccession_url(org, uuid4(), "/rollback"),
            json={"target_status": "proposed", "reason": "x"},
        )
        assert resp.status_code == 404


# ============================================================================
# Authorization — viewer role must be blocked from writes
# ============================================================================


class TestViewerIsBlockedFromWrites:
    """viewer_auth_setup grants only `.view` keys. Any create/update/transition
    endpoint must return 403 even when the viewer is acting inside their own
    org."""

    def test_viewer_cannot_create_conservation(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(
            _conservation_url(org),
            json={"object_id": str(uuid4()), "treatment_type": "cleaning"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_create_exit(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(
            _exits_url(org),
            json={"exit_reason": "loan_return"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_create_deaccession(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(
            _deaccession_url(org),
            json={"object_id": str(uuid4()), "reason": "duplicate"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_transition_conservation(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        # Endpoint demands conservation.edit — viewer doesn't have it even
        # before we try to load the (non-existent) treatment.
        resp = auth_client.post(_conservation_url(org, uuid4(), "/start"))
        assert resp.status_code == 403

    def test_viewer_cannot_rollback_exit(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(
            _exits_url(org, uuid4(), "/rollback"),
            json={"target_status": "pending", "reason": "attempted"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_approve_deaccession(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(
            _deaccession_url(org, uuid4(), "/approve"),
            json={"reference": "FAKE"},
        )
        assert resp.status_code == 403
