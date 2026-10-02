"""
Coverage tests for the Constituents API router.

Targets app/fastapi_app/routers/collections_constituents.py (494 statements,
baseline 29% coverage) by exercising:
    - List (empty / populated / search / type+status filters / pagination)
    - Retrieval (get-one, 404, cross-org isolation)
    - Create (individual + organization, required-field validation, invalid type,
      variant names side-table)
    - Update and PATCH (full + partial field sweeps including JSON columns)
    - Delete (success, 404, blocked-by-xrefs path)
    - Enums, constituent-roles-for-entity lookup
    - Merge (happy path, self-merge, missing secondary, duplicate xref de-dup)
    - Verify (sets is_verified timestamp)
    - Relations (list, create, self-relation guard, invalid type, delete)
    - Object-scoped xrefs (list, add, add-duplicate 409, update, delete)
    - Generic xrefs (list with filters, create, patch, delete, missing-params)
    - Viewer (COLLECTIONS_VIEW only) forbidden on edit endpoints

Run against PostgreSQL (see tests/conftest.py).
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.models import CollectionObject, Constituent, ConstituentRelation, ConstituentXref


# ---------------------------------------------------------------------------
# URL builders
# ---------------------------------------------------------------------------


def _base(org) -> str:
    return f"/api/organizations/{org.organization_id}/collections/constituents"


def _object_constituents_url(org, object_id: str, suffix: str = "") -> str:
    return (
        f"/api/organizations/{org.organization_id}"
        f"/collections/objects/{object_id}/constituents{suffix}"
    )


def _generic_xrefs_url(org, suffix: str = "") -> str:
    return f"/api/organizations/{org.organization_id}/collections/constituent-xrefs{suffix}"


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _make_constituent(
    db_session,
    org,
    *,
    name: str = "Jane Doe",
    constituent_type: str = "person",
    **overrides,
) -> Constituent:
    c = Constituent(
        organization_id=org.organization_id,
        constituent_type=constituent_type,
        name=name,
        display_name=overrides.pop("display_name", name),
        status=overrides.pop("status", "active"),
        is_verified=overrides.pop("is_verified", False),
        **overrides,
    )
    db_session.add(c)
    db_session.commit()
    return c


def _make_object(db_session, org, *, object_number: str = "OBJ.TEST.1") -> CollectionObject:
    obj = CollectionObject(
        organization_id=org.organization_id,
        object_number=object_number,
    )
    db_session.add(obj)
    db_session.commit()
    return obj


def _make_xref(
    db_session,
    org,
    *,
    constituent_id,
    entity_type: str = "collection_object",
    entity_id=None,
    role: str = "creator",
    **overrides,
) -> ConstituentXref:
    xref = ConstituentXref(
        organization_id=org.organization_id,
        constituent_id=constituent_id,
        entity_type=entity_type,
        entity_id=entity_id or uuid4(),
        role=role,
        **overrides,
    )
    db_session.add(xref)
    db_session.commit()
    return xref


# ===========================================================================
# List
# ===========================================================================


class TestListConstituents:
    def test_list_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_base(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 0
        assert data["items"] == []
        assert data["limit"] == 50
        assert data["offset"] == 0

    def test_list_populated_sorted_by_name(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_constituent(db_session, org, name="Bravo Bravo")
        _make_constituent(db_session, org, name="Alpha Alpha")
        _make_constituent(db_session, org, name="Charlie Charlie")

        resp = auth_client.get(_base(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 3
        names = [c["name"] for c in data["items"]]
        assert names == ["Alpha Alpha", "Bravo Bravo", "Charlie Charlie"]

    def test_list_filter_by_type_alias(self, auth_setup, db_session):
        """`?type=` is an alias for `?constituent_type=`."""
        auth_client, org, _ = auth_setup
        _make_constituent(db_session, org, name="Jane", constituent_type="person")
        _make_constituent(
            db_session,
            org,
            name="ACME Corp",
            constituent_type="organization",
            organization_name="ACME Corp",
        )

        resp = auth_client.get(_base(org) + "?type=organization")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "ACME Corp"

    def test_list_filter_by_constituent_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_constituent(db_session, org, name="Person Z", constituent_type="person")
        _make_constituent(
            db_session, org, name="Family Q", constituent_type="family"
        )

        resp = auth_client.get(_base(org) + "?constituent_type=family")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["constituent_type"] == "family"

    def test_list_filter_by_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_constituent(db_session, org, name="Active One", status="active")
        _make_constituent(db_session, org, name="Deprecated One", status="deprecated")

        resp = auth_client.get(_base(org) + "?status=deprecated")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["status"] == "deprecated"

    def test_list_search_by_name(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_constituent(db_session, org, name="Vincent van Gogh")
        _make_constituent(db_session, org, name="Claude Monet")

        resp = auth_client.get(_base(org) + "?q=vincent")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["name"] == "Vincent van Gogh"

    def test_list_search_by_email(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_constituent(db_session, org, name="Emailed", email="findme@museum.org")
        _make_constituent(db_session, org, name="Other", email="other@museum.org")

        resp = auth_client.get(_base(org) + "?q=findme")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["email"] == "findme@museum.org"

    def test_list_search_escapes_wildcards(self, auth_setup, db_session):
        """Literal % should not broaden the match set."""
        auth_client, org, _ = auth_setup
        _make_constituent(db_session, org, name="John Smith")
        _make_constituent(db_session, org, name="100% Wool")

        resp = auth_client.get(_base(org) + "?q=100%25")
        assert resp.status_code == 200
        data = resp.get_json()
        names = [c["name"] for c in data["items"]]
        assert "100% Wool" in names
        assert "John Smith" not in names

    def test_list_pagination(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        for i in range(5):
            _make_constituent(db_session, org, name=f"Person {i:02d}")

        resp = auth_client.get(_base(org) + "?limit=2&offset=1")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 5
        assert len(data["items"]) == 2
        assert data["limit"] == 2
        assert data["offset"] == 1


# ===========================================================================
# Get / 404 / cross-org
# ===========================================================================


class TestGetConstituent:
    def test_get_full_detail(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(
            db_session,
            org,
            name="Claude Monet",
            display_name="Claude Monet",
            nationality="French",
            biography="Impressionist painter.",
            ulan_id="500019484",
            email="monet@example.org",
            phone="+33-1-23-45-67-89",
        )
        cid = str(c.constituent_id)

        resp = auth_client.get(f"{_base(org)}/{cid}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["constituent_id"] == cid
        assert data["name"] == "Claude Monet"
        assert data["nationality"] == "French"
        assert data["biography"] == "Impressionist painter."
        assert data["ulan_id"] == "500019484"
        assert data["email"] == "monet@example.org"
        assert data["phone"] == "+33-1-23-45-67-89"
        # No xrefs yet.
        assert data["linked_records_count"] == 0

    def test_get_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base(org)}/{uuid4()}")
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"

    def test_get_cross_org_returns_404(self, auth_setup, viewer_auth_setup, db_session):
        """A constituent belonging to another org responds with 404 inside auth's org."""
        auth_client, org, _ = auth_setup
        _, other_org, _ = viewer_auth_setup
        other_c = _make_constituent(db_session, other_org, name="Outside Org")

        resp = auth_client.get(f"{_base(org)}/{other_c.constituent_id}")
        assert resp.status_code == 404

    def test_get_linked_records_count(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(db_session, org, name="Linked Person")
        # Create two xrefs pointing at arbitrary entity ids.
        _make_xref(db_session, org, constituent_id=c.constituent_id, role="creator")
        _make_xref(db_session, org, constituent_id=c.constituent_id, role="donor")

        resp = auth_client.get(f"{_base(org)}/{c.constituent_id}")
        assert resp.status_code == 200
        assert resp.get_json()["linked_records_count"] == 2


# ===========================================================================
# Create
# ===========================================================================


class TestCreateConstituent:
    def test_create_person_minimal(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _base(org),
            json={"name": "Ada Lovelace", "constituent_type": "person"},
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["name"] == "Ada Lovelace"
        assert data["constituent_type"] == "person"
        assert data["organization_id"] == str(org.organization_id)
        assert "constituent_id" in data

    def test_create_organization_with_fields(self, auth_setup):
        auth_client, org, _ = auth_setup
        payload = {
            "name": "Example Museum of Modern Art",
            "constituent_type": "organization",
            "organization_name": "Example Museum of Modern Art",
            "department": "Curatorial",
            "email": "info@example.com",
            "phone": "+1-212-555-0100",
            "website": "https://example.com",
            "address": {"line1": "100 Example Ave", "city": "New York"},
            "contact_categories": ["lender", "research"],
            "notes": "Primary institutional contact",
        }
        resp = auth_client.post(_base(org), json=payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["constituent_type"] == "organization"
        assert data["organization_name"] == "Example Museum of Modern Art"
        assert data["department"] == "Curatorial"
        assert data["email"] == "info@example.com"
        assert data["website"] == "https://example.com"
        assert data["address"] == {"line1": "100 Example Ave", "city": "New York"}

    def test_create_with_variant_names_side_table(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        payload = {
            "name": "Pablo Ruiz Picasso",
            "constituent_type": "person",
            "variant_names": [
                {"name": "Pablo Picasso", "type": "displayed", "language": "en"},
                {"name": "P. Picasso", "type": "short"},
            ],
        }
        resp = auth_client.post(_base(org), json=payload)
        assert resp.status_code == 201
        data = resp.get_json()
        # Re-fetch so the variant_names relationship resolves.
        cid = data["constituent_id"]
        detail = auth_client.get(f"{_base(org)}/{cid}").get_json()
        assert detail["variant_names"] is not None
        assert "Pablo Picasso" in detail["variant_names"]
        assert "P. Picasso" in detail["variant_names"]

    def test_create_missing_name(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_base(org), json={"constituent_type": "person"})
        assert resp.status_code == 400
        err = resp.get_json().get("error", {})
        assert err.get("code") == "MISSING_REQUIRED_FIELDS"

    def test_create_missing_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_base(org), json={"name": "Someone"})
        assert resp.status_code == 400
        err = resp.get_json().get("error", {})
        assert err.get("code") == "MISSING_REQUIRED_FIELDS"

    def test_create_invalid_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _base(org),
            json={"name": "Invalid", "constituent_type": "alien"},
        )
        assert resp.status_code == 400
        err = resp.get_json().get("error", {})
        assert err.get("code") == "INVALID_TYPE"


# ===========================================================================
# Update (PUT) and PATCH
# ===========================================================================


class TestUpdateConstituent:
    def test_put_update_basic_fields(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(db_session, org, name="Original")
        cid = str(c.constituent_id)

        resp = auth_client.put(
            f"{_base(org)}/{cid}",
            json={
                "name": "Renamed",
                "display_name": "Renamed Display",
                "nationality": "American",
                "email": "new@example.org",
                "notes": "Updated notes",
            },
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["constituent_id"] == cid

        detail = auth_client.get(f"{_base(org)}/{cid}").get_json()
        assert detail["name"] == "Renamed"
        assert detail["display_name"] == "Renamed Display"
        assert detail["nationality"] == "American"
        assert detail["email"] == "new@example.org"
        assert detail["notes"] == "Updated notes"

    def test_put_updates_json_and_list_fields(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(db_session, org, name="With JSON")
        cid = str(c.constituent_id)

        payload = {
            "nationalities": ["French", "Spanish"],
            "life_roles": [{"role": "painter"}, {"role": "sculptor"}],
            "address": {"line1": "12 rue de Rivoli", "city": "Paris"},
            "external_uris": [
                {"uri": "https://viaf.org/viaf/12345"},
                {"uri": "https://wikidata.org/wiki/Q12345"},
            ],
            "is_active": False,
            "status": "deprecated",
        }
        resp = auth_client.put(f"{_base(org)}/{cid}", json=payload)
        assert resp.status_code == 200

        detail = auth_client.get(f"{_base(org)}/{cid}").get_json()
        assert detail["nationalities"] == ["French", "Spanish"]
        assert detail["life_roles"] == ["painter", "sculptor"]
        assert detail["address"] == {"line1": "12 rue de Rivoli", "city": "Paris"}
        assert detail["external_uris"] == [
            "https://viaf.org/viaf/12345",
            "https://wikidata.org/wiki/Q12345",
        ]
        assert detail["is_active"] is False
        assert detail["status"] == "deprecated"

    def test_put_ignores_unknown_fields(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(db_session, org, name="Keep Me")
        cid = str(c.constituent_id)

        resp = auth_client.put(
            f"{_base(org)}/{cid}",
            json={"not_a_field": "nope", "also_fake": 123, "name": "Keep Me"},
        )
        assert resp.status_code == 200
        detail = auth_client.get(f"{_base(org)}/{cid}").get_json()
        assert detail["name"] == "Keep Me"

    def test_put_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.put(
            f"{_base(org)}/{uuid4()}",
            json={"name": "Ghost"},
        )
        assert resp.status_code == 404

    def test_patch_partial_update(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(
            db_session, org, name="Name Stays", nationality="French"
        )
        cid = str(c.constituent_id)

        resp = auth_client.patch(
            f"{_base(org)}/{cid}",
            json={"phone": "+1-555-0199"},
        )
        assert resp.status_code == 200

        detail = auth_client.get(f"{_base(org)}/{cid}").get_json()
        assert detail["phone"] == "+1-555-0199"
        # Untouched fields remain.
        assert detail["name"] == "Name Stays"
        assert detail["nationality"] == "French"

    def test_patch_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.patch(
            f"{_base(org)}/{uuid4()}",
            json={"phone": "000"},
        )
        assert resp.status_code == 404


# ===========================================================================
# Delete
# ===========================================================================


class TestDeleteConstituent:
    def test_delete_success(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(db_session, org, name="Gone")
        cid = str(c.constituent_id)

        resp = auth_client.delete(f"{_base(org)}/{cid}")
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        resp2 = auth_client.get(f"{_base(org)}/{cid}")
        assert resp2.status_code == 404

    def test_delete_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(f"{_base(org)}/{uuid4()}")
        assert resp.status_code == 404

    def test_delete_blocked_when_linked(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(db_session, org, name="Linked")
        _make_xref(db_session, org, constituent_id=c.constituent_id, role="creator")

        resp = auth_client.delete(f"{_base(org)}/{c.constituent_id}")
        assert resp.status_code == 400
        err = resp.get_json().get("error", {})
        assert err.get("code") == "HAS_LINKS"


# ===========================================================================
# Enums and role lookup
# ===========================================================================


class TestEnumsAndRoles:
    def test_enums_payload(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base(org)}/enums")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "person" in data["constituent_types"]
        assert "organization" in data["constituent_types"]
        assert "active" in data["statuses"]
        assert "collection_object" in data["entity_types"]
        assert "creator" in data["roles_by_entity_type"]["collection_object"]
        assert "teacher_of" in data["relationship_types"]
        assert "certain" in data["attribution_certainty"]

    def test_roles_for_entity_type(self, auth_setup):
        """The endpoint returns a list (possibly empty until lookups seeded)."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}"
            f"/collections/constituent-roles/collection_object"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["entity_type"] == "collection_object"
        assert isinstance(data["roles"], list)


# ===========================================================================
# Verify
# ===========================================================================


class TestVerify:
    def test_verify_sets_flag_and_timestamp(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(db_session, org, name="To Verify", is_verified=False)

        resp = auth_client.post(f"{_base(org)}/{c.constituent_id}/verify")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["is_verified"] is True
        assert body["verified_at"]

        detail = auth_client.get(f"{_base(org)}/{c.constituent_id}").get_json()
        assert detail["is_verified"] is True
        assert detail["verified_at"] is not None

    def test_verify_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(f"{_base(org)}/{uuid4()}/verify")
        assert resp.status_code == 404


# ===========================================================================
# Merge
# ===========================================================================


class TestMerge:
    def test_merge_reassigns_xrefs_and_deactivates_secondary(
        self, auth_setup, db_session
    ):
        auth_client, org, _ = auth_setup
        primary = _make_constituent(db_session, org, name="Primary")
        secondary = _make_constituent(db_session, org, name="Secondary")

        # Xref on secondary only — should be reassigned.
        unique_entity = uuid4()
        _make_xref(
            db_session,
            org,
            constituent_id=secondary.constituent_id,
            entity_type="collection_object",
            entity_id=unique_entity,
            role="creator",
        )

        # Xref on both primary + secondary to the same (entity, role) — dup,
        # should be deleted rather than reassigned.
        shared_entity = uuid4()
        _make_xref(
            db_session,
            org,
            constituent_id=primary.constituent_id,
            entity_type="collection_object",
            entity_id=shared_entity,
            role="donor",
        )
        _make_xref(
            db_session,
            org,
            constituent_id=secondary.constituent_id,
            entity_type="collection_object",
            entity_id=shared_entity,
            role="donor",
        )

        resp = auth_client.post(
            f"{_base(org)}/{primary.constituent_id}/merge",
            json={"secondary_id": str(secondary.constituent_id)},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["primary_id"] == str(primary.constituent_id)
        assert body["secondary_id"] == str(secondary.constituent_id)
        assert body["xrefs_reassigned"] == 1
        assert body["xrefs_skipped_duplicate"] == 1

        # Secondary marked merged/inactive.
        detail = auth_client.get(f"{_base(org)}/{secondary.constituent_id}").get_json()
        assert detail["status"] == "merged"
        assert detail["is_active"] is False

    def test_merge_missing_secondary_id(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        primary = _make_constituent(db_session, org, name="Primary")
        resp = auth_client.post(
            f"{_base(org)}/{primary.constituent_id}/merge", json={}
        )
        assert resp.status_code == 400
        assert resp.get_json().get("error", {}).get("code") == "MISSING_REQUIRED_FIELDS"

    def test_merge_self(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        primary = _make_constituent(db_session, org, name="Self")
        resp = auth_client.post(
            f"{_base(org)}/{primary.constituent_id}/merge",
            json={"secondary_id": str(primary.constituent_id)},
        )
        assert resp.status_code == 400
        assert resp.get_json().get("error", {}).get("code") == "SELF_MERGE"

    def test_merge_primary_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        secondary = _make_constituent(db_session, org, name="Existing Secondary")
        resp = auth_client.post(
            f"{_base(org)}/{uuid4()}/merge",
            json={"secondary_id": str(secondary.constituent_id)},
        )
        assert resp.status_code == 404

    def test_merge_secondary_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        primary = _make_constituent(db_session, org, name="Primary")
        resp = auth_client.post(
            f"{_base(org)}/{primary.constituent_id}/merge",
            json={"secondary_id": str(uuid4())},
        )
        assert resp.status_code == 404


# ===========================================================================
# Relations
# ===========================================================================


class TestRelations:
    def test_list_relations_empty(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(db_session, org, name="Solo")
        resp = auth_client.get(f"{_base(org)}/{c.constituent_id}/relations")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["constituent_id"] == str(c.constituent_id)
        assert data["relations"] == []

    def test_list_relations_constituent_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base(org)}/{uuid4()}/relations")
        assert resp.status_code == 404

    def test_create_relation_success_and_listed_both_directions(
        self, auth_setup, db_session
    ):
        auth_client, org, _ = auth_setup
        teacher = _make_constituent(db_session, org, name="Teacher")
        student = _make_constituent(db_session, org, name="Student")

        resp = auth_client.post(
            f"{_base(org)}/{teacher.constituent_id}/relations",
            json={
                "to_constituent_id": str(student.constituent_id),
                "relationship_type": "teacher_of",
                "relationship_note": "Studio apprenticeship",
            },
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["relationship_type"] == "teacher_of"
        assert body["from_constituent_id"] == str(teacher.constituent_id)
        assert body["to_constituent_id"] == str(student.constituent_id)
        assert body["from_constituent"]["name"] == "Teacher"
        assert body["to_constituent"]["name"] == "Student"

        # Both sides list it.
        teacher_view = auth_client.get(
            f"{_base(org)}/{teacher.constituent_id}/relations"
        ).get_json()
        student_view = auth_client.get(
            f"{_base(org)}/{student.constituent_id}/relations"
        ).get_json()
        assert len(teacher_view["relations"]) == 1
        assert len(student_view["relations"]) == 1

    def test_create_relation_missing_target(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        teacher = _make_constituent(db_session, org, name="Teacher")
        resp = auth_client.post(
            f"{_base(org)}/{teacher.constituent_id}/relations",
            json={"relationship_type": "teacher_of"},
        )
        assert resp.status_code == 400
        assert resp.get_json().get("error", {}).get("code") == "MISSING_REQUIRED_FIELDS"

    def test_create_relation_missing_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        a = _make_constituent(db_session, org, name="A")
        b = _make_constituent(db_session, org, name="B")
        resp = auth_client.post(
            f"{_base(org)}/{a.constituent_id}/relations",
            json={"to_constituent_id": str(b.constituent_id)},
        )
        assert resp.status_code == 400

    def test_create_relation_invalid_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        a = _make_constituent(db_session, org, name="A")
        b = _make_constituent(db_session, org, name="B")
        resp = auth_client.post(
            f"{_base(org)}/{a.constituent_id}/relations",
            json={
                "to_constituent_id": str(b.constituent_id),
                "relationship_type": "nemesis_of",
            },
        )
        assert resp.status_code == 400
        assert (
            resp.get_json().get("error", {}).get("code") == "INVALID_RELATIONSHIP_TYPE"
        )

    def test_create_relation_self(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        a = _make_constituent(db_session, org, name="Only Me")
        resp = auth_client.post(
            f"{_base(org)}/{a.constituent_id}/relations",
            json={
                "to_constituent_id": str(a.constituent_id),
                "relationship_type": "teacher_of",
            },
        )
        assert resp.status_code == 400
        assert resp.get_json().get("error", {}).get("code") == "SELF_RELATION"

    def test_create_relation_target_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        a = _make_constituent(db_session, org, name="A")
        resp = auth_client.post(
            f"{_base(org)}/{a.constituent_id}/relations",
            json={
                "to_constituent_id": str(uuid4()),
                "relationship_type": "teacher_of",
            },
        )
        assert resp.status_code == 404

    def test_create_relation_from_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        b = _make_constituent(db_session, org, name="B")
        resp = auth_client.post(
            f"{_base(org)}/{uuid4()}/relations",
            json={
                "to_constituent_id": str(b.constituent_id),
                "relationship_type": "teacher_of",
            },
        )
        assert resp.status_code == 404

    def test_delete_relation(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        a = _make_constituent(db_session, org, name="A")
        b = _make_constituent(db_session, org, name="B")
        rel = ConstituentRelation(
            organization_id=org.organization_id,
            from_constituent_id=a.constituent_id,
            to_constituent_id=b.constituent_id,
            relationship_type="sibling_of",
        )
        db_session.add(rel)
        db_session.commit()

        resp = auth_client.delete(
            f"{_base(org)}/{a.constituent_id}/relations/{rel.relation_id}"
        )
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        # Second delete: already gone.
        resp2 = auth_client.delete(
            f"{_base(org)}/{a.constituent_id}/relations/{rel.relation_id}"
        )
        assert resp2.status_code == 404


# ===========================================================================
# Object-scoped xrefs
# ===========================================================================


class TestObjectConstituents:
    def test_list_empty(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org)
        resp = auth_client.get(_object_constituents_url(org, str(obj.object_id)))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["object_id"] == str(obj.object_id)
        assert data["constituents"] == []

    def test_add_success(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org)
        c = _make_constituent(db_session, org, name="Maker")

        resp = auth_client.post(
            _object_constituents_url(org, str(obj.object_id)),
            json={
                "constituent_id": str(c.constituent_id),
                "role": "creator",
                "attribution_certainty": "certain",
                "display_order": 0,
                "notes": "Signed lower right.",
            },
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["role"] == "creator"
        assert body["constituent_id"] == str(c.constituent_id)
        assert body["entity_type"] == "collection_object"
        assert body["entity_id"] == str(obj.object_id)
        assert body["notes"] == "Signed lower right."
        assert body["constituent"]["name"] == "Maker"

        # List now returns the xref.
        list_resp = auth_client.get(
            _object_constituents_url(org, str(obj.object_id))
        ).get_json()
        assert len(list_resp["constituents"]) == 1
        assert list_resp["constituents"][0]["role"] == "creator"

    def test_add_missing_role(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org)
        c = _make_constituent(db_session, org, name="Maker")
        resp = auth_client.post(
            _object_constituents_url(org, str(obj.object_id)),
            json={"constituent_id": str(c.constituent_id)},
        )
        assert resp.status_code == 400
        assert resp.get_json().get("error", {}).get("code") == "MISSING_REQUIRED_FIELDS"

    def test_add_missing_constituent(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org)
        resp = auth_client.post(
            _object_constituents_url(org, str(obj.object_id)),
            json={"role": "creator"},
        )
        assert resp.status_code == 400

    def test_add_constituent_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org)
        resp = auth_client.post(
            _object_constituents_url(org, str(obj.object_id)),
            json={"constituent_id": str(uuid4()), "role": "creator"},
        )
        assert resp.status_code == 404

    def test_add_duplicate_returns_409(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org)
        c = _make_constituent(db_session, org, name="Dup")
        payload = {"constituent_id": str(c.constituent_id), "role": "creator"}

        first = auth_client.post(
            _object_constituents_url(org, str(obj.object_id)), json=payload
        )
        assert first.status_code == 201

        second = auth_client.post(
            _object_constituents_url(org, str(obj.object_id)), json=payload
        )
        assert second.status_code == 409
        assert second.get_json().get("error", {}).get("code") == "DUPLICATE"

    def test_update_xref(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org)
        c = _make_constituent(db_session, org, name="Maker")
        xref = _make_xref(
            db_session,
            org,
            constituent_id=c.constituent_id,
            entity_type="collection_object",
            entity_id=obj.object_id,
            role="creator",
        )

        resp = auth_client.put(
            _object_constituents_url(org, str(obj.object_id), f"/{xref.xref_id}"),
            json={
                "role_qualifier": "probable",
                "attribution_certainty": "probable",
                "display_order": 2,
                "notes": "Attribution revisited 2024.",
            },
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["role_qualifier"] == "probable"
        assert body["attribution_certainty"] == "probable"
        assert body["display_order"] == 2
        assert body["notes"] == "Attribution revisited 2024."

    def test_update_xref_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org)
        resp = auth_client.put(
            _object_constituents_url(org, str(obj.object_id), f"/{uuid4()}"),
            json={"role_qualifier": "probable"},
        )
        assert resp.status_code == 404

    def test_delete_xref(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_object(db_session, org)
        c = _make_constituent(db_session, org, name="Maker")
        xref = _make_xref(
            db_session,
            org,
            constituent_id=c.constituent_id,
            entity_type="collection_object",
            entity_id=obj.object_id,
            role="creator",
        )

        resp = auth_client.delete(
            _object_constituents_url(org, str(obj.object_id), f"/{xref.xref_id}")
        )
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        resp2 = auth_client.delete(
            _object_constituents_url(org, str(obj.object_id), f"/{xref.xref_id}")
        )
        assert resp2.status_code == 404


# ===========================================================================
# Generic xrefs
# ===========================================================================


class TestGenericXrefs:
    def test_list_missing_params(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_generic_xrefs_url(org))
        assert resp.status_code == 400
        assert resp.get_json().get("error", {}).get("code") == "MISSING_PARAMS"

    def test_list_with_filters(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(db_session, org, name="Lender LLC")
        entity_id = uuid4()
        _make_xref(
            db_session,
            org,
            constituent_id=c.constituent_id,
            entity_type="loan_in",
            entity_id=entity_id,
            role="lender",
        )
        _make_xref(
            db_session,
            org,
            constituent_id=c.constituent_id,
            entity_type="loan_in",
            entity_id=entity_id,
            role="courier",
        )

        resp = auth_client.get(
            _generic_xrefs_url(org)
            + f"?entity_type=loan_in&entity_id={entity_id}"
        )
        assert resp.status_code == 200
        assert len(resp.get_json()["xrefs"]) == 2

        # Role filter narrows.
        resp2 = auth_client.get(
            _generic_xrefs_url(org)
            + f"?entity_type=loan_in&entity_id={entity_id}&role=lender"
        )
        assert resp2.status_code == 200
        xrefs = resp2.get_json()["xrefs"]
        assert len(xrefs) == 1
        assert xrefs[0]["role"] == "lender"

        # Constituent filter.
        resp3 = auth_client.get(
            _generic_xrefs_url(org)
            + f"?entity_type=loan_in&entity_id={entity_id}"
            + f"&constituent_id={c.constituent_id}"
        )
        assert resp3.status_code == 200
        assert len(resp3.get_json()["xrefs"]) == 2

    def test_create_success(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(db_session, org, name="Lender LLC")
        entity_id = uuid4()
        resp = auth_client.post(
            _generic_xrefs_url(org),
            json={
                "constituent_id": str(c.constituent_id),
                "entity_type": "loan_in",
                "entity_id": str(entity_id),
                "role": "lender",
                "attribution_note": "Primary lender",
                "display_order": 0,
            },
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["entity_type"] == "loan_in"
        assert body["entity_id"] == str(entity_id)
        assert body["role"] == "lender"
        assert body["constituent"]["name"] == "Lender LLC"

    def test_create_missing_fields(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_generic_xrefs_url(org), json={})
        assert resp.status_code == 400
        assert resp.get_json().get("error", {}).get("code") == "MISSING_REQUIRED_FIELDS"

    def test_create_constituent_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _generic_xrefs_url(org),
            json={
                "constituent_id": str(uuid4()),
                "entity_type": "loan_in",
                "entity_id": str(uuid4()),
                "role": "lender",
            },
        )
        assert resp.status_code == 404

    def test_patch_xref(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(db_session, org, name="Lender")
        xref = _make_xref(
            db_session,
            org,
            constituent_id=c.constituent_id,
            entity_type="loan_in",
            entity_id=uuid4(),
            role="lender",
        )
        resp = auth_client.patch(
            _generic_xrefs_url(org, f"/{xref.xref_id}"),
            json={"notes": "Updated note", "display_order": 5},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["notes"] == "Updated note"
        assert body["display_order"] == 5

    def test_patch_xref_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.patch(
            _generic_xrefs_url(org, f"/{uuid4()}"),
            json={"notes": "x"},
        )
        assert resp.status_code == 404

    def test_delete_xref(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c = _make_constituent(db_session, org, name="Lender")
        xref = _make_xref(
            db_session,
            org,
            constituent_id=c.constituent_id,
            entity_type="loan_in",
            entity_id=uuid4(),
            role="lender",
        )
        resp = auth_client.delete(_generic_xrefs_url(org, f"/{xref.xref_id}"))
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        resp2 = auth_client.delete(_generic_xrefs_url(org, f"/{xref.xref_id}"))
        assert resp2.status_code == 404


# ===========================================================================
# Search (local only — avoids external ULAN/VIAF/LoC HTTP calls)
# ===========================================================================


class TestSearch:
    def test_search_requires_min_length(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{_base(org)}/search?q=a")
        assert resp.status_code == 400
        assert resp.get_json().get("error", {}).get("code") == "QUERY_TOO_SHORT"

    def test_search_local_only(self, auth_setup, db_session):
        """include_ulan=false keeps the search entirely in-process."""
        auth_client, org, _ = auth_setup
        _make_constituent(db_session, org, name="Findable Artist")
        _make_constituent(db_session, org, name="Another Person")

        resp = auth_client.get(
            f"{_base(org)}/search?q=findable&include_ulan=false"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["query"] == "findable"
        assert len(data["results"]) == 1
        assert data["results"][0]["source"] == "local"
        assert data["results"][0]["label"] == "Findable Artist"


# ===========================================================================
# Permission / auth enforcement
# ===========================================================================


class TestPermissions:
    def test_list_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.get(_base(org))
        assert resp.status_code == 401

    def test_create_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.post(
            _base(org),
            json={"name": "Anon", "constituent_type": "person"},
        )
        assert resp.status_code == 401

    def test_viewer_can_list(self, viewer_auth_setup):
        """Viewer has collections.view — list works."""
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.get(_base(org))
        assert resp.status_code == 200

    def test_viewer_cannot_create(self, viewer_auth_setup):
        """Viewer lacks collections.edit — create returns 403."""
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(
            _base(org),
            json={"name": "Blocked", "constituent_type": "person"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_update(self, viewer_auth_setup, db_session):
        auth_client, org, _ = viewer_auth_setup
        c = _make_constituent(db_session, org, name="Existing")
        resp = auth_client.patch(
            f"{_base(org)}/{c.constituent_id}",
            json={"name": "Changed"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_delete(self, viewer_auth_setup, db_session):
        auth_client, org, _ = viewer_auth_setup
        c = _make_constituent(db_session, org, name="Existing")
        resp = auth_client.delete(f"{_base(org)}/{c.constituent_id}")
        assert resp.status_code == 403

    def test_viewer_cannot_verify(self, viewer_auth_setup, db_session):
        auth_client, org, _ = viewer_auth_setup
        c = _make_constituent(db_session, org, name="Existing")
        resp = auth_client.post(f"{_base(org)}/{c.constituent_id}/verify")
        assert resp.status_code == 403

    def test_viewer_cannot_merge(self, viewer_auth_setup, db_session):
        auth_client, org, _ = viewer_auth_setup
        a = _make_constituent(db_session, org, name="A")
        b = _make_constituent(db_session, org, name="B")
        resp = auth_client.post(
            f"{_base(org)}/{a.constituent_id}/merge",
            json={"secondary_id": str(b.constituent_id)},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_create_relation(self, viewer_auth_setup, db_session):
        auth_client, org, _ = viewer_auth_setup
        a = _make_constituent(db_session, org, name="A")
        b = _make_constituent(db_session, org, name="B")
        resp = auth_client.post(
            f"{_base(org)}/{a.constituent_id}/relations",
            json={
                "to_constituent_id": str(b.constituent_id),
                "relationship_type": "teacher_of",
            },
        )
        assert resp.status_code == 403

    def test_viewer_can_get_enums(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.get(f"{_base(org)}/enums")
        assert resp.status_code == 200

    def test_viewer_can_list_object_constituents(self, viewer_auth_setup, db_session):
        auth_client, org, _ = viewer_auth_setup
        obj = _make_object(db_session, org)
        resp = auth_client.get(_object_constituents_url(org, str(obj.object_id)))
        assert resp.status_code == 200

    def test_viewer_cannot_add_object_constituent(self, viewer_auth_setup, db_session):
        auth_client, org, _ = viewer_auth_setup
        obj = _make_object(db_session, org)
        c = _make_constituent(db_session, org, name="Target")
        resp = auth_client.post(
            _object_constituents_url(org, str(obj.object_id)),
            json={"constituent_id": str(c.constituent_id), "role": "creator"},
        )
        assert resp.status_code == 403
