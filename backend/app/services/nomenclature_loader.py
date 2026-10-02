"""
Nomenclature 4.0 loader.

Loads Nomenclature for Museum Cataloging (AASLH, 4th edition) into the
vocabulary_terms table as global (organization_id=NULL) terms with
vocabulary='nomenclature'.

Nomenclature is a 4-level hierarchical classification system:
    Category → Classification → Sub-classification → Object Term

Example: Personal Artifact → Clothing → Outerwear → Coat

Data source:
    The full Nomenclature 4.0 dataset is published by AASLH at
    https://www.aaslh.org/nomenclature/ under license. Institutions with
    a license can provide a CSV export with columns:
        Category, Classification, Sub-classification, Object Term, Scope Note, ID

    A starter set (top-level categories and classifications) ships with
    Madrona. Full licensed data can be loaded via load_from_csv().

Usage:
    # Load built-in starter set
    from app.services.nomenclature_loader import load_starter_set
    load_starter_set(db_session)

    # Load full licensed CSV
    from app.services.nomenclature_loader import load_from_csv
    load_from_csv(db_session, "/path/to/nomenclature.csv")
"""

from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.vocabulary import VocabularyTerm

logger = logging.getLogger(__name__)

VOCABULARY_KEY = "nomenclature"

# Fields where Nomenclature terms are applicable
APPLICABLE_FIELDS = ["classification", "object_type", "category"]

# Starter set — top-level Nomenclature 4.0 categories and representative
# classifications. This gives Madrona something useful out of the box while
# institutions with licensed data can load the full hierarchy via CSV.
# Categories are from Nomenclature 4.0 as published by AASLH.
STARTER_HIERARCHY: list[dict[str, Any]] = [
    # Category 1: Built Environment Artifacts
    {"id": "1", "term": "Built Environment Artifact", "parent": None,
     "scope": "Artifacts originally created for use in the built environment of human habitation."},
    {"id": "1.1", "term": "Building", "parent": "1"},
    {"id": "1.2", "term": "Building Component", "parent": "1"},
    {"id": "1.3", "term": "Site Feature", "parent": "1"},
    {"id": "1.4", "term": "Other Structure", "parent": "1"},

    # Category 2: Furnishings
    {"id": "2", "term": "Furnishing", "parent": None,
     "scope": "Artifacts originally used to furnish an enclosed space."},
    {"id": "2.1", "term": "Bedding", "parent": "2"},
    {"id": "2.2", "term": "Floor Covering", "parent": "2"},
    {"id": "2.3", "term": "Furniture", "parent": "2"},
    {"id": "2.4", "term": "Household Accessory", "parent": "2"},
    {"id": "2.5", "term": "Lighting Device", "parent": "2"},
    {"id": "2.6", "term": "Plumbing Fixture", "parent": "2"},
    {"id": "2.7", "term": "Temperature Control Device", "parent": "2"},
    {"id": "2.8", "term": "Window or Door Covering", "parent": "2"},

    # Category 3: Personal Artifacts
    {"id": "3", "term": "Personal Artifact", "parent": None,
     "scope": "Artifacts originally created to serve the personal needs of an individual."},
    {"id": "3.1", "term": "Adornment", "parent": "3"},
    {"id": "3.2", "term": "Clothing", "parent": "3"},
    {"id": "3.3", "term": "Clothing Accessory", "parent": "3"},
    {"id": "3.4", "term": "Footwear", "parent": "3"},
    {"id": "3.5", "term": "Headwear", "parent": "3"},
    {"id": "3.6", "term": "Personal Gear", "parent": "3"},
    {"id": "3.7", "term": "Personal Symbol", "parent": "3"},
    {"id": "3.8", "term": "Toilet Article", "parent": "3"},

    # Category 4: Tools and Equipment for Materials
    {"id": "4", "term": "Tool & Equipment for Materials", "parent": None,
     "scope": "Artifacts originally created to be used in producing, distributing, transforming, or handling materials."},
    {"id": "4.1", "term": "Agricultural Tool & Equipment", "parent": "4"},
    {"id": "4.2", "term": "Animal Husbandry Tool & Equipment", "parent": "4"},
    {"id": "4.3", "term": "Construction Tool & Equipment", "parent": "4"},
    {"id": "4.4", "term": "Energy Production Tool & Equipment", "parent": "4"},
    {"id": "4.5", "term": "Food Processing Tool & Equipment", "parent": "4"},
    {"id": "4.6", "term": "Forestry Tool & Equipment", "parent": "4"},
    {"id": "4.7", "term": "Maintenance Tool & Equipment", "parent": "4"},
    {"id": "4.8", "term": "Manufacturing Tool & Equipment", "parent": "4"},
    {"id": "4.9", "term": "Mining & Mineral Harvesting Tool & Equipment", "parent": "4"},
    {"id": "4.10", "term": "Textile-Working Tool & Equipment", "parent": "4"},
    {"id": "4.11", "term": "Metalworking Tool & Equipment", "parent": "4"},
    {"id": "4.12", "term": "Woodworking Tool & Equipment", "parent": "4"},

    # Category 5: Tools and Equipment for Science and Technology
    {"id": "5", "term": "Tool & Equipment for Science & Technology", "parent": None,
     "scope": "Artifacts originally created to observe and record phenomena, develop knowledge, communicate information, or make technology."},
    {"id": "5.1", "term": "Acoustical Tool & Equipment", "parent": "5"},
    {"id": "5.2", "term": "Armament", "parent": "5"},
    {"id": "5.3", "term": "Astronomical Tool & Equipment", "parent": "5"},
    {"id": "5.4", "term": "Biological Tool & Equipment", "parent": "5"},
    {"id": "5.5", "term": "Chemical Tool & Equipment", "parent": "5"},
    {"id": "5.6", "term": "Data Processing Tool & Equipment", "parent": "5"},
    {"id": "5.7", "term": "Drafting Tool & Equipment", "parent": "5"},
    {"id": "5.8", "term": "Electrical & Magnetic Tool & Equipment", "parent": "5"},
    {"id": "5.9", "term": "Geological Tool & Equipment", "parent": "5"},
    {"id": "5.10", "term": "Mechanical Tool & Equipment", "parent": "5"},
    {"id": "5.11", "term": "Medical & Psychological Tool & Equipment", "parent": "5"},
    {"id": "5.12", "term": "Merchandising Tool & Equipment", "parent": "5"},
    {"id": "5.13", "term": "Meteorological Tool & Equipment", "parent": "5"},
    {"id": "5.14", "term": "Nuclear Physics Tool & Equipment", "parent": "5"},
    {"id": "5.15", "term": "Optical Tool & Equipment", "parent": "5"},
    {"id": "5.16", "term": "Photographic Tool & Equipment", "parent": "5"},
    {"id": "5.17", "term": "Regulative & Protective Tool & Equipment", "parent": "5"},
    {"id": "5.18", "term": "Surveying & Navigational Tool & Equipment", "parent": "5"},
    {"id": "5.19", "term": "Telecommunication Tool & Equipment", "parent": "5"},
    {"id": "5.20", "term": "Thermal Tool & Equipment", "parent": "5"},
    {"id": "5.21", "term": "Timekeeping Tool & Equipment", "parent": "5"},
    {"id": "5.22", "term": "Weights & Measures Tool & Equipment", "parent": "5"},
    {"id": "5.23", "term": "Written Communication Tool & Equipment", "parent": "5"},

    # Category 6: Tools and Equipment for Communication
    {"id": "6", "term": "Tool & Equipment for Communication", "parent": None,
     "scope": "Artifacts originally created to communicate ideas, concepts, information, or data by means of sight, sound, or other sense perception."},
    {"id": "6.1", "term": "Communication Artifact", "parent": "6"},
    {"id": "6.2", "term": "Data Processing Equipment", "parent": "6"},
    {"id": "6.3", "term": "Documentary Artifact", "parent": "6"},
    {"id": "6.4", "term": "Exchange Medium", "parent": "6"},
    {"id": "6.5", "term": "Personal Symbol", "parent": "6"},
    {"id": "6.6", "term": "Sound Communication Equipment", "parent": "6"},
    {"id": "6.7", "term": "Visual Communication Equipment", "parent": "6"},

    # Category 7: Distribution and Transportation Artifacts
    {"id": "7", "term": "Distribution & Transportation Artifact", "parent": None,
     "scope": "Artifacts originally created to transport passengers or material goods from one location to another."},
    {"id": "7.1", "term": "Aerospace Transportation", "parent": "7"},
    {"id": "7.2", "term": "Land Transportation — Animal-Powered", "parent": "7"},
    {"id": "7.3", "term": "Land Transportation — Human-Powered", "parent": "7"},
    {"id": "7.4", "term": "Land Transportation — Motorized", "parent": "7"},
    {"id": "7.5", "term": "Rail Transportation", "parent": "7"},
    {"id": "7.6", "term": "Water Transportation", "parent": "7"},
    {"id": "7.7", "term": "Transportation Accessory", "parent": "7"},

    # Category 8: Communication Artifacts
    {"id": "8", "term": "Communication Artifact", "parent": None,
     "scope": "Artifacts originally created for communicating information."},
    {"id": "8.1", "term": "Advertising Medium", "parent": "8"},
    {"id": "8.2", "term": "Art", "parent": "8"},
    {"id": "8.3", "term": "Ceremonial Artifact", "parent": "8"},
    {"id": "8.4", "term": "Documentary Artifact", "parent": "8"},
    {"id": "8.5", "term": "Exchange Medium", "parent": "8"},
    {"id": "8.6", "term": "Personal Symbol", "parent": "8"},

    # Category 9: Recreational Artifacts
    {"id": "9", "term": "Recreational Artifact", "parent": None,
     "scope": "Artifacts originally created to be used as toys, or in games, sports, public entertainment, or as items of leisure."},
    {"id": "9.1", "term": "Game", "parent": "9"},
    {"id": "9.2", "term": "Public Entertainment Device", "parent": "9"},
    {"id": "9.3", "term": "Recreational Device", "parent": "9"},
    {"id": "9.4", "term": "Sports Equipment", "parent": "9"},
    {"id": "9.5", "term": "Toy", "parent": "9"},

    # Category 10: Unclassifiable Artifacts
    {"id": "10", "term": "Unclassifiable Artifact", "parent": None,
     "scope": "Artifacts that cannot be categorized because their original function is unknown or insufficiently understood."},
    {"id": "10.1", "term": "Artifact Remnant", "parent": "10"},
    {"id": "10.2", "term": "Function Unknown", "parent": "10"},
    {"id": "10.3", "term": "Multiple Use Artifact", "parent": "10"},
]


def load_starter_set(session: Session) -> dict[str, int]:
    """
    Load the built-in Nomenclature 4.0 starter hierarchy.

    This gives Madrona a usable Nomenclature vocabulary out of the box —
    all 10 top-level categories and their classifications (Level 2).
    Institutions needing the full hierarchy (sub-classifications and
    object terms) can layer in licensed data via load_from_csv().

    Safe to run multiple times — uses external_id as a dedup key.

    Returns:
        {"created": N, "updated": N, "skipped": N}
    """
    stats = {"created": 0, "updated": 0, "skipped": 0}

    # First pass: create all terms without parent linkage
    id_to_term_id: dict[str, Any] = {}

    for entry in STARTER_HIERARCHY:
        external_id = entry["id"]
        existing = session.query(VocabularyTerm).filter(
            VocabularyTerm.vocabulary == VOCABULARY_KEY,
            VocabularyTerm.external_id == external_id,
            VocabularyTerm.organization_id.is_(None),
        ).first()

        if existing:
            id_to_term_id[external_id] = existing.term_id
            # Update label and scope if changed
            updated = False
            if existing.preferred_term != entry["term"]:
                existing.preferred_term = entry["term"]
                updated = True
            if entry.get("scope") and existing.scope_note != entry["scope"]:
                existing.scope_note = entry["scope"]
                updated = True
            if updated:
                stats["updated"] += 1
            else:
                stats["skipped"] += 1
            continue

        term = VocabularyTerm(
            term_id=uuid4(),
            organization_id=None,
            vocabulary=VOCABULARY_KEY,
            external_id=external_id,
            preferred_term=entry["term"],
            scope_note=entry.get("scope"),
            applicable_fields=APPLICABLE_FIELDS,
            status="active",
            is_custom=False,
        )
        session.add(term)
        session.flush()
        id_to_term_id[external_id] = term.term_id
        stats["created"] += 1

    # Second pass: set parent_id, broader_term, and hierarchy_path
    by_id = {e["id"]: e for e in STARTER_HIERARCHY}
    for entry in STARTER_HIERARCHY:
        if not entry.get("parent"):
            continue
        term = session.query(VocabularyTerm).filter(
            VocabularyTerm.term_id == id_to_term_id[entry["id"]],
        ).first()
        if not term:
            continue

        parent_entry = by_id.get(entry["parent"])
        if parent_entry:
            term.parent_id = id_to_term_id[entry["parent"]]
            term.broader_term = parent_entry["term"]
            # Build hierarchy path by walking up
            path_parts = [entry["term"]]
            cursor = entry["parent"]
            while cursor and cursor in by_id:
                path_parts.insert(0, by_id[cursor]["term"])
                cursor = by_id[cursor].get("parent")
            term.hierarchy_path = " | ".join(path_parts)

    session.commit()
    logger.info(
        "Nomenclature starter set loaded: created=%d updated=%d skipped=%d",
        stats["created"], stats["updated"], stats["skipped"],
    )
    return stats


def load_from_csv(
    session: Session,
    csv_path: str | Path,
    *,
    id_col: str = "ID",
    term_col: str = "Term",
    parent_col: str = "Parent ID",
    scope_col: str = "Scope Note",
    path_col: str | None = "Hierarchy Path",
) -> dict[str, int]:
    """
    Load full Nomenclature 4.0 data from a licensed CSV.

    Expected CSV columns (defaults, overridable):
        ID, Term, Parent ID, Scope Note, Hierarchy Path

    Institutions with an AASLH license can export the full hierarchy
    and load it here. The starter set should be loaded first.

    Returns:
        {"created": N, "updated": N, "skipped": N}
    """
    csv_path = Path(csv_path)
    if not csv_path.exists():
        raise FileNotFoundError(f"Nomenclature CSV not found: {csv_path}")

    stats = {"created": 0, "updated": 0, "skipped": 0}

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    # Two-pass for parent linkage
    id_to_term_id: dict[str, Any] = {}

    for row in rows:
        external_id = (row.get(id_col) or "").strip()
        term_name = (row.get(term_col) or "").strip()
        if not external_id or not term_name:
            stats["skipped"] += 1
            continue

        existing = session.query(VocabularyTerm).filter(
            VocabularyTerm.vocabulary == VOCABULARY_KEY,
            VocabularyTerm.external_id == external_id,
            VocabularyTerm.organization_id.is_(None),
        ).first()

        scope = (row.get(scope_col) or "").strip() or None
        path = (row.get(path_col) or "").strip() if path_col else None

        if existing:
            changed = False
            if existing.preferred_term != term_name:
                existing.preferred_term = term_name
                changed = True
            if scope and existing.scope_note != scope:
                existing.scope_note = scope
                changed = True
            if path and existing.hierarchy_path != path:
                existing.hierarchy_path = path
                changed = True
            id_to_term_id[external_id] = existing.term_id
            if changed:
                stats["updated"] += 1
            else:
                stats["skipped"] += 1
            continue

        term = VocabularyTerm(
            term_id=uuid4(),
            organization_id=None,
            vocabulary=VOCABULARY_KEY,
            external_id=external_id,
            preferred_term=term_name,
            scope_note=scope,
            hierarchy_path=path,
            applicable_fields=APPLICABLE_FIELDS,
            status="active",
            is_custom=False,
        )
        session.add(term)
        session.flush()
        id_to_term_id[external_id] = term.term_id
        stats["created"] += 1

    # Second pass: link parents
    for row in rows:
        external_id = (row.get(id_col) or "").strip()
        parent_id = (row.get(parent_col) or "").strip()
        if not external_id or not parent_id:
            continue

        term_uuid = id_to_term_id.get(external_id)
        parent_uuid = id_to_term_id.get(parent_id)
        if not term_uuid or not parent_uuid:
            continue

        term = session.query(VocabularyTerm).filter(
            VocabularyTerm.term_id == term_uuid
        ).first()
        parent_term = session.query(VocabularyTerm).filter(
            VocabularyTerm.term_id == parent_uuid
        ).first()

        if term and parent_term:
            term.parent_id = parent_uuid
            term.broader_term = parent_term.preferred_term

    session.commit()
    logger.info(
        "Nomenclature CSV loaded from %s: created=%d updated=%d skipped=%d",
        csv_path.name, stats["created"], stats["updated"], stats["skipped"],
    )
    return stats
