"""
Constituent Service

Manages unified constituent records (persons, organizations, corporate bodies)
with ULAN integration. Provides search across local records and Getty ULAN,
handles importing full ULAN records, cross-reference linking to any entity,
and merging duplicate constituents.

Replaces the former PersonAuthorityService with a broader model that supports
all constituent types and polymorphic entity linking via ConstituentXref.
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

import requests
from sqlalchemy.orm import Session

from app.models import Constituent, ConstituentXref

logger = logging.getLogger(__name__)

# ULAN SPARQL endpoint
GETTY_SPARQL_ENDPOINT = "http://vocab.getty.edu/sparql"
SPARQL_TIMEOUT = 10.0


def find_or_create_staff_constituent(
    session: Session,
    organization_id: UUID,
    user_id: UUID,
    *,
    actor_id: UUID | None = None,
) -> Optional[Constituent]:
    """Return the constituent that represents a staff user in this org, creating
    one (type 'person', named from the user) on first use.

    The user↔constituent bridge: people-references (examiner, conservator, …)
    point at constituents, and this lets a login user be one of them. Idempotent
    — guarded by the uq_constituents_org_user unique index. Returns None if the
    user doesn't exist.
    """
    existing = (
        session.query(Constituent)
        .filter(
            Constituent.organization_id == organization_id,
            Constituent.user_id == user_id,
        )
        .first()
    )
    if existing is not None:
        return existing

    from app.models import User
    user = session.get(User, user_id)
    if user is None:
        return None

    constituent = Constituent(
        organization_id=organization_id,
        user_id=user_id,
        constituent_type="person",
        name=(user.display_name or user.email or "Staff member"),
        email=user.email,
        created_by=actor_id or user_id,
    )
    session.add(constituent)
    session.flush()
    return constituent


def fetch_ulan_modified_date(ulan_id: str) -> Optional[datetime]:
    """
    Fetch only the modification date for a ULAN record.

    This is a lightweight check to see if a record has changed
    without fetching the full data.

    Returns:
        datetime of last modification, or None if not found
    """
    uri = f"http://vocab.getty.edu/ulan/{ulan_id}"

    # SPARQL query to get just the modification date
    sparql = f"""PREFIX dct: <http://purl.org/dc/terms/>

SELECT ?modified
WHERE {{
    <{uri}> dct:modified ?modified .
}}
LIMIT 1"""

    try:
        response = requests.get(
            GETTY_SPARQL_ENDPOINT,
            params={"query": sparql, "format": "json"},
            timeout=SPARQL_TIMEOUT
        )

        if response.status_code != 200:
            return None

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        if bindings:
            modified_str = bindings[0].get("modified", {}).get("value", "")
            if modified_str:
                # Parse ISO datetime (e.g., "2002-06-24T16:03:51")
                return datetime.fromisoformat(modified_str.replace("Z", "+00:00"))

        return None

    except Exception as e:
        logger.warning(f"Failed to fetch ULAN modified date for {ulan_id}: {e}")
        return None


def fetch_ulan_records_modified_since(since_date: datetime, limit: int = 1000) -> list[dict]:
    """
    Query ULAN for all records modified since a given date.

    This is efficient for periodic syncs - one query to find all changes,
    then we only update records we have locally.

    Args:
        since_date: Only return records modified after this date
        limit: Maximum records to return (default 1000)

    Returns:
        List of dicts with ulan_id and modified date
    """
    since_str = since_date.strftime("%Y-%m-%dT%H:%M:%S")

    sparql = f"""PREFIX dct: <http://purl.org/dc/terms/>
PREFIX gvp: <http://vocab.getty.edu/ontology#>

SELECT DISTINCT ?uri ?modified
WHERE {{
    ?uri a gvp:PersonConcept ;
         dct:modified ?modified .
    FILTER(?modified > "{since_str}"^^xsd:dateTime)
}}
ORDER BY DESC(?modified)
LIMIT {limit}"""

    try:
        response = requests.get(
            GETTY_SPARQL_ENDPOINT,
            params={"query": sparql, "format": "json"},
            timeout=30  # Longer timeout for bulk query
        )

        if response.status_code != 200:
            logger.warning(f"ULAN modified-since query failed: status={response.status_code}")
            return []

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        results = []
        for binding in bindings:
            uri = binding.get("uri", {}).get("value", "")
            modified_str = binding.get("modified", {}).get("value", "")

            if not uri or "/ulan/" not in uri:
                continue

            ulan_id = uri.split("/")[-1]

            try:
                modified = datetime.fromisoformat(modified_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                modified = None

            results.append({
                "ulan_id": ulan_id,
                "modified": modified,
            })

        logger.info(f"Found {len(results)} ULAN records modified since {since_str}")
        return results

    except Exception as e:
        logger.warning(f"Failed to fetch ULAN modified-since records: {e}")
        return []


# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class ULANRecord:
    """Full ULAN record data."""
    ulan_id: str
    uri: str
    preferred_name: str
    display_name: Optional[str] = None
    sort_name: Optional[str] = None
    given_name: Optional[str] = None
    family_name: Optional[str] = None
    variant_names: list[dict] = field(default_factory=list)

    # Dates
    birth_date_display: Optional[str] = None
    birth_date_earliest: Optional[date] = None
    birth_date_latest: Optional[date] = None
    birth_place: Optional[str] = None
    birth_place_tgn_id: Optional[str] = None

    death_date_display: Optional[str] = None
    death_date_earliest: Optional[date] = None
    death_date_latest: Optional[date] = None
    death_place: Optional[str] = None
    death_place_tgn_id: Optional[str] = None

    # Identity
    nationality: Optional[str] = None
    nationalities: list[str] = field(default_factory=list)
    gender: Optional[str] = None
    life_roles: list[dict] = field(default_factory=list)

    # Biography
    biography: Optional[str] = None

    # External authority IDs
    viaf_id: Optional[str] = None
    wikidata_id: Optional[str] = None

    # Related persons
    related_persons: list[dict] = field(default_factory=list)


@dataclass
class ConstituentSearchResult:
    """Search result for constituent records."""
    id: str  # "local-{uuid}" or "ulan-{id}"
    source: str  # "local" or "ulan"
    label: str
    description: Optional[str] = None
    dates: Optional[str] = None
    nationality: Optional[str] = None
    roles: list[str] = field(default_factory=list)
    ulan_id: Optional[str] = None
    constituent_id: Optional[UUID] = None  # If local record exists
    uri: Optional[str] = None


# =============================================================================
# ULAN SPARQL QUERIES
# =============================================================================


def fetch_ulan_search(query: str, limit: int = 10) -> list[ConstituentSearchResult]:
    """
    Search ULAN for person names.
    Returns basic info for autocomplete display.
    """
    # Escape special regex characters and quotes
    safe_query = re.escape(query).replace('"', '\\"').replace("'", "\\'")

    # IMPORTANT: No leading whitespace - Getty returns empty for that
    # Use xl:prefLabel path for person names
    # Use word-boundary matching to avoid partial matches (e.g., "Simonetta" for "Monet")
    sparql = f"""PREFIX xl: <http://www.w3.org/2008/05/skos-xl#>
PREFIX gvp: <http://vocab.getty.edu/ontology#>

SELECT DISTINCT ?uri ?name ?birthYear ?deathYear ?nationality
WHERE {{
    ?uri a gvp:PersonConcept ;
         xl:prefLabel/xl:literalForm ?name .
    FILTER(REGEX(?name, "(^|[^a-zA-Z]){safe_query}", "i"))

    OPTIONAL {{ ?uri gvp:estStart ?birthYear . }}
    OPTIONAL {{ ?uri gvp:estEnd ?deathYear . }}
    OPTIONAL {{
        ?uri gvp:nationalityPreferred/xl:prefLabel/xl:literalForm ?nationality .
    }}
}}
LIMIT {limit * 3}"""

    try:
        response = requests.get(
            GETTY_SPARQL_ENDPOINT,
            params={"query": sparql, "format": "json"},
            timeout=SPARQL_TIMEOUT
        )

        if response.status_code != 200 or not response.text:
            logger.warning(f"ULAN search failed: status={response.status_code}")
            return []

        data = response.json()
        bindings = data.get("results", {}).get("bindings", [])

        results = []
        seen_uris = set()

        for binding in bindings:
            uri = binding.get("uri", {}).get("value", "")
            name = binding.get("name", {}).get("value", "")

            if not uri or not name or uri in seen_uris:
                continue
            seen_uris.add(uri)

            # Extract ULAN ID from URI
            ulan_id = uri.split("/")[-1] if "/ulan/" in uri else None
            if not ulan_id:
                continue

            # Build dates display
            birth = binding.get("birthYear", {}).get("value", "")
            death = binding.get("deathYear", {}).get("value", "")
            dates = None
            if birth or death:
                # Extract year from date string (may be full date or just year)
                birth_year = birth[:4] if birth else "?"
                death_year = death[:4] if death else ""
                dates = f"{birth_year}-{death_year}"

            nationality = binding.get("nationality", {}).get("value", "")

            # Build description
            desc_parts = []
            if nationality:
                desc_parts.append(nationality)
            if dates:
                desc_parts.append(dates)
            description = ", ".join(desc_parts) if desc_parts else None

            results.append(ConstituentSearchResult(
                id=f"ulan-{ulan_id}",
                source="ulan",
                label=name,
                description=description,
                dates=dates,
                nationality=nationality,
                ulan_id=ulan_id,
                uri=uri,
            ))

        return results[:limit]

    except Exception as e:
        logger.warning(f"ULAN search failed: {e}")
        return []


def fetch_ulan_full_record(ulan_id: str) -> Optional[ULANRecord]:
    """
    Fetch complete ULAN record for importing into Constituent.
    Uses JSON-LD endpoint for reliable structured data.
    """
    uri = f"http://vocab.getty.edu/ulan/{ulan_id}"
    json_url = f"{uri}.json"

    try:
        response = requests.get(json_url, timeout=SPARQL_TIMEOUT)

        if response.status_code != 200:
            logger.warning(f"ULAN fetch failed: status={response.status_code}")
            return None

        data = response.json()

        # Extract preferred name from identified_by
        preferred_name = None
        variant_names = []
        for ident in data.get("identified_by", []):
            if ident.get("type") == "Name":
                content = ident.get("content", "")
                # Check if this is the preferred name (first English one)
                lang = ident.get("language", [{}])
                is_english = any(
                    l.get("_label") == "English" or l.get("id", "").endswith("300388277")
                    for l in (lang if isinstance(lang, list) else [lang])
                )
                if preferred_name is None and (is_english or not lang):
                    preferred_name = content
                elif content and content != preferred_name:
                    variant_names.append({"name": content, "type": "variant"})

        if not preferred_name:
            preferred_name = data.get("_label", f"ULAN {ulan_id}")

        # Extract birth info
        born = data.get("born", {})
        birth_timespan = born.get("timespan", {})
        birth_date_str = birth_timespan.get("begin_of_the_begin", "")
        birth_year = birth_date_str[:4] if birth_date_str else None
        birth_places = born.get("took_place_at", [])
        birth_place = birth_places[0].get("_label") if birth_places else None
        birth_place_tgn = None
        if birth_places and "/tgn/" in birth_places[0].get("id", ""):
            birth_place_tgn = birth_places[0]["id"].split("/")[-1]

        # Extract death info
        died = data.get("died", {})
        death_timespan = died.get("timespan", {})
        death_date_str = death_timespan.get("begin_of_the_begin", "")
        death_year = death_date_str[:4] if death_date_str else None
        death_places = died.get("took_place_at", [])
        death_place = death_places[0].get("_label") if death_places else None
        death_place_tgn = None
        if death_places and "/tgn/" in death_places[0].get("id", ""):
            death_place_tgn = death_places[0]["id"].split("/")[-1]

        # Extract nationality and roles from classified_as
        nationality = None
        nationalities = []
        life_roles = []
        gender = None

        for classification in data.get("classified_as", []):
            label = classification.get("_label", "")
            class_type = classification.get("classified_as", [])

            # Check what type of classification this is
            for ct in class_type:
                ct_label = ct.get("_label", "")
                if ct_label == "nationality":
                    if not nationality:
                        nationality = label
                    nationalities.append(label)
                elif ct_label == "roles":
                    life_roles.append({"role": label})
                elif ct_label == "sex role":
                    gender = label

        # Extract biography from referred_to_by
        biography = None
        for ref in data.get("referred_to_by", []):
            if ref.get("type") == "LinguisticObject":
                lang = ref.get("language", [{}])
                is_english = any(
                    l.get("_label") == "English"
                    for l in (lang if isinstance(lang, list) else [lang])
                )
                if is_english or not lang:
                    biography = ref.get("content")
                    break

        # Extract external authority IDs via SPARQL (skos:exactMatch)
        viaf_id = None
        wikidata_id = None
        try:
            match_sparql = f"""
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?match WHERE {{
  <{uri}> skos:exactMatch ?match .
}}
"""
            match_response = requests.get(
                GETTY_SPARQL_ENDPOINT,
                params={"query": match_sparql, "format": "json"},
                timeout=SPARQL_TIMEOUT,
            )
            if match_response.status_code == 200:
                match_data = match_response.json()
                for binding in match_data.get("results", {}).get("bindings", []):
                    match_uri = binding.get("match", {}).get("value", "")
                    # VIAF: http://viaf.org/viaf/15873
                    if "viaf.org/viaf/" in match_uri:
                        viaf_id = match_uri.split("viaf.org/viaf/")[-1].rstrip("/")
                    # Wikidata: https://wikidata.org/wiki/Q5593 or http://www.wikidata.org/entity/Q5593
                    elif "wikidata.org/" in match_uri:
                        # Extract Q-number from various URL formats
                        if "/wiki/Q" in match_uri:
                            wikidata_id = match_uri.split("/wiki/")[-1].rstrip("/")
                        elif "/entity/Q" in match_uri:
                            wikidata_id = match_uri.split("/entity/")[-1].rstrip("/")
        except Exception as e:
            logger.warning(f"Failed to fetch external matches for {ulan_id}: {e}")

        def parse_date(year_str: Optional[str]) -> Optional[date]:
            if not year_str:
                return None
            try:
                return date(int(year_str), 1, 1)
            except (ValueError, TypeError):
                return None

        record = ULANRecord(
            ulan_id=ulan_id,
            uri=uri,
            preferred_name=preferred_name,
            display_name=preferred_name,  # Use same as preferred for now
            variant_names=variant_names,
            birth_date_display=birth_year,
            birth_date_earliest=parse_date(birth_year),
            birth_place=birth_place,
            birth_place_tgn_id=birth_place_tgn,
            death_date_display=death_year,
            death_date_earliest=parse_date(death_year),
            death_place=death_place,
            death_place_tgn_id=death_place_tgn,
            nationality=nationality,
            nationalities=nationalities,
            gender=gender,
            life_roles=life_roles,
            biography=biography,
            viaf_id=viaf_id,
            wikidata_id=wikidata_id,
        )

        return record

    except Exception as e:
        logger.warning(f"ULAN fetch failed: {e}")
        import traceback
        logger.warning(traceback.format_exc())
        return None


# =============================================================================
# CONSTITUENT SERVICE
# =============================================================================


# Direct FK columns on procedure tables that reference constituent_id.
# Used by merge() to re-point all references from secondary to primary.
# Each entry is (ModelClass, column_name).
_CONSTITUENT_FK_COLUMNS = None


def _get_constituent_fk_columns():
    """
    Lazily load the list of (Model, column_name) tuples for all procedure
    tables that have a direct FK to constituents.constituent_id.
    """
    global _CONSTITUENT_FK_COLUMNS
    if _CONSTITUENT_FK_COLUMNS is not None:
        return _CONSTITUENT_FK_COLUMNS

    from app.models import (
        Movement,
        ObjectEntry,
        Acquisition,
        LoanIn,
        LoanOut,
        ConservationTreatment,
        ObjectExit,
        Shipment,
        ShipmentLeg,
        Deaccession,
        Valuation,
    )

    _CONSTITUENT_FK_COLUMNS = [
        (Movement, "handler_id"),
        (ObjectEntry, "depositor_id"),
        (ObjectEntry, "current_owner_id"),
        (ObjectEntry, "terms_accepted_by_id"),
        (Acquisition, "source_id"),
        (LoanIn, "lender_id"),
        (LoanIn, "lender_authorizer_id"),
        (LoanOut, "borrower_id"),
        (ConservationTreatment, "conservator_id"),
        (ObjectExit, "recipient_id"),
        (ObjectExit, "courier_id"),
        (Shipment, "ship_from_contact_id"),
        (Shipment, "ship_to_contact_id"),
        (ShipmentLeg, "carrier_id"),
        (Deaccession, "recipient_id"),
        (Deaccession, "appraiser_id"),
        (Valuation, "valuator_id"),
    ]
    return _CONSTITUENT_FK_COLUMNS


class ConstituentService:
    """Service for managing unified constituent records."""

    def __init__(self, session: Session, organization_id: UUID):
        self.session = session
        self.organization_id = organization_id

    def search(
        self,
        query: str,
        include_ulan: bool = True,
        limit: int = 10,
    ) -> list[ConstituentSearchResult]:
        """
        Search for constituents.
        Returns local records first, then ULAN results.
        """
        results = []

        # Search local records first
        local_results = self._search_local(query, limit)
        results.extend(local_results)

        # Search ULAN
        if include_ulan and len(results) < limit:
            ulan_limit = limit - len(results)
            ulan_results = fetch_ulan_search(query, ulan_limit)

            # Filter out ULAN results that already exist locally
            local_ulan_ids = {r.ulan_id for r in local_results if r.ulan_id}
            for ulan_result in ulan_results:
                if ulan_result.ulan_id not in local_ulan_ids:
                    results.append(ulan_result)

        return results[:limit]

    def _search_local(self, query: str, limit: int) -> list[ConstituentSearchResult]:
        """Search local Constituent records."""
        from sqlalchemy import or_

        constituents = self.session.query(Constituent).filter(
            Constituent.organization_id == self.organization_id,
            Constituent.status == "active",
            or_(
                Constituent.name.ilike(f"%{query}%"),
                Constituent.display_name.ilike(f"%{query}%"),
            )
        ).order_by(Constituent.name).limit(limit).all()

        results = []
        for c in constituents:
            # Build dates display
            dates = None
            if c.birth_date_display or c.death_date_display:
                dates = f"{c.birth_date_display or '?'}-{c.death_date_display or ''}"

            # Build description
            desc_parts = []
            if c.nationality:
                desc_parts.append(c.nationality)
            if dates:
                desc_parts.append(dates)

            # Get roles
            roles = []
            if c.life_roles:
                roles = [r.get("role", "") for r in c.life_roles if r.get("role")]

            results.append(ConstituentSearchResult(
                id=f"local-{c.constituent_id}",
                source="local",
                label=c.display_name or c.name,
                description=", ".join(desc_parts) if desc_parts else None,
                dates=dates,
                nationality=c.nationality,
                roles=roles,
                ulan_id=c.ulan_id,
                constituent_id=c.constituent_id,
                uri=f"http://vocab.getty.edu/ulan/{c.ulan_id}" if c.ulan_id else None,
            ))

        return results

    def get_by_id(self, constituent_id: UUID) -> Optional[Constituent]:
        """Get a constituent by ID."""
        return self.session.query(Constituent).filter(
            Constituent.constituent_id == constituent_id,
            Constituent.organization_id == self.organization_id,
        ).first()

    def get_by_ulan_id(self, ulan_id: str) -> Optional[Constituent]:
        """Get a constituent by ULAN ID."""
        return self.session.query(Constituent).filter(
            Constituent.ulan_id == ulan_id,
            Constituent.organization_id == self.organization_id,
        ).first()

    def import_from_ulan(
        self,
        ulan_id: str,
        created_by: Optional[UUID] = None,
    ) -> Optional[Constituent]:
        """
        Import a ULAN record into the local database as a Constituent.
        If a record with this ULAN ID already exists, returns it.
        """
        # Check if already exists
        existing = self.get_by_ulan_id(ulan_id)
        if existing:
            logger.info(f"Constituent for ULAN {ulan_id} already exists")
            return existing

        # Fetch full ULAN record
        ulan_record = fetch_ulan_full_record(ulan_id)
        if not ulan_record:
            logger.warning(f"Could not fetch ULAN record {ulan_id}")
            return None

        # Create Constituent
        constituent = Constituent(
            organization_id=self.organization_id,
            constituent_type="person",

            # Names - map preferred_name to name (Constituent's primary name field)
            name=ulan_record.preferred_name,
            display_name=ulan_record.display_name or ulan_record.preferred_name,
            sort_name=ulan_record.sort_name,
            given_name=ulan_record.given_name,
            family_name=ulan_record.family_name,

            # Dates
            birth_date_display=ulan_record.birth_date_display,
            birth_date_earliest=ulan_record.birth_date_earliest,
            birth_place=ulan_record.birth_place,
            birth_place_tgn_id=ulan_record.birth_place_tgn_id,
            death_date_display=ulan_record.death_date_display,
            death_date_earliest=ulan_record.death_date_earliest,
            death_place=ulan_record.death_place,
            death_place_tgn_id=ulan_record.death_place_tgn_id,

            # Identity
            nationality=ulan_record.nationality,
            nationalities=ulan_record.nationalities if ulan_record.nationalities else None,
            gender=ulan_record.gender,
            life_roles=ulan_record.life_roles if ulan_record.life_roles else None,

            # Biography
            biography=ulan_record.biography,
            biography_source="Getty ULAN",

            # External IDs
            ulan_id=ulan_id,
            viaf_id=ulan_record.viaf_id,
            wikidata_id=ulan_record.wikidata_id,
            ulan_synced_at=datetime.now(timezone.utc),
            ulan_modified_at=fetch_ulan_modified_date(ulan_id),
            external_uris=[{"uri": ulan_record.uri, "source": "ULAN"}],

            # Status
            status="active",
            is_active=True,
            is_verified=True,  # ULAN is authoritative
            created_by=created_by,
        )

        self.session.add(constituent)
        self.session.flush()  # Get the ID

        # Create variant terms from ULAN data
        if ulan_record.variant_names:
            from app.models import VariantTerm
            for idx, vn in enumerate(ulan_record.variant_names):
                name = vn.get("name", vn) if isinstance(vn, dict) else vn
                self.session.add(VariantTerm(
                    organization_id=constituent.organization_id,
                    entity_type='constituent', entity_id=constituent.constituent_id,
                    term=name, source='ulan', display_order=idx,
                ))

        logger.info(f"Created Constituent {constituent.constituent_id} from ULAN {ulan_id}")
        return constituent

    def get_or_import_from_ulan(
        self,
        ulan_id: str,
        created_by: Optional[UUID] = None,
    ) -> Optional[Constituent]:
        """
        Get existing Constituent for ULAN ID, or import if not exists.
        Idempotent operation.
        """
        existing = self.get_by_ulan_id(ulan_id)
        if existing:
            return existing
        return self.import_from_ulan(ulan_id, created_by)

    def link_to_entity(
        self,
        constituent_id: UUID,
        entity_type: str,
        entity_id: UUID,
        role: str = "creator",
        role_qualifier: Optional[str] = None,
        attribution_certainty: Optional[str] = None,
        attribution_note: Optional[str] = None,
        display_order: int = 0,
        display_name_override: Optional[str] = None,
        is_primary: bool = True,
        created_by: Optional[UUID] = None,
    ) -> ConstituentXref:
        """
        Link a constituent to any entity via ConstituentXref.
        If the link already exists (same entity + constituent + role), returns existing.
        """
        # Check if link already exists
        existing = self.session.query(ConstituentXref).filter(
            ConstituentXref.organization_id == self.organization_id,
            ConstituentXref.entity_type == entity_type,
            ConstituentXref.entity_id == entity_id,
            ConstituentXref.constituent_id == constituent_id,
            ConstituentXref.role == role,
        ).first()

        if existing:
            return existing

        xref = ConstituentXref(
            organization_id=self.organization_id,
            constituent_id=constituent_id,
            entity_type=entity_type,
            entity_id=entity_id,
            role=role,
            role_qualifier=role_qualifier,
            attribution_certainty=attribution_certainty,
            attribution_note=attribution_note,
            display_order=display_order,
            display_name_override=display_name_override,
            is_primary=is_primary,
            created_by=created_by,
        )

        self.session.add(xref)
        self.session.flush()

        return xref

    def unlink_from_entity(
        self,
        constituent_id: UUID,
        entity_type: str,
        entity_id: UUID,
        role: Optional[str] = None,
    ) -> bool:
        """
        Remove link between constituent and entity.
        If role is specified, only removes that specific link.
        """
        query = self.session.query(ConstituentXref).filter(
            ConstituentXref.organization_id == self.organization_id,
            ConstituentXref.entity_type == entity_type,
            ConstituentXref.entity_id == entity_id,
            ConstituentXref.constituent_id == constituent_id,
        )

        if role:
            query = query.filter(ConstituentXref.role == role)

        deleted = query.delete()
        return deleted > 0

    def get_entity_constituents(self, entity_type: str, entity_id: UUID) -> list[dict]:
        """Get all constituents linked to an entity via ConstituentXref."""
        xrefs = self.session.query(ConstituentXref).filter(
            ConstituentXref.organization_id == self.organization_id,
            ConstituentXref.entity_type == entity_type,
            ConstituentXref.entity_id == entity_id,
        ).order_by(ConstituentXref.display_order).all()

        results = []
        for xref in xrefs:
            constituent = xref.constituent
            results.append({
                "xref_id": str(xref.xref_id),
                "constituent_id": str(xref.constituent_id),
                "role": xref.role,
                "role_qualifier": xref.role_qualifier,
                "attribution_certainty": xref.attribution_certainty,
                "attribution_note": xref.attribution_note,
                "display_order": xref.display_order,
                "is_primary": xref.is_primary,
                "display_name": xref.display_name_override or constituent.display_name or constituent.name,
                "dates": (
                    f"{constituent.birth_date_display or '?'}-{constituent.death_date_display or ''}"
                    if constituent.birth_date_display or constituent.death_date_display
                    else None
                ),
                "nationality": constituent.nationality,
                "ulan_id": constituent.ulan_id,
                "is_verified": constituent.is_verified,
            })

        return results

    def merge(
        self,
        primary_id: UUID,
        secondary_id: UUID,
        merged_by: Optional[UUID] = None,
    ) -> Constituent:
        """
        Merge two constituents, keeping primary and retiring secondary.

        Steps:
          1. Re-point all ConstituentXrefs from secondary to primary.
             Rows that would violate the unique constraint
             (org + entity_type + entity_id + constituent_id + role)
             are silently deleted instead of moved.
          2. Re-point all direct FK columns on procedure tables from
             secondary to primary.
          3. Set secondary.status = 'merged'.

        Returns the primary Constituent.

        Raises:
            ValueError: if primary or secondary not found, or IDs are equal.
        """
        if primary_id == secondary_id:
            raise ValueError("Cannot merge a constituent with itself")

        primary = self.get_by_id(primary_id)
        if not primary:
            raise ValueError(f"Primary constituent {primary_id} not found")

        secondary = self.get_by_id(secondary_id)
        if not secondary:
            raise ValueError(f"Secondary constituent {secondary_id} not found")

        # ------------------------------------------------------------------
        # 1. Re-point ConstituentXrefs
        # ------------------------------------------------------------------
        secondary_xrefs = self.session.query(ConstituentXref).filter(
            ConstituentXref.constituent_id == secondary_id,
        ).all()

        for xref in secondary_xrefs:
            # Check if the primary already has an xref for the same slot
            conflict = self.session.query(ConstituentXref).filter(
                ConstituentXref.organization_id == xref.organization_id,
                ConstituentXref.entity_type == xref.entity_type,
                ConstituentXref.entity_id == xref.entity_id,
                ConstituentXref.constituent_id == primary_id,
                ConstituentXref.role == xref.role,
            ).first()

            if conflict:
                # Duplicate slot -- delete the secondary's xref
                self.session.delete(xref)
            else:
                # Safe to re-point
                xref.constituent_id = primary_id

        # ------------------------------------------------------------------
        # 2. Re-point direct FK columns on procedure tables
        # ------------------------------------------------------------------
        for model_class, column_name in _get_constituent_fk_columns():
            col = getattr(model_class, column_name)
            self.session.query(model_class).filter(
                col == secondary_id,
            ).update({column_name: primary_id}, synchronize_session="fetch")

        # ------------------------------------------------------------------
        # 3. Mark secondary as merged
        # ------------------------------------------------------------------
        secondary.status = "merged"
        secondary.is_active = False
        if merged_by:
            secondary.updated_by = merged_by

        self.session.flush()

        logger.info(
            f"Merged Constituent {secondary_id} into {primary_id} "
            f"({len(secondary_xrefs)} xrefs processed)"
        )
        return primary
