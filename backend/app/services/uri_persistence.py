"""
URI Persistence Service

Provides stable, dereferenceable URIs for all core entities.
Implements the Linked Data principle that URIs should never change.

Key guarantees:
- URIs are immutable once assigned
- Deletions create tombstones (410 Gone), not hard deletes
- Merges preserve previous URIs via redirects (301/303)
- All URI assignments are logged for audit

URI Pattern:
    https://data.madrona.io/org/{org_slug}/{entity_type}/{public_id}

Example:
    https://data.madrona.io/org/moma/object/2024-001
    https://data.madrona.io/org/moma/agent/monet-claude
    https://data.madrona.io/org/moma/place/paris-france
"""

import hashlib
import os
import re
import secrets
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Tuple
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


# ============================================================================
# CONFIGURATION
# ============================================================================

# Base URI for all public identifiers (configurable via environment variable)
BASE_URI = os.environ.get("LOD_BASE_URI", "https://data.madrona.io")

# Entity type URL segments (singular, lowercase, URL-safe)
ENTITY_TYPES = {
    "collection_object": "object",
    "person_authority": "agent",
    "place": "place",
    "media": "media",
    "vocabulary_term": "concept",
    "organization": "org",
    "acquisition": "acquisition",
    "loan_in": "loan-in",
    "loan_out": "loan-out",
    "exhibition": "exhibition",
    "condition_report": "condition",
    "conservation_treatment": "conservation",
    "deaccession": "deaccession",
}

# Reverse mapping for parsing
URL_SEGMENT_TO_ENTITY = {v: k for k, v in ENTITY_TYPES.items()}


# ============================================================================
# ENUMS
# ============================================================================

class URIStatus(str, Enum):
    """Status of a URI in the persistence layer."""
    ACTIVE = "active"           # Normal, resolvable URI
    REDIRECT = "redirect"       # Merged into another entity
    TOMBSTONE = "tombstone"     # Deleted, returns 410 Gone
    RESERVED = "reserved"       # Reserved but not yet assigned


class RedirectType(str, Enum):
    """Type of redirect for merged URIs."""
    PERMANENT = "301"           # 301 Moved Permanently
    SEE_OTHER = "303"           # 303 See Other (for content negotiation)


# ============================================================================
# MODELS
# ============================================================================

class PublicURI(BaseModel):
    """
    A stable public URI for an entity.

    This is the external identifier that will never change.
    Implementation details (internal UUIDs) are hidden.
    """
    uri: str = Field(..., description="Full dereferenceable URI")
    entity_type: str = Field(..., description="Entity type (object, agent, etc.)")
    public_id: str = Field(..., description="Public identifier segment")
    organization_slug: str = Field(..., description="Organization URL slug")

    @property
    def path(self) -> str:
        """Get the path portion of the URI."""
        return f"/org/{self.organization_slug}/{self.entity_type}/{self.public_id}"


class URIRecord(BaseModel):
    """
    Internal record tracking a URI's lifecycle.

    Stored in the uri_registry table.
    """
    uri_id: UUID = Field(default_factory=uuid4)
    organization_id: UUID
    entity_type: str
    entity_id: UUID
    public_id: str
    full_uri: str
    status: URIStatus = URIStatus.ACTIVE
    redirect_to: Optional[str] = None
    redirect_type: Optional[RedirectType] = None
    tombstone_reason: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    created_by: Optional[UUID] = None


class URIResolution(BaseModel):
    """
    Result of resolving a URI.

    Indicates whether the URI exists, is redirected, or is tombstoned.
    """
    found: bool
    status: URIStatus
    entity_type: Optional[str] = None
    entity_id: Optional[UUID] = None
    redirect_uri: Optional[str] = None
    redirect_type: Optional[RedirectType] = None
    tombstone_reason: Optional[str] = None
    tombstone_date: Optional[datetime] = None


# ============================================================================
# PUBLIC ID GENERATION
# ============================================================================

def generate_public_id(
    entity_type: str,
    hint: Optional[str] = None,
    existing_check: Optional[callable] = None
) -> str:
    """
    Generate a stable, human-friendly public identifier.

    Strategy:
    1. If hint provided (e.g., object number), slugify it
    2. Otherwise, generate a short random ID
    3. Ensure uniqueness via existing_check callback

    Args:
        entity_type: Type of entity
        hint: Optional human-readable hint (object number, name, etc.)
        existing_check: Async function to check if ID exists

    Returns:
        A URL-safe public identifier
    """
    if hint:
        # Slugify the hint
        public_id = slugify(hint)
        if len(public_id) > 100:
            public_id = public_id[:100]
    else:
        # Generate random ID: adjective-noun-xxxx pattern for memorability
        public_id = generate_memorable_id()

    return public_id


def slugify(text: str) -> str:
    """
    Convert text to a URL-safe slug.

    Examples:
        "Claude Monet" -> "claude-monet"
        "Oil on Canvas" -> "oil-on-canvas"
        "1941.4.1" -> "1941-4-1"
        "Café & Bar" -> "cafe-bar"
    """
    # Normalize unicode
    import unicodedata
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii')

    # Lowercase
    text = text.lower()

    # Replace separators with hyphens
    text = re.sub(r'[./\\]', '-', text)

    # Remove non-alphanumeric (except hyphens)
    text = re.sub(r'[^a-z0-9-]', '', text)

    # Collapse multiple hyphens
    text = re.sub(r'-+', '-', text)

    # Strip leading/trailing hyphens
    text = text.strip('-')

    return text or generate_memorable_id()


def generate_memorable_id() -> str:
    """
    Generate a memorable random ID.

    Format: xxxx-xxxx (8 characters total)
    Uses base32 for URL-safety and readability (no 0/O/1/l confusion)
    """
    # Generate 5 random bytes = 40 bits = 8 base32 chars
    random_bytes = secrets.token_bytes(5)
    base32 = hashlib.sha256(random_bytes).hexdigest()[:8]
    return f"{base32[:4]}-{base32[4:8]}"


# ============================================================================
# URI BUILDING
# ============================================================================

def build_uri(
    organization_slug: str,
    entity_type: str,
    public_id: str,
    base_uri: str = BASE_URI
) -> str:
    """
    Build a full dereferenceable URI.

    Args:
        organization_slug: URL-safe organization identifier
        entity_type: Internal entity type name
        public_id: Public identifier for the entity

    Returns:
        Full URI string
    """
    url_segment = ENTITY_TYPES.get(entity_type, entity_type)
    return f"{base_uri}/org/{organization_slug}/{url_segment}/{public_id}"


def parse_uri(uri: str) -> Optional[Tuple[str, str, str]]:
    """
    Parse a URI into its components.

    Args:
        uri: Full URI or path

    Returns:
        Tuple of (organization_slug, entity_type, public_id) or None
    """
    # Handle both full URI and path-only
    path = uri
    if uri.startswith("http"):
        from urllib.parse import urlparse
        parsed = urlparse(uri)
        path = parsed.path

    # Match pattern: /org/{org_slug}/{entity}/{public_id}
    match = re.match(r'^/org/([^/]+)/([^/]+)/(.+)$', path)
    if not match:
        return None

    org_slug, url_segment, public_id = match.groups()

    # Convert URL segment back to entity type
    entity_type = URL_SEGMENT_TO_ENTITY.get(url_segment, url_segment)

    return (org_slug, entity_type, public_id)


# ============================================================================
# URI PERSISTENCE SERVICE
# ============================================================================

class URIPersistenceService:
    """
    Service for managing stable URI assignments.

    Guarantees:
    - URIs are assigned exactly once per entity
    - URIs never change (immutable)
    - Deletions create tombstones
    - Merges create redirects

    Note: This service uses synchronous database operations for Flask compatibility.
    """

    def __init__(self, db_session):
        self.db = db_session

    def assign_uri(
        self,
        organization_id: UUID,
        organization_slug: str,
        entity_type: str,
        entity_id: UUID,
        hint: Optional[str] = None,
        created_by: Optional[UUID] = None
    ) -> PublicURI:
        """
        Assign a stable URI to an entity.

        If the entity already has a URI, returns the existing one.
        This is idempotent - safe to call multiple times.

        Args:
            organization_id: Organization UUID
            organization_slug: URL-safe org identifier
            entity_type: Type of entity (collection_object, person_authority, etc.)
            entity_id: Internal UUID of the entity
            hint: Optional hint for generating public ID
            created_by: User creating the URI

        Returns:
            PublicURI object with the stable URI
        """
        from app.models import URIRegistry

        # Check if URI already exists for this entity
        existing_record = self.db.query(URIRegistry).filter(
            URIRegistry.organization_id == organization_id,
            URIRegistry.entity_type == entity_type,
            URIRegistry.entity_id == entity_id,
            URIRegistry.status == URIStatus.ACTIVE.value
        ).first()

        if existing_record:
            return PublicURI(
                uri=existing_record.full_uri,
                entity_type=ENTITY_TYPES.get(entity_type, entity_type),
                public_id=existing_record.public_id,
                organization_slug=organization_slug
            )

        # Generate new public ID
        public_id = generate_public_id(entity_type, hint)

        # Ensure uniqueness
        public_id = self._ensure_unique_public_id(
            organization_id, entity_type, public_id
        )

        # Build full URI
        full_uri = build_uri(organization_slug, entity_type, public_id)

        # Create record
        record = URIRegistry(
            organization_id=organization_id,
            entity_type=entity_type,
            entity_id=entity_id,
            public_id=public_id,
            full_uri=full_uri,
            status=URIStatus.ACTIVE.value,
            created_by=created_by
        )

        self.db.add(record)
        self.db.flush()

        return PublicURI(
            uri=full_uri,
            entity_type=ENTITY_TYPES.get(entity_type, entity_type),
            public_id=public_id,
            organization_slug=organization_slug
        )

    def resolve_uri(self, uri: str) -> URIResolution:
        """
        Resolve a URI to its current status and entity.

        Handles:
        - Active URIs -> Returns entity info
        - Redirected URIs -> Returns redirect target
        - Tombstoned URIs -> Returns tombstone info
        - Unknown URIs -> Returns not found

        Args:
            uri: Full URI or path to resolve

        Returns:
            URIResolution with status and details
        """
        from app.models import URIRegistry

        parsed = parse_uri(uri)
        if not parsed:
            return URIResolution(found=False, status=URIStatus.ACTIVE)

        org_slug, entity_type, public_id = parsed

        # Look up in registry
        record = self.db.query(URIRegistry).filter(
            URIRegistry.public_id == public_id,
            URIRegistry.entity_type == entity_type
        ).first()

        if not record:
            return URIResolution(found=False, status=URIStatus.ACTIVE)

        if record.status == URIStatus.ACTIVE.value:
            return URIResolution(
                found=True,
                status=URIStatus.ACTIVE,
                entity_type=record.entity_type,
                entity_id=record.entity_id
            )

        if record.status == URIStatus.REDIRECT.value:
            return URIResolution(
                found=True,
                status=URIStatus.REDIRECT,
                entity_type=record.entity_type,
                redirect_uri=record.redirect_to,
                redirect_type=record.redirect_type
            )

        if record.status == URIStatus.TOMBSTONE.value:
            return URIResolution(
                found=True,
                status=URIStatus.TOMBSTONE,
                entity_type=record.entity_type,
                tombstone_reason=record.tombstone_reason,
                tombstone_date=record.updated_at
            )

        return URIResolution(found=False, status=URIStatus.ACTIVE)

    def create_tombstone(
        self,
        uri: str,
        reason: str,
        updated_by: Optional[UUID] = None
    ) -> bool:
        """
        Mark a URI as tombstoned (deleted).

        The URI will return 410 Gone when resolved.
        The entity data may be retained for audit purposes.

        Args:
            uri: URI to tombstone
            reason: Reason for deletion (for audit)
            updated_by: User creating the tombstone

        Returns:
            True if tombstone created, False if URI not found
        """
        from app.models import URIRegistry

        parsed = parse_uri(uri)
        if not parsed:
            return False

        _, entity_type, public_id = parsed

        rows_updated = self.db.query(URIRegistry).filter(
            URIRegistry.public_id == public_id,
            URIRegistry.entity_type == entity_type,
            URIRegistry.status == URIStatus.ACTIVE.value
        ).update({
            URIRegistry.status: URIStatus.TOMBSTONE.value,
            URIRegistry.tombstone_reason: reason,
            URIRegistry.updated_at: datetime.now(timezone.utc),
            URIRegistry.updated_by: updated_by
        })

        return rows_updated > 0

    def create_redirect(
        self,
        source_uri: str,
        target_uri: str,
        redirect_type: RedirectType = RedirectType.SEE_OTHER,
        updated_by: Optional[UUID] = None
    ) -> bool:
        """
        Create a redirect from one URI to another.

        Used when entities are merged. The source URI will redirect
        to the target URI with the specified HTTP status code.

        Args:
            source_uri: URI being redirected FROM
            target_uri: URI being redirected TO
            redirect_type: HTTP redirect type (301 or 303)
            updated_by: User creating the redirect

        Returns:
            True if redirect created, False if source URI not found
        """
        from app.models import URIRegistry

        parsed = parse_uri(source_uri)
        if not parsed:
            return False

        _, entity_type, public_id = parsed

        rows_updated = self.db.query(URIRegistry).filter(
            URIRegistry.public_id == public_id,
            URIRegistry.entity_type == entity_type,
            URIRegistry.status == URIStatus.ACTIVE.value
        ).update({
            URIRegistry.status: URIStatus.REDIRECT.value,
            URIRegistry.redirect_to: target_uri,
            URIRegistry.redirect_type: redirect_type.value,
            URIRegistry.updated_at: datetime.now(timezone.utc),
            URIRegistry.updated_by: updated_by
        })

        return rows_updated > 0

    def get_uri_for_entity(
        self,
        organization_id: UUID,
        entity_type: str,
        entity_id: UUID
    ) -> Optional[str]:
        """
        Get the active URI for an entity.

        Args:
            organization_id: Organization UUID
            entity_type: Type of entity
            entity_id: Entity UUID

        Returns:
            Full URI string or None if not assigned
        """
        from app.models import URIRegistry

        record = self.db.query(URIRegistry.full_uri).filter(
            URIRegistry.organization_id == organization_id,
            URIRegistry.entity_type == entity_type,
            URIRegistry.entity_id == entity_id,
            URIRegistry.status == URIStatus.ACTIVE.value
        ).first()

        return record[0] if record else None

    def get_all_uris_for_entity(
        self,
        organization_id: UUID,
        entity_type: str,
        entity_id: UUID
    ) -> list[URIRecord]:
        """
        Get all URIs (active and redirected) for an entity.

        Useful for seeing merge history.

        Args:
            organization_id: Organization UUID
            entity_type: Type of entity
            entity_id: Entity UUID

        Returns:
            List of all URI records for this entity
        """
        from app.models import URIRegistry

        records = self.db.query(URIRegistry).filter(
            URIRegistry.organization_id == organization_id,
            URIRegistry.entity_type == entity_type,
            URIRegistry.entity_id == entity_id
        ).order_by(URIRegistry.created_at).all()

        return [
            URIRecord(
                uri_id=r.uri_id,
                organization_id=r.organization_id,
                entity_type=r.entity_type,
                entity_id=r.entity_id,
                public_id=r.public_id,
                full_uri=r.full_uri,
                status=URIStatus(r.status),
                redirect_to=r.redirect_to,
                redirect_type=RedirectType(r.redirect_type) if r.redirect_type else None,
                tombstone_reason=r.tombstone_reason,
                created_at=r.created_at,
                updated_at=r.updated_at,
                created_by=r.created_by
            )
            for r in records
        ]

    def _ensure_unique_public_id(
        self,
        organization_id: UUID,
        entity_type: str,
        public_id: str
    ) -> str:
        """
        Ensure the public ID is unique within the organization and entity type.

        If collision, appends a numeric suffix.
        """
        from sqlalchemy import func
        from app.models import URIRegistry

        base_id = public_id
        suffix = 0

        while True:
            count = self.db.query(func.count(URIRegistry.uri_id)).filter(
                URIRegistry.organization_id == organization_id,
                URIRegistry.entity_type == entity_type,
                URIRegistry.public_id == public_id
            ).scalar()

            if count == 0:
                return public_id

            suffix += 1
            public_id = f"{base_id}-{suffix}"

            # Safety limit
            if suffix > 1000:
                # Fall back to random
                return f"{base_id}-{generate_memorable_id()}"


# ============================================================================
# MERGE HANDLING
# ============================================================================

class EntityMergeService:
    """
    Service for merging entities while preserving URI stability.

    When entities are merged:
    1. The "losing" entity's URI becomes a redirect
    2. The "winning" entity keeps its URI
    3. All references are updated to point to the winning entity
    4. Audit trail is preserved

    Note: This service uses synchronous database operations for Flask compatibility.
    """

    def __init__(self, db_session, uri_service: URIPersistenceService):
        self.db = db_session
        self.uri_service = uri_service

    def merge_entities(
        self,
        source_entity_id: UUID,
        target_entity_id: UUID,
        entity_type: str,
        organization_id: UUID,
        merged_by: UUID,
        reason: str
    ) -> dict:
        """
        Merge source entity into target entity.

        The source entity's URI will redirect to the target entity.

        Args:
            source_entity_id: Entity being merged (will be redirected)
            target_entity_id: Entity being merged into (survives)
            entity_type: Type of entities being merged
            organization_id: Organization UUID
            merged_by: User performing the merge
            reason: Reason for the merge (audit)

        Returns:
            Dict with merge results
        """
        # Get URIs for both entities
        source_uri = self.uri_service.get_uri_for_entity(
            organization_id, entity_type, source_entity_id
        )
        target_uri = self.uri_service.get_uri_for_entity(
            organization_id, entity_type, target_entity_id
        )

        if not source_uri or not target_uri:
            raise ValueError("Both entities must have assigned URIs")

        # Create redirect from source to target
        success = self.uri_service.create_redirect(
            source_uri=source_uri,
            target_uri=target_uri,
            redirect_type=RedirectType.SEE_OTHER,
            updated_by=merged_by
        )

        if not success:
            raise ValueError("Failed to create redirect")

        # Log the merge
        from app.models import EntityMergeLog
        merge_log = EntityMergeLog(
            organization_id=organization_id,
            entity_type=entity_type,
            source_entity_id=source_entity_id,
            target_entity_id=target_entity_id,
            source_uri=source_uri,
            target_uri=target_uri,
            reason=reason,
            merged_by=merged_by
        )
        self.db.add(merge_log)

        return {
            "source_uri": source_uri,
            "target_uri": target_uri,
            "redirect_created": True,
            "status": "merged"
        }


# ============================================================================
# HTTP RESPONSE HELPERS
# ============================================================================

def get_http_response_for_resolution(resolution: URIResolution) -> dict:
    """
    Get appropriate HTTP response data for a URI resolution.

    Returns dict with:
    - status_code: HTTP status code
    - headers: Response headers (Location for redirects)
    - body: Response body (for tombstones)
    """
    if not resolution.found:
        return {
            "status_code": 404,
            "headers": {},
            "body": {"error": "Not Found", "message": "URI does not exist"}
        }

    if resolution.status == URIStatus.ACTIVE:
        return {
            "status_code": 200,
            "headers": {},
            "body": None  # Caller provides entity data
        }

    if resolution.status == URIStatus.REDIRECT:
        status = 301 if resolution.redirect_type == RedirectType.PERMANENT else 303
        return {
            "status_code": status,
            "headers": {"Location": resolution.redirect_uri},
            "body": {
                "message": "Resource has moved",
                "location": resolution.redirect_uri
            }
        }

    if resolution.status == URIStatus.TOMBSTONE:
        return {
            "status_code": 410,
            "headers": {},
            "body": {
                "error": "Gone",
                "message": "This resource has been deleted",
                "reason": resolution.tombstone_reason,
                "deleted_at": resolution.tombstone_date.isoformat() if resolution.tombstone_date else None
            }
        }

    return {
        "status_code": 500,
        "headers": {},
        "body": {"error": "Unknown URI status"}
    }
