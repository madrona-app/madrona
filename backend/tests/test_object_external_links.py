"""External links on object records (e.g. a Wikipedia page)."""
import json
from unittest.mock import patch

import pytest

from app.services.external_links import ExternalLinkError, normalize_external_links


def _url(org):
    return f"/api/organizations/{org.organization_id}/collections/objects"


class TestNormalize:
    def test_accepts_links_and_defaults(self):
        out = normalize_external_links([
            {"url": " https://en.wikipedia.org/wiki/Jacobus_tenBroek ", "label": "Wikipedia", "link_type": "wikipedia"},
            "http://example.org/a",
        ])
        assert out == [
            {"url": "https://en.wikipedia.org/wiki/Jacobus_tenBroek", "label": "Wikipedia", "link_type": "wikipedia"},
            {"url": "http://example.org/a", "label": "", "link_type": "other"},
        ]

    def test_blank_rows_dropped_and_empty_is_none(self):
        assert normalize_external_links([{"url": "", "label": ""}]) is None
        assert normalize_external_links([]) is None
        assert normalize_external_links(None) is None

    @pytest.mark.parametrize("bad", [
        "javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<script>", "//evil.example",
        "ftp://example.org", "example.org", "https://",
    ])
    def test_rejects_non_http_urls(self, bad):
        with pytest.raises(ExternalLinkError):
            normalize_external_links([{"url": bad}])

    def test_label_without_url_rejected(self):
        with pytest.raises(ExternalLinkError):
            normalize_external_links([{"url": "", "label": "Wikipedia"}])

    def test_not_a_list(self):
        with pytest.raises(ExternalLinkError):
            normalize_external_links({"url": "https://a.org"})


@patch("app.fastapi_app.routers.collections_objects._index_collection_object")
class TestApi:
    def test_create_update_read_round_trip(self, _idx, auth_setup):
        client, org, _ = auth_setup
        links = [{"url": "https://en.wikipedia.org/wiki/National_Federation_of_the_Blind", "label": "Wikipedia", "link_type": "wikipedia"}]
        resp = client.post(_url(org), data=json.dumps({"object_number": "EXT.1", "object_name": "Banner", "external_links": links}), content_type="application/json")
        assert resp.status_code == 201, resp.get_json()
        oid = resp.get_json()["object_id"]

        got = client.get(f"{_url(org)}/{oid}").get_json()
        assert got["external_links"] == links

        resp = client.put(f"{_url(org)}/{oid}", data=json.dumps({"external_links": []}), content_type="application/json")
        assert resp.status_code == 200
        assert resp.get_json()["external_links"] == []

    def test_put_rejects_javascript_url(self, _idx, auth_setup):
        client, org, _ = auth_setup
        oid = client.post(_url(org), data=json.dumps({"object_number": "EXT.2", "object_name": "x"}), content_type="application/json").get_json()["object_id"]
        resp = client.put(f"{_url(org)}/{oid}", data=json.dumps({"external_links": [{"url": "javascript:alert(1)"}]}), content_type="application/json")
        assert resp.status_code == 422
        assert "external_links" in json.dumps(resp.get_json())

    def test_post_rejects_javascript_url(self, _idx, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(_url(org), data=json.dumps({"object_number": "EXT.3", "object_name": "x", "external_links": ["javascript:alert(1)"]}), content_type="application/json")
        assert resp.status_code == 422
