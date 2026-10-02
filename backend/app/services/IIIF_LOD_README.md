# IIIF as Primary Linked Open Data Interface

This document describes how Madrona uses IIIF Presentation API 3.0 manifests as the primary Linked Open Data (LOD) surface.

## Architecture Overview

```
                    ┌─────────────────────────────────────┐
                    │        Stable URI Layer             │
                    │   https://data.madrona.io/org/...   │
                    └─────────────────┬───────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
              ▼                       ▼                       ▼
     ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
     │ IIIF Manifest  │     │  JSON-LD       │     │  URI Resolution│
     │ (Primary LOD)  │     │  (seeAlso)     │     │  (Content Neg) │
     └────────────────┘     └────────────────┘     └────────────────┘
              │                       │                       │
              └───────────────────────┼───────────────────────┘
                                      │
                    ┌─────────────────┴───────────────────┐
                    │        Collection Object            │
                    │        (CDWA/procedures)            │
                    └─────────────────────────────────────┘
```

## Stable URI Guarantees

### URI Pattern
```
https://data.madrona.io/org/{org_slug}/{entity_type}/{public_id}
```

Examples:
- `https://data.madrona.io/org/moma/object/1941-4-1`
- `https://data.madrona.io/org/moma/object/1941-4-1/manifest`

### Immutability Rules

1. **URIs never change** - Once assigned, a URI permanently identifies the entity
2. **Deletions create tombstones** - Deleted entities return `410 Gone`
3. **Merges create redirects** - Merged entities return `301` to the surviving entity
4. **Public IDs are human-readable** - Derived from object_number (slugified)

### Entity Lifecycle

```
                  ┌──────────────┐
                  │   Created    │
                  │  (URI Assign)│
                  └──────┬───────┘
                         │
            ┌────────────┼────────────┐
            │            │            │
            ▼            ▼            ▼
      ┌──────────┐ ┌──────────┐ ┌──────────┐
      │  Active  │ │  Merged  │ │ Deleted  │
      │ (200 OK) │ │ (301)    │ │ (410)    │
      └──────────┘ └──────────┘ └──────────┘
```

## Manifest Structure

The IIIF manifest serves as the primary LOD document:

```json
{
  "@context": [
    "http://iiif.io/api/presentation/3/context.json",
    {"schema": "https://schema.org/"}
  ],
  "id": "https://data.madrona.io/org/moma/object/1941-4-1/manifest",
  "type": "Manifest",
  "label": {"en": ["Water Lilies"]},

  "metadata": [
    // CDWA-mapped fields with authority links
    {"label": {"en": ["Creator"]}, "value": {"en": ["Claude Monet"]},
     "seeAlso": [{"id": "http://vocab.getty.edu/ulan/500019484", "type": "Dataset"}]},
    {"label": {"en": ["Materials"]}, "value": {"en": ["Oil on canvas"]},
     "seeAlso": [{"id": "http://vocab.getty.edu/aat/300015050", "type": "Dataset"}]}
  ],

  "seeAlso": [
    {"id": "https://data.madrona.io/org/moma/object/1941-4-1.jsonld",
     "type": "Dataset", "format": "application/ld+json"}
  ],

  "homepage": [
    {"id": "https://collections.madrona.io/org/moma/objects/...",
     "type": "Text", "format": "text/html"}
  ],

  "items": [
    // Canvases with stable URIs
  ]
}
```

## CDWA Metadata Mapping

All CDWA (Categories for the Description of Works of Art) fields are mapped to IIIF metadata:

| CDWA Category | IIIF Label | Authority Support |
|---------------|------------|-------------------|
| Object/Work Type | Type | AAT |
| Classification | Classification | AAT |
| Creator/Maker | Creator | ULAN, VIAF, Wikidata |
| Creation Date | Date | - |
| Place of Creation | Place of Creation | TGN |
| Materials | Materials | AAT |
| Techniques | Techniques | AAT |
| Dimensions | Dimensions | - |
| Subject | Subject | AAT, LCSH |
| Provenance | Provenance | - |

## Media → Object Linking

Each canvas (image) in the manifest maintains a bidirectional link to its parent object:

```json
{
  "id": "https://data.madrona.io/org/moma/object/1941-4-1/canvas/1",
  "type": "Canvas",
  "partOf": [{
    "id": "https://data.madrona.io/org/moma/object/1941-4-1/manifest",
    "type": "Manifest"
  }],
  "seeAlso": [{
    "id": "https://data.madrona.io/org/moma/media/abc123",
    "type": "Dataset"
  }]
}
```

## API Endpoints

### Public (No Auth Required)

| Endpoint | Description |
|----------|-------------|
| `GET /org/{slug}/object/{id}/manifest` | IIIF manifest (primary LOD) |
| `GET /org/{slug}/object/{id}` | URI resolution with content negotiation |
| `GET /org/{slug}/object/{id}/canvas/{n}` | Individual canvas |
| `GET /org/{slug}/collection/{id}` | IIIF collection manifest |
| `GET /org/{slug}/media/{id}` | Media JSON-LD |
| `GET /org/{slug}/activity` | IIIF Change Discovery stream |

### Content Negotiation

The `/org/{slug}/object/{id}` endpoint supports:

| Accept Header | Response |
|---------------|----------|
| `application/ld+json` | IIIF manifest |
| `application/json` | JSON representation |
| `text/html` | 303 redirect to web UI |

## Activity Streams (Change Discovery)

For aggregator harvesting, the activity endpoint returns recent changes:

```json
{
  "@context": "http://iiif.io/api/discovery/1/context.json",
  "type": "OrderedCollection",
  "orderedItems": [
    {
      "type": "Update",
      "object": {"id": ".../manifest", "type": "Manifest"},
      "endTime": "2024-01-15T10:30:00Z"
    }
  ]
}
```

## Integration with Existing LOD

- **seeAlso** links to JSON-LD export for schema.org consumers
- **homepage** links to public web UI
- **provider** identifies the organization as LOD resource
- Authority URIs (ULAN, AAT, TGN) in metadata `seeAlso`

## Files

| File | Purpose |
|------|---------|
| `app/services/iiif_lod.py` | IIIF manifest generator with CDWA mapping |
| `app/api/iiif_lod.py` | Public API endpoints |
| `app/services/uri_persistence.py` | Stable URI management |
| `app/models/uri.py` | URI registry database models |
