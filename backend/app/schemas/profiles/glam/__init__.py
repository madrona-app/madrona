"""
GLAM (Galleries, Libraries, Archives, Museums) Profiles

Standard profiles for cultural heritage data:
- agent: People, organizations, groups
- place: Geographic locations, sites, venues
- media: Digital media assets (images, videos, audio, documents)
- event: Exhibitions, historical events, activities
- work: Archival/library materials, documents, publications
- collections: Museum/gallery collection items
"""

# Import order matters: profiles are registered on import,
# and some profiles reference others in their relationships.
# Agent and Place are foundational, then Media, then the rest.
from .agent import AGENT_PROFILE
from .place import PLACE_PROFILE
from .media import MEDIA_PROFILE
from .event import EVENT_PROFILE
from .work import WORK_PROFILE
from .collections import COLLECTIONS_PROFILE

__all__ = [
    "AGENT_PROFILE",
    "PLACE_PROFILE",
    "MEDIA_PROFILE",
    "EVENT_PROFILE",
    "WORK_PROFILE",
    "COLLECTIONS_PROFILE",
]
