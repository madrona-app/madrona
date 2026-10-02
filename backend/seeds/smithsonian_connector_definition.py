"""
Seed data for Smithsonian Open Access connector definition.

Run with:
    python -m seeds.smithsonian_connector_definition
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


def seed_smithsonian_connector():
    """Insert or update Smithsonian connector definition in database."""
    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())
    
    with Session(engine) as session:
        # Define the new config schema (with nullable rows_per_page)
        new_config_schema = {
            "type": "object",
            "properties": {
                "api_key": {
                    "type": "string",
                    "description": "Smithsonian API key from https://api.data.gov/signup/",
                    "minLength": 1,
                },
                "base_url": {
                    "type": "string",
                    "description": "Base API URL (default: https://api.si.edu/openaccess/api/v1.0)",
                    "default": "https://api.si.edu/openaccess/api/v1.0",
                },
                "rows_per_page": {
                    "type": ["integer", "null"],
                    "description": "Number of rows per API request (default: 100, max: 1000)",
                    "minimum": 1,
                    "maximum": 1000,
                    "default": 100,
                },
                "max_records": {
                    "type": ["integer", "null"],
                    "description": "Maximum number of records to fetch (optional, for limiting sync scope)",
                    "minimum": 1,
                },
                "query": {
                    "type": "string",
                    "description": "Search query to filter results (default: *:* for all records). Example: online_media_type:Images",
                    "default": "*:*",
                },
            },
            "required": ["api_key"],
            "additionalProperties": False,
        }
        
        # Check if already exists
        existing = session.query(ConnectorDefinition).filter_by(key="smithsonian-openaccess").first()
        
        if existing:
            # Move any legacy implementation onto the shared base connector.
            # This matched two literal keys before: the pre-core module, and
            # one org's overlay. The overlay form is matched by prefix now, so
            # any org-specific Smithsonian overlay is upgraded rather than only
            # the one that happened to be named here — and no single
            # deployment's org key has to live in this file.
            old_impl_1 = "app.connectors.smithsonian:SmithsonianSourceConnector"
            legacy_overlay_prefix = "app.connectors.orgs."
            new_impl = "app.connectors.core.smithsonian_base:SmithsonianBaseConnector"
            
            needs_update = False
            updates = []
            
            current_impl = existing.implementation_key or ""
            if current_impl == old_impl_1 or (
                current_impl.startswith(legacy_overlay_prefix)
                and current_impl.endswith(".smithsonian:SmithsonianSourceConnector")
            ):
                existing.implementation_key = new_impl
                existing.source_type = "smithsonian"
                existing.version = "2.0.0"  # v2 with base connector
                updates.append("implementation_key")
                needs_update = True
            
            # Always update config_schema to latest version
            if existing.config_schema != new_config_schema:
                existing.config_schema = new_config_schema
                updates.append("config_schema")
                needs_update = True

            # Update category if missing
            if existing.category != CATEGORY_API:
                existing.category = CATEGORY_API
                updates.append("category")
                needs_update = True

            if needs_update:
                print(f"Updating Smithsonian connector definition: {existing.connector_definition_id}")
                session.commit()
                for field in updates:
                    print(f"✓ Updated {field}")
            else:
                print(f"Smithsonian connector definition already up-to-date: {existing.connector_definition_id}")
            return
        
        # Create new connector definition
        connector_def = ConnectorDefinition(
            key="smithsonian-openaccess",
            display_name="Smithsonian Open Access",
            direction="source",
            implementation_key="app.connectors.core.smithsonian_base:SmithsonianBaseConnector",
            source_type="smithsonian",
            version="2.0.0",
            category=CATEGORY_API,
            capabilities={
                "incremental": True,
                "full_refresh": True,
                "search": True,
                "pagination": "cursor",
            },
            config_schema={
                "type": "object",
                "properties": {
                    "api_key": {
                        "type": "string",
                        "description": "Smithsonian API key from https://api.data.gov/signup/",
                        "minLength": 1,
                    },
                    "base_url": {
                        "type": "string",
                        "description": "Base API URL (default: https://api.si.edu/openaccess/api/v1.0)",
                        "default": "https://api.si.edu/openaccess/api/v1.0",
                    },
                    "rows_per_page": {
                        "type": ["integer", "null"],
                        "description": "Number of rows per API request (default: 100, max: 1000)",
                        "minimum": 1,
                        "maximum": 1000,
                        "default": 100,
                    },
                    "max_records": {
                        "type": ["integer", "null"],
                        "description": "Maximum number of records to fetch (optional, for limiting sync scope)",
                        "minimum": 1,
                    },
                    "query": {
                        "type": "string",
                        "description": "Search query to filter results (default: *:* for all records). Example: online_media_type:Images",
                        "default": "*:*",
                    },
                },
                "required": ["api_key"],
                "additionalProperties": False,
            },
            default_config={
                "base_url": "https://api.si.edu/openaccess/api/v1.0",
                "rows_per_page": 100,
                "query": "*:*",
            },
            is_enabled=True,
        )
        
        session.add(connector_def)
        session.commit()
        session.refresh(connector_def)
        
        print(f"✓ Created Smithsonian connector definition: {connector_def.connector_definition_id}")
        print(f"  Key: {connector_def.key}")
        print(f"  Implementation: {connector_def.implementation_key}")
        print(f"  Direction: {connector_def.direction}")


if __name__ == "__main__":
    seed_smithsonian_connector()
