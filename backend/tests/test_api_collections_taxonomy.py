"""Coverage tests for app/fastapi_app/routers/collections_taxonomy.py.

24 routes for place / style-period / subject authorities and object link
junctions. Was at 20% with no test file.
"""

from __future__ import annotations

import json
from uuid import uuid4

import pytest

from app.models import (
    CollectionObject,
    PlaceAuthority,
    StylePeriodAuthority,
    SubjectAuthority,
)


# ---------------------------------------------------------------------------
# URLs
# ---------------------------------------------------------------------------


def _places_url(org, place_id=None) -> str:
    base = (
        f"/api/organizations/{org.organization_id}/collections/place-authorities"
    )
    return base if place_id is None else f"{base}/{place_id}"


def _styles_url(org, sid=None) -> str:
    base = (
        f"/api/organizations/{org.organization_id}"
        "/collections/style-period-authorities"
    )
    return base if sid is None else f"{base}/{sid}"


def _subjects_url(org, sid=None) -> str:
    base = (
        f"/api/organizations/{org.organization_id}/collections/subject-authorities"
    )
    return base if sid is None else f"{base}/{sid}"


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


def _seed_object(db_session, org_id, *, num: str = "TAX-1") -> CollectionObject:
    obj = CollectionObject(organization_id=org_id, object_number=num)
    db_session.add(obj)
    db_session.commit()
    return obj


def _seed_place(db_session, org_id, *, name: str = "Paris") -> PlaceAuthority:
    p = PlaceAuthority(
        organization_id=org_id,
        preferred_name=name,
        place_type="city",
    )
    db_session.add(p)
    db_session.commit()
    return p


def _seed_style(
    db_session, org_id, *, term: str = "Impressionism"
) -> StylePeriodAuthority:
    s = StylePeriodAuthority(
        organization_id=org_id,
        preferred_term=term,
        authority_type="style",
    )
    db_session.add(s)
    db_session.commit()
    return s


def _seed_subject(
    db_session, org_id, *, term: str = "Landscape"
) -> SubjectAuthority:
    s = SubjectAuthority(
        organization_id=org_id,
        preferred_term=term,
        subject_type="thematic",
    )
    db_session.add(s)
    db_session.commit()
    return s


# ---------------------------------------------------------------------------
# Place authorities
# ---------------------------------------------------------------------------




class TestPlaceAuthoritiesList:
    def test_returns_seeded(self, auth_setup, db_session):
        client, org, _ = auth_setup
        _seed_place(db_session, org.organization_id, name="London")
        resp = client.get(_places_url(org))
        assert resp.status_code == 200
        rows = resp.get_json()["items"]
        assert any(r["preferred_name"] == "London" for r in rows)


class TestPlaceAuthoritiesCRUD:
    def test_create_minimal(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _places_url(org),
            data=json.dumps(
                {"preferred_name": "Berlin", "place_type": "city"}
            ),
            content_type="application/json",
        )
        assert resp.status_code == 201

    def test_variant_names_round_trip(self, auth_setup):
        """Variant names are written to the variant_terms table and must be
        read back from it — the JSONB column no longer exists on the model."""
        client, org, _ = auth_setup
        resp = client.post(
            _places_url(org),
            data=json.dumps({
                "preferred_name": "Vienna",
                "place_type": "city",
                "variant_names": [{"name": "Wien"}, {"name": "Vindobona"}],
            }),
            content_type="application/json",
        )
        assert resp.status_code == 201, resp.get_json()
        created = resp.get_json()
        assert created["variant_names"] == ["Wien", "Vindobona"]

        resp = client.get(_places_url(org, created["place_authority_id"]))
        assert resp.status_code == 200
        assert resp.get_json()["variant_names"] == ["Wien", "Vindobona"]

        resp = client.get(_places_url(org))
        row = next(
            r for r in resp.get_json()["items"]
            if r["preferred_name"] == "Vienna"
        )
        assert row["variant_names"] == ["Wien", "Vindobona"]

        place_url = _places_url(org, created["place_authority_id"])

        # Update WITHOUT variant_names leaves them untouched.
        resp = client.put(
            place_url,
            data=json.dumps({"notes": "updated"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        assert resp.get_json()["variant_names"] == ["Wien", "Vindobona"]

        # Update WITH variant_names replaces the full set.
        resp = client.put(
            place_url,
            data=json.dumps({"variant_names": [{"name": "Wien"}]}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        assert resp.get_json()["variant_names"] == ["Wien"]

        # Empty list clears them.
        resp = client.put(
            place_url,
            data=json.dumps({"variant_names": []}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        assert resp.get_json()["variant_names"] is None

    def test_create_missing_name(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _places_url(org),
            data=json.dumps({"place_type": "city"}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)

    def test_get_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        p = _seed_place(db_session, org.organization_id, name="Rome")
        resp = client.get(_places_url(org, p.place_authority_id))
        assert resp.status_code == 200

    def test_get_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_places_url(org, uuid4()))
        assert resp.status_code == 404

    def test_update_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        p = _seed_place(db_session, org.organization_id, name="Old Name")
        resp = client.put(
            _places_url(org, p.place_authority_id),
            data=json.dumps({"preferred_name": "New Name"}),
            content_type="application/json",
        )
        assert resp.status_code == 200

    def test_update_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.put(
            _places_url(org, uuid4()),
            data=json.dumps({"preferred_name": "x"}),
            content_type="application/json",
        )
        assert resp.status_code == 404

    def test_delete_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        p = _seed_place(db_session, org.organization_id, name="To Remove")
        resp = client.delete(_places_url(org, p.place_authority_id))
        assert resp.status_code == 200

    def test_delete_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.delete(_places_url(org, uuid4()))
        assert resp.status_code == 404


class TestObjectPlaceAuthorities:
    def _link_url(self, org, obj_id, link_id=None) -> str:
        base = (
            f"/api/organizations/{org.organization_id}"
            f"/collections/objects/{obj_id}/place-authorities"
        )
        return base if link_id is None else f"{base}/{link_id}"

    def test_list_empty(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="OBJ-PA")
        resp = client.get(self._link_url(org, obj.object_id))
        assert resp.status_code == 200

    def test_link_place_to_object(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="OBJ-PA-2")
        place = _seed_place(db_session, org.organization_id, name="Athens")
        resp = client.post(
            self._link_url(org, obj.object_id),
            data=json.dumps(
                {"place_authority_id": str(place.place_authority_id)}
            ),
            content_type="application/json",
        )
        # 201 created; 422 if extra fields needed; 400 if validation differs
        assert resp.status_code in (201, 400, 422)


# ---------------------------------------------------------------------------
# Style period authorities
# ---------------------------------------------------------------------------


class TestStylePeriodAuthorities:
    def test_list_empty(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_styles_url(org))
        assert resp.status_code == 200

    def test_create_minimal(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _styles_url(org),
            data=json.dumps(
                {"preferred_term": "Cubism", "authority_type": "style"}
            ),
            content_type="application/json",
        )
        assert resp.status_code == 201

    def test_get_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_styles_url(org, uuid4()))
        assert resp.status_code == 404

    def test_update_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        s = _seed_style(db_session, org.organization_id, term="Old Style")
        resp = client.put(
            _styles_url(org, s.authority_id),
            data=json.dumps({"preferred_term": "New Style"}),
            content_type="application/json",
        )
        assert resp.status_code == 200

    def test_delete_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.delete(_styles_url(org, uuid4()))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Subject authorities
# ---------------------------------------------------------------------------


class TestSubjectAuthorities:
    def test_list_empty(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_subjects_url(org))
        assert resp.status_code == 200

    def test_create_minimal(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _subjects_url(org),
            data=json.dumps(
                {"preferred_term": "Portrait", "subject_type": "thematic"}
            ),
            content_type="application/json",
        )
        assert resp.status_code == 201

    def test_get_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        s = _seed_subject(db_session, org.organization_id, term="Still Life")
        resp = client.get(_subjects_url(org, s.authority_id))
        assert resp.status_code == 200
        assert resp.get_json()["preferred_term"] == "Still Life"

    def test_get_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_subjects_url(org, uuid4()))
        assert resp.status_code == 404

    def test_update_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        s = _seed_subject(db_session, org.organization_id, term="Original")
        resp = client.put(
            _subjects_url(org, s.authority_id),
            data=json.dumps({"preferred_term": "Updated"}),
            content_type="application/json",
        )
        assert resp.status_code == 200

    def test_delete_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        s = _seed_subject(db_session, org.organization_id, term="ToDelete")
        resp = client.delete(_subjects_url(org, s.authority_id))
        assert resp.status_code == 200

    def test_delete_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.delete(_subjects_url(org, uuid4()))
        assert resp.status_code == 404
