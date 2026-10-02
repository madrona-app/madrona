"""
Shared base connector for Smithsonian Open Access API.

This module provides the core implementation for connecting to the Smithsonian
Institution's Open Access API. Organizations can subclass SmithsonianBaseConnector
to customize field mapping and data transformation while inheriting the standard
paging, retry logic, and incremental sync capabilities.

API documentation: https://api.si.edu/openaccess/api/v1.0/

Design Pattern:
    - Base connector (this file): Handles API interaction, pagination, retry logic
    - Org-specific overlays: Override transform methods for custom field mappings

Example org overlay:
    from app.connectors.core.smithsonian_base import SmithsonianBaseConnector
    
    class SmithsonianConnector(SmithsonianBaseConnector):
        def transform_entity(self, record):
            # Custom field mapping for this organization
            entity = super().transform_entity(record)
            entity['custom_field'] = self.extract_custom_data(record)
            return entity
"""

import hashlib
import json
import logging
import time
from typing import Any, Iterator

import requests

from app.connectors.base import BaseSourceConnector

logger = logging.getLogger(__name__)


class SmithsonianBaseConnector(BaseSourceConnector):
    """
    Shared base connector for Smithsonian Open Access API.

    Provides:
    - Pagination with cursor-based offset tracking
    - Exponential backoff retry logic for rate limiting
    - Incremental sync via timestamp filtering
    - Standard normalization into canonical entity shape
    - Extensible transform methods for org-specific customization

    Configuration:
        api_key: Smithsonian API key (required)
        base_url: Base API URL (defaults to https://api.si.edu/openaccess/api/v1.0)
        rows_per_page: Number of rows per API request (default 100, max 1000)
        max_records: Maximum total records to extract (default None = unlimited)
        query: Optional raw Solr query (advanced users)

        Filtering Options (user-friendly alternatives to raw query):
        unit_codes: List of museum codes to include (e.g., ["NMAH", "NASM", "SAAM"])
            - NMAH: National Museum of American History
            - NASM: National Air and Space Museum
            - NMNH: National Museum of Natural History
            - SAAM: Smithsonian American Art Museum
            - NPG: National Portrait Gallery
            - CHNDM: Cooper Hewitt Design Museum
            - NMAAHC: National Museum of African American History and Culture
            - NMAI: National Museum of the American Indian
            - NPM: National Postal Museum
            - HMSG: Hirshhorn Museum and Sculpture Garden
            - FSG: Freer/Sackler Gallery

        object_types: List of object types to include (e.g., ["Photographs", "Paintings"])
            Common types: Photographs, Works of art, Prints, Paintings, Sculpture,
            Textiles, Furniture, Jewelry, Ceramics, etc.

        require_images: Boolean - if true, only fetch records with images (default: false)

    Cursor format:
        {"start": <integer>}  # Offset into result set (0-based)

        The cursor is opaque to callers and should be persisted verbatim.
        It tracks pagination state using Smithsonian's start/rows pagination.
        Cursors are JSON-serializable for storage in runs.cursor field.

    Subclassing:
        Override these methods to customize behavior:
        - transform_entity(): Customize field mapping/transformation
        - extract_title(): Custom title extraction logic
        - extract_thumbnail(): Custom thumbnail URL logic
        - get_default_query(): Set org-specific default query
    """

    direction = "source"
    
    # Configuration defaults (can be overridden by subclasses)
    DEFAULT_BASE_URL = "https://api.si.edu/openaccess/api/v1.0"
    DEFAULT_ROWS_PER_PAGE = 100
    DEFAULT_QUERY = "*:*"  # All records
    MAX_RETRIES = 3
    INITIAL_RETRY_DELAY = 1.0  # seconds
    PAGINATION_DELAY = 0.5  # seconds between pagination requests to avoid rate limiting
    
    def __init__(self, config: dict[str, Any], organization_id: str):
        super().__init__(config, organization_id)
        self.high_watermark_source_ts: int | None = None

    def validate_config(self) -> None:
        """Validate Smithsonian-specific configuration."""
        if "api_key" not in self.config:
            raise ValueError("api_key is required for Smithsonian connector")
        
        if not isinstance(self.config["api_key"], str) or not self.config["api_key"].strip():
            raise ValueError("api_key must be a non-empty string")
        
        # Validate optional numeric fields (only if provided and not None)
        rows_per_page = self.config.get("rows_per_page")
        if rows_per_page is not None:
            # Check if it's a valid integer
            if not isinstance(rows_per_page, int):
                raise ValueError(
                    f"rows_per_page must be an integer between 1 and 1000, "
                    f"got: {repr(rows_per_page)} (type: {type(rows_per_page).__name__})"
                )
            if rows_per_page < 1 or rows_per_page > 1000:
                raise ValueError(
                    f"rows_per_page must be between 1 and 1000, got: {rows_per_page}"
                )
        
        max_records = self.config.get("max_records")
        if max_records is not None:
            if not isinstance(max_records, int):
                raise ValueError(
                    f"max_records must be a positive integer, "
                    f"got: {repr(max_records)} (type: {type(max_records).__name__})"
                )
            if max_records < 1:
                raise ValueError(f"max_records must be positive, got: {max_records}")

        # Validate filtering options
        unit_codes = self.config.get("unit_codes")
        if unit_codes is not None:
            if not isinstance(unit_codes, list):
                raise ValueError("unit_codes must be a list of strings")
            for code in unit_codes:
                if not isinstance(code, str) or not code.strip():
                    raise ValueError("Each unit_code must be a non-empty string")

        object_types = self.config.get("object_types")
        if object_types is not None:
            if not isinstance(object_types, list):
                raise ValueError("object_types must be a list of strings")
            for obj_type in object_types:
                if not isinstance(obj_type, str) or not obj_type.strip():
                    raise ValueError("Each object_type must be a non-empty string")

        require_images = self.config.get("require_images")
        if require_images is not None and not isinstance(require_images, bool):
            raise ValueError("require_images must be a boolean")

    def get_query_hash(self) -> str:
        """
        Compute deterministic hash of query configuration for incremental sync tracking.

        This ensures incremental sync only continues from runs with identical query config.
        Changes to query, base_url, or other filter parameters will trigger a full resync.

        Returns:
            SHA256 hash (hex) of normalized query config
        """
        query_config = {
            "query": self._build_effective_query(),
            "base_url": self.config.get("base_url", self.DEFAULT_BASE_URL),
            "unit_codes": sorted(self.config.get("unit_codes", [])),
            "object_types": sorted(self.config.get("object_types", [])),
            "require_images": self.config.get("require_images", False),
        }
        # Sort keys for deterministic serialization
        normalized = json.dumps(query_config, sort_keys=True)
        return hashlib.sha256(normalized.encode()).hexdigest()

    def _build_effective_query(self) -> str:
        """
        Build the effective Solr query from config options.

        Combines raw query with user-friendly filter options (unit_codes, object_types,
        require_images) into a single Solr query string.

        Priority:
        1. If raw 'query' is provided, use it as the base
        2. Otherwise, use get_default_query()
        3. Then append filters from unit_codes, object_types, require_images

        Returns:
            Complete Solr query string
        """
        # Start with base query
        base_query = self.config.get("query", self.get_default_query())
        query_parts = [base_query]

        # Add unit_codes filter (OR between multiple codes)
        unit_codes = self.config.get("unit_codes", [])
        if unit_codes:
            if len(unit_codes) == 1:
                query_parts.append(f"unit_code:{unit_codes[0]}")
            else:
                codes_query = " OR ".join(f"unit_code:{code}" for code in unit_codes)
                query_parts.append(f"({codes_query})")

        # Add object_types filter (OR between multiple types)
        object_types = self.config.get("object_types", [])
        if object_types:
            if len(object_types) == 1:
                # Quote if contains spaces
                ot = object_types[0]
                ot_query = f'object_type:"{ot}"' if " " in ot else f"object_type:{ot}"
                query_parts.append(ot_query)
            else:
                types_query = " OR ".join(
                    f'object_type:"{ot}"' if " " in ot else f"object_type:{ot}"
                    for ot in object_types
                )
                query_parts.append(f"({types_query})")

        # Add require_images filter
        if self.config.get("require_images", False):
            query_parts.append("online_media_type:Images")

        # Combine with AND
        if len(query_parts) == 1:
            return query_parts[0]
        return " AND ".join(query_parts)

    def get_default_query(self) -> str:
        """
        Get default query for this connector.

        Subclasses can override to provide org-specific default queries.

        Returns:
            Default Solr query string
        """
        return self.DEFAULT_QUERY

    def extract(
        self, 
        cursor: dict[str, Any] | None = None, 
        limit: int | None = None,
        last_sync_timestamp: int | None = None,
    ) -> Iterator[dict[str, Any]]:
        """
        Extract records from Smithsonian Open Access API.
        
        Uses cursor-based pagination via the 'start' parameter.
        Supports incremental sync via lastTimeUpdated timestamp filtering.
        
        Args:
            cursor: Pagination cursor (contains 'start' offset). Opaque to callers.
            limit: Maximum number of records to extract
            last_sync_timestamp: Unix timestamp for incremental sync (filters records updated after this time)
            
        Yields:
            Raw API response records
            
        Cursor format (JSON-serializable, persist verbatim):
            {"start": 100}  # Resume from record 100
            
        Example:
            # Full sync
            records = connector.extract(limit=1000)
            
            # Incremental sync
            records = connector.extract(limit=1000, last_sync_timestamp=1699994695)
        """
        base_url = self.config.get("base_url", self.DEFAULT_BASE_URL)
        api_key = self.config["api_key"]
        rows_per_page = self.config.get("rows_per_page", self.DEFAULT_ROWS_PER_PAGE)
        max_records = self.config.get("max_records")  # None = unlimited

        # Build effective query from config options (unit_codes, object_types, require_images)
        base_query = self._build_effective_query()

        # Add optional timestamp filter for incremental sync
        query = self._build_query(base_query, last_sync_timestamp)
        
        # Initialize pagination
        start = cursor.get("start", 0) if cursor else 0
        extracted_count = 0
        self.high_watermark_source_ts = last_sync_timestamp  # Track highest timestamp seen
        
        # Apply max_records if configured (overrides limit parameter)
        effective_limit = max_records if max_records is not None else limit
        
        sync_type = "incremental" if last_sync_timestamp is not None else "full"
        self._log_sync_start(sync_type, start, effective_limit, max_records, query, last_sync_timestamp)
        
        while True:
            # Check limit
            if effective_limit is not None and extracted_count >= effective_limit:
                logger.info(
                    "Reached extraction limit: extracted=%d limit=%d",
                    extracted_count,
                    effective_limit,
                )
                break
            
            # Adjust rows for final page if needed
            rows_to_fetch = self._calculate_rows_to_fetch(rows_per_page, effective_limit, extracted_count)
            
            # Make API request with retry logic
            try:
                response = self._fetch_page_with_retry(
                    base_url=base_url,
                    api_key=api_key,
                    query=query,
                    start=start,
                    rows=rows_to_fetch,
                )
            except requests.RequestException as e:
                logger.error("Smithsonian API request failed: %s", e)
                raise
            
            # Parse response
            response_data = response.get("response", {})
            rows = response_data.get("rows", [])
            
            if not rows:
                logger.info("No more records available (empty page at start=%d)", start)
                break
            
            logger.debug("Received %d records from page (start=%d)", len(rows), start)
            
            # Yield records and track high watermark
            page_max_ts = None
            for row in rows:
                # Track highest lastTimeUpdated timestamp for next incremental sync
                record_timestamp = row.get("lastTimeUpdated")
                if record_timestamp:
                    if self.high_watermark_source_ts is None or record_timestamp > self.high_watermark_source_ts:
                        self.high_watermark_source_ts = record_timestamp
                    if page_max_ts is None or record_timestamp > page_max_ts:
                        page_max_ts = record_timestamp
                
                yield row
                extracted_count += 1
                
                if effective_limit is not None and extracted_count >= effective_limit:
                    break
            
            if page_max_ts:
                logger.debug(
                    "Page complete: extracted=%d page_max_ts=%d global_max_ts=%d",
                    len(rows),
                    page_max_ts,
                    self.high_watermark_source_ts or 0,
                )
            
            # Check if more pages available
            num_found = response_data.get("rowCount", response_data.get("numFound", 0))
            if start + len(rows) >= num_found:
                logger.info(
                    "Reached end of results: start=%d rows=%d rowCount=%d",
                    start,
                    len(rows),
                    num_found,
                )
                break
            
            # Move to next page
            start += len(rows)
            logger.debug("Moving to next page: start=%d extracted=%d", start, extracted_count)

            # Rate limit protection: delay between pagination requests
            time.sleep(self.PAGINATION_DELAY)
        
        # Log final watermark
        self._log_sync_complete(extracted_count)

    def _build_query(self, base_query: str, last_sync_timestamp: int | None) -> str:
        """
        Build Solr query with optional timestamp filter for incremental sync.
        
        Args:
            base_query: Base Solr query string
            last_sync_timestamp: Optional Unix timestamp for incremental filtering
            
        Returns:
            Complete Solr query string
        """
        if last_sync_timestamp is not None:
            # Solr range query: timestamp:[start TO *] means >= start
            timestamp_filter = f"lastTimeUpdated:[{last_sync_timestamp} TO *]"
            if base_query == self.DEFAULT_QUERY:
                return timestamp_filter
            else:
                # Combine base query with timestamp filter using AND
                return f"({base_query}) AND {timestamp_filter}"
        return base_query

    def _calculate_rows_to_fetch(
        self, 
        rows_per_page: int, 
        effective_limit: int | None, 
        extracted_count: int
    ) -> int:
        """Calculate number of rows to fetch for this page."""
        if effective_limit is not None:
            return min(rows_per_page, effective_limit - extracted_count)
        return rows_per_page

    def _log_sync_start(
        self, 
        sync_type: str, 
        start: int, 
        effective_limit: int | None, 
        max_records: int | None, 
        query: str,
        last_sync_timestamp: int | None
    ) -> None:
        """Log sync start with appropriate detail."""
        if sync_type == "incremental":
            logger.info(
                "Starting incremental sync from source timestamp %d: organization_id=%s query=%s",
                last_sync_timestamp,
                self.organization_id,
                query,
            )
        else:
            logger.info(
                "Starting full sync: organization_id=%s start=%d limit=%s max_records=%s query=%s",
                self.organization_id,
                start,
                effective_limit,
                max_records,
                query,
            )

    def _log_sync_complete(self, extracted_count: int) -> None:
        """Log completion with watermark info."""
        if self.high_watermark_source_ts:
            logger.info(
                "Extraction complete: total_records=%d high_watermark_source_ts=%d",
                extracted_count,
                self.high_watermark_source_ts,
            )
        else:
            logger.info(
                "Extraction complete: total_records=%d (no timestamps found)",
                extracted_count,
            )

    def _fetch_page_with_retry(
        self,
        base_url: str,
        api_key: str,
        query: str,
        start: int,
        rows: int,
    ) -> dict[str, Any]:
        """
        Fetch a single page from Smithsonian API with exponential backoff retry.
        
        Implements rate limiting handling with exponential backoff for HTTP 429 responses
        and request timeouts.
        
        Args:
            base_url: Base API URL
            api_key: API authentication key
            query: Search query
            start: Starting offset
            rows: Number of rows to fetch
            
        Returns:
            Parsed JSON response
            
        Raises:
            requests.RequestException: If API request fails after retries
        """
        url = f"{base_url}/search"
        
        params = {
            "api_key": api_key,
            "q": query,
            "start": start,
            "rows": rows,
            "sort": "lastTimeUpdated asc",  # Deterministic ordering for stable pagination
        }
        
        logger.debug("Fetching Smithsonian page: url=%s start=%d rows=%d", url, start, rows)
        
        for attempt in range(self.MAX_RETRIES):
            try:
                response = requests.get(url, params=params, timeout=30)
                
                # Handle rate limiting (HTTP 429)
                if response.status_code == 429:
                    if attempt < self.MAX_RETRIES - 1:
                        wait_time = self._calculate_backoff_delay(attempt)
                        logger.warning(
                            "Rate limited by Smithsonian API (HTTP 429). Retrying in %.1fs (attempt %d/%d)",
                            wait_time,
                            attempt + 1,
                            self.MAX_RETRIES,
                        )
                        time.sleep(wait_time)
                        continue
                    else:
                        logger.error("Rate limit exceeded after %d retries", self.MAX_RETRIES)
                        response.raise_for_status()  # Will raise HTTPError
                
                response.raise_for_status()
                return response.json()
                
            except requests.Timeout:
                if attempt < self.MAX_RETRIES - 1:
                    wait_time = self._calculate_backoff_delay(attempt)
                    logger.warning(
                        "Request timeout. Retrying in %.1fs (attempt %d/%d)",
                        wait_time,
                        attempt + 1,
                        self.MAX_RETRIES,
                    )
                    time.sleep(wait_time)
                    continue
                else:
                    logger.error("Request timeout after %d retries", self.MAX_RETRIES)
                    raise
            except (requests.RequestException, requests.exceptions.ChunkedEncodingError) as e:
                # Retry on connection errors (includes ChunkedEncodingError, ConnectionError, etc.)
                if attempt < self.MAX_RETRIES - 1:
                    wait_time = self._calculate_backoff_delay(attempt)
                    logger.warning(
                        "Request failed (%s). Retrying in %.1fs (attempt %d/%d)",
                        type(e).__name__,
                        wait_time,
                        attempt + 1,
                        self.MAX_RETRIES,
                    )
                    time.sleep(wait_time)
                    continue
                else:
                    logger.error("Request failed after %d retries: %s", self.MAX_RETRIES, e)
                    raise
        
        # Should not reach here, but for type safety
        raise requests.RequestException("Max retries exceeded")

    def _calculate_backoff_delay(self, attempt: int) -> float:
        """
        Calculate exponential backoff delay.
        
        Args:
            attempt: Current attempt number (0-indexed)
            
        Returns:
            Delay in seconds (1s, 2s, 4s, ...)
        """
        return self.INITIAL_RETRY_DELAY * (2 ** attempt)

    def normalize(self, record: dict[str, Any]) -> dict[str, Any]:
        """
        Normalize Smithsonian record to CanonicalDraft format.

        Returns a CanonicalDraft envelope per Madrona Canonical Schema v1.

        Type Selection Rationale:
            Smithsonian Open Access contains museum objects, artworks, specimens,
            and artifacts. We use "Object" as the default type since most items
            are physical museum objects rather than documents/works.

        This method orchestrates the normalization process by:
        1. Extracting core identifiers
        2. Extracting dates and media
        3. Building canonical payload with properties and extensions
        4. Calling transform_entity() for org-specific customization

        Subclasses should override transform_entity() rather than this method.

        Args:
            record: Raw Smithsonian API record

        Returns:
            CanonicalDraft envelope with:
            - id: "mdrn:smithsonian:<record_id>"
            - type: "Object" (default for Smithsonian items)
            - label: Title from Smithsonian record
            - properties: Structured fields (date, creator, etc.)
            - extensions: Raw Smithsonian payload preserved
        """
        # Extract core identifiers
        # Prefer record_ID from descriptiveNonRepeating (human-readable, e.g., "nmnhinvertebratezoology_271536")
        # Fall back to raw id field (technical, e.g., "ld1-1643411685324-1643411725266-1")
        content = record.get("content", {})
        desc_non_rep = content.get("descriptiveNonRepeating", {})
        record_id = desc_non_rep.get("record_ID") or record.get("id", "unknown")

        # Extract standard fields
        label = self.extract_title(record)
        modified_at = self.extract_date(record)
        thumbnail_url = self.extract_thumbnail(record)
        description = self._extract_description(record)
        creator = self._extract_creator(record)
        date_value = self._extract_object_date(record)
        subjects = self._extract_subjects(record)
        object_type = self._extract_object_type(record)
        rights = self._extract_rights(record)
        canonical_url = self._build_canonical_url(record_id)

        # Build identifiers
        identifiers = [
            {"scheme": "source", "value": f"smithsonian:{record_id}"},
        ]
        if canonical_url:
            identifiers.append({"scheme": "url", "value": canonical_url})

        # Build classifications from object type and subjects
        classifications = []
        if object_type:
            classifications.append({"scheme": "smithsonian", "label": object_type})
        for subj in subjects[:10]:  # Limit to 10
            if subj:
                classifications.append({"scheme": "subject", "label": subj})

        # Build media references
        media = []
        if thumbnail_url:
            media.append({
                "id": f"mdrn:media:smithsonian:{record_id}:thumbnail",
                "type": "image",
                "url": thumbnail_url,
                "role": "thumbnail",
            })

        # Build properties (flexible domain-specific fields)
        properties = {
            "date": date_value,
            "creator": creator,
            "object_type": object_type,
            "subjects": subjects[:10] if subjects else None,
            "unit_code": record.get("unitCode"),
            "canonical_url": canonical_url,
            "thumbnail_url": thumbnail_url,
            "modified_at": modified_at,
        }
        # Remove None values
        properties = {k: v for k, v in properties.items() if v is not None}

        # Build extensions with raw source data
        extensions = [
            {
                "namespace": "source.smithsonian",
                "type": "SmithsonianRaw",
                "data": record,
            }
        ]

        # Build CanonicalDraft payload
        # Note: provenance and meta will be added by ingestion (finalize_draft)
        payload = {
            "id": f"mdrn:smithsonian:{record_id}",
            "type": "Object",  # Smithsonian items are primarily physical objects
            "label": label,
            "description": description,
            "identifiers": identifiers,
            "classifications": classifications,
            "properties": properties,
            "media": media,
            "rights": rights,
            "extensions": extensions,
        }

        # Build base entity envelope
        base_entity = {
            "entity_key": f"smithsonian:{record_id}",
            "source_system": "smithsonian",
            "source_id": record_id,
            "payload": payload,
        }

        # Allow subclasses to transform/extend the entity
        return self.transform_entity(record, base_entity)

    def _build_canonical_url(self, record_id: str) -> str:
        """Build canonical URL to view item on Smithsonian website."""
        return f"https://www.si.edu/object/{record_id}"

    # Labels in freetext.notes that are metadata, not descriptions
    _METADATA_NOTE_LABELS = {
        "record last modified",
        "specimen count",
        "item count",
        "record modified",
        "last modified",
        "date modified",
    }

    def _extract_description(self, record: dict[str, Any]) -> str | None:
        """
        Extract description from Smithsonian record.

        Skips metadata-like notes (e.g., "Record Last Modified", "Specimen Count")
        that aren't actual descriptions of the object.
        """
        content = record.get("content", {})
        desc_non_rep = content.get("descriptiveNonRepeating", {})

        # Try various description fields from descriptiveNonRepeating
        notes = desc_non_rep.get("notes", {})
        if isinstance(notes, dict):
            note_value = notes.get("content") or notes.get("note")
            if note_value:
                if isinstance(note_value, list):
                    return " ".join(str(n) for n in note_value[:3])[:500]
                return str(note_value)[:500]

        # Try freetext.notes - but skip metadata labels
        freetext = content.get("freetext", {})
        if isinstance(freetext, dict):
            note_entries = freetext.get("notes", [])
            if note_entries and isinstance(note_entries, list):
                for entry in note_entries:
                    if isinstance(entry, dict):
                        label = entry.get("label", "").lower()
                        # Skip metadata notes
                        if label in self._METADATA_NOTE_LABELS:
                            continue
                        content_val = entry.get("content")
                        if content_val:
                            return str(content_val)[:500]

        # Try freetext.physicalDescription as fallback
        if isinstance(freetext, dict):
            phys_desc = freetext.get("physicalDescription", [])
            if phys_desc and isinstance(phys_desc, list):
                desc_parts = []
                for entry in phys_desc[:3]:
                    if isinstance(entry, dict):
                        label = entry.get("label", "")
                        content_val = entry.get("content", "")
                        if label and content_val:
                            desc_parts.append(f"{label}: {content_val}")
                if desc_parts:
                    return "; ".join(desc_parts)[:500]

        return None

    def _extract_creator(self, record: dict[str, Any]) -> str | None:
        """Extract creator/artist from Smithsonian record."""
        content = record.get("content", {})

        # Try indexedStructured.name
        indexed = content.get("indexedStructured", {})
        names = indexed.get("name", [])
        if names and isinstance(names, list):
            return str(names[0])

        # Try freetext.name
        freetext = content.get("freetext", {})
        name_entries = freetext.get("name", [])
        if name_entries and isinstance(name_entries, list):
            for entry in name_entries:
                if isinstance(entry, dict):
                    content_val = entry.get("content")
                    if content_val:
                        return str(content_val)

        return None

    def _extract_object_date(self, record: dict[str, Any]) -> str | None:
        """Extract object/creation date from Smithsonian record."""
        content = record.get("content", {})

        # Try indexedStructured.date
        indexed = content.get("indexedStructured", {})
        dates = indexed.get("date", [])
        if dates and isinstance(dates, list):
            return str(dates[0])

        # Try freetext.date
        freetext = content.get("freetext", {})
        date_entries = freetext.get("date", [])
        if date_entries and isinstance(date_entries, list):
            for entry in date_entries:
                if isinstance(entry, dict):
                    content_val = entry.get("content")
                    if content_val:
                        return str(content_val)

        return None

    def _extract_subjects(self, record: dict[str, Any]) -> list[str]:
        """Extract subject terms from Smithsonian record."""
        content = record.get("content", {})
        subjects = []

        # Try indexedStructured.topic
        indexed = content.get("indexedStructured", {})
        topics = indexed.get("topic", [])
        if topics and isinstance(topics, list):
            subjects.extend(str(t) for t in topics if t)

        # Try indexedStructured.object_type
        obj_types = indexed.get("object_type", [])
        if obj_types and isinstance(obj_types, list):
            subjects.extend(str(t) for t in obj_types if t)

        return subjects[:20]  # Limit total

    def _extract_object_type(self, record: dict[str, Any]) -> str | None:
        """
        Extract primary object type from Smithsonian record.

        Prefers meaningful object_type from indexedStructured over record type
        (which is often just "edanmdm" - a technical record format).
        """
        content = record.get("content", {})
        indexed = content.get("indexedStructured", {})

        # Prefer indexed object_type (e.g., "Photographs", "Paintings")
        obj_types = indexed.get("object_type", [])
        if obj_types and isinstance(obj_types, list):
            return str(obj_types[0])

        # Fallback to record type (e.g., "edanmdm")
        record_type = record.get("type")
        if record_type:
            return str(record_type)

        return None

    def _extract_rights(self, record: dict[str, Any]) -> dict[str, Any] | None:
        """
        Extract rights/license information from Smithsonian record.

        Looks for metadata_usage.access which contains license info like "CC0".
        """
        content = record.get("content", {})
        desc_non_rep = content.get("descriptiveNonRepeating", {})

        # Check metadata_usage.access
        metadata_usage = desc_non_rep.get("metadata_usage", {})
        if isinstance(metadata_usage, dict):
            access = metadata_usage.get("access")
            if access:
                return {
                    "statement": str(access),
                    "holder": "Smithsonian Institution",
                }

        return None

    def transform_entity(self, record: dict[str, Any], base_entity: dict[str, Any]) -> dict[str, Any]:
        """
        Transform entity with org-specific field mappings.
        
        This method is designed to be overridden by org-specific subclasses
        to customize field mapping, add custom fields, or apply business rules.
        
        The base implementation returns the entity unchanged.
        
        Args:
            record: Raw Smithsonian API record
            base_entity: Base canonical entity (already populated with standard fields)
            
        Returns:
            Transformed canonical entity (can add/modify fields in base_entity)
            
        Example override:
            def transform_entity(self, record, base_entity):
                # Add custom field
                base_entity['custom_category'] = self._extract_category(record)
                
                # Modify existing field
                base_entity['title'] = base_entity['title'].upper()
                
                return base_entity
        """
        return base_entity

    def extract_title(self, record: dict[str, Any]) -> str:
        """
        Extract title from Smithsonian record.
        
        Can be overridden by subclasses for custom title extraction logic.
        
        Args:
            record: Raw Smithsonian record
            
        Returns:
            Extracted title string
        """
        # Try descriptiveNonRepeating.title first (most common)
        title = record.get("title")
        if title:
            return str(title)
        
        # Try content.descriptiveNonRepeating.title
        content = record.get("content", {})
        desc_non_rep = content.get("descriptiveNonRepeating", {})
        title_obj = desc_non_rep.get("title", {})
        
        if isinstance(title_obj, dict):
            title = title_obj.get("content") or title_obj.get("label")
        elif isinstance(title_obj, str):
            title = title_obj
        
        if title:
            return str(title)
        
        # Fallback to ID
        return f"Smithsonian Object {record.get('id', 'Unknown')}"

    def extract_date(self, record: dict[str, Any]) -> str | None:
        """
        Extract modification date from record.
        
        Can be overridden by subclasses for custom date extraction.
        
        Args:
            record: Raw Smithsonian record
            
        Returns:
            Date string or None
        """
        # Try various date fields
        date_fields = [
            "timestamp",
            "lastModified",
            "content.descriptiveNonRepeating.metadata_usage.metadata_updated",
        ]
        
        for field in date_fields:
            if "." in field:
                # Nested field
                parts = field.split(".")
                value = record
                for part in parts:
                    value = value.get(part, {})
                    if not isinstance(value, dict):
                        break
                if value and not isinstance(value, dict):
                    return str(value)
            else:
                value = record.get(field)
                if value:
                    return str(value)
        
        return None

    def extract_thumbnail(self, record: dict[str, Any]) -> str | None:
        """
        Extract thumbnail URL from record.
        
        Can be overridden by subclasses for custom thumbnail extraction.
        
        Args:
            record: Raw Smithsonian record
            
        Returns:
            Thumbnail URL or None
        """
        # Try online_media
        content = record.get("content", {})
        desc_non_rep = content.get("descriptiveNonRepeating", {})
        online_media = desc_non_rep.get("online_media", {})
        
        if isinstance(online_media, dict):
            media_list = online_media.get("media", [])
            if media_list and isinstance(media_list, list):
                first_media = media_list[0]
                if isinstance(first_media, dict):
                    thumbnail = first_media.get("thumbnail")
                    if thumbnail:
                        return str(thumbnail)
        
        # Try idsId (image thumbnail)
        ids_id = desc_non_rep.get("idsId")
        if ids_id:
            # Construct thumbnail URL from idsId
            return f"https://ids.si.edu/ids/deliveryService?id={ids_id}&max=150"
        
        return None
