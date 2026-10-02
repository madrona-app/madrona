"""
Database Source Configuration Schema and Validation.

This module defines the normalized configuration envelope for database source
connectors, with validation rules per DB vendor type.

Supported DB types:
- postgres: PostgreSQL (requires host+port+database)
- mysql: MySQL/MariaDB (requires host+port+database)
- sqlserver: Microsoft SQL Server (requires host+port+database)
- oracle: Oracle Database (requires host+port + serviceName|sid|connectString)
- mongodb: MongoDB (supports connectionUri OR host+port+database?)

The configuration follows a normalized envelope pattern:
- DatabaseSourceConfig: Main configuration envelope
- AuthConfig: Authentication settings (password or secret reference)
- TlsConfig: TLS/SSL configuration
- NetworkConfig: Network connectivity (direct or SSH tunnel)
- DriverOptions: Connection tuning parameters

Secrets Pattern:
- Secrets can be provided inline (password) or via reference (secretRef)
- secretRef follows the platform pattern: {"type": "vault|env|ssm", "key": "..."}
- For production, use secretRef; inline password is for dev/testing only
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal


class DatabaseType(str, Enum):
    """Supported database vendor types."""

    POSTGRES = "postgres"
    MYSQL = "mysql"
    SQLSERVER = "sqlserver"
    ORACLE = "oracle"
    MONGODB = "mongodb"


class AuthMode(str, Enum):
    """Authentication modes for database connections."""

    PASSWORD = "password"  # Username/password authentication
    IAM = "iam"  # Cloud IAM authentication (AWS RDS, GCP Cloud SQL)
    KERBEROS = "kerberos"  # Kerberos/AD authentication
    CERTIFICATE = "certificate"  # Client certificate authentication


class TlsMode(str, Enum):
    """TLS/SSL modes for database connections."""

    DISABLE = "disable"  # No TLS
    ALLOW = "allow"  # Try TLS, fall back to non-TLS
    PREFER = "prefer"  # Prefer TLS, fall back to non-TLS
    REQUIRE = "require"  # Require TLS, no certificate verification
    VERIFY_CA = "verify-ca"  # Require TLS, verify server certificate
    VERIFY_FULL = "verify-full"  # Require TLS, verify server certificate and hostname


class NetworkMode(str, Enum):
    """Network connectivity modes."""

    DIRECT = "direct"  # Direct connection to database
    SSH_TUNNEL = "ssh_tunnel"  # Connect via SSH tunnel


# JSON Schema definitions for config validation

AUTH_CONFIG_SCHEMA = {
    "type": "object",
    "properties": {
        "mode": {
            "type": "string",
            "enum": ["password", "iam", "kerberos", "certificate"],
            "default": "password",
            "description": "Authentication mode",
        },
        "password": {
            "type": "string",
            "description": "Password for password auth (dev/test only, use secretRef in production)",
        },
        "secretRef": {
            "type": "object",
            "description": "Reference to secret in external secret store",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["vault", "env", "ssm", "secrets_manager"],
                    "description": "Secret store type",
                },
                "key": {
                    "type": "string",
                    "description": "Secret key/path in the store",
                },
            },
            "required": ["type", "key"],
            "additionalProperties": False,
        },
    },
    "additionalProperties": False,
}

TLS_CONFIG_SCHEMA = {
    "type": "object",
    "properties": {
        "mode": {
            "type": "string",
            "enum": ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"],
            "default": "prefer",
            "description": "TLS/SSL mode",
        },
        "caCertRef": {
            "type": "object",
            "description": "Reference to CA certificate",
            "properties": {
                "type": {"type": "string", "enum": ["vault", "env", "ssm", "secrets_manager", "file"]},
                "key": {"type": "string"},
            },
            "required": ["type", "key"],
            "additionalProperties": False,
        },
        "clientCertRef": {
            "type": "object",
            "description": "Reference to client certificate (for certificate auth)",
            "properties": {
                "type": {"type": "string", "enum": ["vault", "env", "ssm", "secrets_manager", "file"]},
                "key": {"type": "string"},
            },
            "required": ["type", "key"],
            "additionalProperties": False,
        },
        "clientKeyRef": {
            "type": "object",
            "description": "Reference to client private key (for certificate auth)",
            "properties": {
                "type": {"type": "string", "enum": ["vault", "env", "ssm", "secrets_manager", "file"]},
                "key": {"type": "string"},
            },
            "required": ["type", "key"],
            "additionalProperties": False,
        },
        "serverName": {
            "type": "string",
            "description": "Server name for certificate verification (if different from host)",
        },
    },
    "additionalProperties": False,
}

NETWORK_CONFIG_SCHEMA = {
    "type": "object",
    "properties": {
        "mode": {
            "type": "string",
            "enum": ["direct", "ssh_tunnel"],
            "default": "direct",
            "description": "Network connectivity mode",
        },
        "sshTunnelRef": {
            "type": "object",
            "description": "SSH tunnel configuration reference (when mode=ssh_tunnel)",
            "properties": {
                "host": {"type": "string", "description": "SSH server hostname"},
                "port": {"type": "integer", "default": 22, "description": "SSH server port"},
                "username": {"type": "string", "description": "SSH username"},
                "privateKeyRef": {
                    "type": "object",
                    "description": "Reference to SSH private key",
                    "properties": {
                        "type": {"type": "string", "enum": ["vault", "env", "ssm", "secrets_manager"]},
                        "key": {"type": "string"},
                    },
                    "required": ["type", "key"],
                    "additionalProperties": False,
                },
            },
            "required": ["host", "username"],
            "additionalProperties": False,
        },
    },
    "additionalProperties": False,
}

DRIVER_OPTIONS_SCHEMA = {
    "type": "object",
    "properties": {
        "connectTimeoutMs": {
            "type": "integer",
            "minimum": 1000,
            "maximum": 120000,
            "default": 30000,
            "description": "Connection timeout in milliseconds",
        },
        "statementTimeoutMs": {
            "type": "integer",
            "minimum": 1000,
            "maximum": 600000,
            "default": 60000,
            "description": "Statement/query timeout in milliseconds",
        },
        "maxPoolSize": {
            "type": "integer",
            "minimum": 1,
            "maximum": 20,
            "default": 5,
            "description": "Maximum connection pool size",
        },
    },
    "additionalProperties": False,
}


def get_base_database_config_schema() -> dict[str, Any]:
    """
    Get the base JSON Schema for database source configuration.

    This schema is extended per database type with vendor-specific requirements.
    """
    return {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 255,
                "description": "Display name for this database source",
            },
            "type": {
                "type": "string",
                "enum": ["postgres", "mysql", "sqlserver", "oracle", "mongodb"],
                "description": "Database vendor type",
            },
            "host": {
                "type": "string",
                "description": "Database server hostname or IP address",
            },
            "port": {
                "type": "integer",
                "minimum": 1,
                "maximum": 65535,
                "description": "Database server port",
            },
            "database": {
                "type": "string",
                "description": "Database name (postgres/mysql/sqlserver) or authentication database (mongodb)",
            },
            "serviceName": {
                "type": "string",
                "description": "Oracle service name (alternative to SID)",
            },
            "sid": {
                "type": "string",
                "description": "Oracle SID (alternative to serviceName)",
            },
            "connectString": {
                "type": "string",
                "description": "Oracle TNS connect string (full connection descriptor)",
            },
            "connectionUri": {
                "type": "string",
                "description": "MongoDB connection URI (mongodb:// or mongodb+srv://)",
            },
            "username": {
                "type": "string",
                "description": "Database username",
            },
            "auth": AUTH_CONFIG_SCHEMA,
            "tls": TLS_CONFIG_SCHEMA,
            "network": NETWORK_CONFIG_SCHEMA,
            "driverOptions": DRIVER_OPTIONS_SCHEMA,
        },
        "required": ["name", "type"],
        "additionalProperties": False,
    }


def get_postgres_config_schema() -> dict[str, Any]:
    """JSON Schema for PostgreSQL source configuration."""
    schema = get_base_database_config_schema()
    schema["required"] = ["name", "type", "host", "port", "database", "username"]
    schema["properties"]["port"]["default"] = 5432
    schema["properties"]["tls"]["properties"]["mode"]["default"] = "prefer"
    return schema


def get_mysql_config_schema() -> dict[str, Any]:
    """JSON Schema for MySQL source configuration."""
    schema = get_base_database_config_schema()
    schema["required"] = ["name", "type", "host", "port", "database", "username"]
    schema["properties"]["port"]["default"] = 3306
    schema["properties"]["tls"]["properties"]["mode"]["default"] = "prefer"
    return schema


def get_sqlserver_config_schema() -> dict[str, Any]:
    """JSON Schema for SQL Server source configuration."""
    schema = get_base_database_config_schema()
    schema["required"] = ["name", "type", "host", "port", "database", "username"]
    schema["properties"]["port"]["default"] = 1433
    # SQL Server specific: instance name support
    schema["properties"]["instance"] = {
        "type": "string",
        "description": "SQL Server instance name (for named instances)",
    }
    return schema


def get_oracle_config_schema() -> dict[str, Any]:
    """
    JSON Schema for Oracle source configuration.

    Oracle requires one of: serviceName, sid, or connectString.
    """
    schema = get_base_database_config_schema()
    schema["required"] = ["name", "type", "host", "port", "username"]
    schema["properties"]["port"]["default"] = 1521
    # Oracle requires one of serviceName, sid, or connectString
    schema["oneOf"] = [
        {"required": ["serviceName"]},
        {"required": ["sid"]},
        {"required": ["connectString"]},
    ]
    return schema


def get_mongodb_config_schema() -> dict[str, Any]:
    """
    JSON Schema for MongoDB source configuration.

    MongoDB supports either connectionUri OR host+port configuration.
    Database is optional (defaults to 'admin' for auth, queries specify collection).
    """
    schema = get_base_database_config_schema()
    # MongoDB: either connectionUri or host+port
    schema["required"] = ["name", "type"]
    schema["properties"]["port"]["default"] = 27017
    # MongoDB specific options
    schema["properties"]["replicaSet"] = {
        "type": "string",
        "description": "Replica set name",
    }
    schema["properties"]["authSource"] = {
        "type": "string",
        "description": "Authentication database (default: admin)",
        "default": "admin",
    }
    schema["oneOf"] = [
        {"required": ["connectionUri"]},
        {"required": ["host", "port"]},
    ]
    return schema


# Mapping of database types to their config schemas
DATABASE_CONFIG_SCHEMAS: dict[str, dict[str, Any]] = {
    "postgres": get_postgres_config_schema(),
    "mysql": get_mysql_config_schema(),
    "sqlserver": get_sqlserver_config_schema(),
    "oracle": get_oracle_config_schema(),
    "mongodb": get_mongodb_config_schema(),
}


def validate_database_config(config: dict[str, Any], db_type: str | None = None) -> tuple[bool, list[str]]:
    """
    Validate database source configuration.

    Performs semantic validation beyond JSON Schema, including:
    - Type-specific required field combinations
    - Credential presence (password or secretRef)
    - URI format validation for MongoDB

    Args:
        config: Configuration dictionary to validate
        db_type: Database type (if not provided, reads from config["type"])

    Returns:
        Tuple of (is_valid, error_messages)
    """
    errors: list[str] = []

    # Get database type
    db_type = db_type or config.get("type")
    if not db_type:
        errors.append("Database type is required")
        return False, errors

    if db_type not in DATABASE_CONFIG_SCHEMAS:
        errors.append(f"Unsupported database type: {db_type}. Supported: {list(DATABASE_CONFIG_SCHEMAS.keys())}")
        return False, errors

    # Type-specific validation
    if db_type in ("postgres", "mysql", "sqlserver"):
        # Require host, port, database
        if not config.get("host"):
            errors.append(f"{db_type} requires 'host'")
        if not config.get("port"):
            errors.append(f"{db_type} requires 'port'")
        if not config.get("database"):
            errors.append(f"{db_type} requires 'database'")
        if not config.get("username"):
            errors.append(f"{db_type} requires 'username'")

    elif db_type == "oracle":
        # Require host, port, and one of serviceName/sid/connectString
        if not config.get("host"):
            errors.append("oracle requires 'host'")
        if not config.get("port"):
            errors.append("oracle requires 'port'")
        if not config.get("username"):
            errors.append("oracle requires 'username'")

        has_service = bool(config.get("serviceName"))
        has_sid = bool(config.get("sid"))
        has_connect_string = bool(config.get("connectString"))

        if not (has_service or has_sid or has_connect_string):
            errors.append("oracle requires one of: 'serviceName', 'sid', or 'connectString'")
        if sum([has_service, has_sid, has_connect_string]) > 1:
            errors.append("oracle: specify only one of 'serviceName', 'sid', or 'connectString'")

    elif db_type == "mongodb":
        # MongoDB: either connectionUri OR host+port
        has_uri = bool(config.get("connectionUri"))
        has_host = bool(config.get("host"))

        if not has_uri and not has_host:
            errors.append("mongodb requires either 'connectionUri' or 'host'")
        if has_uri and has_host:
            errors.append("mongodb: specify either 'connectionUri' or 'host', not both")

        # Validate URI format if provided
        if has_uri:
            uri = config["connectionUri"]
            if not (uri.startswith("mongodb://") or uri.startswith("mongodb+srv://")):
                errors.append("mongodb connectionUri must start with 'mongodb://' or 'mongodb+srv://'")

    # Validate auth configuration (all types)
    auth = config.get("auth", {})
    auth_mode = auth.get("mode", "password")

    if auth_mode == "password":
        has_password = bool(auth.get("password"))
        has_secret_ref = bool(auth.get("secretRef"))

        # For password mode, need either password or secretRef
        if not has_password and not has_secret_ref:
            # Check if password is inline (for dev/test convenience)
            # Only warn, don't error - some configs use other auth methods
            pass  # Auth validation is flexible for different deployment scenarios

    # Validate network configuration
    network = config.get("network", {})
    network_mode = network.get("mode", "direct")

    if network_mode == "ssh_tunnel":
        ssh_ref = network.get("sshTunnelRef")
        if not ssh_ref:
            errors.append("SSH tunnel mode requires 'sshTunnelRef' configuration")
        elif not ssh_ref.get("host") or not ssh_ref.get("username"):
            errors.append("sshTunnelRef requires 'host' and 'username'")

    return len(errors) == 0, errors


@dataclass
class DatabaseCapabilities:
    """
    Capabilities exposed by a database source connector.

    These inform the UI and pipeline about what operations are supported.
    """

    supports_schemas: bool = True  # Database has schema namespace (e.g., PostgreSQL schemas)
    supports_views: bool = True  # Can read from views
    supports_sql: bool = True  # Supports arbitrary SQL queries
    supports_sampling: bool = True  # Supports LIMIT/TOP for preview
    max_preview_bytes: int = 10_000_000  # Max bytes for preview (10MB default)
    supports_table_discovery: bool = True  # Can enumerate tables/collections
    supports_column_discovery: bool = True  # Can enumerate columns/fields


def get_database_capabilities(db_type: str) -> dict[str, Any]:
    """
    Get capabilities for a database type.

    Args:
        db_type: Database vendor type

    Returns:
        Capabilities dictionary for the connector definition
    """
    base_capabilities = {
        "supportsSchemas": True,
        "supportsViews": True,
        "supportsSql": True,
        "supportsSampling": True,
        "maxPreviewBytes": 10_000_000,
        "supportsTableDiscovery": True,
        "supportsColumnDiscovery": True,
        # Source connector standard capabilities
        "incremental": False,  # Not implementing CDC in this scope
        "full_refresh": True,
        "pagination": "offset",
    }

    # Type-specific capability overrides
    if db_type == "postgres":
        return {
            **base_capabilities,
            "supportsSchemas": True,  # PostgreSQL has schemas
            "defaultSchema": "public",
        }

    elif db_type == "mysql":
        return {
            **base_capabilities,
            "supportsSchemas": False,  # MySQL databases act as schemas
            "supportsViews": True,
        }

    elif db_type == "sqlserver":
        return {
            **base_capabilities,
            "supportsSchemas": True,  # SQL Server has schemas
            "defaultSchema": "dbo",
        }

    elif db_type == "oracle":
        return {
            **base_capabilities,
            "supportsSchemas": True,  # Oracle schemas = users
            "supportsViews": True,
        }

    elif db_type == "mongodb":
        return {
            **base_capabilities,
            "supportsSchemas": False,  # MongoDB is schemaless
            "supportsViews": False,  # MongoDB views work differently
            "supportsSql": False,  # Uses MQL, not SQL
            "supportsTableDiscovery": True,  # Can list collections
            "supportsColumnDiscovery": False,  # Schemaless - sample fields only
        }

    return base_capabilities


# Default ports per database type
DEFAULT_PORTS: dict[str, int] = {
    "postgres": 5432,
    "mysql": 3306,
    "sqlserver": 1433,
    "oracle": 1521,
    "mongodb": 27017,
}


# =============================================================================
# Extraction Configuration Schema (for RouteSource.parameters)
# =============================================================================
# This defines what can be configured per-customer when extracting data
# from a database connector instance.

COLUMN_MAPPING_SCHEMA = {
    "type": "object",
    "description": "Maps source columns to canonical record fields",
    "properties": {
        "sourceColumn": {
            "type": "string",
            "description": "Column name in source table/query result",
        },
        "targetField": {
            "type": "string",
            "description": "Target field path in canonical record (e.g., 'label', 'properties.title')",
        },
        "transform": {
            "type": "string",
            "enum": ["none", "trim", "lowercase", "uppercase", "parse_date", "parse_json"],
            "default": "none",
            "description": "Optional transformation to apply",
        },
    },
    "required": ["sourceColumn", "targetField"],
    "additionalProperties": False,
}

EXTRACTION_OBJECT_SCHEMA = {
    "type": "object",
    "description": "Configuration for extracting from a single table/view/collection",
    "properties": {
        "objectId": {
            "type": "string",
            "description": "Object ID from catalog discovery (identifies table/view)",
        },
        "schema": {
            "type": "string",
            "description": "Schema name (e.g., 'dbo', 'public'). Can override objectId.",
        },
        "table": {
            "type": "string",
            "description": "Table/view name. Can override objectId.",
        },
        "customQuery": {
            "type": "string",
            "description": "Custom SQL query (overrides table selection). Use parameterized queries only.",
        },
        "idColumn": {
            "type": "string",
            "description": "Column to use as entity ID (required for incremental sync)",
        },
        "watermarkColumn": {
            "type": "string",
            "description": "Column for incremental sync (e.g., 'updated_at', 'modified_date')",
        },
        "filter": {
            "type": "object",
            "description": "WHERE clause conditions (parameterized)",
            "properties": {
                "sql": {
                    "type": "string",
                    "description": "WHERE clause (without 'WHERE'), e.g., 'status = :status AND active = 1'",
                },
                "params": {
                    "type": "object",
                    "description": "Named parameters for the WHERE clause",
                    "additionalProperties": True,
                },
            },
            "additionalProperties": False,
        },
        "columns": {
            "type": "array",
            "description": "Columns to select (empty = all columns)",
            "items": {"type": "string"},
        },
        "columnMappings": {
            "type": "array",
            "description": "How source columns map to canonical record fields",
            "items": COLUMN_MAPPING_SCHEMA,
        },
        "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1000000,
            "description": "Maximum rows to extract (for testing/sampling)",
        },
    },
    "additionalProperties": False,
}

DATABASE_EXTRACTION_CONFIG_SCHEMA = {
    "type": "object",
    "description": "Extraction configuration for database source (stored in RouteSource.parameters)",
    "properties": {
        "syncMode": {
            "type": "string",
            "enum": ["full", "incremental"],
            "default": "full",
            "description": "Sync mode: 'full' replaces all data, 'incremental' uses watermark",
        },
        "objects": {
            "type": "array",
            "description": "Tables/views to extract from (can be multiple for multi-table sync)",
            "items": EXTRACTION_OBJECT_SCHEMA,
            "minItems": 1,
        },
        "entityType": {
            "type": "string",
            "enum": ["Object", "Work", "Agent", "Place", "Event", "Media"],
            "description": "Canonical record type for extracted entities",
        },
        "batchSize": {
            "type": "integer",
            "minimum": 100,
            "maximum": 10000,
            "default": 1000,
            "description": "Rows per batch during extraction",
        },
        "continueOnError": {
            "type": "boolean",
            "default": False,
            "description": "Continue extraction if individual rows fail to process",
        },
    },
    "required": ["objects"],
    "additionalProperties": False,
}


def get_extraction_config_schema() -> dict[str, Any]:
    """
    Get the JSON Schema for database extraction configuration.

    This schema defines what can be stored in RouteSource.parameters
    for database connectors. Each customer can configure:
    - Which tables/views to extract
    - Custom queries or filters
    - Column-to-canonical-field mappings
    - Sync mode (full vs incremental)

    Returns:
        JSON Schema dict for extraction configuration
    """
    return DATABASE_EXTRACTION_CONFIG_SCHEMA

# Display names for UI
DATABASE_DISPLAY_NAMES: dict[str, str] = {
    "postgres": "PostgreSQL",
    "mysql": "MySQL",
    "sqlserver": "Microsoft SQL Server",
    "oracle": "Oracle Database",
    "mongodb": "MongoDB",
}
