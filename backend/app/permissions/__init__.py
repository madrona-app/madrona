"""
Canonical Permission Model for Madrona.

This package is the single source of truth for authorization permissions,
permission metadata, and internal role definitions.

All symbols are re-exported here so that existing imports like
``from app.permissions import Permission`` continue to work.
"""
from app.permissions.enums import *      # noqa: F401,F403
from app.permissions.metadata import *   # noqa: F401,F403
from app.permissions.roles import *      # noqa: F401,F403
