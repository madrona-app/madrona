"""
Library of Congress Digital Collections connector.

Connects to the LOC.gov API to fetch digital collection items from
the Library of Congress. This connector is designed for library and
archive institutions as an alternative to the Smithsonian connector.

API documentation: https://www.loc.gov/apis/

The LOC API is free and requires no authentication, making it ideal
for demo and onboarding purposes.

Design Pattern:
    - Uses offset-based pagination (fo=json&sp=<offset>&c=<count>)
    - Normalizes records to canonical entity shape
    - Supports incremental extraction via date filtering

Example API call:
    https://www.loc.gov/collections/civil-war-maps/?fo=json&c=25&sp=0
"""

import hashlib
import json
import logging
import re
import time
from datetime import datetime
from typing import Any, Iterator

import requests

from app.connectors.base import BaseSourceConnector

logger = logging.getLogger(__name__)


class LOCDigitalCollectionsConnector(BaseSourceConnector):
    """
    Source connector for Library of Congress Digital Collections.

    Provides:
    - Pagination with offset tracking
    - Retry logic for rate limiting
    - Standard normalization into canonical entity shape

    Configuration:
        collection: Collection slug to fetch from (e.g., "civil-war-maps", "baseball-cards")
                   If not specified, fetches from all digital collections
        base_url: Base API URL (defaults to https://www.loc.gov)
        items_per_page: Number of items per request (default 25, max 100)
        max_records: Maximum total records to extract (default None = unlimited)

    Cursor format:
        {"offset": <integer>}  # Offset into result set (0-based)
    """

    direction = "source"

    # Configuration defaults
    DEFAULT_BASE_URL = "https://www.loc.gov"
    DEFAULT_ITEMS_PER_PAGE = 25
    MAX_ITEMS_PER_PAGE = 100
    MAX_RETRIES = 3
    INITIAL_RETRY_DELAY = 1.0  # seconds

    def validate_config(self) -> None:
        """Validate LOC connector configuration."""
        # Collection is optional - if not provided, fetches from all collections
        collection = self.config.get("collection")
        if collection is not None and not isinstance(collection, str):
            raise ValueError("collection must be a string")

        # Validate optional numeric fields
        items_per_page = self.config.get("items_per_page")
        if items_per_page is not None:
            if not isinstance(items_per_page, int):
                raise ValueError(
                    f"items_per_page must be an integer between 1 and {self.MAX_ITEMS_PER_PAGE}"
                )
            if items_per_page < 1 or items_per_page > self.MAX_ITEMS_PER_PAGE:
                raise ValueError(
                    f"items_per_page must be between 1 and {self.MAX_ITEMS_PER_PAGE}"
                )

        max_records = self.config.get("max_records")
        if max_records is not None:
            if not isinstance(max_records, int) or max_records < 1:
                raise ValueError("max_records must be a positive integer")

    def _get_base_url(self) -> str:
        """Get configured base URL."""
        return self.config.get("base_url", self.DEFAULT_BASE_URL).rstrip("/")

    def _get_items_per_page(self) -> int:
        """Get configured items per page."""
        return self.config.get("items_per_page", self.DEFAULT_ITEMS_PER_PAGE)

    def _get_collection_url(self) -> str:
        """Build the collection URL based on config."""
        base_url = self._get_base_url()
        collection = self.config.get("collection")

        if collection:
            # Specific collection
            return f"{base_url}/collections/{collection}/"
        else:
            # All digital collections (search endpoint)
            return f"{base_url}/search/"

    def _make_request(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        """
        Make HTTP request with retry logic.

        Args:
            url: API endpoint URL
            params: Query parameters

        Returns:
            JSON response as dict

        Raises:
            ConnectorExecutionError: If request fails after retries
        """
        delay = self.INITIAL_RETRY_DELAY

        for attempt in range(self.MAX_RETRIES):
            try:
                logger.debug(f"LOC API request: {url} params={params} (attempt {attempt + 1})")

                response = requests.get(
                    url,
                    params=params,
                    timeout=30,
                    headers={
                        "Accept": "application/json",
                        "User-Agent": "Madrona/1.0 (https://madrona.io; data integration platform)"
                    }
                )

                if response.status_code == 429:
                    # Rate limited - wait and retry
                    logger.warning(f"LOC API rate limited, waiting {delay}s before retry")
                    time.sleep(delay)
                    delay *= 2  # Exponential backoff
                    continue

                response.raise_for_status()
                return response.json()

            except requests.exceptions.Timeout:
                logger.warning(f"LOC API timeout, attempt {attempt + 1}/{self.MAX_RETRIES}")
                if attempt < self.MAX_RETRIES - 1:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise
            except requests.exceptions.RequestException as e:
                logger.error(f"LOC API request failed: {e}")
                if attempt < self.MAX_RETRIES - 1:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise

        raise RuntimeError(f"LOC API request failed after {self.MAX_RETRIES} attempts")

    def extract(
        self,
        cursor: dict[str, Any] | None = None,
        limit: int | None = None,
    ) -> Iterator[dict[str, Any]]:
        """
        Extract records from Library of Congress API.

        Args:
            cursor: Pagination cursor {"offset": <int>}
            limit: Maximum records to extract (overrides config.max_records)

        Yields:
            Raw record dictionaries from LOC API
        """
        offset = cursor.get("offset", 0) if cursor else 0
        items_per_page = self._get_items_per_page()
        max_records = limit or self.config.get("max_records")

        total_extracted = 0
        url = self._get_collection_url()

        logger.info(f"Starting LOC extraction from {url}, offset={offset}")

        while True:
            # Check if we've hit the limit
            if max_records and total_extracted >= max_records:
                logger.info(f"Reached max_records limit ({max_records})")
                break

            # Adjust page size if near limit
            request_count = items_per_page
            if max_records:
                remaining = max_records - total_extracted
                request_count = min(items_per_page, remaining)

            # Build request params
            params = {
                "fo": "json",
                "c": request_count,
                "sp": offset,
            }

            # Add fa=online-format:image to get items with images (more interesting for demos)
            if not self.config.get("collection"):
                params["fa"] = "online-format:image"

            try:
                data = self._make_request(url, params)
            except Exception as e:
                logger.error(f"Failed to fetch from LOC API: {e}")
                raise

            # Extract results from response
            results = data.get("results", [])

            if not results:
                logger.info("No more results from LOC API")
                break

            logger.debug(f"Fetched {len(results)} records from LOC (offset={offset})")

            for record in results:
                yield record
                total_extracted += 1

            # Update cursor for next page
            offset += len(results)

            # Check if we've reached the end
            pagination = data.get("pagination", {})
            total_available = pagination.get("total", 0)

            if offset >= total_available:
                logger.info(f"Reached end of results (total: {total_available})")
                break

        logger.info(f"LOC extraction complete: {total_extracted} records extracted")

    def _normalize_shelf_id(self, shelf_id: str) -> str:
        """
        Normalize shelf_id to a URL-safe, unique identifier.

        LOC shelf_ids contain spaces, commas, and special characters.
        We normalize them to be URL-safe while preserving uniqueness.

        Examples:
            "sn97067613, 1885-08-06, Edition 1" -> "sn97067613_1885-08-06_edition-1"
            "Edition: 1925 Call Number: KF62 Series: Title 48" -> "edition-1925_call-kf62_series-title-48"
        """
        if not shelf_id:
            return ""

        # Lowercase and strip
        result = shelf_id.lower().strip()

        # Remove common prefixes that add noise
        result = re.sub(r'\b(edition|call number|series|title):\s*', '', result)

        # Replace separators with underscores
        result = re.sub(r'[,;]\s*', '_', result)

        # Replace spaces and special chars with hyphens
        result = re.sub(r'[\s/\\]+', '-', result)

        # Remove any remaining non-alphanumeric chars except underscore and hyphen
        result = re.sub(r'[^a-z0-9_-]', '', result)

        # Collapse multiple separators
        result = re.sub(r'[-_]{2,}', '-', result)

        # Trim separators from ends
        result = result.strip('-_')

        return result

    def _extract_id_from_url(self, url: str) -> str:
        """
        Extract ID from LOC URL as fallback when shelf_id is unavailable.

        Handles different URL patterns:
        - /item/{id}/ -> {id}
        - /item/{lccn}/{date}/{edition}/ -> {lccn}-{date}-{edition}
        """
        if not url:
            return ""

        # Strip protocol and domain
        path = url.rstrip("/")
        if "/item/" in path:
            # Extract everything after /item/
            item_part = path.split("/item/")[-1]
            segments = [s for s in item_part.split("/") if s]

            if len(segments) == 1:
                return segments[0]
            elif len(segments) >= 2:
                # Composite ID for newspapers: lccn-date-edition
                return "-".join(segments)

        # Fallback: last path segment
        return path.split("/")[-1] if "/" in path else path

    def normalize(self, record: dict[str, Any]) -> dict[str, Any]:
        """
        Normalize a LOC record into CanonicalDraft format.

        Returns a CanonicalDraft envelope per Madrona Canonical Schema v1.

        ID Extraction Strategy:
            1. Primary: Use shelf_id (100% available, guaranteed unique)
            2. Fallback: Extract from URL path (for edge cases)

        Type Selection Rationale:
            LOC Digital Collections contain primarily documents, maps, photographs,
            and other creative/intellectual works. We use "Work" as the default
            type since most LOC items are published/documented works rather than
            physical museum objects.

        Args:
            record: Raw record from LOC API

        Returns:
            CanonicalDraft envelope with:
            - id: "mdrn:loc:<loc_id>"
            - type: "Work" (default for LOC items)
            - label: Title from LOC record
            - properties: Structured fields (date, creator, subjects, etc.)
            - extensions: Raw LOC payload preserved
        """
        # Extract LOC identifier using shelf_id (primary) or URL (fallback)
        shelf_id = record.get("shelf_id", "")
        loc_id = self._normalize_shelf_id(shelf_id)

        # Fallback to URL extraction if shelf_id normalization fails
        if not loc_id:
            url = record.get("url", record.get("id", ""))
            loc_id = self._extract_id_from_url(url)

        # Final fallback: use raw id field
        if not loc_id:
            loc_id = record.get("id", "unknown")
            if loc_id.startswith("http"):
                loc_id = loc_id.rstrip("/").split("/")[-1]

        # Extract title (may be string or list) - required for label
        title = record.get("title", "")
        if isinstance(title, list):
            title = title[0] if title else ""
        # Fallback label if title missing
        label = title.strip() if title else f"LOC Item {loc_id}"

        # Extract date
        date_value = record.get("date", "")
        if isinstance(date_value, list):
            date_value = date_value[0] if date_value else ""

        # Extract subjects for classifications
        subjects = record.get("subject", [])
        if isinstance(subjects, str):
            subjects = [subjects]
        subjects = subjects[:10]  # Limit to 10

        # Extract thumbnail/image URL
        image_url = None
        image_data = record.get("image_url", [])
        if isinstance(image_data, list) and image_data:
            for img in image_data:
                if isinstance(img, str):
                    image_url = img
                    break
        elif isinstance(image_data, str):
            image_url = image_data

        # Extract description/summary
        description = record.get("description", [])
        if isinstance(description, list):
            description = " ".join(description[:3]) if description else None
        description = description[:500] if description else None  # Truncate

        # Extract contributor/creator
        contributors = record.get("contributor", [])
        if isinstance(contributors, str):
            contributors = [contributors]
        creator = contributors[0] if contributors else None

        # Build canonical URL
        canonical_url = record.get("url", record.get("id", ""))
        if not canonical_url.startswith("http"):
            canonical_url = f"https://www.loc.gov/item/{loc_id}/"

        # Repository is always Library of Congress for this connector
        # (the location field contains geographic data, not holding institution)
        repository = "Library of Congress"

        # Try to get more specific collection/division info
        partof_division = record.get("partof_division", [])
        if partof_division and isinstance(partof_division, list):
            repository = f"Library of Congress - {partof_division[0].title()}"

        # Extract format/type
        original_format = record.get("original_format", [])
        if isinstance(original_format, list):
            original_format = original_format[0] if original_format else None

        # Extract rights information from item metadata
        item_data = record.get("item", {})
        rights_statement = item_data.get("rights") if isinstance(item_data, dict) else None

        # Build identifiers
        identifiers = [
            {"scheme": "source", "value": f"loc:{loc_id}"},
        ]
        if canonical_url:
            identifiers.append({"scheme": "url", "value": canonical_url})

        # Build classifications from subjects
        classifications = [
            {"scheme": "lcsh", "label": subj}
            for subj in subjects
            if subj
        ]

        # Build media references
        media = []
        if image_url:
            media.append({
                "id": f"mdrn:media:loc:{loc_id}:thumbnail",
                "type": "image",
                "url": image_url,
                "role": "thumbnail",
            })

        # Build properties (flexible domain-specific fields)
        # Note: subjects are NOT included here as they are in classifications
        properties = {
            "date": date_value if date_value else None,
            "creator": creator,
            "repository": repository,
            "format": original_format,
            "canonical_url": canonical_url,
            "thumbnail_url": image_url,
        }
        # Remove None values
        properties = {k: v for k, v in properties.items() if v is not None}

        # Build rights object if available
        rights = None
        if rights_statement:
            rights = {
                "statement": rights_statement,
                "holder": "Library of Congress",
            }

        # Build extensions with raw source data
        extensions = [
            {
                "namespace": "source.loc",
                "type": "LocRaw",
                "data": record,
            }
        ]

        # Build CanonicalDraft payload
        # Note: provenance and meta will be added by ingestion (finalize_draft)
        payload = {
            "id": f"mdrn:loc:{loc_id}",
            "type": "Work",  # LOC items are primarily documents/works
            "label": label,
            "description": description,
            "identifiers": identifiers,
            "classifications": classifications,
            "properties": properties,
            "media": media,
            "rights": rights,
            "extensions": extensions,
        }

        return {
            "entity_key": f"loc:{loc_id}",
            "source_system": "loc",
            "source_id": loc_id,
            "payload": payload,
        }

    def get_cursor_state(self, offset: int) -> dict[str, Any]:
        """Get cursor state for persistence."""
        return {"offset": offset}
