"""
Media Field Inheritance Service.

Handles the inheritance of CollectionObject fields to linked Media items.
When Media is linked to CollectionObjects, configurable metadata fields
from the object can be displayed in the Media app without overwriting
the Media's own fields.

Usage:
    from app.services.media_inheritance import MediaInheritanceService

    # Get inheritance config for an organization
    config = MediaInheritanceService.get_inheritance_config(org_id, context='detail')

    # Compute inherited fields for a media item
    fields = MediaInheritanceService.compute_inherited_fields(media_id, org_id, context='detail')
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.database import current_session
from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    Media,
    MediaFieldInheritanceConfig,
)

logger = logging.getLogger(__name__)


class FieldTransformer:
    """Transforms field values based on configuration."""

    @staticmethod
    def transform(
        value: Any,
        transform_type: str | None,
        transform_config: dict[str, Any] | None
    ) -> Any:
        """
        Transform a field value based on the specified transform type.

        Args:
            value: The raw field value
            transform_type: Type of transform ('array_first', 'array_join', 'array_concat_field', or None)
            transform_config: Configuration for the transform (e.g., separator, field name)

        Returns:
            The transformed value
        """
        if value is None:
            return None

        if transform_type is None:
            return value

        config = transform_config or {}

        if transform_type == "array_first":
            # Get first element of array
            if isinstance(value, list) and len(value) > 0:
                item = value[0]
                # If it's a dict and we have a field specified, extract that field
                field = config.get("field")
                if isinstance(item, dict) and field:
                    return item.get(field)
                return item
            return value

        elif transform_type == "array_join":
            # Join array elements with separator
            if isinstance(value, list):
                separator = config.get("separator", ", ")
                # Handle list of dicts - extract field value from each
                field = config.get("field")
                if field and all(isinstance(item, dict) for item in value):
                    values = [item.get(field, "") for item in value if item.get(field)]
                    return separator.join(str(v) for v in values)
                # Handle list of strings/primitives
                return separator.join(str(v) for v in value if v)
            return str(value)

        elif transform_type == "array_concat_field":
            # Concatenate a specific field from array of objects
            if isinstance(value, list):
                field = config.get("field", "name")
                separator = config.get("separator", ", ")
                values = []
                for item in value:
                    if isinstance(item, dict):
                        field_value = item.get(field)
                        if field_value:
                            values.append(str(field_value))
                    else:
                        values.append(str(item))
                return separator.join(values)
            return value

        return value


class MediaInheritanceService:
    """Service for managing media field inheritance from CollectionObjects."""

    # Default field mappings that can be seeded for new organizations
    DEFAULT_MAPPINGS = [
        {
            "source_field": "object_number",
            "display_label": "Object Number",
            "display_context": "both",
            "transform_type": None,
            "transform_config": None,
            "sort_order": 0,
        },
        {
            "source_field": "titles",
            "display_label": "Title",
            "display_context": "both",
            "transform_type": "array_concat_field",
            "transform_config": {"field": "title", "separator": " | "},
            "sort_order": 1,
        },
        {
            "source_field": "creators",
            "display_label": "Creator",
            "display_context": "both",
            "transform_type": "array_concat_field",
            "transform_config": {"field": "name", "separator": "; "},
            "sort_order": 2,
        },
        {
            "source_field": "creation_date_display",
            "display_label": "Date",
            "display_context": "both",
            "transform_type": None,
            "transform_config": None,
            "sort_order": 3,
        },
        {
            "source_field": "copyright_status",
            "display_label": "Copyright Status",
            "display_context": "detail",
            "transform_type": None,
            "transform_config": None,
            "sort_order": 4,
        },
        {
            "source_field": "credit_line",
            "display_label": "Credit Line",
            "display_context": "detail",
            "transform_type": None,
            "transform_config": None,
            "sort_order": 5,
        },
    ]

    @classmethod
    def get_inheritance_config(
        cls,
        organization_id: UUID | str,
        context: str | None = None,
        session=None,
    ) -> list[dict[str, Any]]:
        """
        Get the field inheritance configuration for an organization.

        Args:
            organization_id: The organization ID
            context: Optional filter for display context ('detail', 'list', or None for all)

        Returns:
            List of config dictionaries with source_field, display_label, etc.
        """
        org_id = UUID(str(organization_id))

        query = (
            select(MediaFieldInheritanceConfig)
            .where(MediaFieldInheritanceConfig.organization_id == org_id)
            .where(MediaFieldInheritanceConfig.is_active == True)
            .order_by(MediaFieldInheritanceConfig.sort_order)
        )

        if context and context in ("detail", "list"):
            query = query.where(
                MediaFieldInheritanceConfig.display_context.in_([context, "both"])
            )

        _s = session if session is not None else current_session()
        configs = _s.execute(query).scalars().all()

        return [
            {
                "config_id": str(config.config_id),
                "source_field": config.source_field,
                "display_label": config.display_label,
                "display_context": config.display_context,
                "transform_type": config.transform_type,
                "transform_config": config.transform_config,
                "sort_order": config.sort_order,
                "is_active": config.is_active,
            }
            for config in configs
        ]

    @classmethod
    def compute_inherited_fields(
        cls,
        media_id: UUID | str,
        organization_id: UUID | str,
        context: str = "detail",
        session=None,
    ) -> list[dict[str, Any]]:
        """
        Compute the inherited fields for a media item from its linked CollectionObjects.

        Args:
            media_id: The media item ID
            organization_id: The organization ID
            context: Display context ('detail' or 'list')

        Returns:
            List of inherited field values with labels and source object info
        """
        media_uuid = UUID(str(media_id))
        org_uuid = UUID(str(organization_id))

        # Get inheritance config
        _s = session if session is not None else current_session()
        config = cls.get_inheritance_config(org_uuid, context, session=_s)
        if not config:
            return []

        # Get linked collection objects
        links = (
            _s.execute(
                select(CollectionObjectMedia)
                .options(joinedload(CollectionObjectMedia.object))
                .where(CollectionObjectMedia.media_id == media_uuid)
                .order_by(CollectionObjectMedia.sort_order)
            )
            .scalars()
            .all()
        )

        if not links:
            return []

        # Compute inherited fields from each linked object
        result = []
        for link in links:
            obj = link.object
            if not obj:
                continue

            object_fields = {
                "object_id": str(obj.object_id),
                "object_number": obj.object_number,
                "fields": [],
            }

            for field_config in config:
                source_field = field_config["source_field"]

                # Get raw value from object
                raw_value = getattr(obj, source_field, None)

                # Transform the value
                transformed_value = FieldTransformer.transform(
                    raw_value,
                    field_config["transform_type"],
                    field_config["transform_config"],
                )

                if transformed_value is not None:
                    object_fields["fields"].append({
                        "source_field": source_field,
                        "display_label": field_config["display_label"],
                        "value": transformed_value,
                    })

            if object_fields["fields"]:
                result.append(object_fields)

        return result

    @classmethod
    def create_config(
        cls,
        organization_id: UUID | str,
        source_field: str,
        display_label: str,
        display_context: str = "both",
        transform_type: str | None = None,
        transform_config: dict[str, Any] | None = None,
        sort_order: int = 0,
        is_active: bool = True,
        session=None,
    ) -> MediaFieldInheritanceConfig:
        """
        Create a new field inheritance configuration.

        Args:
            organization_id: The organization ID
            source_field: The CollectionObject field name
            display_label: The label to display in the UI
            display_context: Where to show ('detail', 'list', 'both')
            transform_type: Optional transform type
            transform_config: Optional transform configuration
            sort_order: Display order
            is_active: Whether the config is active

        Returns:
            The created MediaFieldInheritanceConfig
        """
        org_uuid = UUID(str(organization_id))

        config = MediaFieldInheritanceConfig(
            organization_id=org_uuid,
            source_field=source_field,
            display_label=display_label,
            display_context=display_context,
            transform_type=transform_type,
            transform_config=transform_config,
            sort_order=sort_order,
            is_active=is_active,
        )

        _s = session if session is not None else current_session()
        _s.add(config)
        _s.flush()

        logger.info(
            f"Created field inheritance config for org {org_uuid}: "
            f"{source_field} -> {display_label}"
        )

        return config

    @classmethod
    def update_config(
        cls,
        config_id: UUID | str,
        organization_id: UUID | str,
        session=None,
        **updates,
    ) -> MediaFieldInheritanceConfig | None:
        """
        Update a field inheritance configuration.

        Args:
            config_id: The config ID
            organization_id: The organization ID (for security)
            **updates: Fields to update

        Returns:
            The updated config or None if not found
        """
        config_uuid = UUID(str(config_id))
        org_uuid = UUID(str(organization_id))

        _s = session if session is not None else current_session()
        config = _s.execute(
            select(MediaFieldInheritanceConfig)
            .where(MediaFieldInheritanceConfig.config_id == config_uuid)
            .where(MediaFieldInheritanceConfig.organization_id == org_uuid)
        ).scalar_one_or_none()

        if not config:
            return None

        allowed_fields = {
            "display_label", "display_context", "transform_type",
            "transform_config", "sort_order", "is_active"
        }

        for field, value in updates.items():
            if field in allowed_fields:
                setattr(config, field, value)

        _s.flush()

        logger.info(f"Updated field inheritance config {config_uuid}")

        return config

    @classmethod
    def delete_config(
        cls,
        config_id: UUID | str,
        organization_id: UUID | str,
        session=None,
    ) -> bool:
        """
        Delete a field inheritance configuration.

        Args:
            config_id: The config ID
            organization_id: The organization ID (for security)

        Returns:
            True if deleted, False if not found
        """
        config_uuid = UUID(str(config_id))
        org_uuid = UUID(str(organization_id))

        _s = session if session is not None else current_session()
        config = _s.execute(
            select(MediaFieldInheritanceConfig)
            .where(MediaFieldInheritanceConfig.config_id == config_uuid)
            .where(MediaFieldInheritanceConfig.organization_id == org_uuid)
        ).scalar_one_or_none()

        if not config:
            return False

        _s.delete(config)
        _s.flush()

        logger.info(f"Deleted field inheritance config {config_uuid}")

        return True

    @classmethod
    def seed_default_config(cls, organization_id: UUID | str, session=None) -> list[MediaFieldInheritanceConfig]:
        """
        Seed the default field inheritance configuration for a new organization.

        Args:
            organization_id: The organization ID

        Returns:
            List of created configs
        """
        org_uuid = UUID(str(organization_id))

        _s = session if session is not None else current_session()
        # Check if org already has config
        existing = _s.execute(
            select(MediaFieldInheritanceConfig)
            .where(MediaFieldInheritanceConfig.organization_id == org_uuid)
            .limit(1)
        ).scalar_one_or_none()

        if existing:
            logger.info(f"Organization {org_uuid} already has field inheritance config")
            return []

        configs = []
        for mapping in cls.DEFAULT_MAPPINGS:
            config = cls.create_config(
                organization_id=org_uuid,
                session=_s,
                **mapping,
            )
            configs.append(config)

        logger.info(
            f"Seeded {len(configs)} default field inheritance configs for org {org_uuid}"
        )

        return configs
