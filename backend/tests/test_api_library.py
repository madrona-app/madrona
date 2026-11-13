"""Library catalog: bibliographic records, holdings, items, subject and name
links. API round trip, validation, permissions and field-level restrictions."""
import json
from datetime import datetime, timezone
from uuid import uuid4

from tests.conftest import AuthenticatedClient, _create_permission, _create_role_permission


def _base(org):
    return f"/api/organizations/{org.organization_id}/collections/library/records"


def _post(client, url, body):
    return client.post(url, data=json.dumps(body), content_type="application/json")


def _patch(client, url, body):
    return client.patch(url, data=json.dumps(body), content_type="application/json")


def _record(client, org, **fields):
    body = {"title": "Walking Alone and Marching Together", **fields}
    resp = _post(client, _base(org), body)
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


def _location(db_session, org, name="Stacks, Range 4"):
    from app.models import Location

    loc = Location(organization_id=org.organization_id, name=name, code=f"L{uuid4().hex[:6]}", path=name, location_type="shelf")
    db_session.add(loc)
    db_session.flush()
    return loc


class TestRoundTrip:
    def test_record_holdings_items_subjects_names(self, auth_setup, db_session):
        client, org, _ = auth_setup
        from app.models import CollectionObject, Constituent, SubjectAuthority

        loc = _location(db_session, org)
        author = Constituent(organization_id=org.organization_id, constituent_type="person", name="Floyd Matson")
        narrator = Constituent(organization_id=org.organization_id, constituent_type="person", name="Ray Reader")
        subject = SubjectAuthority(organization_id=org.organization_id, preferred_term="Blind--Civil rights", lcsh_id="sh85014899")
        obj = CollectionObject(organization_id=org.organization_id, object_number="LIB.1", object_name="Braille volume")
        db_session.add_all([author, narrator, subject, obj])
        db_session.commit()

        rec = _record(
            client, org,
            record_type="braille",
            subtitle=" A history of the National Federation of the Blind ",
            statement_of_responsibility="Floyd Matson",
            place="Baltimore", publisher="National Federation of the Blind",
            date_display="1990", date_earliest=1990, date_latest=1990,
            extent="12 volumes of braille", language="English",
            isbn="9780000000001", call_number="HV1593 .M38 1990",
            notes="",
        )
        rid = rec["bib_record_id"]
        assert rec["record_type"] == "braille"
        assert rec["subtitle"] == "A history of the National Federation of the Blind"
        assert rec["notes"] is None
        assert rec["holdings"] == [] and rec["subjects"] == [] and rec["names"] == []

        # Holding at a location, with two items.
        r = _post(client, f"{_base(org)}/{rid}/holdings", {
            "location_id": str(loc.location_id),
            "call_number": "tenBroek HV1593 .M38",
            "holdings_statement": "v.1-12",
        })
        assert r.status_code == 201, r.get_json()
        holding = r.get_json()
        hid = holding["holding_id"]
        assert holding["location_name"] == "Stacks, Range 4"

        items_url = f"{_base(org)}/{rid}/holdings/{hid}/items"
        r = _post(client, items_url, {"barcode": "T0001", "enumeration": "v.1", "copy_number": "1"})
        assert r.status_code == 201, r.get_json()
        item1 = r.get_json()
        assert item1["status"] == "available"
        r = _post(client, items_url, {
            "barcode": "T0002", "enumeration": "v.2", "status": "in_processing",
            "collection_object_id": str(obj.object_id),
        })
        assert r.status_code == 201, r.get_json()
        assert r.get_json()["collection_object_number"] == "LIB.1"
        # An item without a barcode is allowed, and two of them do not collide.
        assert _post(client, items_url, {"enumeration": "v.3"}).status_code == 201
        assert _post(client, items_url, {"enumeration": "v.4", "barcode": ""}).status_code == 201

        # Edit an item.
        r = _patch(client, f"{items_url}/{item1['item_id']}", {"status": "on_loan", "condition_note": "Dots worn"})
        assert r.status_code == 200
        assert r.get_json()["status"] == "on_loan"

        # Subjects and names.
        r = _post(client, f"{_base(org)}/{rid}/subjects", {"subject_authority_id": str(subject.authority_id)})
        assert r.status_code == 201, r.get_json()
        assert r.get_json()["preferred_term"] == "Blind--Civil rights"
        assert _post(client, f"{_base(org)}/{rid}/subjects", {"subject_authority_id": str(subject.authority_id)}).status_code == 409
        r = _post(client, f"{_base(org)}/{rid}/names", {"constituent_id": str(author.constituent_id), "role": "author"})
        assert r.status_code == 201
        r = _post(client, f"{_base(org)}/{rid}/names", {"constituent_id": str(narrator.constituent_id), "role": "narrator"})
        assert r.status_code == 201
        narrator_link = r.get_json()["link_id"]
        assert _post(client, f"{_base(org)}/{rid}/names", {"constituent_id": str(author.constituent_id), "role": "author"}).status_code == 409
        # Same person in another role is fine.
        assert _post(client, f"{_base(org)}/{rid}/names", {"constituent_id": str(author.constituent_id), "role": "editor"}).status_code == 201

        got = client.get(f"{_base(org)}/{rid}").get_json()
        assert got["holding_count"] == 1
        assert got["item_count"] == 4
        assert [i["enumeration"] for i in got["holdings"][0]["items"]] == ["v.1", "v.2", "v.3", "v.4"]
        assert [n["role"] for n in got["names"]] == ["author", "narrator", "editor"]
        assert got["subjects"][0]["lcsh_id"] == "sh85014899"

        # Remove a name.
        assert client.delete(f"{_base(org)}/{rid}/names/{narrator_link}").status_code == 200
        assert client.delete(f"{_base(org)}/{rid}/names/{narrator_link}").status_code == 404

        # Partial update leaves other fields alone.
        r = _patch(client, f"{_base(org)}/{rid}", {"edition": "Braille edition"})
        assert r.status_code == 200
        assert r.get_json()["edition"] == "Braille edition"
        assert r.get_json()["publisher"] == "National Federation of the Blind"

        # Update and remove the holding (its items go with it).
        r = _patch(client, f"{_base(org)}/{rid}/holdings/{hid}", {"public_note": "Ask at the desk"})
        assert r.status_code == 200 and r.get_json()["public_note"] == "Ask at the desk"
        assert len(r.get_json()["items"]) == 4
        assert client.delete(f"{items_url}/{item1['item_id']}").status_code == 200
        assert client.delete(f"{_base(org)}/{rid}/holdings/{hid}").status_code == 200
        assert client.get(f"{_base(org)}/{rid}").get_json()["item_count"] == 0

        # Delete the record; the linked authorities and object survive.
        assert client.delete(f"{_base(org)}/{rid}").status_code == 200
        assert client.get(f"{_base(org)}/{rid}").status_code == 404
        db_session.expire_all()
        assert db_session.get(SubjectAuthority, subject.authority_id) is not None
        assert db_session.get(Constituent, author.constituent_id) is not None


class TestSearch:
    def test_filters_text_query_and_pagination(self, auth_setup):
        client, org, _ = auth_setup
        braille = _record(client, org, title="Braille Monitor 1957", record_type="serial", issn="0006-8829")
        _record(client, org, title="Kernel Book: Stories", record_type="large_print", statement_of_responsibility="Marc Maurer", call_number="PS3563 .A9")
        _record(client, org, title="Audio history", record_type="audio", isbn="9781234567897")
        hid = _post(client, f"{_base(org)}/{braille['bib_record_id']}/holdings", {"call_number": "LOCAL-BM-57"}).get_json()["holding_id"]
        _post(client, f"{_base(org)}/{braille['bib_record_id']}/holdings/{hid}/items", {"barcode": "BC-7788"})

        def titles(qs):
            resp = client.get(f"{_base(org)}{qs}")
            assert resp.status_code == 200, resp.get_json()
            return [r["title"] for r in resp.get_json()["items"]]

        assert titles("") == ["Audio history", "Braille Monitor 1957", "Kernel Book: Stories"]
        assert titles("?record_type=large_print") == ["Kernel Book: Stories"]
        assert titles("?q=maurer") == ["Kernel Book: Stories"]          # responsibility
        assert titles("?q=9781234567897") == ["Audio history"]          # ISBN
        assert titles("?q=0006-8829") == ["Braille Monitor 1957"]       # ISSN
        assert titles("?q=PS3563") == ["Kernel Book: Stories"]          # record call number
        assert titles("?q=LOCAL-BM") == ["Braille Monitor 1957"]        # holding call number
        assert titles("?q=BC-7788") == ["Braille Monitor 1957"]         # item barcode
        assert titles("?q=monitor&record_type=audio") == []
        assert titles("?q=100%25") == []                                # % is literal

        page = client.get(f"{_base(org)}?limit=2&offset=2").get_json()
        assert page["total"] == 3 and page["limit"] == 2 and page["offset"] == 2
        assert [r["title"] for r in page["items"]] == ["Kernel Book: Stories"]
        listed = client.get(f"{_base(org)}?q=monitor").get_json()["items"][0]
        assert listed["holding_count"] == 1 and listed["item_count"] == 1
        assert client.get(f"{_base(org)}?record_type=nonsense").status_code == 422


class TestValidation:
    def test_title_required_and_type_checked(self, auth_setup):
        client, org, _ = auth_setup
        assert _post(client, _base(org), {}).status_code == 422
        assert _post(client, _base(org), {"title": "   "}).status_code == 422
        assert _post(client, _base(org), {"title": "A", "record_type": "scroll"}).status_code == 422
        rid = _record(client, org)["bib_record_id"]
        assert _patch(client, f"{_base(org)}/{rid}", {"title": ""}).status_code == 422
        assert _patch(client, f"{_base(org)}/{rid}", {"record_type": None}).status_code == 422

    def test_years_in_order(self, auth_setup):
        client, org, _ = auth_setup
        assert _post(client, _base(org), {"title": "A", "date_earliest": 1990, "date_latest": 1980}).status_code == 422
        rid = _record(client, org, date_earliest=1990)["bib_record_id"]
        assert _patch(client, f"{_base(org)}/{rid}", {"date_latest": 1980}).status_code == 422

    def test_unknown_fields_rejected(self, auth_setup):
        client, org, _ = auth_setup
        assert _post(client, _base(org), {"title": "A", "organization_id": str(uuid4())}).status_code == 422
        assert _post(client, _base(org), {"title": "A", "marc_json": {}}).status_code == 422

    def test_barcode_unique_per_org(self, auth_setup):
        client, org, _ = auth_setup
        rid = _record(client, org)["bib_record_id"]
        hid = _post(client, f"{_base(org)}/{rid}/holdings", {}).get_json()["holding_id"]
        url = f"{_base(org)}/{rid}/holdings/{hid}/items"
        assert _post(client, url, {"barcode": "X1"}).status_code == 201
        assert _post(client, url, {"barcode": "X1"}).status_code == 409
        # Also across records in the same org.
        rid2 = _record(client, org, title="Other")["bib_record_id"]
        hid2 = _post(client, f"{_base(org)}/{rid2}/holdings", {}).get_json()["holding_id"]
        url2 = f"{_base(org)}/{rid2}/holdings/{hid2}/items"
        assert _post(client, url2, {"barcode": "X1"}).status_code == 409
        other = _post(client, url2, {"barcode": "X2"}).get_json()
        assert _patch(client, f"{url2}/{other['item_id']}", {"barcode": "X1"}).status_code == 409

    def test_item_status_and_role_checked(self, auth_setup, db_session):
        client, org, _ = auth_setup
        from app.models import Constituent

        rid = _record(client, org)["bib_record_id"]
        hid = _post(client, f"{_base(org)}/{rid}/holdings", {}).get_json()["holding_id"]
        assert _post(client, f"{_base(org)}/{rid}/holdings/{hid}/items", {"status": "lost"}).status_code == 422
        person = Constituent(organization_id=org.organization_id, constituent_type="person", name="P")
        db_session.add(person)
        db_session.commit()
        assert _post(client, f"{_base(org)}/{rid}/names", {"constituent_id": str(person.constituent_id), "role": "ghost"}).status_code == 422

    def test_references_must_belong_to_the_org(self, auth_setup):
        client, org, _ = auth_setup
        rid = _record(client, org)["bib_record_id"]
        assert _post(client, f"{_base(org)}/{rid}/holdings", {"location_id": str(uuid4())}).status_code == 400
        hid = _post(client, f"{_base(org)}/{rid}/holdings", {}).get_json()["holding_id"]
        assert _post(client, f"{_base(org)}/{rid}/holdings/{hid}/items", {"collection_object_id": str(uuid4())}).status_code == 400
        assert _post(client, f"{_base(org)}/{rid}/subjects", {"subject_authority_id": str(uuid4())}).status_code == 404
        assert _post(client, f"{_base(org)}/{rid}/names", {"constituent_id": str(uuid4())}).status_code == 404

    def test_nested_ids_must_match_their_parent(self, auth_setup):
        client, org, _ = auth_setup
        rid1 = _record(client, org)["bib_record_id"]
        rid2 = _record(client, org, title="Second")["bib_record_id"]
        hid1 = _post(client, f"{_base(org)}/{rid1}/holdings", {}).get_json()["holding_id"]
        hid2 = _post(client, f"{_base(org)}/{rid2}/holdings", {}).get_json()["holding_id"]
        item = _post(client, f"{_base(org)}/{rid1}/holdings/{hid1}/items", {}).get_json()
        # Holding 1 addressed through record 2: not found.
        assert _patch(client, f"{_base(org)}/{rid2}/holdings/{hid1}", {"public_note": "x"}).status_code == 404
        # Item of holding 1 addressed through holding 2: not found.
        assert client.delete(f"{_base(org)}/{rid2}/holdings/{hid2}/items/{item['item_id']}").status_code == 404


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
        token = generate_access_token(
            user_id=str(user.user_id), email=user.email,
            active_organization_id=str(org.organization_id), expires_minutes=60,
        )
        return token, role

    def test_view_only_can_read_but_not_write(self, auth_setup, client, db_session):
        admin, org, _ = auth_setup
        rid = _record(admin, org)["bib_record_id"]
        hid = _post(admin, f"{_base(org)}/{rid}/holdings", {}).get_json()["holding_id"]

        token, _ = self._member(db_session, org, ["collections.view"])
        viewer = AuthenticatedClient(client, token)
        assert viewer.get(_base(org)).status_code == 200
        assert viewer.get(f"{_base(org)}/{rid}").status_code == 200
        assert _post(viewer, _base(org), {"title": "B"}).status_code == 403
        assert _patch(viewer, f"{_base(org)}/{rid}", {"edition": "x"}).status_code == 403
        assert _post(viewer, f"{_base(org)}/{rid}/holdings", {}).status_code == 403
        assert _post(viewer, f"{_base(org)}/{rid}/holdings/{hid}/items", {}).status_code == 403
        assert viewer.delete(f"{_base(org)}/{rid}").status_code == 403

    def test_edit_without_delete_cannot_delete_record(self, auth_setup, client, db_session):
        admin, org, _ = auth_setup
        rid = _record(admin, org)["bib_record_id"]
        token, _ = self._member(db_session, org, ["collections.view", "collections.edit"])
        editor = AuthenticatedClient(client, token)
        assert _patch(editor, f"{_base(org)}/{rid}", {"edition": "2nd"}).status_code == 200
        assert _post(editor, _base(org), {"title": "B"}).status_code == 403
        assert editor.delete(f"{_base(org)}/{rid}").status_code == 403

    def test_without_collections_view_nothing_is_readable(self, auth_setup, client, db_session):
        _, org, _ = auth_setup
        token, _ = self._member(db_session, org, ["use_requests.view"])
        outsider = AuthenticatedClient(client, token)
        assert outsider.get(_base(org)).status_code == 403


class TestFieldLevelRestrictions:
    """Field policies with entity_type 'bib_record' apply like object fields:
    hidden fields are left out of responses, read-only fields are ignored on
    write."""

    def test_hidden_and_read_only_fields(self, auth_setup, client, db_session):
        from app.models import Application, FieldAccessPolicy, RoleFieldAccess

        admin, org, _ = auth_setup
        app_row = db_session.query(Application).filter_by(key="collections").first()
        if app_row is None:
            app_row = Application(key="collections", display_name="Collections")
            db_session.add(app_row)
            db_session.flush()
        hidden = FieldAccessPolicy(
            application_id=app_row.application_id, entity_type="bib_record", field_path="notes",
            policy_type="internal", display_name="Staff notes", default_visible=False,
        )
        read_only = FieldAccessPolicy(
            application_id=app_row.application_id, entity_type="bib_record", field_path="call_number",
            policy_type="restricted", display_name="Call number", default_visible=True,
        )
        db_session.add_all([hidden, read_only])
        db_session.commit()

        rid = _record(admin, org, notes="Donated by the estate", call_number="HV1")["bib_record_id"]

        token, role = TestPermissions()._member(
            db_session, org, ["collections.view", "collections.create", "collections.edit"],
        )
        db_session.add(RoleFieldAccess(
            organization_id=org.organization_id, role_id=role.role_id, policy_id=read_only.policy_id,
            can_view=True, can_edit=False,
        ))
        db_session.commit()
        intern = AuthenticatedClient(client, token)

        got = intern.get(f"{_base(org)}/{rid}").get_json()
        assert "notes" not in got
        assert got["call_number"] == "HV1"
        assert set(got["_restricted_fields"]) == {"notes"}
        listed = intern.get(_base(org)).get_json()["items"][0]
        assert "notes" not in listed

        r = _patch(intern, f"{_base(org)}/{rid}", {"call_number": "CHANGED", "notes": "CHANGED", "edition": "2nd"})
        assert r.status_code == 200
        full = admin.get(f"{_base(org)}/{rid}").get_json()
        assert full["call_number"] == "HV1"
        assert full["notes"] == "Donated by the estate"
        assert full["edition"] == "2nd"

        created = _post(intern, _base(org), {"title": "New", "call_number": "X", "notes": "Y"}).get_json()
        full = admin.get(f"{_base(org)}/{created['bib_record_id']}").get_json()
        assert full["call_number"] is None and full["notes"] is None
