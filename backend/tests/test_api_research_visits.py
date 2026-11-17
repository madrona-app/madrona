"""Research visit log: API round trip, validation, and permissions."""
import json
from datetime import datetime, timezone
from uuid import uuid4

from tests.conftest import AuthenticatedClient, _create_permission, _create_role_permission


def _base(org):
    return f"/api/organizations/{org.organization_id}/collections/research-visits"


def _post(client, url, body):
    return client.post(url, data=json.dumps(body), content_type="application/json")


def _patch(client, url, body):
    return client.patch(url, data=json.dumps(body), content_type="application/json")


def _object(db_session, org, number, name="Braille slate"):
    from app.models import CollectionObject

    obj = CollectionObject(organization_id=org.organization_id, object_number=number, object_name=name)
    db_session.add(obj)
    db_session.flush()
    return obj


class TestRoundTrip:
    def test_visit_objects_and_object_listing(self, auth_setup, db_session):
        client, org, user = auth_setup
        from app.models import Constituent, UseRequest

        person = Constituent(organization_id=org.organization_id, constituent_type="person", name="Ada Researcher")
        db_session.add(person)
        req = UseRequest(
            organization_id=org.organization_id, request_number="USE-2026-001",
            request_date=datetime.now(timezone.utc).date(), use_type="research",
            use_purpose="Thesis", requester_name="Ada Researcher",
        )
        db_session.add(req)
        slate = _object(db_session, org, "RV.1")
        stylus = _object(db_session, org, "RV.2", "Stylus")
        db_session.commit()

        resp = _post(client, _base(org), {
            "researcher_name": "  Ada Researcher ",
            "researcher_affiliation": "University of Example",
            "researcher_constituent_id": str(person.constituent_id),
            "visit_date": "2026-11-10",
            "arrival_time": "09:30",
            "departure_time": "15:00",
            "location": "Reading Room 2",
            "research_topic": "Early braille writing tools",
            "purpose": "Dissertation chapter",
            "supervised_by_name": "Sam Staff",
            "supervised_by_user_id": str(user.user_id),
            "use_request_id": str(req.request_id),
            "notes": "",
        })
        assert resp.status_code == 201, resp.get_json()
        visit = resp.get_json()
        vid = visit["visit_id"]
        assert visit["researcher_name"] == "Ada Researcher"
        assert visit["researcher_constituent_name"] == "Ada Researcher"
        assert visit["arrival_time"] == "09:30"
        assert visit["use_request_number"] == "USE-2026-001"
        assert visit["notes"] is None
        assert visit["objects"] == []

        # Add two objects, one with notes.
        r = _post(client, f"{_base(org)}/{vid}/objects", {
            "object_id": str(slate.object_id),
            "handling_note": "Handled with gloves",
            "condition_on_return": "No change",
        })
        assert r.status_code == 201, r.get_json()
        assert r.get_json()["object_number"] == "RV.1"
        assert _post(client, f"{_base(org)}/{vid}/objects", {"object_id": str(stylus.object_id)}).status_code == 201

        # Duplicate is refused.
        dup = _post(client, f"{_base(org)}/{vid}/objects", {"object_id": str(slate.object_id)})
        assert dup.status_code == 409

        got = client.get(f"{_base(org)}/{vid}").get_json()
        assert [o["object_number"] for o in got["objects"]] == ["RV.1", "RV.2"]
        assert got["object_count"] == 2

        # Edit a note on one object.
        r = _patch(client, f"{_base(org)}/{vid}/objects/{stylus.object_id}", {"condition_on_return": "Tip bent"})
        assert r.status_code == 200
        assert r.get_json()["condition_on_return"] == "Tip bent"

        # The list shows the count; search narrows it.
        listed = client.get(_base(org)).get_json()
        assert listed["total"] == 1
        assert listed["items"][0]["object_count"] == 2
        assert client.get(f"{_base(org)}?q=braille").get_json()["total"] == 1
        assert client.get(f"{_base(org)}?q=nothing-matches").get_json()["total"] == 0

        # The object record can list its visits.
        per_object = client.get(
            f"/api/organizations/{org.organization_id}/collections/objects/{slate.object_id}/research-visits"
        ).get_json()["items"]
        assert len(per_object) == 1
        assert per_object[0]["visit_id"] == vid
        assert per_object[0]["handling_note"] == "Handled with gloves"

        # Partial update leaves other fields alone.
        r = _patch(client, f"{_base(org)}/{vid}", {"location": "Reading Room 1"})
        assert r.status_code == 200
        body = r.get_json()
        assert body["location"] == "Reading Room 1"
        assert body["research_topic"] == "Early braille writing tools"

        # Remove one object.
        assert client.delete(f"{_base(org)}/{vid}/objects/{slate.object_id}").status_code == 200
        assert client.delete(f"{_base(org)}/{vid}/objects/{slate.object_id}").status_code == 404
        assert client.get(f"{_base(org)}/{vid}").get_json()["object_count"] == 1

        # Delete the visit; the object survives.
        assert client.delete(f"{_base(org)}/{vid}").status_code == 200
        assert client.get(f"{_base(org)}/{vid}").status_code == 404
        assert client.get(f"/api/organizations/{org.organization_id}/collections/objects/{stylus.object_id}").status_code == 200


class TestValidation:
    def test_name_and_date_required(self, auth_setup):
        client, org, _ = auth_setup
        assert _post(client, _base(org), {"visit_date": "2026-11-10"}).status_code == 422
        assert _post(client, _base(org), {"researcher_name": "  ", "visit_date": "2026-11-10"}).status_code == 422
        assert _post(client, _base(org), {"researcher_name": "A"}).status_code == 422

    def test_departure_before_arrival_rejected(self, auth_setup):
        client, org, _ = auth_setup
        r = _post(client, _base(org), {
            "researcher_name": "A", "visit_date": "2026-11-10",
            "arrival_time": "14:00", "departure_time": "09:00",
        })
        assert r.status_code == 422

        vid = _post(client, _base(org), {
            "researcher_name": "A", "visit_date": "2026-11-10", "arrival_time": "14:00",
        }).get_json()["visit_id"]
        assert _patch(client, f"{_base(org)}/{vid}", {"departure_time": "09:00"}).status_code == 422
        assert _patch(client, f"{_base(org)}/{vid}", {"researcher_name": ""}).status_code == 422

    def test_unknown_fields_rejected(self, auth_setup):
        client, org, _ = auth_setup
        r = _post(client, _base(org), {"researcher_name": "A", "visit_date": "2026-11-10", "organization_id": str(uuid4())})
        assert r.status_code == 422

    def test_references_must_belong_to_the_org(self, auth_setup):
        client, org, _ = auth_setup
        for field in ("researcher_constituent_id", "use_request_id", "supervised_by_user_id"):
            r = _post(client, _base(org), {"researcher_name": "A", "visit_date": "2026-11-10", field: str(uuid4())})
            assert r.status_code == 400, (field, r.get_json())

    def test_unknown_object_is_404(self, auth_setup):
        client, org, _ = auth_setup
        vid = _post(client, _base(org), {"researcher_name": "A", "visit_date": "2026-11-10"}).get_json()["visit_id"]
        assert _post(client, f"{_base(org)}/{vid}/objects", {"object_id": str(uuid4())}).status_code == 404


class TestPermissions:
    def _member(self, db_session, org, keys):
        from app.models import OrganizationMembership, Role, User
        from app.services.auth_utils import generate_access_token

        slug = uuid4().hex[:8]
        role = Role(role_key=f"limited-{slug}", display_name="Limited", description="", is_system=False)
        db_session.add(role)
        db_session.flush()
        for key in keys:
            _create_role_permission(db_session, role, _create_permission(db_session, key))
        user = User(
            email=f"limited-{slug}@example.com", password_hash="x", status="active",
            email_verified_at=datetime.now(timezone.utc),
        )
        db_session.add(user)
        db_session.flush()
        db_session.add(OrganizationMembership(
            organization_id=org.organization_id, user_id=user.user_id,
            role="member", role_id=role.role_id, status="active",
        ))
        db_session.commit()
        return generate_access_token(
            user_id=str(user.user_id), email=user.email,
            active_organization_id=str(org.organization_id), expires_minutes=60,
        )

    def test_view_only_can_read_but_not_write(self, auth_setup, client, db_session):
        admin, org, _ = auth_setup
        vid = _post(admin, _base(org), {"researcher_name": "A", "visit_date": "2026-11-10"}).get_json()["visit_id"]

        viewer = AuthenticatedClient(client, self._member(db_session, org, ["collections.view", "use_requests.view"]))
        assert viewer.get(_base(org)).status_code == 200
        assert viewer.get(f"{_base(org)}/{vid}").status_code == 200
        assert _post(viewer, _base(org), {"researcher_name": "B", "visit_date": "2026-11-10"}).status_code == 403
        assert _patch(viewer, f"{_base(org)}/{vid}", {"location": "x"}).status_code == 403
        assert viewer.delete(f"{_base(org)}/{vid}").status_code == 403

    def test_without_use_requests_view_nothing_is_readable(self, auth_setup, client, db_session):
        _, org, _ = auth_setup
        outsider = AuthenticatedClient(client, self._member(db_session, org, ["collections.view"]))
        assert outsider.get(_base(org)).status_code == 403
        assert outsider.get(
            f"/api/organizations/{org.organization_id}/collections/objects/{uuid4()}/research-visits"
        ).status_code == 403
