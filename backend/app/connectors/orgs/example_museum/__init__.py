"""
Example Museum organization-specific connectors.

This package contains custom connector implementations for the Example Museum organization.
"""

# Export connector classes for easier imports
from .smithsonian import SmithsonianConnector

__all__ = [
    "SmithsonianConnector",
]
