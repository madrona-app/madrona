"""
Transform CollectionObjects to OpenSearch documents.

Maps procedure fields to search-optimized documents following
GLAM sector search conventions.
"""

import re
from datetime import datetime, timezone
from typing import Any, Optional
import logging

logger = logging.getLogger(__name__)

# Simple HTML tag stripping for embedding text
_HTML_TAG_RE = re.compile(r"<[^>]+>")

# Fields kept out of the index for NAGPRA access-restricted objects
# (43 CFR 10 duty of care). Identity fields (object number, title, name,
# type, classification) stay indexed so staff can still locate the record;
# interpretive, locational and associative content is never indexed.
NAGPRA_REDACTED_FIELDS = (
    "full_description",
    "provenance",
    "inscriptions",
    "subjects",
    "creation_place",
    "current_location",
    "condition",
    "associated_people",
    "associated_places",
)


class CollectionObjectTransformer:
    """Transforms CollectionObject records to OpenSearch documents."""

    def transform(self, obj: Any, include_embedding: bool = False) -> dict:
        """
        Transform a CollectionObject to an OpenSearch document.

        NAGPRA access-restricted objects are redacted at ingestion: sensitive
        fields are never written to the index and no semantic embedding is
        generated. Because ``index_document`` is a full replace, re-indexing
        after a consent change also removes previously indexed content.

        Args:
            obj: CollectionObject SQLAlchemy model instance
            include_embedding: If True, generate a semantic embedding via Ollama

        Returns:
            OpenSearch document ready for indexing
        """
        from app.services.nagpra_restrictions import is_access_restricted_for_index

        nagpra_restricted = is_access_restricted_for_index(obj)

        doc = {
            # Identity
            "object_id": str(obj.object_id),
            "organization_id": str(obj.organization_id),
            "object_number": obj.object_number,

            # Core searchable fields (Object Identification)
            # Note: 'title' is the display title for search; full titles array is not indexed
            "title": self._get_display_title(obj.title_links),
            "object_name": obj.object_name,
            "brief_description": obj.brief_description,
            "full_description": obj.full_description,

            # Classification (Object Description)
            # Note: 'classification' is singular for filtering; uses first classification
            "object_type": obj.object_type,
            "classification": self._get_primary_classification(obj),
            "category": obj.category,
            "object_status": obj.object_status,
            "is_discoverable": getattr(obj, 'is_discoverable', False),
            "has_primary_image": self._has_primary_image(obj),

            # Creators (Production)
            # Merge JSONB creators with linked Person Authorities
            "creators": self._extract_creators(obj.creators, obj),

            # Person authority links count (for People indicator)
            "person_authority_count": self._count_person_authorities(obj),

            # Materials & Techniques (Technical Description)
            "materials": self._extract_materials(obj.materials),
            "techniques": self._extract_techniques(obj.techniques),

            # Subject matter (Content)
            "subjects": self._extract_subjects(obj.subjects),
            "style_period": obj.style_period,

            # Dates (Production)
            "creation_date": self._extract_creation_date(obj),
            "creation_place": obj.creation_place,

            # Physical description (Measurements)
            "measurements": self._extract_measurements(obj.measurement_links),
            "inscriptions": self._extract_inscriptions(obj.inscription_links),

            # History (Provenance)
            "provenance": obj.provenance,
            "credit_line": obj.credit_line,
            "acquisition_method": obj.acquisition_method,
            "acquisition_date": self._format_date(obj.acquisition_date),

            # Location (Location)
            "current_location": self._extract_location(obj),

            # Condition (Condition)
            "condition": self._extract_condition(obj),

            # Associations (Associations)
            "associated_people": self._extract_associated_people(obj.associated_people),
            "associated_places": self._extract_associated_places(obj.associated_places),

            # Rights - managed via ObjectRight records

            # Timestamps
            "created_at": self._format_datetime(obj.created_at),
            "updated_at": self._format_datetime(obj.updated_at),
            "indexed_at": datetime.now(timezone.utc).isoformat(),
        }

        # NAGPRA access gate: strip sensitive content before it ever
        # reaches the index (never-embedded, not filtered at query time)
        if nagpra_restricted:
            for field in NAGPRA_REDACTED_FIELDS:
                doc[field] = None

        # Optionally generate semantic embedding (never for restricted objects)
        if include_embedding and not nagpra_restricted:
            semantic_text = self.compose_semantic_text(obj, restricted=False)
            if semantic_text:
                try:
                    from app.services.embedding_service import get_embedding
                    embedding = get_embedding(semantic_text)
                    if embedding:
                        doc["semantic_embedding"] = embedding
                except Exception as e:
                    logger.warning("Embedding generation failed for %s: %s", obj.object_id, e)

        # Remove None values
        return {k: v for k, v in doc.items() if v is not None}

    def compose_semantic_text(self, obj: Any, restricted: Optional[bool] = None) -> Optional[str]:
        """
        Compose a natural-language text for semantic embedding.

        Uses descriptive prose rather than structured labels because embedding
        models (nomic-embed-text) perform dramatically better with natural
        language. E.g., "a painting about flowers and still life" embeds far
        closer to "flowers" than "Depicts: Flowers, Still Life".

        Returns None for NAGPRA access-restricted objects — their record
        content must never be embedded. Callers that already know the
        restriction state can pass ``restricted`` to skip the lookup.

        Capped at 6000 characters.
        """
        if restricted is None:
            from app.services.nagpra_restrictions import is_access_restricted_for_index
            restricted = is_access_restricted_for_index(obj)
        if restricted:
            return None

        parts = []

        # Title — the most distinctive identifier
        title = self._get_display_title(obj.title_links)

        # Build a natural-language description opening
        obj_type = _HTML_TAG_RE.sub("", obj.object_type or "")
        obj_type_lower = obj_type.lower().strip()
        # Only include type if it adds meaning (skip generic terms)
        type_phrase = ""
        if obj_type_lower and obj_type_lower not in ("painting", "print", "photograph"):
            article = "an" if obj_type_lower[0] in "aeiou" else "a"
            type_phrase = f", {article} {obj_type_lower}"

        # Subjects — compose as natural language
        subjects = self._extract_subjects(obj.subjects)
        subject_phrase = ""
        if subjects:
            terms = [s["term"].lower() for s in subjects if s.get("term")]
            if terms:
                subject_phrase = f" depicting {', '.join(terms)}"

        # Compose the opening sentence
        if title:
            if type_phrase or subject_phrase:
                parts.append(f"{title}{type_phrase}{subject_phrase}")
            else:
                parts.append(title)

        # Style/period — useful for era-based queries
        if obj.style_period:
            parts.append(f"From the {obj.style_period}")

        # Creation place — useful for origin-based queries
        if obj.creation_place:
            parts.append(f"Origin: {obj.creation_place}")

        # Descriptions — rich semantic content when available
        if obj.full_description:
            parts.append(obj.full_description)
        elif obj.brief_description and obj.brief_description != obj.object_type:
            parts.append(obj.brief_description)

        # Inscriptions — often contain unique descriptive text
        inscriptions = self._extract_inscriptions(obj.inscription_links)
        if inscriptions:
            parts.append(inscriptions)

        if not parts:
            return None

        text = ". ".join(parts)
        # Strip any HTML tags (e.g., <i>Gusoku</i> → Gusoku)
        text = _HTML_TAG_RE.sub("", text)
        return text[:6000]

    def _has_primary_image(self, obj: Any) -> bool:
        """Check if the object has any linked published media."""
        if hasattr(obj, 'media_links') and obj.media_links:
            for link in obj.media_links:
                if hasattr(link, 'media') and link.media and getattr(link.media, 'is_published', False):
                    return True
        return False

    def _extract_creators(self, creators: Optional[list], obj: Any = None) -> Optional[list[dict]]:
        """
        Extract creator information from JSONB field AND linked Person Authorities.

        Supports both legacy format and new authority-backed format:
        - Legacy: {"name": "...", "ulan_id": "..."}
        - New: {"value": "...", "authorities": [{uri, source}]}
        - Relational: ConstituentXref links to Constituent records
        """
        result = []
        seen_authority_ids = set()

        # First, extract from linked Constituents via ConstituentXrefs
        if obj and hasattr(obj, 'constituent_xrefs') and obj.constituent_xrefs:
            for xref in obj.constituent_xrefs:
                if not hasattr(xref, 'constituent') or not xref.constituent:
                    continue

                constituent = xref.constituent
                seen_authority_ids.add(str(constituent.constituent_id))

                creator = {
                    "name": xref.display_name_override or constituent.display_name or constituent.name,
                    "role": xref.role or "creator",
                    "authority_id": str(constituent.constituent_id),
                }

                if xref.attribution_certainty:
                    creator["attribution"] = xref.attribution_certainty

                # Extract authority URIs from the Constituent record
                authority_uris = []
                if constituent.ulan_id:
                    creator["ulan_id"] = constituent.ulan_id
                    authority_uris.append(f"http://vocab.getty.edu/ulan/{constituent.ulan_id}")
                if constituent.viaf_id:
                    creator["viaf_id"] = constituent.viaf_id
                    authority_uris.append(f"http://viaf.org/viaf/{constituent.viaf_id}")
                if constituent.wikidata_id:
                    creator["wikidata_id"] = constituent.wikidata_id
                    authority_uris.append(f"http://www.wikidata.org/entity/{constituent.wikidata_id}")

                if authority_uris:
                    creator["authority_uris"] = authority_uris

                result.append(creator)

        # Then, extract from JSONB creators field (for backward compatibility)
        if creators:
            for c in creators:
                if isinstance(c, dict):
                    # Support both "value" (new) and "name" (legacy) keys
                    name = c.get("value") or c.get("name")
                    if not name:
                        continue

                    creator = {
                        "name": name,
                        "role": c.get("role", "creator"),
                    }

                    if c.get("attribution"):
                        creator["attribution"] = c["attribution"]

                    # Extract authority URIs for search faceting
                    authority_uris = []

                    # New authorities array format
                    if c.get("authorities"):
                        for auth in c["authorities"]:
                            if isinstance(auth, dict) and auth.get("uri"):
                                authority_uris.append(auth["uri"])
                                # Also extract source-specific IDs for backward compatibility
                                source = auth.get("source", "").upper()
                                if source == "ULAN" and "ulan/" in auth["uri"]:
                                    creator["ulan_id"] = auth["uri"].split("ulan/")[-1]
                                elif source == "VIAF" and "viaf/" in auth["uri"]:
                                    creator["viaf_id"] = auth["uri"].split("viaf/")[-1]
                                elif source == "WIKIDATA" and "entity/" in auth["uri"]:
                                    creator["wikidata_id"] = auth["uri"].split("entity/")[-1]

                    # Legacy ulan_id field (backward compatibility)
                    if c.get("ulan_id") and not creator.get("ulan_id"):
                        creator["ulan_id"] = c["ulan_id"]
                        authority_uris.append(f"http://vocab.getty.edu/ulan/{c['ulan_id']}")

                    if authority_uris:
                        creator["authority_uris"] = authority_uris

                    result.append(creator)
                elif isinstance(c, str) and c.strip():
                    result.append({"name": c.strip(), "role": "creator"})

        return result if result else None

    def _count_person_authorities(self, obj: Any) -> int:
        """Count linked Constituents for the People indicator."""
        if hasattr(obj, 'constituent_xrefs') and obj.constituent_xrefs:
            return len(obj.constituent_xrefs)
        return 0

    def _get_display_title(self, title_links) -> Optional[str]:
        """Get the preferred display title from title_links relationship."""
        if not title_links:
            return None
        preferred = next((t for t in title_links if t.is_preferred), None)
        if preferred:
            return preferred.title
        return title_links[0].title if title_links else None

    def _get_primary_classification(self, obj) -> Optional[str]:
        """Get the primary classification for filtering."""
        if hasattr(obj, 'classification_links') and obj.classification_links:
            first = obj.classification_links[0]
            if first.lookup_value:
                return first.lookup_value.value_key
        return None

    def _extract_materials(self, materials: Optional[list]) -> Optional[list[dict]]:
        """
        Extract material information from JSONB field.

        Supports both legacy format and new authority-backed format:
        - Legacy: {"name": "...", "aat_id": "..."}
        - New: {"value": "...", "authorities": [{uri, source}]}
        """
        if not materials:
            return None

        result = []
        for m in materials:
            if isinstance(m, dict):
                # Support both "value" (new) and "name" (legacy) keys
                name = m.get("value") or m.get("name")
                if not name:
                    continue

                material = {"name": name}

                if m.get("part"):
                    material["part"] = m["part"]

                # Extract authority URIs
                authority_uris = []

                # New authorities array format
                if m.get("authorities"):
                    for auth in m["authorities"]:
                        if isinstance(auth, dict) and auth.get("uri"):
                            authority_uris.append(auth["uri"])
                            source = auth.get("source", "").upper()
                            if source == "AAT" and "aat/" in auth["uri"]:
                                material["aat_id"] = auth["uri"].split("aat/")[-1]

                # Legacy aat_id field (backward compatibility)
                if m.get("aat_id") and not material.get("aat_id"):
                    material["aat_id"] = m["aat_id"]
                    authority_uris.append(f"http://vocab.getty.edu/aat/{m['aat_id']}")

                if authority_uris:
                    material["authority_uris"] = authority_uris

                result.append(material)
            elif isinstance(m, str) and m.strip():
                result.append({"name": m.strip()})

        return result if result else None

    def _extract_techniques(self, techniques: Optional[list]) -> Optional[list[dict]]:
        """
        Extract technique information from JSONB field.

        Supports both legacy format and new authority-backed format:
        - Legacy: {"name": "...", "aat_id": "..."}
        - New: {"value": "...", "authorities": [{uri, source}]}
        """
        if not techniques:
            return None

        result = []
        for t in techniques:
            if isinstance(t, dict):
                # Support both "value" (new) and "name" (legacy) keys
                name = t.get("value") or t.get("name")
                if not name:
                    continue

                technique = {"name": name}

                # Extract authority URIs
                authority_uris = []

                # New authorities array format
                if t.get("authorities"):
                    for auth in t["authorities"]:
                        if isinstance(auth, dict) and auth.get("uri"):
                            authority_uris.append(auth["uri"])
                            source = auth.get("source", "").upper()
                            if source == "AAT" and "aat/" in auth["uri"]:
                                technique["aat_id"] = auth["uri"].split("aat/")[-1]

                # Legacy aat_id field (backward compatibility)
                if t.get("aat_id") and not technique.get("aat_id"):
                    technique["aat_id"] = t["aat_id"]
                    authority_uris.append(f"http://vocab.getty.edu/aat/{t['aat_id']}")

                if authority_uris:
                    technique["authority_uris"] = authority_uris

                result.append(technique)
            elif isinstance(t, str) and t.strip():
                result.append({"name": t.strip()})

        return result if result else None

    def _extract_subjects(self, subjects: Optional[list]) -> Optional[list[dict]]:
        """Extract subject terms."""
        if not subjects:
            return None

        result = []
        for s in subjects:
            if isinstance(s, dict):
                subject = {
                    "term": s.get("term") or s.get("name"),
                    "type": s.get("type", "topic"),
                }
                if subject["term"]:
                    result.append(subject)
            elif isinstance(s, str) and s.strip():
                result.append({"term": s.strip(), "type": "topic"})

        return result if result else None

    def _extract_creation_date(self, obj: Any) -> Optional[dict]:
        """Extract creation date information."""
        dates = {}

        if obj.creation_date_display:
            dates["display"] = obj.creation_date_display

        if obj.creation_date_earliest:
            dates["earliest"] = self._format_date(obj.creation_date_earliest)

        if obj.creation_date_latest:
            dates["latest"] = self._format_date(obj.creation_date_latest)

        return dates if dates else None

    def _extract_measurements(self, measurement_links) -> Optional[dict]:
        """Extract measurement information from measurement_links relationship."""
        if not measurement_links:
            return None

        result = {}

        # Build display string from measurement link records
        display_parts = []
        for m in measurement_links:
            dim_type = (m.dimension or "").lower()
            value = float(m.value) if m.value is not None else None
            unit = m.unit or "cm"

            if value is not None:
                display_parts.append(f"{dim_type}: {value} {unit}")

                # Map to specific fields
                if dim_type == "height":
                    result["height_cm"] = self._to_cm(value, unit)
                elif dim_type == "width":
                    result["width_cm"] = self._to_cm(value, unit)
                elif dim_type == "depth":
                    result["depth_cm"] = self._to_cm(value, unit)
                elif dim_type == "weight":
                    result["weight_kg"] = self._to_kg(value, unit)

        if display_parts:
            result["display"] = "; ".join(display_parts)

        return result if result else None

    def _to_cm(self, value: Any, unit: str) -> Optional[float]:
        """Convert measurement to centimeters."""
        try:
            val = float(value)
            unit = unit.lower()
            if unit in ("cm", "centimeter", "centimeters"):
                return val
            elif unit in ("m", "meter", "meters"):
                return val * 100
            elif unit in ("mm", "millimeter", "millimeters"):
                return val / 10
            elif unit in ("in", "inch", "inches"):
                return val * 2.54
            elif unit in ("ft", "foot", "feet"):
                return val * 30.48
            return val  # Assume cm if unknown
        except (ValueError, TypeError):
            return None

    def _to_kg(self, value: Any, unit: str) -> Optional[float]:
        """Convert weight to kilograms."""
        try:
            val = float(value)
            unit = unit.lower()
            if unit in ("kg", "kilogram", "kilograms"):
                return val
            elif unit in ("g", "gram", "grams"):
                return val / 1000
            elif unit in ("lb", "lbs", "pound", "pounds"):
                return val * 0.453592
            elif unit in ("oz", "ounce", "ounces"):
                return val * 0.0283495
            return val
        except (ValueError, TypeError):
            return None

    def _extract_inscriptions(self, inscription_links) -> Optional[str]:
        """Extract inscription text from inscription_links relationship."""
        if not inscription_links:
            return None

        texts = []
        for i in inscription_links:
            if i.content and i.content.strip():
                texts.append(i.content.strip())

        return " | ".join(texts) if texts else None

    def _extract_location(self, obj: Any) -> Optional[dict]:
        """Extract current location information."""
        if not obj.current_location_id:
            return None

        location = {
            "location_id": str(obj.current_location_id),
        }

        # If location is loaded via relationship
        if hasattr(obj, "current_location") and obj.current_location:
            loc = obj.current_location
            location["name"] = loc.name
            location["type"] = loc.location_type
            # Determine if on display based on location type
            location["on_display"] = loc.location_type in ("gallery", "exhibition")

        return location

    def _extract_condition(self, obj: Any) -> Optional[dict]:
        """Extract condition information from the latest condition report."""
        reports = getattr(obj, "condition_reports", None)
        if not reports:
            return None

        latest = reports[0]  # ordered by report_date desc
        if not latest.overall_condition:
            return None

        condition: dict = {
            "rating": latest.overall_condition,
        }

        if latest.report_date:
            condition["date"] = self._format_date(latest.report_date)

        return condition

    def _extract_associated_people(self, people: Optional[list]) -> Optional[list[dict]]:
        """Extract associated people."""
        if not people:
            return None

        result = []
        for p in people:
            if isinstance(p, dict):
                person = {
                    "name": p.get("name"),
                    "role": p.get("role"),
                }
                if person["name"]:
                    result.append(person)

        return result if result else None

    def _extract_associated_places(self, places: Optional[list]) -> Optional[list[dict]]:
        """
        Extract associated places.

        Supports both legacy format and new authority-backed format:
        - Legacy: {"name": "...", "tgn_id": "..."}
        - New: {"value": "...", "authorities": [{uri, source}]}
        """
        if not places:
            return None

        result = []
        for p in places:
            if isinstance(p, dict):
                # Support both "value" (new) and "name" (legacy) keys
                name = p.get("value") or p.get("name")
                if not name:
                    continue

                place = {
                    "name": name,
                    "role": p.get("role") or p.get("place_type"),
                }

                # Extract authority URIs
                authority_uris = []

                # New authorities array format
                if p.get("authorities"):
                    for auth in p["authorities"]:
                        if isinstance(auth, dict) and auth.get("uri"):
                            authority_uris.append(auth["uri"])
                            source = auth.get("source", "").upper()
                            if source == "TGN" and "tgn/" in auth["uri"]:
                                place["tgn_id"] = auth["uri"].split("tgn/")[-1]
                            elif source == "GEONAMES" and "geonames.org/" in auth["uri"]:
                                place["geonames_id"] = auth["uri"].split("/")[-2]

                # Legacy tgn_id field (backward compatibility)
                if p.get("tgn_id") and not place.get("tgn_id"):
                    place["tgn_id"] = p["tgn_id"]
                    authority_uris.append(f"http://vocab.getty.edu/tgn/{p['tgn_id']}")

                # Coordinates if present
                if p.get("coordinates"):
                    place["coordinates"] = p["coordinates"]

                if authority_uris:
                    place["authority_uris"] = authority_uris

                result.append(place)

        return result if result else None

    def _format_date(self, d: Any) -> Optional[str]:
        """Format date to ISO string."""
        if d is None:
            return None
        if hasattr(d, "isoformat"):
            return d.isoformat()
        return str(d)

    def _format_datetime(self, dt: Any) -> Optional[str]:
        """Format datetime to ISO string."""
        if dt is None:
            return None
        if isinstance(dt, datetime):
            return dt.isoformat()
        return str(dt)
