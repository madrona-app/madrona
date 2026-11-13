"""Library of Congress Subject Headings lookup (id.loc.gov suggest2), HTTP mocked."""
from unittest.mock import MagicMock, patch

import pytest
import requests

from app.schemas.authority_backed import AuthoritySource, parse_authority_uri
from app.services.external_lookups import (
    LCSH_SUGGEST_URL,
    LCSHLookupError,
    lookup_lcsh,
    parse_lcsh_suggest2,
)

# Shape of a real suggest2 keyword response (trimmed).
SUGGEST2_BLIND = {
    "q": "blind",
    "count": 4,
    "pagesize": 10,
    "start": 1,
    "sortmethod": "rank",
    "searchtype": "keyword",
    "directory": "/authorities/subjects/",
    "hits": [
        {
            "suggestLabel": "Blind",
            "uri": "http://id.loc.gov/authorities/subjects/sh85014832",
            "aLabel": "Blind",
            "token": "sh85014832",
            "vLabel": "",
            "code": "",
            "rank": "",
        },
        {
            "suggestLabel": "Blind--Education (USE Blind--Education)",
            "uri": "http://id.loc.gov/authorities/subjects/sh85014839",
            "aLabel": "Blind--Education",
            "token": "sh85014839",
            "vLabel": "Education of the blind",
        },
        # Duplicate hit for the same heading via another variant
        {
            "uri": "http://id.loc.gov/authorities/subjects/sh85014832",
            "aLabel": "Blind",
            "vLabel": "Blind people",
        },
        # Not an LCSH subject URI: skipped
        {"uri": "http://id.loc.gov/authorities/childrensSubjects/sj96004895", "aLabel": "Blind"},
        # Missing label: skipped
        {"uri": "http://id.loc.gov/authorities/subjects/sh00000001", "aLabel": ""},
    ],
}


def _response(status=200, payload=None, json_error=False):
    resp = MagicMock()
    resp.status_code = status
    if json_error:
        resp.json.side_effect = ValueError("not json")
    else:
        resp.json.return_value = payload if payload is not None else {}
    return resp


class TestParse:
    def test_parses_hits_dedupes_and_skips_non_subjects(self):
        out = parse_lcsh_suggest2(SUGGEST2_BLIND)
        assert out == [
            {
                "id": "sh85014832",
                "label": "Blind",
                "uri": "http://id.loc.gov/authorities/subjects/sh85014832",
                "matched_variant": None,
            },
            {
                "id": "sh85014839",
                "label": "Blind--Education",
                "uri": "http://id.loc.gov/authorities/subjects/sh85014839",
                "matched_variant": "Education of the blind",
            },
        ]

    def test_normalizes_https_uri(self):
        out = parse_lcsh_suggest2({"hits": [{"uri": "https://id.loc.gov/authorities/subjects/sh85058882", "aLabel": "Harbors"}]})
        assert out[0]["uri"] == "http://id.loc.gov/authorities/subjects/sh85058882"

    def test_respects_limit(self):
        assert len(parse_lcsh_suggest2(SUGGEST2_BLIND, limit=1)) == 1

    @pytest.mark.parametrize("payload", [None, [], "x", {"hits": None}, {"hits": ["x", 3]}, {}])
    def test_tolerates_malformed(self, payload):
        assert parse_lcsh_suggest2(payload) == []


class TestLookup:
    @patch("app.services.external_lookups.requests.get")
    def test_calls_suggest2_keyword_with_timeout(self, mock_get):
        mock_get.return_value = _response(payload=SUGGEST2_BLIND)
        out = lookup_lcsh("  blind ", limit=5)
        assert [r["id"] for r in out] == ["sh85014832", "sh85014839"]
        args, kwargs = mock_get.call_args
        assert args[0] == LCSH_SUGGEST_URL == "https://id.loc.gov/authorities/subjects/suggest2"
        assert kwargs["params"] == {"q": "blind", "searchtype": "keyword", "count": 5}
        assert kwargs["timeout"] > 0
        assert kwargs["headers"]["User-Agent"]

    @patch("app.services.external_lookups.requests.get")
    def test_short_query_makes_no_request(self, mock_get):
        assert lookup_lcsh("b") == []
        mock_get.assert_not_called()

    @patch("app.services.external_lookups.requests.get")
    @pytest.mark.parametrize("resp", [_response(status=503), _response(json_error=True)])
    def test_bad_responses_raise(self, mock_get, resp):
        mock_get.return_value = resp
        with pytest.raises(LCSHLookupError):
            lookup_lcsh("blind")

    @patch("app.services.external_lookups.requests.get", side_effect=requests.Timeout("slow"))
    def test_timeout_raises(self, _mock_get):
        with pytest.raises(LCSHLookupError):
            lookup_lcsh("blind")


def test_parse_authority_uri_recognizes_lcsh():
    assert parse_authority_uri("http://id.loc.gov/authorities/subjects/sh85014832") == (
        AuthoritySource.LOC_SUBJECTS, "sh85014832",
    )


@patch("app.fastapi_app.routers.autocomplete._set_cached")
@patch("app.fastapi_app.routers.autocomplete._get_cached", return_value=None)
class TestEndpoints:
    @patch("app.services.external_lookups.requests.get")
    def test_lcsh_endpoint_returns_suggestions_with_uri(self, mock_get, _get, _set, auth_setup):
        mock_get.return_value = _response(payload=SUGGEST2_BLIND)
        client, _, _ = auth_setup
        resp = client.get("/api/autocomplete/lcsh?q=blind")
        assert resp.status_code == 200, resp.get_json()
        body = resp.get_json()
        assert body["warnings"] is None
        first = body["suggestions"][0]
        assert first["id"] == "lcsh-sh85014832"
        assert first["label"] == "Blind"
        assert first["source"] == "loc"
        assert first["reference"] == {
            "uri": "http://id.loc.gov/authorities/subjects/sh85014832",
            "source": "LCSH",
            "label": "Blind",
            "match_confidence": "exact",
        }
        assert "Education of the blind" in body["suggestions"][1]["description"]
        _set.assert_called_once()

    @patch("app.services.external_lookups.requests.get", side_effect=requests.ConnectionError("down"))
    def test_lcsh_endpoint_degrades_when_loc_is_down(self, _mock_get, _get, _set, auth_setup):
        client, _, _ = auth_setup
        resp = client.get("/api/autocomplete/lcsh?q=blind")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["suggestions"] == []
        assert body["warnings"]
        _set.assert_not_called()

    def test_lcsh_endpoint_requires_query(self, _get, _set, auth_setup):
        client, _, _ = auth_setup
        assert client.get("/api/autocomplete/lcsh?q=b").status_code == 400

    def test_lcsh_endpoint_requires_auth(self, _get, _set, client):
        assert client.get("/api/autocomplete/lcsh?q=blind").status_code == 401

    @patch("app.fastapi_app.routers.autocomplete.search_wikidata", return_value=[])
    @patch("app.fastapi_app.routers.autocomplete.search_iconclass", return_value=[])
    @patch("app.fastapi_app.routers.autocomplete.search_getty_aat", return_value=[{
        "id": "aat-300008036", "label": "blind", "source": "getty", "score": 0.9,
        "reference": {"uri": "http://vocab.getty.edu/aat/300008036", "source": "AAT"},
    }])
    @patch("app.services.external_lookups.requests.get")
    def test_subject_search_includes_lcsh_beside_same_label_aat(self, mock_get, _aat, _ic, _wd, _get, _set, auth_setup):
        mock_get.return_value = _response(payload=SUGGEST2_BLIND)
        client, org, _ = auth_setup
        resp = client.post("/api/autocomplete/search", json={
            "query": "blind", "field_type": "subject",
            "organization_id": str(org.organization_id), "sources": ["external"], "limit": 10,
        })
        assert resp.status_code == 200, resp.get_json()
        refs = [(s["label"], (s.get("reference") or {}).get("source")) for s in resp.get_json()["suggestions"]]
        assert ("Blind", "LCSH") in refs
        assert ("blind", "AAT") in refs
