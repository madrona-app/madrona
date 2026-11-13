"""Strict vocabulary validation, switchable per field (org setting)."""
import json
from unittest.mock import patch

import pytest

from app.services.vocabulary_validation import (
    STRICT_VOCABULARY_FIELDS,
    authority_source_for_uri,
    find_invalid_values,
)


def _objects(org):
    return f"/api/organizations/{org.organization_id}/collections/objects"


def _settings(org):
    return f"/api/organizations/{org.organization_id}/settings/vocabulary-validation"


def _post(client, url, body):
    return client.post(url, data=json.dumps(body), content_type="application/json")


def _put(client, url, body):
    return client.put(url, data=json.dumps(body), content_type="application/json")


def _make_term(db_session, org_id, term, vocabulary="local", alternate=None, uri=None):
    from app.models import VocabularyTerm

    t = VocabularyTerm(
        organization_id=org_id, vocabulary=vocabulary, preferred_term=term,
        alternate_terms=alternate, external_uri=uri, status="active",
    )
    db_session.add(t)
    db_session.commit()
    return t


def _make_lookup(db_session, org_id, category_key, value_key, label):
    from app.models import LookupCategory, LookupValue

    cat = db_session.query(LookupCategory).filter_by(category_key=category_key).first()
    if not cat:
        cat = LookupCategory(category_key=category_key, display_name=category_key, applicable_contexts=["objects"])
        db_session.add(cat)
        db_session.flush()
    db_session.add(LookupValue(category_id=cat.category_id, organization_id=org_id, value_key=value_key, label=label))
    db_session.commit()


class TestAuthorityUriRecognition:
    @pytest.mark.parametrize("uri,source", [
        ("http://vocab.getty.edu/aat/300015050", "AAT"),
        ("http://vocab.getty.edu/page/aat/300015050", "AAT"),
        ("http://id.loc.gov/authorities/subjects/sh85076723", "LCSH"),
        ("https://id.loc.gov/authorities/names/n79021164", "LCNAF"),
        ("https://www.wikidata.org/entity/Q296", "Wikidata"),
        ("http://viaf.org/viaf/36915266", "VIAF"),
    ])
    def test_recognized(self, uri, source):
        assert authority_source_for_uri(uri) == source

    @pytest.mark.parametrize("uri", [
        "https://vocab.getty.edu.evil.example/aat/1",
        "http://example.org/aat/300015050",
        "javascript:alert(1)",
        "not a uri",
    ])
    def test_unrecognized(self, uri):
        assert authority_source_for_uri(uri) is None


@patch("app.fastapi_app.routers.collections_objects._index_collection_object")
@patch("app.fastapi_app.routers.collections_objects._reindex_linked_media")
class TestStrictObjectWrites:
    def _strict(self, client, org, **fields):
        resp = _put(client, _settings(org), fields)
        assert resp.status_code == 200, resp.get_json()

    def test_lenient_by_default_accepts_free_text(self, _m, _i, auth_setup):
        client, org, _ = auth_setup
        resp = _post(client, _objects(org), {
            "object_number": "V.1", "materials": [{"name": "mystery goo"}],
            "depicted_concepts": ["something new"],
        })
        assert resp.status_code == 201, resp.get_json()

    def test_settings_default_off_for_every_field(self, _m, _i, auth_setup):
        client, org, _ = auth_setup
        fields = _get_fields(client, org)
        assert set(fields) == set(STRICT_VOCABULARY_FIELDS)
        assert not any(f["strict"] for f in fields.values())

    def test_strict_materials_rejects_unknown_free_text(self, _m, _i, auth_setup):
        client, org, _ = auth_setup
        self._strict(client, org, materials=True)
        resp = _post(client, _objects(org), {"object_number": "V.2", "materials": [{"name": "mystery goo"}]})
        assert resp.status_code == 422
        detail = resp.get_json()["error"]
        assert detail["code"] == "vocabulary_validation_error"
        assert detail["field"] == "materials"
        assert "Materials" in detail["message"] and "mystery goo" in detail["message"]
        assert detail["errors"][0]["invalid_values"] == ["mystery goo"]

    def test_strict_materials_accepts_vocabulary_term_text(self, _m, _i, auth_setup, db_session):
        client, org, _ = auth_setup
        _make_term(db_session, org.organization_id, "Oil Paint", vocabulary="aat")
        self._strict(client, org, materials=True)
        resp = _post(client, _objects(org), {"object_number": "V.3", "materials": [{"name": "oil paint", "part": "medium"}]})
        assert resp.status_code == 201, resp.get_json()

    def test_strict_materials_accepts_alternate_term(self, _m, _i, auth_setup, db_session):
        client, org, _ = auth_setup
        _make_term(db_session, org.organization_id, "tempera", alternate=["Egg Tempera"])
        self._strict(client, org, materials=True)
        resp = _post(client, _objects(org), {"object_number": "V.3b", "materials": [{"name": "egg tempera"}]})
        assert resp.status_code == 201, resp.get_json()

    def test_strict_materials_accepts_linked_authority_uri(self, _m, _i, auth_setup):
        client, org, _ = auth_setup
        self._strict(client, org, materials=True)
        resp = _post(client, _objects(org), {"object_number": "V.4", "materials": [
            {"name": "bronze", "vocabulary_term_id": "http://vocab.getty.edu/aat/300010957"},
        ]})
        assert resp.status_code == 201, resp.get_json()

    def test_strict_rejects_authority_from_wrong_source(self, _m, _i, auth_setup):
        client, org, _ = auth_setup
        self._strict(client, org, materials=True)
        resp = _post(client, _objects(org), {"object_number": "V.4b", "materials": [
            {"name": "bronze", "authorities": [{"uri": "http://id.loc.gov/authorities/names/n79021164", "source": "LCNAF"}]},
        ]})
        assert resp.status_code == 422

    def test_strict_only_affects_that_field(self, _m, _i, auth_setup):
        client, org, _ = auth_setup
        self._strict(client, org, materials=True)
        resp = _post(client, _objects(org), {"object_number": "V.5", "techniques": [{"name": "made up"}]})
        assert resp.status_code == 201, resp.get_json()

    def test_strict_string_list_field(self, _m, _i, auth_setup, db_session):
        client, org, _ = auth_setup
        _make_term(db_session, org.organization_id, "justice")
        self._strict(client, org, depicted_concepts=True)
        ok = _post(client, _objects(org), {"object_number": "V.6", "depicted_concepts": ["Justice"]})
        assert ok.status_code == 201, ok.get_json()
        bad = _post(client, _objects(org), {"object_number": "V.7", "depicted_concepts": ["Justice", "vibes"]})
        assert bad.status_code == 422
        assert bad.get_json()["error"]["field"] == "depicted_concepts"
        assert bad.get_json()["error"]["errors"][0]["invalid_values"] == ["vibes"]

    def test_strict_subjects_accepts_lcsh_uri_and_subject_authority(self, _m, _i, auth_setup, db_session):
        from app.models.authorities import SubjectAuthority

        client, org, _ = auth_setup
        db_session.add(SubjectAuthority(organization_id=org.organization_id, preferred_term="Harbors"))
        db_session.commit()
        self._strict(client, org, subjects=True)
        resp = _post(client, _objects(org), {"object_number": "V.8", "subjects": [
            {"term": "Blind", "vocabulary_term_id": "http://id.loc.gov/authorities/subjects/sh85014832"},
            "harbors",
        ]})
        assert resp.status_code == 201, resp.get_json()

    def test_strict_lookup_field_object_type(self, _m, _i, auth_setup, db_session):
        client, org, _ = auth_setup
        _make_lookup(db_session, org.organization_id, "object_type", "painting", "Painting")
        self._strict(client, org, object_type=True)
        assert _post(client, _objects(org), {"object_number": "V.9", "object_type": "painting"}).status_code == 201
        assert _post(client, _objects(org), {"object_number": "V.10", "object_type": "Painting"}).status_code == 201
        bad = _post(client, _objects(org), {"object_number": "V.11", "object_type": "spaceship"})
        assert bad.status_code == 422
        assert "Object type" in bad.get_json()["error"]["message"]

    def test_strict_creators_accepts_constituent_or_authority(self, _m, _i, auth_setup, db_session):
        from app.models.contacts import Constituent

        client, org, _ = auth_setup
        db_session.add(Constituent(organization_id=org.organization_id, name="Jacobus tenBroek", constituent_type="person"))
        db_session.commit()
        self._strict(client, org, creators=True)
        ok = _post(client, _objects(org), {"object_number": "V.12", "creators": [
            {"name": "jacobus tenbroek"}, {"name": "Claude Monet", "ulan_id": "500019484"},
        ]})
        assert ok.status_code == 201, ok.get_json()
        bad = _post(client, _objects(org), {"object_number": "V.13", "creators": [{"name": "Nobody Known"}]})
        assert bad.status_code == 422

    def test_update_rejects_new_value_but_grandfathers_existing(self, _m, _i, auth_setup):
        client, org, _ = auth_setup
        # Legacy free-text value saved while lenient
        oid = _post(client, _objects(org), {"object_number": "V.14", "materials": [{"name": "legacy goo"}]}).get_json()["object_id"]
        self._strict(client, org, materials=True)
        # Re-saving the unchanged legacy value (as the editor does on any save) is allowed
        same = _put(client, f"{_objects(org)}/{oid}", {"object_name": "Renamed", "materials": [{"name": "legacy goo"}]})
        assert same.status_code == 200, same.get_json()
        # Adding a new unknown value is rejected and nothing is written
        bad = _put(client, f"{_objects(org)}/{oid}", {"object_name": "Again", "materials": [{"name": "legacy goo"}, {"name": "new goo"}]})
        assert bad.status_code == 422
        assert bad.get_json()["error"]["errors"][0]["invalid_values"] == ["new goo"]
        got = client.get(f"{_objects(org)}/{oid}").get_json()
        assert got["object_name"] == "Renamed"

    def test_toggle_off_allows_again(self, _m, _i, auth_setup):
        client, org, _ = auth_setup
        self._strict(client, org, materials=True)
        assert _post(client, _objects(org), {"object_number": "V.15", "materials": [{"name": "goo"}]}).status_code == 422
        self._strict(client, org, materials=False)
        assert _post(client, _objects(org), {"object_number": "V.15", "materials": [{"name": "goo"}]}).status_code == 201


def _get_fields(client, org):
    resp = client.get(_settings(org))
    assert resp.status_code == 200, resp.get_json()
    return {f["key"]: f for f in resp.get_json()["fields"]}


class TestSettingsEndpoint:
    def test_put_rejects_unknown_field_and_non_bool(self, auth_setup):
        client, org, _ = auth_setup
        assert _put(client, _settings(org), {"title": True}).status_code == 422
        assert _put(client, _settings(org), {"materials": "yes"}).status_code == 422

    def test_put_persists_and_returns_state(self, auth_setup):
        client, org, _ = auth_setup
        resp = _put(client, _settings(org), {"subjects": True})
        assert resp.status_code == 200
        fields = {f["key"]: f for f in resp.get_json()["fields"]}
        assert fields["subjects"]["strict"] is True
        assert _get_fields(client, org)["subjects"]["strict"] is True

    def test_viewer_can_read_but_not_change(self, viewer_auth_setup):
        client, org, _ = viewer_auth_setup
        assert client.get(_settings(org)).status_code == 200
        assert _put(client, _settings(org), {"materials": True}).status_code == 403


class TestFindInvalidValues:
    def test_blank_values_ignored(self, db_session):
        import uuid

        spec = STRICT_VOCABULARY_FIELDS["materials"]
        assert find_invalid_values(db_session, uuid.uuid4(), spec, [{"name": ""}, None, {"part": "x"}]) == []
