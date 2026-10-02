"""
Playbook metadata — filename slug → display title + nav target.

The `reference_chunks.document` field for playbooks is the markdown
filename (e.g. `accession_new_object.md`) because the ingest script
uses `rel_path` as the document identifier. This module maps that
filename to:

  - **title**: the human-readable name (the H1 of the playbook) that
    the Guide narrates in its reply
  - **nav_item**: the nav catalog entry the user most likely wants to
    land on after reading the playbook

A single dict keeps both values next to each other so they never drift.
If you add a new playbook, add a new row here AND re-run the ingest.

Pytests in `test_agent_playbook_tool.py`:
  - every nav_item must resolve to an entry in this package's nav_catalog.json
  - the dict keys must match the actual filenames in backend/playbooks/
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PlaybookMeta:
    title: str
    nav_item: str


# Keyed on filename WITHOUT the .md extension, because the tool strips
# the extension before lookup. Values are (title, nav_item) pairs.
PLAYBOOKS: dict[str, PlaybookMeta] = {
    "receive_object_entry": PlaybookMeta(
        title="Receive an Object Entry",
        nav_item="collections:entries",
    ),
    "accession_new_object": PlaybookMeta(
        title="Accession a New Object",
        nav_item="collections:acquisitions",
    ),
    "process_loan_in": PlaybookMeta(
        title="Process an Incoming Loan",
        nav_item="collections:loans-in",
    ),
    "process_loan_out": PlaybookMeta(
        title="Send an Outgoing Loan",
        nav_item="collections:loans-out",
    ),
    "record_condition_check": PlaybookMeta(
        title="File a Condition Report",
        nav_item="collections:condition-reports",
    ),
    "start_conservation_treatment": PlaybookMeta(
        title="Start a Conservation Treatment",
        nav_item="collections:conservation",
    ),
    "record_movement": PlaybookMeta(
        title="Record an Object Movement",
        nav_item="collections:movements",
    ),
    "handle_incident": PlaybookMeta(
        title="Handle an Incident",
        nav_item="collections:incidents",
    ),
    "process_deaccession": PlaybookMeta(
        title="Process a Deaccession",
        nav_item="collections:deaccessions",
    ),
    "process_object_exit": PlaybookMeta(
        title="Process an Object Exit",
        nav_item="collections:exits",
    ),
    "record_valuation": PlaybookMeta(
        title="Record a Valuation",
        nav_item="collections:valuations",
    ),
    "manage_rights": PlaybookMeta(
        title="Manage Rights on an Object",
        nav_item="collections:rights",
    ),
    "set_up_exhibition": PlaybookMeta(
        title="Set Up an Exhibition",
        nav_item="collections:exhibitions-list",
    ),
    "upload_manage_media": PlaybookMeta(
        title="Upload and Manage Media",
        nav_item="media:library",
    ),
    "run_inventory_audit": PlaybookMeta(
        title="Run an Inventory Audit",
        nav_item="collections:barcode-scanner",
    ),
    # Auto-generated playbooks (from scripts/generate_playbooks.py)
    "process_use_request": PlaybookMeta(
        title="Use Request",
        nav_item="collections:use-requests",
    ),
    "process_reproduction_request": PlaybookMeta(
        title="Reproduction Request",
        nav_item="collections:reproduction-requests",
    ),
}


def _document_to_slug(document: str) -> str:
    """Strip a `.md` / `.txt` extension to get the playbook slug."""
    for ext in (".md", ".txt"):
        if document.endswith(ext):
            return document[: -len(ext)]
    return document


def get_playbook_meta(document: str) -> PlaybookMeta | None:
    """Look up metadata for a chunk's `document` field (filename)."""
    slug = _document_to_slug(document)
    return PLAYBOOKS.get(slug)
