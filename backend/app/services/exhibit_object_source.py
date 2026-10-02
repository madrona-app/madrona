"""
Exhibition Object Source Service

Provides a unified interface for working with exhibition objects regardless
of whether they come from Collections (native) or Bridge (external CMS).

Usage:
    from app.services.exhibit_object_source import ExhibitObjectSourceService

    service = ExhibitObjectSourceService(db_session, organization_id)

    # Get unified object data for an exhibition object
    obj_data = service.get_object_data(exhibition_object)

    # Search for objects to add to an exhibition
    results = service.search_available_objects(query="Monet", limit=20)

    # Create an exhibition object from either source
    exhibition_object = service.create_exhibition_object(
        exhibition_id=...,
        source_type="collections",  # or "bridge"
        source_id=object_id,  # or entity_key
    )
"""
import logging
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    EntityCurrent,
    CollectionObject,
    CollectionObjectMedia,
    MediaDerivative,
    ExhibitionObject,
)

logger = logging.getLogger(__name__)


SourceType = Literal["collections", "bridge"]


@dataclass
class UnifiedObjectData:
    """Unified object data from either Collections or Bridge source."""

    source_type: SourceType
    source_id: str  # object_id (UUID as str) or entity_key

    # Core fields (available from both sources)
    object_number: str | None
    title: str | None
    description: str | None
    thumbnail_url: str | None

    # Collections-specific (None for Bridge objects)
    collection_object: CollectionObject | None = None

    # Bridge-specific (None for Collections objects)
    entity_current: EntityCurrent | None = None
    source_system: str | None = None
    payload: dict | None = None


class ExhibitObjectSourceService:
    """
    Service for working with exhibition objects from either Collections or Bridge.

    Abstracts the polymorphic object source so API endpoints and UI components
    can work with objects uniformly regardless of their origin.
    """

    def __init__(self, session: Session, organization_id: UUID):
        self.session = session
        self.organization_id = organization_id

    def get_source_mode(self) -> SourceType:
        """
        Get the configured object source mode for this organization.

        Returns 'collections' or 'bridge' based on the Collections app's
        organization_applications config.
        Default is 'collections' for backward compatibility.
        """
        from app.models import OrganizationApplication, Application

        result = self.session.execute(
            select(OrganizationApplication.config)
            .join(Application)
            .where(
                OrganizationApplication.organization_id == self.organization_id,
                # Exhibitions live in Collections now; the Exhibit app was
                # retired and its object_source config migrated across.
                Application.key == "collections",
                OrganizationApplication.enabled == True,
            )
        ).scalar_one_or_none()

        if result and isinstance(result, dict):
            return result.get("object_source", "collections")
        return "collections"

    def get_object_data(self, exhibition_object: ExhibitionObject) -> UnifiedObjectData:
        """
        Get unified object data for an exhibition object.

        Loads data from either Collections or Bridge based on which source is set.
        """
        if exhibition_object.object_id:
            return self._get_collections_object_data(exhibition_object.object_id)
        elif exhibition_object.entity_key:
            return self._get_bridge_object_data(exhibition_object.entity_key)
        else:
            raise ValueError("ExhibitionObject has neither object_id nor entity_key set")

    def _get_thumbnail_url(self, object_id: UUID) -> str | None:
        """Get thumbnail URL for a collection object's primary media."""
        try:
            # Find primary media link
            primary_link = self.session.execute(
                select(CollectionObjectMedia)
                .options(joinedload(CollectionObjectMedia.media))
                .where(
                    CollectionObjectMedia.object_id == object_id,
                    CollectionObjectMedia.is_primary == True,
                )
            ).scalar_one_or_none()

            # Fallback: first media by sort order
            if not primary_link:
                primary_link = self.session.execute(
                    select(CollectionObjectMedia)
                    .options(joinedload(CollectionObjectMedia.media))
                    .where(CollectionObjectMedia.object_id == object_id)
                    .order_by(CollectionObjectMedia.sort_order)
                    .limit(1)
                ).scalar_one_or_none()

            if not primary_link or not primary_link.media:
                return None

            # Prefer thumbnail derivative for performance
            thumb = self.session.execute(
                select(MediaDerivative).where(
                    MediaDerivative.media_id == primary_link.media.media_id,
                    MediaDerivative.derivative_type == "thumbnail",
                )
            ).scalar_one_or_none()

            s3_key = thumb.s3_key if thumb else primary_link.media.s3_key
            if not s3_key:
                return None

            from app.services.uploads import get_org_media_url
            return get_org_media_url(
                s3_key,
                organization_id=str(self.organization_id),
                db_session=self.session,
                expiry_seconds=3600,
            )
        except Exception as e:
            logger.warning(f"Failed to get thumbnail for object {object_id}: {e}")
            return None

    def _get_collections_object_data(self, object_id: UUID) -> UnifiedObjectData:
        """Load object data from Collections."""
        obj = self.session.execute(
            select(CollectionObject).where(
                CollectionObject.object_id == object_id,
                CollectionObject.organization_id == self.organization_id,
            )
        ).scalar_one_or_none()

        if not obj:
            return UnifiedObjectData(
                source_type="collections",
                source_id=str(object_id),
                object_number=None,
                title="[Object not found]",
                description=None,
                thumbnail_url=None,
            )

        return UnifiedObjectData(
            source_type="collections",
            source_id=str(object_id),
            object_number=obj.object_number,
            title=obj.title_links[0].title if obj.title_links else obj.object_name,
            description=obj.brief_description,
            thumbnail_url=self._get_thumbnail_url(object_id),
            collection_object=obj,
        )

    def _get_bridge_object_data(self, entity_key: str) -> UnifiedObjectData:
        """Load object data from Bridge (flow.entity_current)."""
        entity = self.session.execute(
            select(EntityCurrent).where(
                EntityCurrent.organization_id == self.organization_id,
                EntityCurrent.entity_key == entity_key,
            )
        ).scalar_one_or_none()

        if not entity:
            return UnifiedObjectData(
                source_type="bridge",
                source_id=entity_key,
                object_number=None,
                title="[Entity not found]",
                description=None,
                thumbnail_url=None,
            )

        payload = entity.payload or {}
        return UnifiedObjectData(
            source_type="bridge",
            source_id=entity_key,
            object_number=payload.get("object_number") or payload.get("accession_number"),
            title=payload.get("title") or payload.get("name"),
            description=payload.get("description") or payload.get("brief_description"),
            thumbnail_url=payload.get("thumbnail_url") or payload.get("primary_image_url"),
            entity_current=entity,
            source_system=entity.source_system,
            payload=payload,
        )

    def search_available_objects(
        self,
        query: str | None = None,
        limit: int = 50,
        offset: int = 0,
        source_type: SourceType | None = None,
    ) -> list[UnifiedObjectData]:
        """
        Search for objects available to add to an exhibition.

        Uses the organization's configured source mode unless explicitly overridden.
        """
        mode = source_type or self.get_source_mode()

        if mode == "collections":
            return self._search_collections_objects(query, limit, offset)
        else:
            return self._search_bridge_objects(query, limit, offset)

    def _search_collections_objects(
        self, query: str | None, limit: int, offset: int
    ) -> list[UnifiedObjectData]:
        """Search objects in Collections."""
        from app.models import ObjectTitle

        stmt = (
            select(CollectionObject)
            .outerjoin(ObjectTitle, and_(
                ObjectTitle.object_id == CollectionObject.object_id,
                ObjectTitle.is_preferred == True,
            ))
            .where(CollectionObject.organization_id == self.organization_id)
        )

        if query:
            search_pattern = f"%{query}%"
            stmt = stmt.where(
                CollectionObject.object_name.ilike(search_pattern)
                | ObjectTitle.title.ilike(search_pattern)
                | CollectionObject.object_number.ilike(search_pattern)
                | CollectionObject.brief_description.ilike(search_pattern)
            )

        stmt = stmt.order_by(CollectionObject.object_number).limit(limit).offset(offset)
        objects = self.session.execute(stmt).scalars().unique().all()

        return [
            UnifiedObjectData(
                source_type="collections",
                source_id=str(obj.object_id),
                object_number=obj.object_number,
                title=obj.title_links[0].title if obj.title_links else obj.object_name,
                description=obj.brief_description,
                thumbnail_url=self._get_thumbnail_url(obj.object_id),
                collection_object=obj,
            )
            for obj in objects
        ]

    def _search_bridge_objects(
        self, query: str | None, limit: int, offset: int
    ) -> list[UnifiedObjectData]:
        """Search objects in Bridge (entity_current)."""
        from app.models import EntityField

        # Use entity_fields for fast search if available
        stmt = select(EntityCurrent).where(
            EntityCurrent.organization_id == self.organization_id,
            EntityCurrent.is_deleted == False,
        )

        # For Bridge objects, we search in the JSONB payload
        if query:
            search_pattern = f"%{query}%"
            stmt = stmt.where(
                EntityCurrent.payload["title"].astext.ilike(search_pattern)
                | EntityCurrent.payload["object_number"].astext.ilike(search_pattern)
                | EntityCurrent.payload["name"].astext.ilike(search_pattern)
            )

        stmt = stmt.order_by(EntityCurrent.entity_key).limit(limit).offset(offset)
        entities = self.session.execute(stmt).scalars().all()

        return [
            UnifiedObjectData(
                source_type="bridge",
                source_id=entity.entity_key,
                object_number=entity.payload.get("object_number"),
                title=entity.payload.get("title") or entity.payload.get("name"),
                description=entity.payload.get("description"),
                thumbnail_url=entity.payload.get("thumbnail_url"),
                entity_current=entity,
                source_system=entity.source_system,
                payload=entity.payload,
            )
            for entity in entities
        ]

    def create_exhibition_object(
        self,
        exhibition_id: UUID,
        source_type: SourceType,
        source_id: str,
        display_order: int = 0,
        section: str | None = None,
        **kwargs,
    ) -> ExhibitionObject:
        """
        Create an ExhibitionObject linked to either Collections or Bridge source.

        Args:
            exhibition_id: The exhibition to add the object to
            source_type: 'collections' or 'bridge'
            source_id: object_id (as string) for Collections, entity_key for Bridge
            display_order: Sort order within the exhibition
            section: Optional section/gallery grouping
            **kwargs: Additional ExhibitionObject fields

        Returns:
            The created ExhibitionObject (not yet committed)
        """
        if source_type == "collections":
            obj = ExhibitionObject(
                exhibition_id=exhibition_id,
                organization_id=self.organization_id,
                object_id=UUID(source_id),
                entity_key=None,
                display_order=display_order,
                section=section,
                **kwargs,
            )
        else:
            obj = ExhibitionObject(
                exhibition_id=exhibition_id,
                organization_id=self.organization_id,
                object_id=None,
                entity_key=source_id,
                display_order=display_order,
                section=section,
                **kwargs,
            )

        self.session.add(obj)
        return obj
