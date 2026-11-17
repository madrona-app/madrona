"""
Strict vocabulary validation for collection object fields.

Authority links on object fields are optional by design (see
app/schemas/authority_backed.py): a cataloguer can always type a free-text
value. An organization can switch individual fields to *strict*, after which
the object create/update API rejects values that are not found in the
organization's vocabulary, lookup list or a linked authority for that field.

Settings live in ``Organization.vocabulary_strict_fields`` as
``{field_key: bool}``. A missing key means lenient (the default), so migrated
free-text data never blocks anything until an administrator opts in.

How each field's values are stored, and therefore how they are checked:

- ``materials`` / ``techniques`` — JSONB arrays of objects
  ``{name|value, part, vocabulary_term_id, authorities[]}``. The UI writes the
  chosen term's authority URI into ``vocabulary_term_id``; older rows may hold
  a VocabularyTerm UUID there instead.
- ``subjects`` — JSONB array of strings or ``{term|value, type,
  vocabulary_term_id, authorities[]}`` objects.
- ``creators`` — JSONB array of ``{name, ulan_id, authority_id, ...}``.
- ``depicted_activities`` / ``depicted_concepts`` / ``associated_concepts`` —
  JSONB arrays of plain strings. No URI travels with the value, so a value is
  accepted only when its text matches a term the organization holds (the UI
  caches a chosen reference-source term into the vocabulary before saving).
- ``object_type`` — a scalar string checked against the ``object_type``
  lookup list (value key or label).

A value is accepted when ANY of these holds:
1. It carries an authority URI from a source allowed for the field.
2. It references a VocabularyTerm (by UUID) visible to the organization.
3. Its text matches (case-insensitively) a term in the field's sources:
   active VocabularyTerm preferred/alternate terms, active lookup values,
   the organization's subject authorities, or its constituents.

Values already stored on the object are grandfathered on update: strict mode
governs what is newly entered, so switching it on never makes an existing
record unsaveable because of legacy data in an unrelated field.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class StrictFieldSpec:
    key: str
    label: str
    description: str
    # "objects": list of dicts (or strings); "strings": list of strings;
    # "scalar": a single string
    shape: str
    # Keys holding the display text inside an object value, in priority order
    text_keys: tuple[str, ...] = ("value", "name", "term", "label")
    # VocabularyTerm.vocabulary values that count as this field's vocabulary
    vocabularies: tuple[str, ...] = ()
    # Authority sources whose URIs are accepted for this field
    authority_sources: frozenset[str] = field(default_factory=frozenset)
    # LookupCategory.category_key holding this field's lookup list
    lookup_category: str | None = None
    # Also match the organization's subject authorities
    subject_authorities: bool = False
    # Also match the organization's constituents (people/organizations)
    constituents: bool = False


_SUBJECT_VOCABS = ("aat", "lcsh", "iconclass", "wikidata", "local")
_SUBJECT_AUTHORITIES = frozenset({"AAT", "LCSH", "Iconclass", "Wikidata"})

STRICT_VOCABULARY_FIELDS: dict[str, StrictFieldSpec] = {
    spec.key: spec
    for spec in (
        StrictFieldSpec(
            key="object_type",
            label="Object type",
            description="Must be a value from the Object Type lookup list.",
            shape="scalar",
            lookup_category="object_type",
        ),
        StrictFieldSpec(
            key="materials",
            label="Materials",
            description="Must be a term from your vocabulary or Getty AAT.",
            shape="objects",
            vocabularies=("aat", "local"),
            authority_sources=frozenset({"AAT", "Wikidata"}),
        ),
        StrictFieldSpec(
            key="techniques",
            label="Techniques",
            description="Must be a term from your vocabulary or Getty AAT.",
            shape="objects",
            vocabularies=("aat", "local"),
            authority_sources=frozenset({"AAT", "Wikidata"}),
        ),
        StrictFieldSpec(
            key="subjects",
            label="Subjects",
            description=(
                "Must be a term from your vocabulary or subject list, Getty AAT, "
                "Iconclass, or Library of Congress Subject Headings."
            ),
            shape="objects",
            text_keys=("term", "value", "name", "label"),
            vocabularies=_SUBJECT_VOCABS,
            authority_sources=_SUBJECT_AUTHORITIES,
            subject_authorities=True,
        ),
        StrictFieldSpec(
            key="creators",
            label="Creators",
            description=(
                "Must be a person or organization already in your records, or one "
                "linked to Getty ULAN, VIAF, Wikidata or Library of Congress Names."
            ),
            shape="objects",
            text_keys=("name", "value", "display_name"),
            vocabularies=("ulan",),
            authority_sources=frozenset({"ULAN", "VIAF", "Wikidata", "LCNAF"}),
            constituents=True,
        ),
        StrictFieldSpec(
            key="depicted_activities",
            label="Depicted activities",
            description="Must be a term from your vocabulary or subject list.",
            shape="strings",
            vocabularies=_SUBJECT_VOCABS,
            subject_authorities=True,
        ),
        StrictFieldSpec(
            key="depicted_concepts",
            label="Depicted concepts",
            description="Must be a term from your vocabulary or subject list.",
            shape="strings",
            vocabularies=_SUBJECT_VOCABS,
            subject_authorities=True,
        ),
        StrictFieldSpec(
            key="associated_concepts",
            label="Associated concepts",
            description="Must be a term from your vocabulary or subject list.",
            shape="strings",
            vocabularies=_SUBJECT_VOCABS,
            subject_authorities=True,
        ),
    )
}


# Authority URI recognition. Patterns are matched against the whole URI with
# an optional scheme and "www." prefix, so look-alike hosts do not pass.
_AUTHORITY_URI_PATTERNS: dict[str, re.Pattern[str]] = {
    "AAT": re.compile(r"^https?://vocab\.getty\.edu/(page/)?aat/\d+/?$"),
    "ULAN": re.compile(r"^https?://vocab\.getty\.edu/(page/)?ulan/\d+/?$"),
    "TGN": re.compile(r"^https?://vocab\.getty\.edu/(page/)?tgn/\d+/?$"),
    "Wikidata": re.compile(r"^https?://(www\.)?wikidata\.org/(entity|wiki)/Q\d+/?$"),
    "LCSH": re.compile(r"^https?://id\.loc\.gov/authorities/subjects/sh\d+(\.html)?/?$"),
    "LCNAF": re.compile(r"^https?://id\.loc\.gov/authorities/names/n[a-z]?\d+(\.html)?/?$"),
    "VIAF": re.compile(r"^https?://(www\.)?viaf\.org/viaf/\d+/?$"),
    "Iconclass": re.compile(r"^https?://(www\.)?iconclass\.org/[\w.()+\-]+/?$"),
}


def authority_source_for_uri(uri: str) -> str | None:
    """Return the authority source a URI belongs to, or None if unrecognized."""
    if not isinstance(uri, str):
        return None
    candidate = uri.strip()
    for source, pattern in _AUTHORITY_URI_PATTERNS.items():
        if pattern.match(candidate):
            return source
    return None


class VocabularyValidationError(Exception):
    """Raised when strict fields contain values outside the vocabulary."""

    def __init__(self, errors: list[dict[str, Any]]):
        self.errors = errors
        first = errors[0]
        super().__init__(first["message"])

    def to_detail(self) -> dict[str, Any]:
        first = self.errors[0]
        return {
            "code": "vocabulary_validation_error",
            "message": first["message"],
            "field": first["field"],
            "errors": self.errors,
        }


def get_strict_fields(db: Session, organization_id: UUID | str) -> set[str]:
    """Return the set of field keys switched to strict for an organization."""
    from app.models.core_org import Organization

    org = db.query(Organization).filter(
        Organization.organization_id == organization_id,
    ).first()
    if not org or not org.vocabulary_strict_fields:
        return set()
    return {
        key for key, enabled in org.vocabulary_strict_fields.items()
        if enabled is True and key in STRICT_VOCABULARY_FIELDS
    }


def describe_settings(db: Session, organization_id: UUID | str) -> list[dict[str, Any]]:
    """All strict-capable fields with their current state, in display order."""
    strict = get_strict_fields(db, organization_id)
    return [
        {
            "key": spec.key,
            "label": spec.label,
            "description": spec.description,
            "strict": spec.key in strict,
        }
        for spec in STRICT_VOCABULARY_FIELDS.values()
    ]


# ---------------------------------------------------------------------------
# Value extraction
# ---------------------------------------------------------------------------

@dataclass
class _Entry:
    text: str
    uris: list[str]
    term_ids: list[UUID]


def _as_uuid(value: Any) -> UUID | None:
    if not isinstance(value, str):
        return None
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError):
        return None


def _entry_from(value: Any, spec: StrictFieldSpec) -> _Entry | None:
    """Normalize one stored/submitted value into text + references."""
    if value is None:
        return None
    if isinstance(value, str):
        text_value = value.strip()
        return _Entry(text_value, [], []) if text_value else None
    if not isinstance(value, dict):
        text_value = str(value).strip()
        return _Entry(text_value, [], []) if text_value else None

    text_value = ""
    for k in spec.text_keys:
        v = value.get(k)
        if isinstance(v, str) and v.strip():
            text_value = v.strip()
            break

    uris: list[str] = []
    term_ids: list[UUID] = []
    for auth in value.get("authorities") or []:
        if isinstance(auth, dict) and isinstance(auth.get("uri"), str):
            uris.append(auth["uri"])
    for k in ("vocabulary_term_id", "external_uri", "uri"):
        v = value.get(k)
        if isinstance(v, str) and v.strip():
            as_id = _as_uuid(v.strip())
            if as_id:
                term_ids.append(as_id)
            else:
                uris.append(v.strip())
    if isinstance(value.get("ulan_id"), str) and value["ulan_id"].strip().isdigit():
        uris.append(f"http://vocab.getty.edu/ulan/{value['ulan_id'].strip()}")
    if isinstance(value.get("aat_id"), str) and value["aat_id"].strip().isdigit():
        uris.append(f"http://vocab.getty.edu/aat/{value['aat_id'].strip()}")

    if not text_value and not uris and not term_ids:
        return None
    return _Entry(text_value, uris, term_ids)


def _entries(raw: Any, spec: StrictFieldSpec) -> list[_Entry]:
    if raw is None:
        return []
    items: Iterable[Any] = [raw] if spec.shape == "scalar" else (raw if isinstance(raw, list) else [raw])
    out = []
    for item in items:
        e = _entry_from(item, spec)
        if e is not None:
            out.append(e)
    return out


def _entry_key(e: _Entry) -> tuple[str, tuple[str, ...]]:
    return (e.text.casefold(), tuple(sorted(e.uris)) + tuple(sorted(str(t) for t in e.term_ids)))


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

def _known_texts(
    db: Session, organization_id: UUID, spec: StrictFieldSpec, texts: set[str],
) -> set[str]:
    """Of the casefolded `texts`, return those found in the field's sources."""
    from app.models import LookupCategory, LookupValue, VocabularyTerm

    if not texts:
        return set()
    lowered = list(texts)
    found: set[str] = set()

    if spec.vocabularies:
        scope = or_(
            VocabularyTerm.organization_id == organization_id,
            VocabularyTerm.organization_id.is_(None),
        )
        rows = db.query(func.lower(VocabularyTerm.preferred_term)).filter(
            scope,
            VocabularyTerm.vocabulary.in_(spec.vocabularies),
            VocabularyTerm.status == "active",
            func.lower(VocabularyTerm.preferred_term).in_(lowered),
        ).all()
        found.update(r[0] for r in rows)

        remaining = [t for t in lowered if t not in found]
        if remaining:
            alt_match = text(
                "EXISTS (SELECT 1 FROM jsonb_array_elements_text("
                "CASE WHEN jsonb_typeof(collections.vocabulary_terms.alternate_terms) = 'array' "
                "THEN collections.vocabulary_terms.alternate_terms ELSE '[]'::jsonb END) AS alt "
                "WHERE lower(alt) = ANY(:alts))"
            ).bindparams(alts=remaining)
            terms = db.query(VocabularyTerm.alternate_terms).filter(
                scope,
                VocabularyTerm.vocabulary.in_(spec.vocabularies),
                VocabularyTerm.status == "active",
                alt_match,
            ).all()
            for (alts,) in terms:
                for alt in alts or []:
                    if isinstance(alt, str) and alt.lower() in remaining:
                        found.add(alt.lower())

    if spec.lookup_category:
        remaining = [t for t in lowered if t not in found]
        if remaining:
            rows = db.query(LookupValue.label, LookupValue.value_key).join(
                LookupCategory, LookupValue.category_id == LookupCategory.category_id,
            ).filter(
                LookupCategory.category_key == spec.lookup_category,
                or_(
                    LookupValue.organization_id == organization_id,
                    LookupValue.organization_id.is_(None),
                ),
                LookupValue.is_active.is_(True),
                LookupValue.is_hidden.is_(False),
                or_(
                    func.lower(LookupValue.label).in_(remaining),
                    func.lower(LookupValue.value_key).in_(remaining),
                ),
            ).all()
            for label, key in rows:
                found.add(label.lower())
                found.add(key.lower())

    if spec.subject_authorities:
        remaining = [t for t in lowered if t not in found]
        if remaining:
            from app.models.authorities import SubjectAuthority

            rows = db.query(func.lower(SubjectAuthority.preferred_term)).filter(
                SubjectAuthority.organization_id == organization_id,
                SubjectAuthority.status == "active",
                func.lower(SubjectAuthority.preferred_term).in_(remaining),
            ).all()
            found.update(r[0] for r in rows)

    if spec.constituents:
        remaining = [t for t in lowered if t not in found]
        if remaining:
            from app.models.contacts import Constituent

            rows = db.query(Constituent.name, Constituent.display_name).filter(
                Constituent.organization_id == organization_id,
                or_(
                    func.lower(Constituent.name).in_(remaining),
                    func.lower(Constituent.display_name).in_(remaining),
                ),
            ).all()
            for name, display in rows:
                if name:
                    found.add(name.lower())
                if display:
                    found.add(display.lower())

    # Casefold vs lower differ only for a few scripts; compare on lower().
    return {t for t in texts if t in found}


def _known_term_ids(
    db: Session, organization_id: UUID, spec: StrictFieldSpec, ids: set[UUID],
) -> set[UUID]:
    from app.models import VocabularyTerm

    if not ids:
        return set()
    q = db.query(VocabularyTerm.term_id).filter(
        VocabularyTerm.term_id.in_(list(ids)),
        or_(
            VocabularyTerm.organization_id == organization_id,
            VocabularyTerm.organization_id.is_(None),
        ),
    )
    if spec.vocabularies:
        q = q.filter(VocabularyTerm.vocabulary.in_(spec.vocabularies))
    return {r[0] for r in q.all()}


def _uri_ok(uri: str, spec: StrictFieldSpec) -> bool:
    source = authority_source_for_uri(uri)
    return source is not None and source in spec.authority_sources


def find_invalid_values(
    db: Session,
    organization_id: UUID,
    spec: StrictFieldSpec,
    submitted: Any,
    existing: Any = None,
) -> list[str]:
    """Return display strings of submitted values not found for this field."""
    existing_keys = {_entry_key(e) for e in _entries(existing, spec)}
    candidates = [e for e in _entries(submitted, spec) if _entry_key(e) not in existing_keys]
    if not candidates:
        return []

    pending: list[_Entry] = []
    for e in candidates:
        if any(_uri_ok(u, spec) for u in e.uris):
            continue
        pending.append(e)
    if not pending:
        return []

    known_ids = _known_term_ids(
        db, organization_id, spec, {t for e in pending for t in e.term_ids},
    )
    known_texts = _known_texts(
        db, organization_id, spec, {e.text.lower() for e in pending if e.text},
    )

    invalid: list[str] = []
    for e in pending:
        if any(t in known_ids for t in e.term_ids):
            continue
        if e.text and e.text.lower() in known_texts:
            continue
        invalid.append(e.text or (e.uris[0] if e.uris else str(e.term_ids[0])))
    return invalid


def _quote_list(values: list[str]) -> str:
    shown = [f"“{v}”" for v in values[:5]]
    more = len(values) - len(shown)
    joined = ", ".join(shown)
    return f"{joined} and {more} more" if more > 0 else joined


def validate_strict_vocabulary(
    db: Session,
    organization_id: UUID,
    data: dict[str, Any],
    existing_obj: Any = None,
    skip_fields: set[str] | frozenset[str] = frozenset(),
) -> None:
    """
    Raise VocabularyValidationError if any strict field in `data` holds a
    value outside the organization's vocabulary for that field.

    Only fields present in `data` are checked. On update, pass the current
    object as `existing_obj` so values it already holds are grandfathered.
    """
    strict = get_strict_fields(db, organization_id)
    if not strict:
        return

    errors: list[dict[str, Any]] = []
    for key in STRICT_VOCABULARY_FIELDS:
        if key not in strict or key not in data or key in skip_fields:
            continue
        spec = STRICT_VOCABULARY_FIELDS[key]
        existing = getattr(existing_obj, key, None) if existing_obj is not None else None
        invalid = find_invalid_values(db, organization_id, spec, data[key], existing)
        if invalid:
            noun = "is" if len(invalid) == 1 else "are"
            errors.append({
                "field": key,
                "label": spec.label,
                "invalid_values": invalid,
                "message": (
                    f"{spec.label}: {_quote_list(invalid)} {noun} not in your "
                    f"organization's vocabulary. Strict vocabulary validation is "
                    f"on for this field, so choose a suggested term instead. "
                    f"{spec.description}"
                ),
            })
    if errors:
        raise VocabularyValidationError(errors)
