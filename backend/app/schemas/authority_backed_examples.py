"""
Authority-Backed Field Examples

This module provides concrete examples of the authority-backed field structure
for use in documentation, testing, and API responses.
"""

# ============================================================================
# EXAMPLE: COMPLETE COLLECTION OBJECT WITH AUTHORITY-BACKED FIELDS
# ============================================================================

EXAMPLE_COLLECTION_OBJECT = {
    "object_id": "550e8400-e29b-41d4-a716-446655440000",
    "organization_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "object_number": "1941.4.1",

    # Basic identification (unchanged)
    "object_name": "painting",
    "titles": [
        {"title": "The Starry Night", "is_preferred": True, "language": "en"}
    ],
    "brief_description": "Oil on canvas depicting a swirling night sky over a village",

    # ═══════════════════════════════════════════════════════════════════════
    # CREATORS - Authority-backed (CDWA Category 10)
    # ═══════════════════════════════════════════════════════════════════════
    "creators": [
        {
            # Primary display value (REQUIRED)
            "value": "Vincent van Gogh",

            # CDWA creator role
            "role": "artist",

            # Optional attribution qualifier
            "attribution": None,  # Could be "attributed to", "circle of", etc.

            # Authority links (OPTIONAL - empty array is valid)
            "authorities": [
                {
                    "uri": "http://vocab.getty.edu/ulan/500115588",
                    "source": "ULAN",
                    "label": "Gogh, Vincent van",
                    "match_confidence": "exact"
                },
                {
                    "uri": "http://viaf.org/viaf/9854560",
                    "source": "VIAF"
                },
                {
                    "uri": "https://www.wikidata.org/entity/Q5582",
                    "source": "Wikidata"
                }
            ]
        }
    ],

    # ═══════════════════════════════════════════════════════════════════════
    # MATERIALS - Authority-backed (CDWA Category 7)
    # ═══════════════════════════════════════════════════════════════════════
    "materials": [
        {
            "value": "oil paint",
            "part": "medium",
            "authorities": [
                {
                    "uri": "http://vocab.getty.edu/aat/300015050",
                    "source": "AAT",
                    "label": "oil paint (paint)"
                }
            ]
        },
        {
            "value": "canvas",
            "part": "support",
            "authorities": [
                {
                    "uri": "http://vocab.getty.edu/aat/300014078",
                    "source": "AAT",
                    "label": "canvas (textile material)"
                }
            ]
        }
    ],

    # ═══════════════════════════════════════════════════════════════════════
    # TECHNIQUES - Authority-backed (CDWA Category 8)
    # ═══════════════════════════════════════════════════════════════════════
    "techniques": [
        {
            "value": "impasto",
            "authorities": [
                {
                    "uri": "http://vocab.getty.edu/aat/300053839",
                    "source": "AAT"
                }
            ]
        }
    ],

    # ═══════════════════════════════════════════════════════════════════════
    # CLASSIFICATIONS - Authority-backed (CDWA Category 4)
    # ═══════════════════════════════════════════════════════════════════════
    "classifications": [
        {
            "value": "paintings (visual works)",
            "classification_system": "AAT",
            "is_primary": True,
            "authorities": [
                {
                    "uri": "http://vocab.getty.edu/aat/300033618",
                    "source": "AAT"
                }
            ]
        },
        {
            "value": "Post-Impressionist",
            "classification_system": "local",
            "is_primary": False,
            "authorities": []  # No authority link for local term
        }
    ],

    # Object type (simple string, not authority-backed)
    "object_type": "painting",

    # ═══════════════════════════════════════════════════════════════════════
    # CREATION PLACE - Authority-backed (CDWA Category 11)
    # ═══════════════════════════════════════════════════════════════════════
    "creation_place": "Saint-Rémy-de-Provence, France",
    "creation_place_details": {
        "value": "Saint-Rémy-de-Provence, Provence-Alpes-Côte d'Azur, France",
        "place_type": "creation_place",
        "coordinates": {
            "lat": 43.7892,
            "lon": 4.8311
        },
        "authorities": [
            {
                "uri": "http://vocab.getty.edu/tgn/7008791",
                "source": "TGN",
                "label": "Saint-Rémy-de-Provence"
            },
            {
                "uri": "https://www.wikidata.org/entity/Q188854",
                "source": "Wikidata"
            },
            {
                "uri": "https://sws.geonames.org/2978623/",
                "source": "GeoNames"
            }
        ]
    },

    # Dates (unchanged - not authority-backed)
    "creation_date_display": "June 1889",
    "creation_date_earliest": "1889-06-01",
    "creation_date_latest": "1889-06-30",

    # ═══════════════════════════════════════════════════════════════════════
    # DEPICTED PLACES - Authority-backed
    # ═══════════════════════════════════════════════════════════════════════
    "depicted_places": [
        {
            "value": "Saint-Rémy-de-Provence",
            "place_type": "depicted_place",
            "authorities": [
                {
                    "uri": "http://vocab.getty.edu/tgn/7008791",
                    "source": "TGN"
                }
            ]
        }
    ],

    # ═══════════════════════════════════════════════════════════════════════
    # SUBJECTS - Authority-backed (CDWA Category 13)
    # ═══════════════════════════════════════════════════════════════════════
    "subjects": [
        {
            "value": "night sky",
            "subject_type": "depicted_subject",
            "authorities": [
                {
                    "uri": "http://vocab.getty.edu/aat/300263346",
                    "source": "AAT"
                }
            ]
        },
        {
            "value": "landscapes",
            "subject_type": "theme",
            "authorities": [
                {
                    "uri": "http://vocab.getty.edu/aat/300132294",
                    "source": "AAT"
                }
            ]
        }
    ],

    # Other fields (unchanged)
    "style_period": "Post-Impressionism",
    "measurements": [
        {"type": "height", "value": 73.7, "unit": "cm"},
        {"type": "width", "value": 92.1, "unit": "cm"}
    ],
    "credit_line": "Acquired through the Lillie P. Bliss Bequest, 1941",
}


# ============================================================================
# EXAMPLE: MINIMAL OBJECT (No authority links - still valid)
# ============================================================================

EXAMPLE_MINIMAL_OBJECT = {
    "object_id": "660e8400-e29b-41d4-a716-446655440001",
    "organization_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "object_number": "2024.1.1",
    "object_name": "ceramic vessel",
    "titles": [
        {"title": "Untitled Vessel", "is_preferred": True}
    ],

    # Authority-backed fields WITHOUT authorities (still valid)
    "creators": [
        {
            "value": "Unknown maker",
            "role": "maker",
            "authorities": []  # No authority link - that's OK
        }
    ],
    "materials": [
        {
            "value": "earthenware",
            "authorities": []
        }
    ],
    "classifications": [
        {
            "value": "ceramics",
            "authorities": []
        }
    ],
}


# ============================================================================
# EXAMPLE: LEGACY FORMAT (Still supported for backward compatibility)
# ============================================================================

EXAMPLE_LEGACY_FORMAT = {
    "object_id": "770e8400-e29b-41d4-a716-446655440002",
    "organization_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "object_number": "OLD.2020.1",
    "object_name": "painting",

    # Legacy format - "name" instead of "value", flat ID fields
    "creators": [
        {
            "name": "Claude Monet",  # Legacy: "name" key
            "role": "artist",
            "ulan_id": "500019484"   # Legacy: flat ID field
        }
    ],
    "materials": [
        {
            "name": "oil paint",     # Legacy: "name" key
            "aat_id": "300015050"    # Legacy: flat ID field
        }
    ],
    "techniques": [
        {
            "name": "impasto",
            "aat_id": "300053839"
        }
    ],
}


# ============================================================================
# EXAMPLE: MULTIPLE CREATORS WITH ATTRIBUTION
# ============================================================================

EXAMPLE_MULTIPLE_CREATORS = {
    "object_id": "880e8400-e29b-41d4-a716-446655440003",
    "organization_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "object_number": "1985.42.1",

    "creators": [
        {
            "value": "Workshop of Rembrandt van Rijn",
            "role": "workshop",
            "attribution": "workshop of",
            "authorities": [
                {
                    "uri": "http://vocab.getty.edu/ulan/500011051",
                    "source": "ULAN",
                    "label": "Rembrandt van Rijn"
                }
            ],
            "note": "Formerly attributed to Rembrandt himself"
        },
        {
            "value": "Ferdinand Bol",
            "role": "artist",
            "attribution": "possibly by",
            "authorities": [
                {
                    "uri": "http://vocab.getty.edu/ulan/500013764",
                    "source": "ULAN"
                }
            ],
            "note": "Attribution proposed by Smith (2015)"
        }
    ],
}


# ============================================================================
# EXAMPLE: JSON-LD EXPORT FORMAT (For LOD consumers)
# ============================================================================

EXAMPLE_JSONLD_EXPORT = {
    "@context": {
        "@vocab": "https://schema.org/",
        "crm": "http://www.cidoc-crm.org/cidoc-crm/",
        "aat": "http://vocab.getty.edu/aat/",
        "ulan": "http://vocab.getty.edu/ulan/",
        "tgn": "http://vocab.getty.edu/tgn/"
    },
    "@type": "VisualArtwork",
    "@id": "https://museum.example.org/objects/1941.4.1",
    "name": "The Starry Night",
    "creator": {
        "@type": "Person",
        "name": "Vincent van Gogh",
        "sameAs": [
            "http://vocab.getty.edu/ulan/500115588",
            "http://viaf.org/viaf/9854560",
            "https://www.wikidata.org/entity/Q5582"
        ]
    },
    "material": [
        {
            "@type": "DefinedTerm",
            "name": "oil paint",
            "sameAs": "http://vocab.getty.edu/aat/300015050"
        },
        {
            "@type": "DefinedTerm",
            "name": "canvas",
            "sameAs": "http://vocab.getty.edu/aat/300014078"
        }
    ],
    "locationCreated": {
        "@type": "Place",
        "name": "Saint-Rémy-de-Provence, France",
        "sameAs": [
            "http://vocab.getty.edu/tgn/7008791",
            "https://www.wikidata.org/entity/Q188854"
        ],
        "geo": {
            "@type": "GeoCoordinates",
            "latitude": 43.7892,
            "longitude": 4.8311
        }
    },
    "dateCreated": "1889-06",
    "artform": {
        "@type": "DefinedTerm",
        "name": "paintings (visual works)",
        "sameAs": "http://vocab.getty.edu/aat/300033618"
    }
}


# ============================================================================
# SEARCH INDEX DOCUMENT EXAMPLE (After transformation)
# ============================================================================

EXAMPLE_SEARCH_DOCUMENT = {
    "object_id": "550e8400-e29b-41d4-a716-446655440000",
    "organization_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "object_number": "1941.4.1",
    "title": "The Starry Night",
    "object_name": "painting",
    "object_type": "painting",
    "classification": "paintings (visual works)",

    # Transformed creators with authority_uris for faceting
    "creators": [
        {
            "name": "Vincent van Gogh",
            "role": "artist",
            "ulan_id": "500115588",
            "viaf_id": "9854560",
            "wikidata_id": "Q5582",
            "authority_uris": [
                "http://vocab.getty.edu/ulan/500115588",
                "http://viaf.org/viaf/9854560",
                "https://www.wikidata.org/entity/Q5582"
            ]
        }
    ],

    # Transformed materials
    "materials": [
        {
            "name": "oil paint",
            "part": "medium",
            "aat_id": "300015050",
            "authority_uris": ["http://vocab.getty.edu/aat/300015050"]
        },
        {
            "name": "canvas",
            "part": "support",
            "aat_id": "300014078",
            "authority_uris": ["http://vocab.getty.edu/aat/300014078"]
        }
    ],

    # Dates
    "creation_date": {
        "display": "June 1889",
        "earliest": "1889-06-01",
        "latest": "1889-06-30"
    },
    "creation_place": "Saint-Rémy-de-Provence, France",

    # Timestamps
    "indexed_at": "2026-01-27T14:30:00Z"
}
