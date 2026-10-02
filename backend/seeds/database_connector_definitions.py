"""
Seed script for database source connector definitions.

Creates connector_definition records for:
- PostgreSQL (db-postgres)
- MySQL (db-mysql)
- Microsoft SQL Server (db-sqlserver)
- Oracle Database (db-oracle)
- MongoDB (db-mongodb)

These define the configuration schemas, capabilities, and implementation
keys for database source connectors.

Usage:
    python -m backend.seeds.database_connector_definitions

Note: This registers the connector definitions. Actual database driver
integration is pending in the connector implementations.
"""

import sys
from pathlib import Path

# Add backend to path for imports
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import ConnectorDefinition
from app.schemas.database_source import (
    DATABASE_CONFIG_SCHEMAS,
    DATABASE_DISPLAY_NAMES,
    DEFAULT_PORTS,
    get_database_capabilities,
)

# Connector categories for UI grouping
CATEGORY_DATABASE = "database"
CATEGORY_API = "api"
CATEGORY_FILE = "file"
CATEGORY_CLOUD = "cloud"



def get_postgres_definition() -> dict:
    """Get PostgreSQL connector definition."""
    return {
        "key": "db-postgres",
        "display_name": "PostgreSQL",
        "direction": "both",
        "implementation_key": "app.connectors.core.database_base:PostgresConnector",
        "source_type": "postgres",
        "version": "1.0.0",
                "category": CATEGORY_DATABASE,
        "capabilities": get_database_capabilities("postgres"),
        "config_schema": DATABASE_CONFIG_SCHEMAS["postgres"],
        "default_config": {
            "type": "postgres",
            "port": 5432,
            "tls": {"mode": "prefer"},
            "driverOptions": {
                "connectTimeoutMs": 30000,
                "statementTimeoutMs": 60000,
                "maxPoolSize": 5,
            },
        },
    }


def get_mysql_definition() -> dict:
    """Get MySQL connector definition."""
    return {
        "key": "db-mysql",
        "display_name": "MySQL",
        "direction": "both",
        "implementation_key": "app.connectors.core.database_base:MySQLConnector",
        "source_type": "mysql",
        "version": "1.0.0",
                "category": CATEGORY_DATABASE,
        "capabilities": get_database_capabilities("mysql"),
        "config_schema": DATABASE_CONFIG_SCHEMAS["mysql"],
        "default_config": {
            "type": "mysql",
            "port": 3306,
            "tls": {"mode": "prefer"},
            "driverOptions": {
                "connectTimeoutMs": 30000,
                "statementTimeoutMs": 60000,
                "maxPoolSize": 5,
            },
        },
    }


def get_sqlserver_definition() -> dict:
    """Get SQL Server connector definition."""
    return {
        "key": "db-sqlserver",
        "display_name": "Microsoft SQL Server",
        "direction": "both",
        "implementation_key": "app.connectors.core.database_base:SQLServerConnector",
        "source_type": "sqlserver",
        "version": "1.0.0",
                "category": CATEGORY_DATABASE,
        "capabilities": get_database_capabilities("sqlserver"),
        "config_schema": DATABASE_CONFIG_SCHEMAS["sqlserver"],
        "default_config": {
            "type": "sqlserver",
            "port": 1433,
            "tls": {"mode": "require"},
            "driverOptions": {
                "connectTimeoutMs": 30000,
                "statementTimeoutMs": 60000,
                "maxPoolSize": 5,
            },
        },
    }


def get_oracle_definition() -> dict:
    """Get Oracle connector definition."""
    return {
        "key": "db-oracle",
        "display_name": "Oracle Database",
        "direction": "both",
        "implementation_key": "app.connectors.core.database_base:OracleConnector",
        "source_type": "oracle",
        "version": "1.0.0",
                "category": CATEGORY_DATABASE,
        "capabilities": get_database_capabilities("oracle"),
        "config_schema": DATABASE_CONFIG_SCHEMAS["oracle"],
        "default_config": {
            "type": "oracle",
            "port": 1521,
            "tls": {"mode": "disable"},
            "driverOptions": {
                "connectTimeoutMs": 30000,
                "statementTimeoutMs": 60000,
                "maxPoolSize": 5,
            },
        },
    }


def get_mongodb_definition() -> dict:
    """Get MongoDB connector definition."""
    return {
        "key": "db-mongodb",
        "display_name": "MongoDB",
        "direction": "both",
        "implementation_key": "app.connectors.core.database_base:MongoDBConnector",
        "source_type": "mongodb",
        "version": "1.0.0",
                "category": CATEGORY_DATABASE,
        "capabilities": get_database_capabilities("mongodb"),
        "config_schema": DATABASE_CONFIG_SCHEMAS["mongodb"],
        "default_config": {
            "type": "mongodb",
            "port": 27017,
            "authSource": "admin",
            "tls": {"mode": "prefer"},
            "driverOptions": {
                "connectTimeoutMs": 30000,
                "statementTimeoutMs": 60000,
                "maxPoolSize": 5,
            },
        },
    }


DATABASE_DEFINITIONS = [
    get_postgres_definition,
    get_mysql_definition,
    get_sqlserver_definition,
    get_oracle_definition,
    get_mongodb_definition,
]


def seed_database_connectors():
    """Create or update all database connector definitions."""
    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())

    created = 0
    updated = 0
    skipped = 0

    with Session(engine) as session:
        for get_definition in DATABASE_DEFINITIONS:
            definition = get_definition()
            key = definition["key"]

            # Check if already exists
            existing = session.query(ConnectorDefinition).filter_by(key=key).first()

            if existing:
                # Check if update needed
                needs_update = (
                    existing.config_schema != definition["config_schema"]
                    or existing.capabilities != definition["capabilities"]
                    or existing.implementation_key != definition["implementation_key"]
                    or existing.version != definition["version"]
                    or existing.direction != definition["direction"]
                    or existing.category != definition.get("category")
                )

                if needs_update:
                    existing.config_schema = definition["config_schema"]
                    existing.capabilities = definition["capabilities"]
                    existing.implementation_key = definition["implementation_key"]
                    existing.version = definition["version"]
                    existing.direction = definition["direction"]
                    existing.source_type = definition["source_type"]
                    existing.category = definition.get("category")
                    existing.default_config = definition.get("default_config")
                    session.commit()
                    print(f"Updated: {key} ({definition['display_name']})")
                    updated += 1
                else:
                    print(f"Skipped (up-to-date): {key}")
                    skipped += 1
            else:
                # Create new
                connector_def = ConnectorDefinition(
                    key=key,
                    display_name=definition["display_name"],
                    direction=definition["direction"],
                    implementation_key=definition["implementation_key"],
                    source_type=definition["source_type"],
                    version=definition["version"],
                    category=definition.get("category"),
                    capabilities=definition["capabilities"],
                    config_schema=definition["config_schema"],
                    default_config=definition.get("default_config"),
                    is_enabled=True,
                )

                session.add(connector_def)
                session.commit()
                session.refresh(connector_def)
                print(f"Created: {key} ({definition['display_name']}) - {connector_def.connector_definition_id}")
                created += 1

    print(f"\nSummary: {created} created, {updated} updated, {skipped} skipped")


def list_database_connectors():
    """List all database connector definitions."""
    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())

    with Session(engine) as session:
        connectors = (
            session.query(ConnectorDefinition)
            .filter(ConnectorDefinition.key.like("db-%"))
            .all()
        )

        if not connectors:
            print("No database connectors found. Run seed_database_connectors() first.")
            return

        print(f"Database Connectors ({len(connectors)}):")
        print("-" * 60)
        for conn in connectors:
            print(f"  {conn.key}: {conn.display_name}")
            print(f"    Implementation: {conn.implementation_key}")
            print(f"    Version: {conn.version}")
            print(f"    Enabled: {conn.is_enabled}")
            print()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Database connector definition management")
    parser.add_argument(
        "--list",
        action="store_true",
        help="List existing database connector definitions",
    )

    args = parser.parse_args()

    if args.list:
        list_database_connectors()
    else:
        seed_database_connectors()
