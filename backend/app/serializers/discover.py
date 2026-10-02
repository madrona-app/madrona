"""
Discover/public serialization helpers.

Extracted from app/api/discover_public.py for use by FastAPI routers,
agent services, and tasks without pulling in Flask route dependencies.
"""
from __future__ import annotations


def _extract_creators_list(creators):
    """Extract creator name strings from JSONB array."""
    if not creators:
        return []
    result = []
    for c in creators:
        if isinstance(c, dict):
            name = c.get("value") or c.get("name")
            if name:
                result.append(name)
        elif isinstance(c, str) and c.strip():
            result.append(c.strip())
    return result


def _get_primary_classification(obj):
    """Get first classification term from classification_links relationship."""
    if hasattr(obj, 'classification_links') and obj.classification_links:
        first = obj.classification_links[0]
        if first.lookup_value:
            return first.lookup_value.label
    return None


def _build_related_should_clauses(obj, relationship_type: str = "all") -> list[dict]:
    """
    Build OpenSearch bool should clauses for finding objects related to `obj`.

    Args:
        obj: A CollectionObject with creators, style_period, classifications,
             creation_place, materials, and object_type attributes.
        relationship_type: Filter to a specific relationship. One of:
            "all", "same_artist", "same_period", "same_materials", "same_place".
    """
    should_clauses = []

    # Same creator (nested, boost 3.0)
    if relationship_type in ("all", "same_artist"):
        creator_names = _extract_creators_list(obj.creators)
        for name in creator_names[:3]:
            should_clauses.append({
                "nested": {
                    "path": "creators",
                    "query": {
                        "term": {"creators.name.keyword": {"value": name, "boost": 3.0}}
                    }
                }
            })

    # Same style/period (boost 2.5)
    if relationship_type in ("all", "same_period") and obj.style_period:
        should_clauses.append({
            "term": {"style_period": {"value": obj.style_period, "boost": 2.5}}
        })

    # Same classification (boost 2.0)
    if relationship_type in ("all",):
        primary_classification = _get_primary_classification(obj)
        if primary_classification:
            should_clauses.append({
                "term": {"classification": {"value": primary_classification, "boost": 2.0}}
            })

    # Same creation place (boost 1.5)
    if relationship_type in ("all", "same_place") and obj.creation_place:
        should_clauses.append({
            "term": {"creation_place.keyword": {"value": obj.creation_place, "boost": 1.5}}
        })

    # Same materials (nested, boost 1.0)
    if relationship_type in ("all", "same_materials") and obj.materials:
        for mat in obj.materials[:3]:
            mat_name = mat.get("value") or mat.get("name") if isinstance(mat, dict) else str(mat)
            if mat_name:
                should_clauses.append({
                    "nested": {
                        "path": "materials",
                        "query": {
                            "term": {"materials.name.keyword": {"value": mat_name, "boost": 1.0}}
                        }
                    }
                })

    # Same object type (boost 1.0)
    if relationship_type in ("all",) and obj.object_type:
        should_clauses.append({
            "term": {"object_type": {"value": obj.object_type, "boost": 1.0}}
        })

    return should_clauses
