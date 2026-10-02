"""
Unit tests for external ID lookup services.

Tests external API lookups (ULAN, Wikidata, GeoNames, VIAF).
Note: These tests mock external APIs to avoid actual network calls.
"""

import pytest
from unittest.mock import MagicMock, patch

from app.services.external_lookups import (
    ExternalLookupResult,
    lookup_ulan,
    lookup_wikidata,
    lookup_wikidata_by_id,
    lookup_geonames,
    lookup_viaf,
    enrich_agent_identifiers,
    enrich_place_identifiers,
)


class TestExternalLookupResult:
    """Test ExternalLookupResult class."""

    def test_found_with_identifier(self):
        """Result is found when identifier is set."""
        result = ExternalLookupResult(source="ulan", identifier="500115588")
        assert result.found is True

    def test_not_found_without_identifier(self):
        """Result is not found when identifier is None."""
        result = ExternalLookupResult(source="ulan")
        assert result.found is False

    def test_to_dict_includes_all_fields(self):
        """to_dict includes all non-None fields."""
        result = ExternalLookupResult(
            source="wikidata",
            identifier="Q5582",
            label="Vincent van Gogh",
            uri="https://www.wikidata.org/wiki/Q5582",
            confidence=0.9,
        )
        d = result.to_dict()
        assert d["source"] == "wikidata"
        assert d["identifier"] == "Q5582"
        assert d["label"] == "Vincent van Gogh"
        assert d["uri"] == "https://www.wikidata.org/wiki/Q5582"
        assert d["confidence"] == 0.9

    def test_to_dict_excludes_none(self):
        """to_dict excludes None values."""
        result = ExternalLookupResult(source="ulan")
        d = result.to_dict()
        assert "identifier" not in d
        assert "label" not in d

    def test_to_dict_includes_error(self):
        """to_dict includes error if set."""
        result = ExternalLookupResult(source="ulan", error="API unavailable")
        d = result.to_dict()
        assert d["error"] == "API unavailable"


class TestLookupULAN:
    """Test ULAN lookup function."""

    def test_rejects_short_name(self):
        """Rejects names shorter than 2 characters."""
        result = lookup_ulan("V")
        assert result.found is False
        assert "too short" in result.error

    @patch("app.services.external_lookups.requests.get")
    def test_successful_lookup(self, mock_get):
        """Returns result for successful lookup."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "results": {
                "bindings": [
                    {
                        "subject": {"value": "http://vocab.getty.edu/ulan/500115588"},
                        "prefLabel": {"value": "Gogh, Vincent van"},
                        "birthDate": {"value": "1853"},
                        "deathDate": {"value": "1890"},
                    }
                ]
            }
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        result = lookup_ulan("Vincent van Gogh")

        assert result.found is True
        assert result.identifier == "500115588"
        assert result.label == "Gogh, Vincent van"
        assert "1853" in result.data["birth_date"]

    @patch("app.services.external_lookups.requests.get")
    def test_no_results(self, mock_get):
        """Handles no results gracefully."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"results": {"bindings": []}}
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        result = lookup_ulan("Unknown Artist 12345")

        assert result.found is False
        assert result.error is None

    @patch("app.services.external_lookups.requests.get")
    def test_increases_confidence_with_birth_year(self, mock_get):
        """Confidence increases when birth year matches."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "results": {
                "bindings": [
                    {
                        "subject": {"value": "http://vocab.getty.edu/ulan/500115588"},
                        "prefLabel": {"value": "Gogh, Vincent van"},
                        "birthDate": {"value": "1853"},
                    }
                ]
            }
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        result = lookup_ulan("Vincent van Gogh", birth_year=1853)

        assert result.confidence >= 0.9


class TestLookupWikidata:
    """Test Wikidata lookup function."""

    def test_rejects_short_query(self):
        """Rejects queries shorter than 2 characters."""
        result = lookup_wikidata("V")
        assert result.found is False
        assert "too short" in result.error

    @patch("app.services.external_lookups.requests.get")
    def test_successful_search(self, mock_get):
        """Returns result for successful search."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "search": [
                {
                    "id": "Q5582",
                    "label": "Vincent van Gogh",
                    "description": "Dutch post-impressionist painter",
                    "concepturi": "https://www.wikidata.org/wiki/Q5582",
                }
            ]
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        result = lookup_wikidata("Vincent van Gogh")

        assert result.found is True
        assert result.identifier == "Q5582"
        assert result.label == "Vincent van Gogh"
        assert "painter" in result.data["description"]

    @patch("app.services.external_lookups.requests.get")
    def test_lookup_by_id(self, mock_get):
        """Retrieves entity by Q-ID."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "entities": {
                "Q5582": {
                    "labels": {"en": {"value": "Vincent van Gogh"}},
                    "descriptions": {"en": {"value": "Dutch painter"}},
                    "claims": {"P106": [], "P21": []},
                }
            }
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        result = lookup_wikidata_by_id("Q5582")

        assert result.found is True
        assert result.label == "Vincent van Gogh"
        assert result.confidence == 1.0


class TestLookupGeoNames:
    """Test GeoNames lookup function."""

    def test_rejects_short_name(self):
        """Rejects names shorter than 2 characters."""
        result = lookup_geonames("P")
        assert result.found is False
        assert "too short" in result.error

    @patch("app.services.external_lookups.requests.get")
    def test_successful_lookup(self, mock_get):
        """Returns result for successful lookup."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "geonames": [
                {
                    "geonameId": 2988507,
                    "name": "Paris",
                    "countryName": "France",
                    "countryCode": "FR",
                    "lat": "48.85341",
                    "lng": "2.3488",
                    "population": 2138551,
                    "fcl": "P",
                    "fcode": "PPLC",
                }
            ]
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        result = lookup_geonames("Paris")

        assert result.found is True
        assert result.identifier == "2988507"
        assert result.label == "Paris"
        assert result.data["country"] == "France"
        assert result.data["latitude"] == "48.85341"


class TestLookupVIAF:
    """Test VIAF lookup function."""

    def test_rejects_short_name(self):
        """Rejects names shorter than 2 characters."""
        result = lookup_viaf("V")
        assert result.found is False
        assert "too short" in result.error

    @patch("app.services.external_lookups.requests.get")
    def test_successful_lookup(self, mock_get):
        """Returns result for successful lookup."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "result": [
                {
                    "viafid": "27063116",
                    "term": "Gogh, Vincent van, 1853-1890",
                    "nametype": "personal",
                }
            ]
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response

        result = lookup_viaf("Vincent van Gogh", "personal")

        assert result.found is True
        assert result.identifier == "27063116"
        assert "Gogh" in result.label


class TestEnrichAgentIdentifiers:
    """Test agent enrichment function."""

    def test_skips_without_name(self):
        """Returns unmodified record without name."""
        record = {"properties": {}}
        enriched, results = enrich_agent_identifiers(record)
        assert enriched == record
        assert results == []

    @patch("app.services.external_lookups.lookup_ulan")
    @patch("app.services.external_lookups.lookup_wikidata")
    @patch("app.services.external_lookups.lookup_viaf")
    def test_enriches_with_found_identifiers(
        self, mock_viaf, mock_wikidata, mock_ulan
    ):
        """Adds identifiers when lookups succeed."""
        mock_ulan.return_value = ExternalLookupResult(
            source="ulan",
            identifier="500115588",
            uri="http://vocab.getty.edu/ulan/500115588",
            confidence=0.9,
        )
        mock_wikidata.return_value = ExternalLookupResult(
            source="wikidata",
            identifier="Q5582",
            uri="https://www.wikidata.org/wiki/Q5582",
            confidence=0.8,
        )
        mock_viaf.return_value = ExternalLookupResult(source="viaf")  # Not found

        record = {
            "properties": {"name": "Vincent van Gogh"},
            "identifiers": [],
        }

        enriched, results = enrich_agent_identifiers(record)

        assert len(enriched["identifiers"]) == 2
        assert any(i["scheme"] == "ulan" for i in enriched["identifiers"])
        assert any(i["scheme"] == "wikidata" for i in enriched["identifiers"])

    def test_skips_existing_identifiers(self):
        """Skips sources that already have identifiers."""
        record = {
            "properties": {"name": "Vincent van Gogh"},
            "identifiers": [{"scheme": "ulan", "value": "500115588"}],
        }

        with patch("app.services.external_lookups.lookup_ulan") as mock_ulan:
            with patch("app.services.external_lookups.lookup_wikidata") as mock_wikidata:
                with patch("app.services.external_lookups.lookup_viaf") as mock_viaf:
                    mock_wikidata.return_value = ExternalLookupResult(source="wikidata")
                    mock_viaf.return_value = ExternalLookupResult(source="viaf")

                    enrich_agent_identifiers(record, sources=["ulan", "wikidata"])

                    # ULAN should not be called since it already exists
                    mock_ulan.assert_not_called()


class TestEnrichPlaceIdentifiers:
    """Test place enrichment function."""

    def test_skips_without_name(self):
        """Returns unmodified record without name."""
        record = {"properties": {}}
        enriched, results = enrich_place_identifiers(record)
        assert enriched == record
        assert results == []

    @patch("app.services.external_lookups.lookup_geonames")
    @patch("app.services.external_lookups.lookup_wikidata")
    def test_enriches_with_found_identifiers(self, mock_wikidata, mock_geonames):
        """Adds identifiers when lookups succeed."""
        mock_geonames.return_value = ExternalLookupResult(
            source="geonames",
            identifier="2988507",
            uri="https://www.geonames.org/2988507",
            confidence=0.8,
        )
        mock_wikidata.return_value = ExternalLookupResult(
            source="wikidata",
            identifier="Q90",
            uri="https://www.wikidata.org/wiki/Q90",
            confidence=0.8,
        )

        record = {
            "properties": {"name": "Paris", "country_code": "FR"},
            "identifiers": [],
        }

        enriched, results = enrich_place_identifiers(record)

        assert len(enriched["identifiers"]) == 2
        assert any(i["scheme"] == "geonames" for i in enriched["identifiers"])
        assert any(i["scheme"] == "wikidata" for i in enriched["identifiers"])
