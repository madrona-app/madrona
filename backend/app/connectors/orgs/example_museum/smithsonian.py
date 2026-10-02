"""
Example Museum-specific Smithsonian Open Access connector (org overlay).

This connector extends the shared base Smithsonian connector with custom
field mappings and transformations specific to the Example Museum's data model
and business requirements.

The base connector (app.connectors.core.smithsonian_base) handles:
- API pagination and retry logic
- Incremental sync via timestamps
- Standard field extraction

This overlay customizes:
- Field mapping for Example Museum's canonical schema
- Custom entity transformations
- Org-specific default configurations
"""

import logging
from typing import Any

from app.connectors.core.smithsonian_base import SmithsonianBaseConnector

logger = logging.getLogger(__name__)


class SmithsonianConnector(SmithsonianBaseConnector):
    """
    Example Museum-specific Smithsonian connector.
    
    Extends the base connector with custom field mappings and transformations
    for the Example Museum's data model.
    
    Customizations:
    - Enhanced metadata extraction for museum-specific fields
    - Custom entity_type classification hints
    - Specialized thumbnail selection logic
    - Default query filters for images with online media
    """
    
    def get_default_query(self) -> str:
        """
        Set org-specific default query.
        
        Example Museum focuses on records with online media (images).
        
        Returns:
            Default Solr query for Example Museum
        """
        return "online_media_type:Images"
    
    def transform_entity(self, record: dict[str, Any], base_entity: dict[str, Any]) -> dict[str, Any]:
        """
        Apply Example Museum-specific transformations.
        
        Adds custom fields and enriches metadata for the Example Museum's
        canonical data model.
        
        Args:
            record: Raw Smithsonian API record
            base_entity: Base canonical entity from SmithsonianBaseConnector
            
        Returns:
            Enhanced canonical entity with Example Museum customizations
        """
        # Add museum-specific metadata hints
        content = record.get("content", {})
        indexed_structured = content.get("indexedStructured", {})
        
        # Extract object type hints for better classification
        object_type = indexed_structured.get("object_type", [])
        if object_type:
            base_entity["payload"]["jb_object_type_hints"] = object_type
        
        # Extract date information for chronological sorting
        date = indexed_structured.get("date", [])
        if date:
            base_entity["payload"]["jb_creation_dates"] = date
        
        # Extract topic/subject for categorization
        topic = indexed_structured.get("topic", [])
        if topic:
            base_entity["payload"]["jb_topics"] = topic
        
        # Extract place information for geographic context
        place = indexed_structured.get("place", [])
        if place:
            base_entity["payload"]["jb_places"] = place
        
        # Add organization-specific logging for debugging
        logger.debug(
            "Example Museum transform: entity_key=%s object_types=%s",
            base_entity.get("entity_key"),
            object_type[:3] if object_type else [],  # Log first 3 types
        )
        
        return base_entity
    
    def extract_title(self, record: dict[str, Any]) -> str:
        """
        Override title extraction with Example Museum preferences.
        
        Prefers the most descriptive title format for museum cataloging.
        
        Args:
            record: Raw Smithsonian record
            
        Returns:
            Extracted title optimized for museum display
        """
        # Try descriptiveNonRepeating.title.label first (preferred for Example Museum)
        content = record.get("content", {})
        desc_non_rep = content.get("descriptiveNonRepeating", {})
        title_obj = desc_non_rep.get("title", {})
        
        if isinstance(title_obj, dict):
            # Prefer label over content for museum display
            title = title_obj.get("label") or title_obj.get("content")
            if title:
                return str(title)
        
        # Fall back to base implementation
        return super().extract_title(record)
    
    def extract_thumbnail(self, record: dict[str, Any]) -> str | None:
        """
        Override thumbnail extraction with Example Museum preferences.
        
        Selects the highest quality thumbnail available.
        
        Args:
            record: Raw Smithsonian record
            
        Returns:
            Thumbnail URL optimized for museum display
        """
        content = record.get("content", {})
        desc_non_rep = content.get("descriptiveNonRepeating", {})
        
        # Try idsId first (higher quality for Example Museum)
        ids_id = desc_non_rep.get("idsId")
        if ids_id:
            # Request larger thumbnail (300px vs base 150px)
            return f"https://ids.si.edu/ids/deliveryService?id={ids_id}&max=300"
        
        # Fall back to base implementation
        return super().extract_thumbnail(record)
