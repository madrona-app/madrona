"""
Tests for Smithsonian Open Access connector.

Tests both mocked API responses and optional live API calls.
"""

import pytest
import requests
from unittest.mock import Mock, patch

from app.connectors.core.smithsonian_base import SmithsonianBaseConnector


class TestSmithsonianConnectorValidation:
    """Test configuration validation."""

    def test_validate_config_success(self):
        """Test valid configuration passes validation."""
        config = {
            "api_key": "test-api-key-12345",
            "base_url": "https://api.si.edu/openaccess/api/v1.0",
            "rows_per_page": 100,
            "query": "*:*",
        }
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")
        # validate_config is called in __init__, should not raise

    def test_validate_config_missing_api_key(self):
        """Test that missing API key raises error."""
        config = {"base_url": "https://api.si.edu/openaccess/api/v1.0"}
        
        with pytest.raises(ValueError, match="api_key is required"):
            SmithsonianBaseConnector(config=config, organization_id="tenant-123")

    def test_validate_config_empty_api_key(self):
        """Test that empty API key raises error."""
        config = {"api_key": "   "}
        
        with pytest.raises(ValueError, match="api_key must be a non-empty string"):
            SmithsonianBaseConnector(config=config, organization_id="tenant-123")

    def test_validate_config_invalid_rows_per_page(self):
        """Test that invalid rows_per_page raises error."""
        config = {"api_key": "test-key", "rows_per_page": 2000}  # Max is 1000

        with pytest.raises(ValueError, match="rows_per_page must be between 1 and 1000"):
            SmithsonianBaseConnector(config=config, organization_id="tenant-123")

    def test_validate_config_unit_codes(self):
        """Test that unit_codes validation works."""
        # Valid unit_codes
        config = {"api_key": "test-key", "unit_codes": ["NMAH", "NASM"]}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")
        # Should not raise

        # Invalid: not a list
        config = {"api_key": "test-key", "unit_codes": "NMAH"}
        with pytest.raises(ValueError, match="unit_codes must be a list"):
            SmithsonianBaseConnector(config=config, organization_id="tenant-123")

        # Invalid: empty string in list
        config = {"api_key": "test-key", "unit_codes": ["NMAH", ""]}
        with pytest.raises(ValueError, match="Each unit_code must be a non-empty string"):
            SmithsonianBaseConnector(config=config, organization_id="tenant-123")

    def test_validate_config_object_types(self):
        """Test that object_types validation works."""
        # Valid object_types
        config = {"api_key": "test-key", "object_types": ["Photographs", "Paintings"]}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")
        # Should not raise

        # Invalid: not a list
        config = {"api_key": "test-key", "object_types": "Photographs"}
        with pytest.raises(ValueError, match="object_types must be a list"):
            SmithsonianBaseConnector(config=config, organization_id="tenant-123")

    def test_validate_config_require_images(self):
        """Test that require_images validation works."""
        # Valid boolean
        config = {"api_key": "test-key", "require_images": True}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")
        # Should not raise

        # Invalid: not a boolean
        config = {"api_key": "test-key", "require_images": "yes"}
        with pytest.raises(ValueError, match="require_images must be a boolean"):
            SmithsonianBaseConnector(config=config, organization_id="tenant-123")


class TestSmithsonianConnectorQueryBuilding:
    """Test query building from filter options."""

    def test_build_effective_query_default(self):
        """Test default query when no filters specified."""
        config = {"api_key": "test-key"}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")

        query = connector._build_effective_query()
        assert query == "*:*"

    def test_build_effective_query_with_unit_codes(self):
        """Test query with single and multiple unit codes."""
        # Single unit code
        config = {"api_key": "test-key", "unit_codes": ["NMAH"]}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")

        query = connector._build_effective_query()
        assert "unit_code:NMAH" in query

        # Multiple unit codes (OR)
        config = {"api_key": "test-key", "unit_codes": ["NMAH", "NASM", "SAAM"]}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")

        query = connector._build_effective_query()
        assert "unit_code:NMAH" in query
        assert "unit_code:NASM" in query
        assert "unit_code:SAAM" in query
        assert " OR " in query

    def test_build_effective_query_with_object_types(self):
        """Test query with object types (handles spaces)."""
        # Type without spaces
        config = {"api_key": "test-key", "object_types": ["Photographs"]}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")

        query = connector._build_effective_query()
        assert "object_type:Photographs" in query

        # Type with spaces (should be quoted)
        config = {"api_key": "test-key", "object_types": ["Works of art"]}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")

        query = connector._build_effective_query()
        assert 'object_type:"Works of art"' in query

    def test_build_effective_query_with_require_images(self):
        """Test query with require_images filter."""
        config = {"api_key": "test-key", "require_images": True}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")

        query = connector._build_effective_query()
        assert "online_media_type:Images" in query

    def test_build_effective_query_combined_filters(self):
        """Test query with multiple filters combined."""
        config = {
            "api_key": "test-key",
            "unit_codes": ["NMAH"],
            "object_types": ["Photographs"],
            "require_images": True,
        }
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")

        query = connector._build_effective_query()

        # Should have all filters combined with AND
        assert "unit_code:NMAH" in query
        assert "object_type:Photographs" in query
        assert "online_media_type:Images" in query
        assert " AND " in query


class TestSmithsonianConnectorExtract:
    """Test extraction with mocked API responses."""

    @patch("app.connectors.core.smithsonian_base.requests.get")
    def test_extract_single_page(self, mock_get):
        """Test extraction of a single page of results."""
        # Mock API response
        mock_response = Mock()
        mock_response.json.return_value = {
            "response": {
                "numFound": 2,
                "rows": [
                    {
                        "id": "edanmdm-nmah_1",
                        "title": "Test Object 1",
                        "unitCode": "NMAH",
                        "timestamp": "2024-01-01T12:00:00Z",
                    },
                    {
                        "id": "edanmdm-nmah_2",
                        "title": "Test Object 2",
                        "unitCode": "NMAH",
                        "timestamp": "2024-01-02T12:00:00Z",
                    },
                ],
            }
        }
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response

        # Create connector and extract
        config = {"api_key": "test-key", "rows_per_page": 100}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")
        
        records = list(connector.extract(limit=10))
        
        # Assertions
        assert len(records) == 2
        assert records[0]["id"] == "edanmdm-nmah_1"
        assert records[1]["id"] == "edanmdm-nmah_2"
        
        # Verify API was called correctly
        mock_get.assert_called_once()
        call_args = mock_get.call_args
        assert call_args[1]["params"]["api_key"] == "test-key"
        assert call_args[1]["params"]["start"] == 0
        # When limit (10) < rows_per_page (100), request should use limit
        assert call_args[1]["params"]["rows"] == 10

    @patch("app.connectors.core.smithsonian_base.requests.get")
    def test_extract_with_cursor(self, mock_get):
        """Test extraction starting from a cursor position."""
        mock_response = Mock()
        mock_response.json.return_value = {
            "response": {
                "numFound": 150,
                "rows": [{"id": f"edanmdm-nmah_{i}", "title": f"Object {i}"} for i in range(100, 110)],
            }
        }
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response

        config = {"api_key": "test-key"}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")
        
        records = list(connector.extract(cursor={"start": 100}, limit=10))
        
        assert len(records) == 10
        
        # Verify cursor was used
        call_args = mock_get.call_args
        assert call_args[1]["params"]["start"] == 100

    @patch("app.connectors.core.smithsonian_base.requests.get")
    def test_extract_respects_limit(self, mock_get):
        """Test that limit parameter is respected."""
        mock_response = Mock()
        mock_response.json.return_value = {
            "response": {
                "numFound": 1000,
                "rows": [{"id": f"obj_{i}", "title": f"Object {i}"} for i in range(100)],
            }
        }
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response

        config = {"api_key": "test-key", "rows_per_page": 100}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")
        
        records = list(connector.extract(limit=50))
        
        # Should only return 50 records even though API returned 100
        assert len(records) == 50

    @patch("app.connectors.core.smithsonian_base.requests.get")
    def test_extract_multiple_pages(self, mock_get):
        """Test extraction across multiple pages."""
        # Create mock responses for two pages
        def side_effect(*args, **kwargs):
            start = kwargs["params"]["start"]
            mock_response = Mock()
            
            if start == 0:
                # First page
                mock_response.json.return_value = {
                    "response": {
                        "numFound": 150,
                        "rows": [{"id": f"obj_{i}", "title": f"Object {i}"} for i in range(100)],
                    }
                }
            else:
                # Second page
                mock_response.json.return_value = {
                    "response": {
                        "numFound": 150,
                        "rows": [{"id": f"obj_{i}", "title": f"Object {i}"} for i in range(100, 150)],
                    }
                }
            
            mock_response.raise_for_status = Mock()
            mock_response.status_code = 200
            return mock_response
        
        mock_get.side_effect = side_effect

        config = {"api_key": "test-key", "rows_per_page": 100}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")
        
        records = list(connector.extract(limit=150))
        
        assert len(records) == 150
        assert mock_get.call_count == 2

    @patch("app.connectors.core.smithsonian_base.time.sleep")
    @patch("app.connectors.core.smithsonian_base.requests.get")
    def test_extract_handles_rate_limiting(self, mock_get, mock_sleep):
        """Test that rate limiting (HTTP 429) triggers retry with backoff."""
        # First call returns 429, second call succeeds
        mock_response_429 = Mock()
        mock_response_429.status_code = 429
        mock_response_429.raise_for_status = Mock(side_effect=requests.HTTPError("429 Too Many Requests"))
        
        mock_response_success = Mock()
        mock_response_success.status_code = 200
        mock_response_success.json.return_value = {
            "response": {
                "numFound": 1,
                "rows": [{"id": "obj_1", "title": "Object 1"}],
            }
        }
        mock_response_success.raise_for_status = Mock()
        
        mock_get.side_effect = [mock_response_429, mock_response_success]

        config = {"api_key": "test-key"}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")
        
        records = list(connector.extract(limit=10))
        
        # Should have retried and succeeded
        assert len(records) == 1
        assert mock_get.call_count == 2
        # Should have slept once (exponential backoff: 1 second)
        mock_sleep.assert_called_once_with(1.0)


class TestSmithsonianConnectorNormalize:
    """Test record normalization."""

    def test_normalize_basic_record(self):
        """Test normalization of a basic Smithsonian record to CanonicalDraft format."""
        raw_record = {
            "id": "edanmdm-nmah_123456",
            "title": "Apollo 11 Command Module",
            "unitCode": "NMAH",
            "type": "edanmdm",
            "timestamp": "2024-01-15T10:30:00Z",
            "content": {
                "descriptiveNonRepeating": {
                    "title": {"content": "Apollo 11 Command Module"},
                    "idsId": "NMAH-2009-3329",
                },
                "indexedStructured": {
                    "date": ["1969"],
                },
            },
        }

        config = {"api_key": "test-key"}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")

        normalized = connector.normalize(raw_record)

        # Check entity envelope structure
        assert normalized["entity_key"] == "smithsonian:edanmdm-nmah_123456"
        assert normalized["source_system"] == "smithsonian"
        assert normalized["source_id"] == "edanmdm-nmah_123456"

        # Check payload (CanonicalDraft format)
        payload = normalized["payload"]
        assert payload["id"] == "mdrn:smithsonian:edanmdm-nmah_123456"
        assert payload["type"] == "Object"
        assert payload["label"] == "Apollo 11 Command Module"
        assert payload["properties"]["date"] == "1969"

        # Check extensions contain raw data
        extensions = payload["extensions"]
        assert len(extensions) == 1
        assert extensions[0]["namespace"] == "source.smithsonian"
        assert extensions[0]["data"] == raw_record

    def test_normalize_record_with_thumbnail(self):
        """Test normalization extracts thumbnail URL into media and properties."""
        raw_record = {
            "id": "edanmdm-nmah_123",
            "title": "Test Object",
            "content": {
                "descriptiveNonRepeating": {
                    "online_media": {
                        "media": [
                            {
                                "thumbnail": "https://ids.si.edu/ids/thumb.jpg",
                                "idsId": "NMAH-123",
                            }
                        ]
                    }
                }
            },
        }

        config = {"api_key": "test-key"}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")

        normalized = connector.normalize(raw_record)
        payload = normalized["payload"]

        # Thumbnail should be in properties
        assert payload["properties"]["thumbnail_url"] == "https://ids.si.edu/ids/thumb.jpg"

        # And in media array
        assert len(payload["media"]) == 1
        assert payload["media"][0]["url"] == "https://ids.si.edu/ids/thumb.jpg"
        assert payload["media"][0]["role"] == "thumbnail"

    def test_normalize_record_missing_title(self):
        """Test normalization handles missing title gracefully."""
        raw_record = {
            "id": "edanmdm-nmah_999",
            "unitCode": "NMAH",
        }

        config = {"api_key": "test-key"}
        connector = SmithsonianBaseConnector(config=config, organization_id="tenant-123")

        normalized = connector.normalize(raw_record)
        payload = normalized["payload"]

        # Should create fallback label
        assert "Smithsonian Object" in payload["label"]
        assert "edanmdm-nmah_999" in payload["label"]


@pytest.mark.skipif(
    True,  # Always skip by default
    reason="Live integration test - run manually with real API key"
)
class TestSmithsonianConnectorLive:
    """
    Live integration tests with real Smithsonian API.
    
    Run with: pytest tests/test_smithsonian.py -v --run-integration
    
    Requires SMITHSONIAN_API_KEY environment variable to be set.
    """

    def test_live_extraction(self):
        """Test live API extraction (requires real API key)."""
        import os
        
        api_key = os.getenv("SMITHSONIAN_API_KEY")
        if not api_key:
            pytest.skip("SMITHSONIAN_API_KEY environment variable not set")
        
        config = {
            "api_key": api_key,
            "rows_per_page": 10,
            "query": "online_media_type:Images",  # Filter to records with images
        }
        
        connector = SmithsonianBaseConnector(config=config, organization_id="test-live")
        
        # Extract a few records
        records = list(connector.extract(limit=5))
        
        assert len(records) > 0
        assert len(records) <= 5
        
        # Verify record structure
        first_record = records[0]
        assert "id" in first_record
        
        # Normalize and verify
        normalized = connector.normalize(first_record)
        assert normalized["entity_key"].startswith("smithsonian:")
        assert normalized["source_system"] == "smithsonian"
        assert "payload" in normalized
        assert normalized["payload"]["label"]
