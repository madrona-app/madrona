"""
Seed data for Library of Congress Digital Collections connector definition.

Run with:
    python -m seeds.loc_connector_definition
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import ConnectorDefinition

# Category constant
CATEGORY_API = "api"


def seed_loc_connector():
    """Insert or update LOC connector definition in database."""
    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())

    with Session(engine) as session:
        # Define config schema
        config_schema = {
            "type": "object",
            "properties": {
                "collection": {
                    "type": ["string", "null"],
                    "description": "Collection slug to fetch from (e.g., 'civil-war-maps', 'baseball-cards'). Leave empty to search all collections.",
                },
                "base_url": {
                    "type": "string",
                    "description": "Base API URL (default: https://www.loc.gov)",
                    "default": "https://www.loc.gov",
                },
                "items_per_page": {
                    "type": ["integer", "null"],
                    "description": "Number of items per API request (default: 25, max: 100)",
                    "minimum": 1,
                    "maximum": 100,
                    "default": 25,
                },
                "max_records": {
                    "type": ["integer", "null"],
                    "description": "Maximum number of records to fetch (optional, for limiting sync scope)",
                    "minimum": 1,
                },
            },
            "required": [],
            "additionalProperties": False,
        }

        # Check if already exists
        existing = session.query(ConnectorDefinition).filter_by(key="loc-digital-collections").first()

        if existing:
            # Update if needed
            needs_update = False
            updates = []

            if existing.config_schema != config_schema:
                existing.config_schema = config_schema
                updates.append("config_schema")
                needs_update = True

            # Update category if missing
            if existing.category != CATEGORY_API:
                existing.category = CATEGORY_API
                updates.append("category")
                needs_update = True

            if needs_update:
                print(f"Updating LOC connector definition: {existing.connector_definition_id}")
                session.commit()
                for field in updates:
                    print(f"✓ Updated {field}")
            else:
                print(f"LOC connector definition already up-to-date: {existing.connector_definition_id}")
            return existing.connector_definition_id

        # Create new connector definition
        connector_def = ConnectorDefinition(
            key="loc-digital-collections",
            display_name="Library of Congress Digital Collections",
            direction="source",
            implementation_key="app.connectors.core.loc_digital_collections:LOCDigitalCollectionsConnector",
            source_type="loc",
            version="1.0.0",
            category=CATEGORY_API,
            capabilities={
                "incremental": False,  # LOC API doesn't support incremental easily
                "full_refresh": True,
                "search": True,
                "pagination": "offset",
            },
            config_schema=config_schema,
            default_config={
                "base_url": "https://www.loc.gov",
                "items_per_page": 25,
            },
            is_enabled=True,
        )

        session.add(connector_def)
        session.commit()
        session.refresh(connector_def)

        print(f"✓ Created LOC connector definition: {connector_def.connector_definition_id}")
        print(f"  Key: {connector_def.key}")
        print(f"  Implementation: {connector_def.implementation_key}")
        print(f"  Direction: {connector_def.direction}")

        return connector_def.connector_definition_id


if __name__ == "__main__":
    seed_loc_connector()
