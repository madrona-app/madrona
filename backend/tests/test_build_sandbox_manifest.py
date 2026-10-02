"""Unit tests for the per-source mapper functions in
backend/scripts/build_sandbox_manifest.py.

These cover the pure-Python field-mapping logic that the bootstrap
script uses to transform upstream API records into manifest entries.
Network calls and S3 uploads are not exercised here — those are
covered by the bootstrap's own integration with the live APIs,
which we test by inspection of the produced manifest files.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from scripts import build_sandbox_manifest as bsm  # noqa: E402


# ---------------------------------------------------------------------------
# Met mapper
# ---------------------------------------------------------------------------


class TestMetMapper:
    def _sample(self) -> dict:
        return {
            "objectID": 436535,
            "isPublicDomain": True,
            "title": "Wheat Field with Cypresses",
            "artistDisplayName": "Vincent van Gogh",
            "artistRole": "Artist",
            "artistULAN_URL": "https://vocab.getty.edu/ulan/500115588",
            "objectName": "Painting",
            "department": "European Paintings",
            "medium": "Oil on canvas",
            "tags": [{"term": "Landscape"}, {"term": "Trees"}],
            "objectBeginDate": 1889,
            "objectEndDate": 1889,
            "objectDate": "1889",
            "culture": "Dutch",
            "creditLine": "Purchase, ... 1993",
            "dimensions": "73 x 92 cm",
            "period": "Post-Impressionism",
            "primaryImage": "https://images.metmuseum.org/.../wheat.jpg",
        }

    def test_should_not_skip_when_public_domain_with_image(self):
        assert bsm._met_should_skip(self._sample()) is None

    def test_skip_when_not_public_domain(self):
        data = self._sample()
        data["isPublicDomain"] = False
        assert "public domain" in bsm._met_should_skip(data)

    def test_skip_when_no_primary_image(self):
        data = self._sample()
        data["primaryImage"] = ""
        assert "primaryImage" in bsm._met_should_skip(data)

    def test_image_url(self):
        assert bsm._met_image_url(self._sample()) == self._sample()["primaryImage"]

    def test_map_extracts_object_fields(self):
        out = bsm._met_map(self._sample())
        assert out["object_name"] == "Painting"
        assert out["responsible_department"] == "European Paintings"
        assert out["object_type"] == "Painting"
        assert out["materials"] == [{"name": "Oil on canvas", "part": None, "vocabulary_term_id": None}]
        assert out["physical_description"] == "73 x 92 cm"
        assert out["style_period"] == "Post-Impressionism"
        assert out["creation_date_display"] == "1889"
        assert out["creation_place"] == "Dutch"
        assert out["credit_line"] == "Purchase, ... 1993"
        assert out["object_status"] == "accessioned"

    def test_map_extracts_creators_with_ulan(self):
        creators = bsm._met_map(self._sample())["creators"]
        assert len(creators) == 1
        c = creators[0]
        assert c["name"] == "Vincent van Gogh"
        assert c["role"] == "Artist"
        assert c["ulan_id"] == "500115588"

    def test_map_extracts_subjects_from_tags(self):
        subjects = bsm._met_map(self._sample())["subjects"]
        assert {s["term"] for s in subjects} == {"Landscape", "Trees"}
        assert all(s["type"] == "topic" for s in subjects)

    def test_map_coerces_iso_dates_from_year_range(self):
        out = bsm._met_map(self._sample())
        assert out["creation_date_earliest"] == "1889-01-01"
        assert out["creation_date_latest"] == "1889-12-31"

    def test_map_handles_missing_optional_fields(self):
        bare = {"objectID": 1, "isPublicDomain": True, "primaryImage": "u"}
        out = bsm._met_map(bare)
        assert out["object_name"] is None
        assert out["creators"] is None
        assert out["materials"] is None
        assert out["subjects"] is None

    def test_map_does_not_emit_legacy_titles_or_classifications(self):
        """`titles` and `classifications` were extracted to link tables;
        passing them to CollectionObject() raises TypeError. The mapper
        must not include them in the column-kwargs payload."""
        out = bsm._met_map(self._sample())
        assert "titles" not in out
        assert "classifications" not in out

    def test_titles_emits_primary_preferred(self):
        titles = bsm._met_titles(self._sample())
        assert titles == [
            {"title": "Wheat Field with Cypresses", "title_type": "primary", "is_preferred": True},
        ]

    def test_titles_falls_back_to_untitled(self):
        no_title = {"objectID": 1}
        titles = bsm._met_titles(no_title)
        assert titles[0]["title"] == "Untitled"

    def test_media_shape(self):
        media = bsm._met_media(self._sample(), "sandbox-fixtures/met/436535.jpg", 12345)
        assert media["s3_key"] == "sandbox-fixtures/met/436535.jpg"
        assert media["file_size"] == 12345
        assert media["mime_type"] == "image/jpeg"
        assert media["title"] == "Wheat Field with Cypresses"
        assert "Vincent van Gogh" in media["alt_text"]
        assert media["copyright_status"] == "public_domain"
        assert media["license"] == "CC0-1.0"
        assert media["source"].startswith("The Metropolitan Museum")


# ---------------------------------------------------------------------------
# Smithsonian mapper
# ---------------------------------------------------------------------------


class TestSmithsonianMapper:
    def _sample(self) -> dict:
        return {
            "descriptiveNonRepeating": {
                "title": {"content": "Aviator Goggles"},
                "record_ID": "nasm:A19510007000",
                "unit_code": "NASM",
                "online_media": {
                    "media": [
                        {
                            "content": "https://ids.si.edu/.../big.jpg",
                            "thumbnail": "https://ids.si.edu/.../thumb.jpg",
                        }
                    ]
                },
            },
            "indexedStructured": {
                "object_type": ["Goggles"],
                "topic": ["Aviation", "Personal equipment"],
                "place": ["United States"],
            },
            "freetext": {
                "name": [{"label": "Maker", "content": "AN-6530 manufacturer"}],
                "creditLine": [{"content": "Gift of John Doe"}],
                "notes": [{"content": "Standard issue aviation goggles."}],
                "date": [{"content": "1940s"}],
            },
        }

    def test_image_url(self):
        assert bsm._si_image_url(self._sample()) == "https://ids.si.edu/.../big.jpg"

    def test_image_url_falls_back_to_thumbnail(self):
        s = self._sample()
        s["descriptiveNonRepeating"]["online_media"]["media"][0].pop("content")
        assert bsm._si_image_url(s) == "https://ids.si.edu/.../thumb.jpg"

    def test_image_url_returns_none_when_no_media(self):
        s = self._sample()
        s["descriptiveNonRepeating"]["online_media"]["media"] = []
        assert bsm._si_image_url(s) is None

    def test_skip_when_no_image_url(self):
        s = self._sample()
        s["descriptiveNonRepeating"]["online_media"]["media"] = []
        assert "no image URL" in bsm._si_should_skip(s)

    def test_map_extracts_object_fields(self):
        out = bsm._si_map(self._sample())
        assert out["object_name"] == "Aviator Goggles"
        assert out["responsible_department"] == "NASM"
        assert out["object_type"] == "Goggles"
        assert out["creators"] == [{
            "name": "AN-6530 manufacturer", "role": "Maker",
            "attribution": None, "authority_id": None, "ulan_id": None,
        }]
        assert {s["term"] for s in out["subjects"]} == {"Aviation", "Personal equipment"}
        assert out["creation_date_display"] == "1940s"
        assert out["credit_line"] == "Gift of John Doe"
        assert out["creation_place"] == "United States"
        assert out["object_status"] == "accessioned"

    def test_map_does_not_emit_legacy_keys(self):
        out = bsm._si_map(self._sample())
        assert "titles" not in out
        assert "classifications" not in out

    def test_id_normalize_replaces_colons(self):
        assert bsm._si_id_normalize("edanmdm:saam_1968.155.8") == "edanmdm-saam_1968.155.8"


class TestSmithsonianDiscovery:
    """`_si_discover_ids` replaces the previously curated 15-ID list,
    which went stale (13 of 15 IDs 404'd by the time we ran the
    bootstrap). It paginates /search filtered to CC0 images across
    cultural-collection units, reads the EDANMDM ID from `row.url`
    (not the opaque internal `row.id`), and stops at the target count."""

    def test_returns_empty_when_no_api_key(self):
        assert bsm._si_discover_ids(10, None) == []
        assert bsm._si_discover_ids(10, "") == []

    def test_reads_url_field_not_internal_id(self, monkeypatch):
        """The crucial bug: search rows include both
            id  = "ld1-1643399134763-…"   (internal, opaque)
            url = "edanmdm:nmah_1341773"  (the EDANMDM the detail API wants)
        Using `row.id` would yield un-fetchable IDs."""
        responses = [
            {
                "response": {
                    "rows": [
                        {"id": "ld1-INTERNAL-AAA", "url": "edanmdm:saam_1"},
                        {"id": "ld1-INTERNAL-BBB", "url": "edanmdm:npg_2"},
                    ],
                    "rowCount": 2,
                },
            },
        ]
        calls = []

        def fake_get(url, params=None, timeout=None):
            calls.append((url, params))

            class R:
                def __init__(self, data):
                    self._data = data

                def raise_for_status(self):
                    return None

                def json(self):
                    return self._data

            return R(responses.pop(0))

        monkeypatch.setattr(bsm.requests, "get", fake_get)
        ids = bsm._si_discover_ids(2, "FAKE-KEY")
        assert ids == ["edanmdm:saam_1", "edanmdm:npg_2"]
        # Sort=random is on so the demo isn't 97% NPG.
        assert calls[0][1].get("sort") == "random"
        # The filter narrows to CC0 images, restricted to cultural units.
        assert "media_usage:CC0" in calls[0][1]["q"]
        assert "unit_code:" in calls[0][1]["q"]

    def test_adds_edanmdm_prefix_when_missing(self, monkeypatch):
        """Defensive: if SI ever returns the bare slug instead of the
        prefixed form, the discovery should still hand back the form
        `_si_fetch` expects."""
        page = {
            "response": {
                "rows": [
                    {"id": "x", "url": "nmaa_2005.20"},  # no edanmdm: prefix
                ],
            },
        }
        # Re-yield indefinitely; the over-fetch loop will paginate.
        def fake_get(url, params=None, timeout=None):
            class R:
                def raise_for_status(self): return None
                def json(self): return page
            return R()

        monkeypatch.setattr(bsm.requests, "get", fake_get)
        ids = bsm._si_discover_ids(1, "FAKE-KEY")
        assert ids == ["edanmdm:nmaa_2005.20"]

    def test_stops_at_target(self, monkeypatch):
        page = {
            "response": {
                "rows": [{"id": f"x{i}", "url": f"edanmdm:saam_{i}"} for i in range(100)],
            },
        }

        def fake_get(url, params=None, timeout=None):
            class R:
                def raise_for_status(self): return None
                def json(self): return page
            return R()

        monkeypatch.setattr(bsm.requests, "get", fake_get)
        ids = bsm._si_discover_ids(5, "FAKE-KEY")
        assert len(ids) == 5
        assert ids == [f"edanmdm:saam_{i}" for i in range(5)]


# ---------------------------------------------------------------------------
# Rijks mapper
# ---------------------------------------------------------------------------


class TestRijksMapper:
    """The Rijksmuseum's legacy /api/en/collection endpoint was retired
    in favor of the Linked Art service at data.rijksmuseum.nl. The
    record shape is now JSON-LD (identified_by / produced_by /
    representation / referred_to_by / made_of / classified_as), not
    the prior `webImage` / `principalMakers` / `dating` payload."""

    def _sample(self) -> dict:
        return {
            "@context": "https://linked.art/ns/v1/linked-art.json",
            "id": "https://id.rijksmuseum.nl/12345",
            "type": "HumanMadeObject",
            "identified_by": [
                {"type": "Name", "content": "The Night Watch"},
                {"type": "Identifier", "content": "SK-C-5"},
            ],
            "produced_by": {
                "type": "Production",
                "carried_out_by": [
                    {
                        "type": "Person",
                        "identified_by": [
                            {"type": "Name", "content": "Rembrandt van Rijn"},
                        ],
                    },
                ],
                "timespan": {
                    "type": "TimeSpan",
                    "identified_by": [
                        {"type": "Name", "content": "1642"},
                    ],
                },
                "referred_to_by": [
                    {"type": "LinguisticObject", "content": "Rembrandt Harmensz. van Rijn"},
                ],
            },
            "classified_as": [
                {
                    "type": "Type",
                    "identified_by": [{"type": "Name", "content": "painting"}],
                },
            ],
            "made_of": [
                {
                    "type": "Material",
                    "identified_by": [{"type": "Name", "content": "oil paint"}],
                },
                {
                    "type": "Material",
                    "identified_by": [{"type": "Name", "content": "canvas"}],
                },
            ],
            "referred_to_by": [
                {
                    "type": "LinguisticObject",
                    "content": "A monumental civic guard portrait.",
                    "classified_as": [
                        {
                            "type": "Type",
                            "identified_by": [{"type": "Name", "content": "description"}],
                        },
                    ],
                },
                {
                    "type": "LinguisticObject",
                    "content": "h 363 cm × w 437 cm",
                    "classified_as": [
                        {
                            "type": "Type",
                            "identified_by": [{"type": "Name", "content": "Dimensions"}],
                        },
                    ],
                },
            ],
            "subject_of": [
                {
                    "type": "LinguisticObject",
                    "subject_to": [
                        {
                            "type": "Right",
                            "classified_as": [
                                {
                                    "id": "https://creativecommons.org/publicdomain/zero/1.0/",
                                    "type": "Type",
                                },
                            ],
                        },
                    ],
                },
            ],
            # `_madrona_image_url` is attached by `_rijks_fetch` after
            # walking the shows → VisualItem → DigitalObject chain.
            "_madrona_image_url": "https://iiif.micr.io/abc/full/max/0/default.jpg",
        }

    # ---- image / skip ----

    def test_image_url_reads_synthetic_resolved_key(self):
        assert (
            bsm._rijks_image_url(self._sample())
            == "https://iiif.micr.io/abc/full/max/0/default.jpg"
        )

    def test_image_url_missing_returns_none(self):
        s = self._sample()
        s["_madrona_image_url"] = None
        assert bsm._rijks_image_url(s) is None

    def test_skip_when_no_image(self):
        s = self._sample()
        s["_madrona_image_url"] = None
        assert "image" in bsm._rijks_should_skip(s).lower()

    def test_skip_when_not_cc0(self):
        s = self._sample()
        s["subject_of"] = []
        assert "CC0" in bsm._rijks_should_skip(s)

    def test_keep_when_cc0_and_image_present(self):
        assert bsm._rijks_should_skip(self._sample()) is None

    # ---- map ----

    def test_map_extracts_object_fields(self):
        out = bsm._rijks_map(self._sample())
        assert out["object_name"] == "The Night Watch"
        assert out["responsible_department"] == "Rijksmuseum"
        assert out["object_type"] == "painting"
        assert out["materials"] == [
            {"name": "oil paint", "part": None, "vocabulary_term_id": None},
            {"name": "canvas", "part": None, "vocabulary_term_id": None},
        ]
        assert out["physical_description"] == "h 363 cm × w 437 cm"
        assert out["credit_line"] == "Rijksmuseum Amsterdam"
        assert out["creation_date_display"] == "1642"
        assert out["object_status"] == "accessioned"
        assert out["brief_description"] == "A monumental civic guard portrait."

    def test_map_prefers_linguistic_creator_over_carried_out_by(self):
        creators = bsm._rijks_map(self._sample())["creators"]
        assert len(creators) == 1
        assert creators[0]["name"] == "Rembrandt Harmensz. van Rijn"

    def test_map_falls_back_to_carried_out_by(self):
        s = self._sample()
        s["produced_by"]["referred_to_by"] = []
        creators = bsm._rijks_map(s)["creators"]
        assert creators == [{
            "name": "Rembrandt van Rijn",
            "role": None,
            "attribution": None,
            "authority_id": None,
            "ulan_id": None,
        }]

    def test_map_no_creator_when_produced_by_missing(self):
        s = self._sample()
        s["produced_by"] = {}
        out = bsm._rijks_map(s)
        assert out["creators"] is None

    def test_map_does_not_emit_legacy_keys(self):
        out = bsm._rijks_map(self._sample())
        assert "titles" not in out
        assert "classifications" not in out

    # ---- titles / media / id ----

    def test_titles_uses_name(self):
        titles = bsm._rijks_titles(self._sample())
        assert titles == [
            {"title": "The Night Watch", "title_type": "primary", "is_preferred": True},
        ]

    def test_media_uses_creator_in_alt_text(self):
        media = bsm._rijks_media(self._sample(), "sandbox-fixtures/rijks/12345.jpg", 9999)
        assert media["title"] == "The Night Watch"
        assert media["creator"] == "Rembrandt Harmensz. van Rijn"
        assert "Rembrandt" in media["alt_text"]
        assert media["license"] == "CC0-1.0"
        assert media["image_url"] == "https://iiif.micr.io/abc/full/max/0/default.jpg"

    def test_id_normalize_strips_url_prefix(self):
        assert bsm._rijks_id_normalize("https://id.rijksmuseum.nl/12345") == "12345"
        assert bsm._rijks_id_normalize("https://data.rijksmuseum.nl/objects/SK-C-5/") == "SK-C-5"

    # ---- discovery / fetch resolution ----

    def test_resolve_image_url_walks_visualitem_and_digitalobject(self, monkeypatch):
        """`_rijks_resolve_image_url` follows shows[0] → VisualItem →
        digitally_shown_by[0] → DigitalObject → access_point[0].id."""
        record = {
            "shows": [{"id": "https://id.rijksmuseum.nl/visual-1", "type": "VisualItem"}],
        }
        visual = {
            "digitally_shown_by": [
                {"id": "https://id.rijksmuseum.nl/digital-1", "type": "DigitalObject"},
            ],
        }
        digital = {
            "access_point": [
                {"id": "https://iiif.micr.io/X/full/max/0/default.jpg", "type": "DigitalObject"},
            ],
        }
        fetched = {}

        def fake_get_ld(url: str):
            fetched.setdefault(url, 0)
            fetched[url] += 1
            return {
                "https://id.rijksmuseum.nl/visual-1": visual,
                "https://id.rijksmuseum.nl/digital-1": digital,
            }.get(url)

        monkeypatch.setattr(bsm, "_rijks_get_ld", fake_get_ld)
        out = bsm._rijks_resolve_image_url(record)
        assert out == "https://iiif.micr.io/X/full/max/0/default.jpg"
        # Exactly 2 follow-up fetches (VisualItem + DigitalObject).
        assert fetched == {
            "https://id.rijksmuseum.nl/visual-1": 1,
            "https://id.rijksmuseum.nl/digital-1": 1,
        }

    def test_resolve_image_url_uses_direct_representation_if_present(self, monkeypatch):
        record = {
            "representation": [
                {"id": "https://example.com/direct.jpg", "type": "DigitalObject"},
            ],
            # Should not be followed when representation is populated.
            "shows": [{"id": "https://id.rijksmuseum.nl/should-not-fetch"}],
        }
        calls = []
        monkeypatch.setattr(bsm, "_rijks_get_ld", lambda url: calls.append(url) or {})
        assert bsm._rijks_resolve_image_url(record) == "https://example.com/direct.jpg"
        assert calls == []

    def test_resolve_image_url_returns_none_when_chain_breaks(self, monkeypatch):
        record = {
            "shows": [{"id": "https://id.rijksmuseum.nl/visual-1", "type": "VisualItem"}],
        }
        monkeypatch.setattr(
            bsm,
            "_rijks_get_ld",
            lambda url: {"digitally_shown_by": []},  # VisualItem has no DigitalObject
        )
        assert bsm._rijks_resolve_image_url(record) is None

    def test_discover_ids_paginates_and_stops_at_target(self, monkeypatch):
        """`_rijks_discover_ids` walks `orderedItems` across pages and
        stops once it has the requested count."""
        pages = [
            {
                "orderedItems": [
                    {"id": "https://id.rijksmuseum.nl/1", "type": "HumanMadeObject"},
                    {"id": "https://id.rijksmuseum.nl/2", "type": "HumanMadeObject"},
                ],
                "next": {"id": "https://x?pageToken=abc"},
            },
            {
                "orderedItems": [
                    {"id": "https://id.rijksmuseum.nl/3", "type": "HumanMadeObject"},
                    {"id": "https://id.rijksmuseum.nl/4", "type": "HumanMadeObject"},
                ],
                "next": {"id": "https://x?pageToken=def"},
            },
        ]

        class FakeSession:
            def __init__(self):
                self.headers = {}
                self._page = 0

            def get(self, url, params=None, timeout=None):
                page = pages[self._page]
                self._page += 1

                class R:
                    def __init__(self, data):
                        self._data = data

                    def raise_for_status(self):
                        return None

                    def json(self):
                        return self._data

                return R(page)

        monkeypatch.setattr(bsm.requests, "Session", FakeSession)
        ids = bsm._rijks_discover_ids(3, None)
        assert ids == [
            "https://id.rijksmuseum.nl/1",
            "https://id.rijksmuseum.nl/2",
            "https://id.rijksmuseum.nl/3",
        ]


# ---------------------------------------------------------------------------
# Source registry
# ---------------------------------------------------------------------------


class TestSourceRegistry:
    def test_registry_has_all_three_sources(self):
        assert set(bsm.SOURCES.keys()) == {"met", "smithsonian", "rijks"}

    def test_source_specs_carry_right_prefix_and_subdir(self):
        assert bsm.SOURCES["met"].prefix == "MET-"
        assert bsm.SOURCES["met"].s3_key_subdir == "met"
        assert bsm.SOURCES["smithsonian"].prefix == "SI-"
        assert bsm.SOURCES["smithsonian"].s3_key_subdir == "smithsonian"
        assert bsm.SOURCES["rijks"].prefix == "RIJKS-"
        assert bsm.SOURCES["rijks"].s3_key_subdir == "rijks"

    def test_bucket_resolver_uses_default_prefix(self):
        assert bsm._bucket_for_region("us-west-2") == "madrona-media-us-west-2"
        assert bsm._bucket_for_region("eu-west-1") == "madrona-media-eu-west-1"
