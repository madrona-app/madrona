"""
Which standard object fields an organization publishes.

Every public surface that describes a collection object — the Discover
record page, Discover search/related/featured/exhibition cards, the Discover
CSV/JSON exports (including portal members' collection exports), the
server-rendered social preview tags, the public DAM API, the LOD IIIF
manifest, the URI resolver's JSON/JSON-LD and the public MCP server — asks
this module which fields it may show.

The choice lives on ``DiscoverConfig.public_object_fields`` (a JSON list of
field keys). NULL means "the defaults", and the defaults are exactly the set
the Discover record page published before the setting existed, so an
organization that never opens the setting sees no change.

Server-side rules, independent of anything a client sends:

* Only keys in :data:`FIELD_CATALOG` can ever be public. The catalog is an
  allowlist of descriptive fields; anything else (valuation, insurance,
  storage location, acquisition source and cost, condition and handling
  notes, culturally restricted context) is refused with a 422 when someone
  tries to enable it — :data:`NEVER_PUBLIC` names the common ones so the
  refusal can say why.
* Locked fields (object number and title) are always public: they identify
  the record in its public web address.
* This only narrows what is shown. The existing gates still apply first:
  only ``is_discoverable`` objects are served at all, only published media,
  and user-defined additional fields keep their own per-field public flag.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy.orm import Session


@dataclass(frozen=True)
class PublicField:
    key: str
    label: str
    group: str
    description: str
    default: bool
    locked: bool = False
    # Keys this field controls in the public object payload.
    payload_keys: tuple[str, ...] = ()
    # OpenSearch fields searched by the Discover full-text query.
    search_fields: tuple[str, ...] = ()
    # Discover search query parameters (filters) that act on this field.
    filter_params: tuple[str, ...] = ()
    # Facet names (CollectionsSearchService._parse_facets) for this field.
    facets: tuple[str, ...] = ()
    # Labels used in the LOD IIIF manifest metadata block.
    iiif_labels: tuple[str, ...] = field(default_factory=tuple)


FIELD_GROUPS: tuple[tuple[str, str], ...] = (
    ("identification", "Identification"),
    ("description", "Description"),
    ("classification", "Classification"),
    ("creation", "Creation"),
    ("physical", "Physical details"),
    ("history", "History and credit"),
    ("links", "Links"),
)

FIELD_CATALOG: tuple[PublicField, ...] = (
    # --- Identification -----------------------------------------------------
    PublicField(
        "object_number", "Object number", "identification",
        "The accession or object number. Always public: it is part of the record's public web address.",
        True, locked=True, payload_keys=("object_number",), search_fields=("object_number^3",),
        iiif_labels=("Object Number",),
    ),
    PublicField(
        "title", "Title", "identification",
        "The preferred title. Always public: every public listing names the record by it.",
        True, locked=True, payload_keys=("title",), search_fields=("title^3",),
    ),
    PublicField(
        "titles", "Other titles", "identification",
        "Alternative, former and translated titles, with their type and language.",
        True, payload_keys=("titles",), iiif_labels=("Title",),
    ),
    PublicField(
        "object_name", "Object name", "identification",
        "The name for the kind of thing the object is, such as “teapot” or “letter”.",
        True, payload_keys=("object_name",), search_fields=("object_name^2",),
    ),
    # --- Description --------------------------------------------------------
    PublicField(
        "brief_description", "Brief description", "description",
        "The short summary shown on search results and at the top of the record.",
        True, payload_keys=("brief_description",), search_fields=("brief_description",),
    ),
    PublicField(
        "full_description", "Full description", "description",
        "The long descriptive text.",
        True, payload_keys=("full_description",), search_fields=("full_description",),
    ),
    PublicField(
        "physical_description", "Physical description", "description",
        "A description of the object's physical appearance and condition as catalogued.",
        False, payload_keys=("physical_description",), iiif_labels=("Physical Description",),
    ),
    PublicField(
        "subjects", "Subjects", "description",
        "Subject terms describing what the object is about or depicts. Also used as a search filter.",
        True, payload_keys=("subjects",), search_fields=("subjects.term",),
        filter_params=("subject",), facets=("subject",), iiif_labels=("Subject",),
    ),
    # --- Classification ----------------------------------------------------
    PublicField(
        "object_type", "Object type", "classification",
        "The broad type of object, such as painting or photograph. Also used as a search filter.",
        True, payload_keys=("object_type",), filter_params=("object_type",), facets=("object_type",),
        iiif_labels=("Type",),
    ),
    PublicField(
        "classification", "Classification", "classification",
        "Classification terms from your vocabularies. Also used as a search filter.",
        True, payload_keys=("classification", "classifications"), filter_params=("classification",),
        facets=("classification",), iiif_labels=("Classification",),
    ),
    PublicField(
        "style_period", "Style or period", "classification",
        "The style, period, school or movement. Also used as a search filter.",
        True, payload_keys=("style_period",), filter_params=("style_period",), facets=("style_period",),
        iiif_labels=("Style/Period",),
    ),
    # --- Creation -----------------------------------------------------------
    PublicField(
        "creators", "Creators", "creation",
        "Makers, artists and authors, with their roles. Also used as a search filter.",
        True, payload_keys=("creators",), search_fields=("creators.name^2",),
        filter_params=("creator",), facets=("creator",), iiif_labels=("Creator",),
    ),
    PublicField(
        "creation_date", "Date made", "creation",
        "The display date and the earliest and latest dates. Also used for date filters and sorting.",
        True, payload_keys=("creation_date_display", "creation_date_earliest", "creation_date_latest"),
        filter_params=("date_from", "date_to"), facets=("creation_date",), iiif_labels=("Date",),
    ),
    PublicField(
        "creation_place", "Place made", "creation",
        "Where the object was made. Also used as a search filter.",
        True, payload_keys=("creation_place",), search_fields=("creation_place",),
        filter_params=("creation_place",), facets=("creation_place",), iiif_labels=("Place of Creation",),
    ),
    # --- Physical details ---------------------------------------------------
    PublicField(
        "materials", "Materials", "physical",
        "What the object is made of. Also used as a search filter.",
        True, payload_keys=("materials",), search_fields=("materials.name",),
        filter_params=("material",), facets=("material",), iiif_labels=("Materials",),
    ),
    PublicField(
        "techniques", "Techniques", "physical",
        "How the object was made. Also used as a search filter.",
        True, payload_keys=("techniques",), search_fields=("techniques.name",),
        filter_params=("technique",), facets=("technique",), iiif_labels=("Techniques",),
    ),
    PublicField(
        "measurements", "Measurements", "physical",
        "Dimensions such as height, width and weight.",
        True, payload_keys=("measurements",), iiif_labels=("Dimensions",),
    ),
    PublicField(
        "inscriptions", "Inscriptions and marks", "physical",
        "The text of inscriptions, signatures and marks.",
        True, payload_keys=("inscriptions",), search_fields=("inscriptions",),
        iiif_labels=("Inscriptions",),
    ),
    PublicField(
        "edition", "Edition and state", "physical",
        "Edition number and size, and print state, for multiples.",
        False, payload_keys=("edition",), iiif_labels=("Edition", "State"),
    ),
    # --- History and credit -------------------------------------------------
    PublicField(
        "provenance", "Provenance", "history",
        "The ownership history narrative. Review it for private donor or owner names before publishing.",
        True, payload_keys=("provenance",), search_fields=("provenance",), iiif_labels=("Provenance",),
    ),
    PublicField(
        "credit_line", "Credit line", "history",
        "The acknowledgement shown with the object, such as “Gift of the Smith family”.",
        True, payload_keys=("credit_line",), iiif_labels=("Credit Line",),
    ),
    # --- Links ---------------------------------------------------------------
    PublicField(
        "external_links", "Web links", "links",
        "Links to related pages elsewhere on the web (only http and https links are ever shown).",
        True, payload_keys=("external_links",),
    ),
)

#: Fields that are never publishable, with the reason. Not exhaustive — the
#: catalog above is the allowlist — but naming them lets the API explain a
#: refusal and lets the settings page show what is held back and why.
NEVER_PUBLIC: dict[str, tuple[str, str]] = {
    "current_value": ("Valuation", "Valuations are financial and security information."),
    "insurance_value": ("Insurance value", "Insurance figures are financial and security information."),
    "valuation_history": ("Valuation history", "Valuations are financial and security information."),
    "acquisition_cost": ("Acquisition cost", "Purchase prices are confidential."),
    "acquisition_source": ("Acquisition source", "The source may be a private donor or seller."),
    "acquisition_note": ("Acquisition notes", "Internal acquisition notes can name private people."),
    "acquisition_funding_source": ("Funding source", "Funding details can name private donors."),
    "current_location": ("Current location", "Storage locations are security information."),
    "home_location": ("Home location", "Storage locations are security information."),
    "barcode": ("Barcode", "Barcodes are internal tracking identifiers."),
    "comments": ("Comments", "Internal staff notes."),
    "condition_note": ("Condition notes", "Internal condition and handling information."),
    "insurance_note": ("Insurance notes", "Internal financial information."),
    "handling_requirements": ("Handling requirements", "Internal handling information."),
    "hazards": ("Hazards", "Internal safety information."),
    "associated_cultural_affinity": (
        "Cultural affinity",
        "Can be subject to NAGPRA and community consultation restrictions.",
    ),
    "excavation_site": ("Excavation site", "Site locations are withheld to protect sites from looting."),
    "archaeological_context": ("Archaeological context", "Site details are withheld to protect sites from looting."),
}

_BY_KEY: dict[str, PublicField] = {f.key: f for f in FIELD_CATALOG}
_PAYLOAD_TO_FIELD: dict[str, str] = {pk: f.key for f in FIELD_CATALOG for pk in f.payload_keys}

LOCKED_KEYS: frozenset[str] = frozenset(f.key for f in FIELD_CATALOG if f.locked)
DEFAULT_KEYS: frozenset[str] = frozenset(f.key for f in FIELD_CATALOG if f.default)
ALL_KEYS: frozenset[str] = frozenset(_BY_KEY)

#: Discover facets that do not describe a catalog field but are public by
#: design (the visitor's "on display" filter).
_ALWAYS_PUBLIC_FACETS = frozenset({"on_display"})


class PublicFieldsError(ValueError):
    """A requested public field set breaks the allowlist."""

    def __init__(self, message: str, invalid: list[str]):
        super().__init__(message)
        self.invalid = invalid


def validate_keys(keys: Iterable[Any]) -> frozenset[str]:
    """Check a requested set against the allowlist; locked fields are added."""
    requested = list(keys)
    not_strings = [repr(k) for k in requested if not isinstance(k, str)]
    if not_strings:
        raise PublicFieldsError("Field keys must be strings.", not_strings)
    never = [k for k in requested if k in NEVER_PUBLIC]
    if never:
        labels = ", ".join(NEVER_PUBLIC[k][0] for k in never)
        raise PublicFieldsError(f"These fields can never be made public: {labels}.", never)
    unknown = [k for k in requested if k not in _BY_KEY]
    if unknown:
        raise PublicFieldsError(
            f"These are not publishable standard fields: {', '.join(unknown)}.", unknown,
        )
    return frozenset(requested) | LOCKED_KEYS


def resolve_stored(stored: Any) -> frozenset[str]:
    """Turn the stored JSON value into an effective field set.

    NULL (never configured) is the defaults. Anything stored that is not in
    the allowlist any more is dropped rather than trusted.
    """
    if stored is None or not isinstance(stored, (list, tuple)):
        return DEFAULT_KEYS
    return frozenset(k for k in stored if isinstance(k, str) and k in _BY_KEY) | LOCKED_KEYS


def get_public_field_keys(db: Session | None, organization_id: UUID | str | None) -> frozenset[str]:
    """The effective public field set of an organization."""
    if db is None or organization_id is None:
        return DEFAULT_KEYS
    from app.models import DiscoverConfig

    stored = (
        db.query(DiscoverConfig.public_object_fields)
        .filter(DiscoverConfig.organization_id == organization_id)
        .scalar()
    )
    return resolve_stored(stored)


def keys_for_object(obj: Any) -> frozenset[str]:
    """The public field set of the organization that owns ``obj``."""
    from sqlalchemy.orm import object_session

    return get_public_field_keys(object_session(obj), getattr(obj, "organization_id", None))


def payload_key_public(payload_key: str, keys: frozenset[str]) -> bool:
    """Whether a payload key may carry a value. Keys outside the catalog
    (ids, URLs, images) are not governed here and pass."""
    field_key = _PAYLOAD_TO_FIELD.get(payload_key)
    return field_key is None or field_key in keys


def redact(payload: dict, keys: frozenset[str]) -> dict:
    """Blank every governed payload key whose field is not public.

    Values are blanked (``None``, or ``[]`` for lists) rather than removed so
    that response shapes stay stable for API clients.
    """
    for pk, value in list(payload.items()):
        if not payload_key_public(pk, keys):
            payload[pk] = [] if isinstance(value, list) else None
    return payload


def omit(payload: dict, keys: frozenset[str]) -> dict:
    """Copy of ``payload`` without the governed keys that are not public."""
    return {k: v for k, v in payload.items() if payload_key_public(k, keys)}


def search_fields(base_fields: Iterable[str], keys: frozenset[str]) -> list[str]:
    """The full-text fields the Discover query may match against.

    A field that is not public must not be searchable either: matching a
    hidden provenance note would reveal which records contain a name.
    Search fields outside the catalog are not public text and are dropped.
    """
    allowed = {sf for f in FIELD_CATALOG if f.key in keys for sf in f.search_fields}
    return [sf for sf in base_fields if sf in allowed]


def filter_param_public(param: str, keys: frozenset[str]) -> bool:
    for f in FIELD_CATALOG:
        if param in f.filter_params:
            return f.key in keys
    return True


def facet_public(facet: str, keys: frozenset[str]) -> bool:
    if facet in _ALWAYS_PUBLIC_FACETS:
        return True
    for f in FIELD_CATALOG:
        if facet in f.facets:
            return f.key in keys
    # Facets that are not descriptive fields (location, condition, status,
    # acquisition method) are never public.
    return False


def iiif_label_public(label: str, keys: frozenset[str]) -> bool:
    for f in FIELD_CATALOG:
        if label in f.iiif_labels:
            return f.key in keys
    # Labels outside the catalog (current location, department, depicted
    # people) are not public fields.
    return False


def is_public(field_key: str, keys: frozenset[str]) -> bool:
    return field_key in keys


def format_edition(obj: Any) -> str | None:
    """Edition and state as one line, e.g. "3/50 (edition of 50); State 2/4: ..."."""
    parts: list[str] = []
    if getattr(obj, "edition", None):
        text = obj.edition
        if getattr(obj, "copy_number", None):
            text = f"{text}, {obj.copy_number}"
        if getattr(obj, "edition_size", None):
            text = f"{text} (edition of {obj.edition_size})"
        parts.append(text)
    if getattr(obj, "state_description", None) or getattr(obj, "state_number", None):
        state = ""
        if obj.state_number and getattr(obj, "total_states", None):
            state = f"State {obj.state_number}/{obj.total_states}"
        elif obj.state_number:
            state = f"State {obj.state_number}"
        if obj.state_description:
            state = f"{state}: {obj.state_description}" if state else obj.state_description
        parts.append(state)
    return "; ".join(p for p in parts if p) or None


def format_subjects(obj: Any) -> list[str]:
    out: list[str] = []
    for s in getattr(obj, "subjects", None) or []:
        if isinstance(s, str) and s.strip():
            out.append(s)
        elif isinstance(s, dict):
            term = s.get("term") or s.get("label") or s.get("value") or s.get("name")
            if term:
                out.append(str(term))
    return out


def catalog_payload(keys: frozenset[str]) -> list[dict]:
    """The catalog as the settings API returns it."""
    return [
        {
            "key": f.key,
            "label": f.label,
            "group": f.group,
            "description": f.description,
            "default_public": f.default,
            "locked": f.locked,
            "public": f.key in keys,
        }
        for f in FIELD_CATALOG
    ]


def redact_aggregated_metadata(metadata: dict | None, keys: frozenset[str]) -> dict | None:
    """Apply the public field set to object_metadata_aggregator output.

    Used by the public DAM API (``include=object_metadata``). Sections that
    are not public descriptive fields at all (storage location, acquisition
    method and date, depicted people and the other content fields outside
    the catalog) are removed. Rights statements are left as they are: they
    are a rights gate, not a descriptive field.
    """
    if not metadata:
        return metadata
    out = dict(metadata)
    obj = dict(out.get("object") or {})
    object_map = {
        "titles": "titles", "object_name": "object_name", "object_type": "object_type",
        "classifications": "classification", "brief_description": "brief_description",
        "physical_description": "physical_description", "materials": "materials",
        "techniques": "techniques", "measurements": "measurements",
        "inscriptions": "inscriptions", "edition": "edition", "copy_number": "edition",
        "style_period": "style_period",
    }
    always = {"object_id", "object_number", "primary_title"}
    for k, v in list(obj.items()):
        if k in always:
            continue
        field_key = object_map.get(k)
        if field_key is None:
            obj.pop(k)
        elif field_key not in keys:
            obj[k] = [] if isinstance(v, list) else None
    out["object"] = obj
    if "creators" not in keys:
        out["creators"] = []
    dates = dict(out.get("dates") or {})
    if "creation_date" not in keys:
        for k in ("display", "earliest", "latest"):
            dates[k] = None
    if "creation_place" not in keys:
        dates["creation_place"] = None
    out["dates"] = dates
    subjects = out.get("subjects") or {}
    out["subjects"] = {
        "terms": subjects.get("terms", []) if "subjects" in keys else [],
        "style_period": subjects.get("style_period") if "style_period" in keys else None,
    }
    rights = dict(out.get("rights") or {})
    if "credit_line" not in keys:
        rights["credit_line"] = None
    out["rights"] = rights
    out.pop("provenance", None)
    repository = dict(out.get("repository") or {})
    repository.pop("location", None)
    out["repository"] = repository
    return out
