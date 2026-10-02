"""
Transformer system for converting entity payloads between different standards.

This module provides the infrastructure for transforming museum object data
from source formats (like Smithsonian EDAN) into industry-standard schemas
(Dublin Core, LIDO, Schema.org, CIDOC-CRM).
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class Transformer(ABC):
    """
    Base class for all format transformers.
    
    Each transformer knows how to convert from a specific source format
    (e.g., Smithsonian EDAN) to a specific target format (e.g., Dublin Core).
    """
    
    @property
    @abstractmethod
    def source_format(self) -> str:
        """The source format this transformer handles (e.g., 'smithsonian')."""
        pass
    
    @property
    @abstractmethod
    def target_format(self) -> str:
        """The target format this transformer produces (e.g., 'dublin-core')."""
        pass
    
    @property
    @abstractmethod
    def content_type(self) -> str:
        """The MIME type of the output (e.g., 'application/json')."""
        pass
    
    @property
    def file_extension(self) -> str:
        """The file extension for exported files (e.g., 'json')."""
        return "json"
    
    @abstractmethod
    def transform(self, payload: Dict[str, Any]) -> Any:
        """
        Transform a source payload into the target format.
        
        Args:
            payload: The source format payload (e.g., Smithsonian EDAN object)
            
        Returns:
            The transformed payload in the target format
        """
        pass
    
    def can_transform(self, source_system: str) -> bool:
        """
        Check if this transformer can handle the given source system.
        
        Args:
            source_system: The source system identifier (e.g., 'smithsonian')
            
        Returns:
            True if this transformer can handle the source system
        """
        return source_system.lower() == self.source_format.lower()


class TransformerRegistry:
    """
    Registry for discovering and instantiating transformers.
    
    This allows the API to dynamically find the right transformer based on
    the source system and requested output format.
    """
    
    def __init__(self):
        self._transformers: Dict[tuple, Transformer] = {}
    
    def register(self, transformer: Transformer) -> None:
        """
        Register a transformer.
        
        Args:
            transformer: The transformer instance to register
        """
        key = (transformer.source_format.lower(), transformer.target_format.lower())
        self._transformers[key] = transformer
    
    def get_transformer(
        self, 
        source_format: str, 
        target_format: str
    ) -> Optional[Transformer]:
        """
        Get a transformer for the given source and target formats.
        
        Args:
            source_format: The source format (e.g., 'smithsonian')
            target_format: The target format (e.g., 'dublin-core')
            
        Returns:
            The transformer instance, or None if not found
        """
        key = (source_format.lower(), target_format.lower())
        return self._transformers.get(key)
    
    def list_formats(self, source_format: str) -> list[str]:
        """
        List all available target formats for a given source format.
        
        Args:
            source_format: The source format (e.g., 'smithsonian')
            
        Returns:
            List of available target format names
        """
        return [
            target for source, target in self._transformers.keys()
            if source == source_format.lower()
        ]


# Global registry instance
registry = TransformerRegistry()


def get_registry() -> TransformerRegistry:
    """Get the global transformer registry."""
    return registry
