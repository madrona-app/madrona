"""
Connector public API for Madrona v1.

Minimal explicit exports to avoid circular imports.
"""

from .base import BaseConnector, BaseSourceConnector, BaseTargetConnector, BidirectionalConnector
from .loader import (
    create_connector,
    load_connector,
    load_connector_class,
    ConnectorLoadError,
    ConnectorConfigError,
    ConnectorExecutionError,
)

__all__ = [
    "BaseConnector",
    "BaseSourceConnector",
    "BaseTargetConnector",
    "BidirectionalConnector",
    "create_connector",
    "load_connector",
    "load_connector_class",
    "ConnectorLoadError",
    "ConnectorConfigError",
    "ConnectorExecutionError",
]
