"""
Base connector class.

All connectors (both system-wide and org-specific) inherit from BaseConnector.
"""

from abc import ABC, abstractmethod
from typing import Any, Iterator, Optional
from datetime import datetime


class BaseConnector(ABC):
    """
    Base class for all connectors.
    
    Provides common interface and utilities for data extraction,
    transformation, and loading.
    """
    
    def __init__(self, config: dict[str, Any], organization_id: str):
        """
        Initialize connector.
        
        Args:
            config: Connector configuration from connector_instances.config
            organization_id: Organization identifier
        """
        self.config = config
        self.organization_id = organization_id
        self._validate_config()
    
    @abstractmethod
    def _validate_config(self) -> None:
        """
        Validate connector configuration.
        
        Raises:
            ValueError: If configuration is invalid
        """
        pass
    
    @abstractmethod
    def fetch_records(
        self,
        incremental_state: Optional[dict[str, Any]] = None
    ) -> Iterator[dict[str, Any]]:
        """
        Fetch records from the source.
        
        Args:
            incremental_state: State from previous run for incremental sync.
                             None indicates a full sync.
        
        Yields:
            Records as dictionaries
        """
        pass
    
    def get_incremental_state(self) -> Optional[dict[str, Any]]:
        """
        Get current incremental state for next run.
        
        Returns:
            State dictionary to persist, or None for full sync only
        """
        return None
    
    @abstractmethod
    def get_connector_type(self) -> str:
        """
        Get connector type identifier.
        
        Returns:
            Connector type string (e.g., 'smithsonian')
        """
        pass
    
    def get_display_name(self) -> str:
        """
        Get human-readable connector name.
        
        Returns:
            Display name for UI
        """
        return self.get_connector_type()
