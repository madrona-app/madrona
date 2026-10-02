"""
Transform Madrona entities to OpenSearch documents.

Extracts and normalizes fields from the canonical entity payload
to create search-optimized documents.
"""

from datetime import datetime, timezone
from typing import Any, Optional
import logging

logger = logging.getLogger(__name__)


class EntityDocumentTransformer:
    """Transforms entity payloads to OpenSearch documents."""

    def transform(self, outbox_payload: dict) -> dict:
        """
        Transform an outbox payload to an OpenSearch document.

        Args:
            outbox_payload: Raw payload from search_outbox table

        Returns:
            OpenSearch document ready for indexing
        """
        entity_payload = outbox_payload.get('payload', {}) or {}

        doc = {
            # Identity fields
            'organization_id': outbox_payload.get('organization_id'),
            'entity_key': outbox_payload.get('entity_key'),
            'entity_type': outbox_payload.get('entity_type'),
            'source_system': outbox_payload.get('source_system'),
            'source_id': outbox_payload.get('source_id'),
            'dataset_id': outbox_payload.get('dataset_id'),

            # Core searchable fields
            'title': self._extract_title(entity_payload),
            'object_number': self._extract_object_number(entity_payload),
            'description': self._extract_description(entity_payload),
            'thumbnail_url': entity_payload.get('thumbnail_url'),

            # Structured fields
            'creators': self._extract_creators(entity_payload),
            'classifications': self._extract_classifications(entity_payload),
            'dates': self._extract_dates(entity_payload),
            'dimensions': self._extract_dimensions(entity_payload),
            'location': self._extract_location(entity_payload),

            # Dynamic fields for org-specific data
            'dynamic_fields': self._extract_dynamic_fields(entity_payload),

            # Timestamps
            'last_seen_at': self._format_timestamp(outbox_payload.get('last_seen_at')),
            'updated_at': self._format_timestamp(outbox_payload.get('updated_at')),
            'indexed_at': datetime.now(timezone.utc).isoformat(),
        }

        # Remove None values to keep documents clean
        return {k: v for k, v in doc.items() if v is not None}

    def _format_timestamp(self, ts: Any) -> Optional[str]:
        """Format timestamp to ISO string."""
        if ts is None:
            return None
        if isinstance(ts, datetime):
            return ts.isoformat()
        if isinstance(ts, str):
            return ts
        return str(ts)

    def _extract_title(self, payload: dict) -> Optional[str]:
        """Extract title from various possible locations."""
        # Check canonical schema first
        if payload.get('label'):
            return payload['label'].strip() if isinstance(payload['label'], str) else None

        # Check properties (canonical schema)
        props = payload.get('properties', {})
        if props.get('title'):
            return props['title'].strip() if isinstance(props['title'], str) else None

        # Fallback to common field names
        candidates = [
            payload.get('title'),
            payload.get('name'),
            payload.get('display_title'),
        ]
        for c in candidates:
            if c and isinstance(c, str):
                return c.strip()
        return None

    def _extract_object_number(self, payload: dict) -> Optional[str]:
        """Extract object/accession number."""
        candidates = [
            payload.get('object_number'),
            payload.get('accession_number'),
            payload.get('identifier'),
            payload.get('id_number'),
        ]
        for c in candidates:
            if c and isinstance(c, str):
                return c.strip()
        return None

    def _extract_description(self, payload: dict) -> Optional[str]:
        """Extract description text."""
        candidates = [
            payload.get('description'),
            payload.get('summary'),
            payload.get('notes'),
            payload.get('scope_content'),
        ]
        parts = [c for c in candidates if c and isinstance(c, str)]
        return ' '.join(parts) if parts else None

    def _extract_creators(self, payload: dict) -> list[dict]:
        """Extract creator/artist information."""
        creators = []

        # Check canonical schema properties.creator first
        props = payload.get('properties', {})
        if props.get('creator'):
            creator_val = props['creator']
            if isinstance(creator_val, str) and creator_val.strip():
                creators.append({'name': creator_val.strip(), 'role': 'creator'})
            elif isinstance(creator_val, list):
                for c in creator_val:
                    if isinstance(c, str) and c.strip():
                        creators.append({'name': c.strip(), 'role': 'creator'})

        # Check relationships in canonical schema
        for rel in payload.get('relationships', []):
            if isinstance(rel, dict) and rel.get('type') in ('creator', 'artist', 'author', 'maker'):
                name = rel.get('label') or rel.get('name')
                if name:
                    creators.append({
                        'name': name,
                        'role': rel.get('type', 'creator'),
                        'id': rel.get('target_id'),
                    })

        # Handle various other creator field formats
        raw_creators = (
            payload.get('creators') or
            payload.get('artists') or
            payload.get('agents') or
            []
        )

        if isinstance(raw_creators, list):
            for c in raw_creators:
                if isinstance(c, dict):
                    name = c.get('name') or c.get('display_name')
                    if name:
                        creators.append({
                            'name': name,
                            'role': c.get('role') or c.get('relationship') or 'creator',
                            'id': c.get('id') or c.get('agent_id'),
                        })
                elif isinstance(c, str) and c.strip():
                    creators.append({'name': c.strip(), 'role': 'creator'})
        elif isinstance(raw_creators, str) and raw_creators.strip():
            creators.append({'name': raw_creators.strip(), 'role': 'creator'})

        return creators if creators else None

    def _extract_classifications(self, payload: dict) -> list[dict]:
        """Extract classification/taxonomy information."""
        classifications = []

        raw = payload.get('classifications') or payload.get('subjects') or []

        if isinstance(raw, list):
            for c in raw:
                if isinstance(c, dict):
                    label = c.get('label') or c.get('term') or c.get('name')
                    if label:
                        classifications.append({
                            'scheme': c.get('scheme') or c.get('vocabulary'),
                            'term_id': c.get('term_id') or c.get('id'),
                            'label': label,
                        })
                elif isinstance(c, str) and c.strip():
                    classifications.append({'label': c.strip()})

        return classifications if classifications else None

    def _extract_dates(self, payload: dict) -> Optional[dict]:
        """Extract date information."""
        dates = {}

        # Check canonical schema properties.date first
        props = payload.get('properties', {})
        if props.get('date'):
            dates['created_display'] = props['date']
            # Try to parse as structured date for range queries
            date_val = props['date']
            if isinstance(date_val, str) and len(date_val) >= 4:
                try:
                    # Only treat as year if it's exactly 4 digits and a reasonable year
                    if len(date_val) == 4 and date_val.isdigit():
                        year = int(date_val)
                        # Sanity check: year should be between 1000 and 2100
                        if 1000 <= year <= 2100:
                            dates['created_earliest'] = f"{date_val}-01-01"
                    # Check for proper ISO date format (YYYY-MM-DD where MM and DD are valid)
                    elif (len(date_val) >= 10 and
                          date_val[:4].isdigit() and date_val[4] == '-' and
                          date_val[5:7].isdigit() and date_val[7] == '-' and
                          date_val[8:10].isdigit()):
                        # Validate it's a reasonable date
                        year = int(date_val[:4])
                        month = int(date_val[5:7])
                        day = int(date_val[8:10])
                        if 1000 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31:
                            dates['created_earliest'] = date_val[:10]
                except (ValueError, IndexError):
                    pass

        # Display date (human-readable) from other locations
        if 'created_display' not in dates:
            display = (
                payload.get('date_display') or
                payload.get('creation_date') or
                payload.get('date')
            )
            if display:
                dates['created_display'] = display

        # Structured dates for range queries
        if 'date_earliest' in payload:
            dates['created_earliest'] = payload['date_earliest']
        if 'date_latest' in payload:
            dates['created_latest'] = payload['date_latest']
        if 'acquisition_date' in payload:
            dates['acquired'] = payload['acquisition_date']

        return dates if dates else None

    def _extract_dimensions(self, payload: dict) -> Optional[dict]:
        """Extract dimension information."""
        dims = {}

        raw = payload.get('dimensions') or {}
        if isinstance(raw, dict):
            if raw.get('display'):
                dims['display'] = raw['display']
            if raw.get('height_cm') or raw.get('height'):
                dims['height_cm'] = raw.get('height_cm') or raw.get('height')
            if raw.get('width_cm') or raw.get('width'):
                dims['width_cm'] = raw.get('width_cm') or raw.get('width')
            if raw.get('depth_cm') or raw.get('depth'):
                dims['depth_cm'] = raw.get('depth_cm') or raw.get('depth')
        elif isinstance(raw, str) and raw.strip():
            dims['display'] = raw.strip()

        return dims if dims else None

    def _extract_location(self, payload: dict) -> Optional[dict]:
        """Extract location/gallery information."""
        loc = {}

        raw = payload.get('location') or payload.get('current_location') or {}
        if isinstance(raw, dict):
            if raw.get('gallery') or raw.get('name'):
                loc['gallery'] = raw.get('gallery') or raw.get('name')
            if 'on_display' in raw:
                loc['on_display'] = raw['on_display']
            elif 'is_public' in raw:
                loc['on_display'] = raw['is_public']
        elif isinstance(raw, str) and raw.strip():
            loc['gallery'] = raw.strip()

        return loc if loc else None

    def _extract_dynamic_fields(self, payload: dict) -> Optional[dict]:
        """
        Extract organization-specific fields into flattened structure.

        These are fields that don't map to standard schema but should
        still be searchable.
        """
        # Standard fields to exclude
        standard_fields = {
            'title', 'name', 'label', 'display_title',
            'object_number', 'accession_number', 'identifier', 'id_number',
            'description', 'summary', 'notes', 'scope_content',
            'creators', 'artists', 'agents',
            'classifications', 'subjects',
            'dimensions', 'location', 'current_location',
            'date_display', 'creation_date', 'date',
            'date_earliest', 'date_latest', 'acquisition_date',
            'thumbnail_url', 'canonical_url',
        }

        dynamic = {}
        for key, value in payload.items():
            if key not in standard_fields and value is not None:
                # Flatten nested structures
                if isinstance(value, dict):
                    for k, v in value.items():
                        if v is not None and not isinstance(v, (dict, list)):
                            dynamic[f"{key}.{k}"] = str(v)
                elif isinstance(value, list):
                    # Join list items
                    str_items = [str(v) for v in value if v is not None and not isinstance(v, (dict, list))]
                    if str_items:
                        dynamic[key] = ' '.join(str_items)
                elif not isinstance(value, (dict, list)):
                    dynamic[key] = str(value)

        return dynamic if dynamic else None
