"""
CLI commands for preservation operations.

Can be run standalone:
    python -m app.commands.preservation
"""

import json
import logging
from pathlib import Path

import click

from app.database import get_session

logger = logging.getLogger(__name__)

SEED_FILE = Path(__file__).resolve().parent.parent / "data" / "pronom_registry_seed.json"


@click.command("seed-format-registry")
def seed_format_registry():
    """Load/update the PRONOM format registry from seed data (idempotent)."""
    from app.models.preservation import FormatRegistryEntry

    if not SEED_FILE.exists():
        click.echo(f"Seed file not found: {SEED_FILE}")
        raise SystemExit(1)

    with open(SEED_FILE) as f:
        entries = json.load(f)

    inserted = 0
    updated = 0

    with get_session() as session:
        for entry_data in entries:
            existing = (
                session.query(FormatRegistryEntry)
                .filter_by(pronom_puid=entry_data["pronom_puid"])
                .first()
            )

            if existing:
                existing.name = entry_data["name"]
                existing.version = entry_data.get("version")
                existing.mime_types = entry_data.get("mime_types")
                existing.extensions = entry_data.get("extensions")
                existing.risk_level = entry_data.get("risk_level", "low")
                existing.risk_note = entry_data.get("risk_note")
                existing.is_open_format = entry_data.get("is_open_format", False)
                existing.recommended_migration_puid = entry_data.get(
                    "recommended_migration_puid"
                )
                updated += 1
            else:
                new_entry = FormatRegistryEntry(
                    pronom_puid=entry_data["pronom_puid"],
                    name=entry_data["name"],
                    version=entry_data.get("version"),
                    mime_types=entry_data.get("mime_types"),
                    extensions=entry_data.get("extensions"),
                    risk_level=entry_data.get("risk_level", "low"),
                    risk_note=entry_data.get("risk_note"),
                    is_open_format=entry_data.get("is_open_format", False),
                    recommended_migration_puid=entry_data.get(
                        "recommended_migration_puid"
                    ),
                )
                session.add(new_entry)
                inserted += 1

    click.echo(f"Format registry seeded: {inserted} inserted, {updated} updated")


if __name__ == "__main__":
    seed_format_registry()
