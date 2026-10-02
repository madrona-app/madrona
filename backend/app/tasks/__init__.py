"""Background tasks module."""

from app.tasks.classification import classify_entity_task, classify_dataset_task
from app.tasks.search import index_entity_task, delete_entity_task, bulk_index_entities_task
from app.tasks.geo import (
    batch_geocode_contacts_task,
    geocode_single_contact_task,
    geocode_place_authority_task,
    batch_geocode_places_without_coordinates_task,
)
from app.tasks.vocabulary import (
    sync_term_hierarchy_task,
    sync_term_hierarchy_by_id_task,
    refresh_stale_terms_task,
    expand_term_for_search_task,
    import_getty_term_task,
)
from app.tasks.ulan import (
    sync_ulan_authority_task,
    refresh_stale_ulan_authorities_task,
)

__all__ = [
    "classify_entity_task",
    "classify_dataset_task",
    "index_entity_task",
    "delete_entity_task",
    "bulk_index_entities_task",
    # GIS tasks
    "batch_geocode_contacts_task",
    "geocode_single_contact_task",
    "geocode_place_authority_task",
    "batch_geocode_places_without_coordinates_task",
    # Vocabulary tasks
    "sync_term_hierarchy_task",
    "sync_term_hierarchy_by_id_task",
    "refresh_stale_terms_task",
    "expand_term_for_search_task",
    "import_getty_term_task",
    # ULAN tasks
    "sync_ulan_authority_task",
    "refresh_stale_ulan_authorities_task",
]
