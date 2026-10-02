"""
Sandbox seeders — populate a demo organization with realistic data.

Each seeder is idempotent (safe to call repeatedly on the same org) and
returns a small dict of counters that the saga step records on the job
for the admin UI to display.

Phase 1b ships:
    - seed_reference_data (departments, locations, contacts)
    - seed_met_collections (Metropolitan Museum of Art, ~75 objects)
    - seed_smithsonian_collections (Smithsonian Open Access, ~15 objects)
    - seed_rijks_collections (Rijksmuseum, ~10 objects)

Phase 2 ships incrementally (one sub-step at a time):
    - seed_acquisitions (Acquisition + AcquisitionObject)
    - seed_loans (LoanIn + LoanOut)
    - seed_exhibitions (Venue + Exhibition + ExhibitionObject)
    - seed_conservation (ConservationTreatment)
    - seed_condition_reports (ConditionReport)

Phase 3 will add:
    - seed_media (synthetic PDFs, DOCX, video/audio for non-image types)
    - seed_relationships (link procedures ↔ media, build workspaces)
"""
from __future__ import annotations

from app.services.sandbox_seeder.acquisitions import seed_acquisitions
from app.services.sandbox_seeder.condition_reports import seed_condition_reports
from app.services.sandbox_seeder.conservation import seed_conservation
from app.services.sandbox_seeder.exhibitions import seed_exhibitions
from app.services.sandbox_seeder.manifest import seed_collections_from_manifest
from app.services.sandbox_seeder.loans import seed_loans
from app.services.sandbox_seeder.reference import seed_reference_data
from app.services.sandbox_seeder.met import seed_met_collections
from app.services.sandbox_seeder.smithsonian import seed_smithsonian_collections
from app.services.sandbox_seeder.rijks import seed_rijks_collections

__all__ = [
    "seed_reference_data",
    "seed_met_collections",
    "seed_smithsonian_collections",
    "seed_rijks_collections",
    "seed_acquisitions",
    "seed_loans",
    "seed_exhibitions",
    "seed_conservation",
    "seed_condition_reports",
]
