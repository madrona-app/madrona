"""
Connector Action Framework.

Defines a formal action dispatch system for connector operations.
Actions are invoked through: POST /connector-instances/{id}/actions/{action}

Available actions for db.* connectors:
- testConnection: Test database connectivity
- getCatalog: Discover schemas, tables, collections
- describeObject: Get column/field metadata for an object
- previewObject: Preview data with safe, parameterized queries
- validateConfig: Validate configuration without connecting
- refreshCatalog: Force-refresh catalog cache
- getObjectStats: Get row count, size, last modified
- searchCatalog: Search catalog items by name pattern
- getServerInfo: Get server version and features
- checkPermissions: Verify read/write access to objects
- getSampleValues: Get distinct values for a column

This module provides:
- Action definitions with input/output schemas
- Action dispatcher that routes to vendor-specific handlers
- Consistent error handling across all actions
"""

import fnmatch
import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from app.connectors.db import (
    ConnectionTestResult,
    test_database_connection,
    CatalogResult,
    discover_catalog,
    describe_object,
    preview_data,
    PreviewRequest,
    DbError,
    DbErrorCode,
    MAX_PREVIEW_LIMIT,
    MAX_RESPONSE_BYTES,
    get_object_stats,
    get_sample_values,
    check_permissions,
    MAX_SAMPLE_VALUES,
)
from app.connectors.db.catalog import invalidate_catalog_cache
from app.schemas.database_source import (
    validate_database_config,
    get_database_capabilities,
    DATABASE_CONFIG_SCHEMAS,
)

logger = logging.getLogger(__name__)


class ConnectorAction(str, Enum):
    """
    Available connector actions.

    Database connectors support these discovery and preview actions.
    No sync/extract actions are included - those use the pipeline system.
    """

    TEST_CONNECTION = "testConnection"
    GET_CATALOG = "getCatalog"
    DESCRIBE_OBJECT = "describeObject"
    PREVIEW_OBJECT = "previewObject"
    VALIDATE_CONFIG = "validateConfig"
    REFRESH_CATALOG = "refreshCatalog"
    GET_OBJECT_STATS = "getObjectStats"
    SEARCH_CATALOG = "searchCatalog"
    GET_SERVER_INFO = "getServerInfo"
    CHECK_PERMISSIONS = "checkPermissions"
    GET_SAMPLE_VALUES = "getSampleValues"


@dataclass
class ActionDefinition:
    """Definition of a connector action."""

    name: str
    description: str
    method: str = "POST"  # HTTP method
    input_schema: dict[str, Any] = field(default_factory=dict)
    output_schema: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        return {
            "name": self.name,
            "description": self.description,
            "method": self.method,
            "inputSchema": self.input_schema,
            "outputSchema": self.output_schema,
        }


# Action definitions for db.* connectors
DB_ACTION_DEFINITIONS: dict[str, ActionDefinition] = {
    ConnectorAction.TEST_CONNECTION.value: ActionDefinition(
        name="testConnection",
        description="Test database connectivity with a minimal safe command",
        method="POST",
        input_schema={
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "ok": {"type": "boolean"},
                "latencyMs": {"type": "number"},
                "server": {
                    "type": "object",
                    "properties": {
                        "version": {"type": ["string", "null"]},
                        "vendor": {"type": "string"},
                    },
                },
                "capabilities": {"type": "object"},
                "error": {"type": ["object", "null"]},
            },
            "required": ["ok", "latencyMs", "server", "capabilities"],
        },
    ),

    ConnectorAction.GET_CATALOG.value: ActionDefinition(
        name="getCatalog",
        description="Discover schemas, tables, views, and collections",
        method="POST",
        input_schema={
            "type": "object",
            "properties": {
                "includeSystem": {
                    "type": "boolean",
                    "default": False,
                    "description": "Include system schemas/databases",
                },
            },
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "sourceId": {"type": "string"},
                "vendor": {"type": "string"},
                "items": {"type": "array"},
                "error": {"type": ["object", "null"]},
            },
            "required": ["sourceId", "vendor", "items"],
        },
    ),

    ConnectorAction.DESCRIBE_OBJECT.value: ActionDefinition(
        name="describeObject",
        description="Get detailed metadata for a table, view, or collection",
        method="POST",
        input_schema={
            "type": "object",
            "properties": {
                "objectId": {"type": "string", "description": "Object ID from catalog discovery"},
                "path": {"type": "string", "description": "Dot-separated path (e.g., 'mydb.public.users')"},
                "kind": {"type": "string", "enum": ["table", "view", "collection"], "default": "table"},
            },
            "required": ["path"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "objectId": {"type": "string"},
                "kind": {"type": "string"},
                "name": {"type": "string"},
                "path": {"type": "array"},
                "columns": {"type": "array"},
                "fields": {"type": "array"},
                "primaryKey": {"type": ["array", "null"]},
                "error": {"type": ["object", "null"]},
            },
        },
    ),

    ConnectorAction.PREVIEW_OBJECT.value: ActionDefinition(
        name="previewObject",
        description="Preview data from a table, view, or collection with safety limits",
        method="POST",
        input_schema={
            "type": "object",
            "properties": {
                "objectId": {"type": "string"},
                "path": {"type": "string", "description": "Dot-separated path to the object"},
                "kind": {"type": "string", "enum": ["table", "view", "collection"], "default": "table"},
                "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PREVIEW_LIMIT, "default": 25},
                "columns": {"type": "array", "items": {"type": "string"}},
                "filter": {"type": "object"},
                "sort": {"type": "array"},
            },
            "required": ["path"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "objectId": {"type": "string"},
                "kind": {"type": "string"},
                "rows": {"type": "array"},
                "docs": {"type": "array"},
                "truncated": {"type": "boolean"},
                "meta": {"type": "object"},
                "error": {"type": ["object", "null"]},
            },
        },
    ),

    ConnectorAction.VALIDATE_CONFIG.value: ActionDefinition(
        name="validateConfig",
        description="Validate connector configuration without connecting to the database",
        method="POST",
        input_schema={
            "type": "object",
            "properties": {
                "config": {
                    "type": "object",
                    "description": "Configuration to validate (uses instance config if omitted)",
                },
            },
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "valid": {"type": "boolean"},
                "errors": {"type": "array", "items": {"type": "string"}},
                "warnings": {"type": "array", "items": {"type": "string"}},
                "schema": {"type": "object", "description": "JSON Schema for this connector type"},
            },
            "required": ["valid", "errors"],
        },
    ),

    ConnectorAction.REFRESH_CATALOG.value: ActionDefinition(
        name="refreshCatalog",
        description="Force-refresh the catalog cache and rediscover objects",
        method="POST",
        input_schema={
            "type": "object",
            "properties": {
                "includeSystem": {"type": "boolean", "default": False},
            },
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "sourceId": {"type": "string"},
                "vendor": {"type": "string"},
                "items": {"type": "array"},
                "cacheInvalidated": {"type": "boolean"},
                "error": {"type": ["object", "null"]},
            },
            "required": ["sourceId", "vendor", "items", "cacheInvalidated"],
        },
    ),

    ConnectorAction.GET_OBJECT_STATS.value: ActionDefinition(
        name="getObjectStats",
        description="Get statistics for a database object (row count, size, last modified)",
        method="POST",
        input_schema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Dot-separated path to the object"},
            },
            "required": ["path"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "objectId": {"type": "string"},
                "path": {"type": "array"},
                "rowCount": {"type": ["integer", "null"]},
                "sizeBytes": {"type": ["integer", "null"]},
                "lastModified": {"type": ["string", "null"]},
                "meta": {"type": "object"},
                "error": {"type": ["object", "null"]},
            },
        },
    ),

    ConnectorAction.SEARCH_CATALOG.value: ActionDefinition(
        name="searchCatalog",
        description="Search catalog items by name pattern (supports wildcards)",
        method="POST",
        input_schema={
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Search pattern (supports * and ? wildcards, or regex with /pattern/)",
                },
                "kind": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["database", "schema", "table", "view", "collection"]},
                    "description": "Filter by object kind(s)",
                },
                "includeSystem": {"type": "boolean", "default": False},
                "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 100},
            },
            "required": ["pattern"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "sourceId": {"type": "string"},
                "vendor": {"type": "string"},
                "items": {"type": "array"},
                "totalMatches": {"type": "integer"},
                "truncated": {"type": "boolean"},
                "error": {"type": ["object", "null"]},
            },
            "required": ["sourceId", "vendor", "items"],
        },
    ),

    ConnectorAction.GET_SERVER_INFO.value: ActionDefinition(
        name="getServerInfo",
        description="Get server version, vendor, and capabilities without testing connection",
        method="POST",
        input_schema={
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "vendor": {"type": "string"},
                "version": {"type": ["string", "null"]},
                "capabilities": {"type": "object"},
                "connected": {"type": "boolean"},
                "error": {"type": ["object", "null"]},
            },
            "required": ["vendor", "capabilities"],
        },
    ),

    ConnectorAction.CHECK_PERMISSIONS.value: ActionDefinition(
        name="checkPermissions",
        description="Verify read/write access permissions for a database object",
        method="POST",
        input_schema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Dot-separated path to the object"},
            },
            "required": ["path"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "objectId": {"type": "string"},
                "path": {"type": "array"},
                "canRead": {"type": "boolean"},
                "canWrite": {"type": "boolean"},
                "permissions": {"type": "array", "items": {"type": "string"}},
                "error": {"type": ["object", "null"]},
            },
        },
    ),

    ConnectorAction.GET_SAMPLE_VALUES.value: ActionDefinition(
        name="getSampleValues",
        description="Get distinct sample values for a column or field",
        method="POST",
        input_schema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Dot-separated path to the object"},
                "column": {"type": "string", "description": "Column or field name to sample"},
                "limit": {"type": "integer", "minimum": 1, "maximum": MAX_SAMPLE_VALUES, "default": 50},
            },
            "required": ["path", "column"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "objectId": {"type": "string"},
                "path": {"type": "array"},
                "column": {"type": "string"},
                "values": {"type": "array"},
                "totalDistinct": {"type": ["integer", "null"]},
                "nullCount": {"type": ["integer", "null"]},
                "error": {"type": ["object", "null"]},
            },
        },
    ),
}


@dataclass
class ActionResult:
    """Result of executing a connector action."""

    success: bool
    data: dict[str, Any] = field(default_factory=dict)
    error: DbError | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to API response format."""
        if self.error:
            return {
                "success": False,
                "error": self.error.to_dict(),
            }
        return {
            "success": True,
            **self.data,
        }


# Database source types that support actions
DB_SOURCE_TYPES = {"postgres", "mysql", "sqlserver", "oracle", "mongodb"}


def get_db_source_type(definition_key: str, source_type: str | None) -> str | None:
    """
    Get the database source type from connector definition.

    Args:
        definition_key: Connector definition key (e.g., 'db-postgres')
        source_type: Source type from definition (e.g., 'postgres')

    Returns:
        Database type if supported, None otherwise
    """
    # Check source_type first
    if source_type in DB_SOURCE_TYPES:
        return source_type

    # Fall back to key prefix
    if definition_key.startswith("db-"):
        db_type = definition_key.replace("db-", "")
        if db_type in DB_SOURCE_TYPES:
            return db_type

    return None


# =============================================================================
# Action Handlers
# =============================================================================


def execute_test_connection(
    config: dict[str, Any],
    params: dict[str, Any],
    source_id: str,
) -> ActionResult:
    """Execute testConnection action."""
    result = test_database_connection(config)

    return ActionResult(
        success=result.ok,
        data=result.to_dict(),
        error=result.error,
    )


def execute_get_catalog(
    config: dict[str, Any],
    params: dict[str, Any],
    source_id: str,
) -> ActionResult:
    """Execute getCatalog action."""
    include_system = params.get("includeSystem", False)

    result = discover_catalog(config, source_id, include_system)

    return ActionResult(
        success=result.error is None,
        data=result.to_dict(),
        error=result.error,
    )


def execute_describe_object(
    config: dict[str, Any],
    params: dict[str, Any],
    source_id: str,
) -> ActionResult:
    """Execute describeObject action."""
    path_str = params.get("path", "")
    object_kind = params.get("kind", "table")

    if not path_str:
        return ActionResult(
            success=False,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Missing 'path' parameter. Provide dot-separated path to the object.",
                None,
                False,
            ),
        )

    path = path_str.split(".")
    result = describe_object(config, source_id, path, object_kind)

    return ActionResult(
        success=result.error is None,
        data=result.to_dict(),
        error=result.error,
    )


def execute_preview_object(
    config: dict[str, Any],
    params: dict[str, Any],
    source_id: str,
) -> ActionResult:
    """Execute previewObject action."""
    from app.connectors.db.describe import describe_object as describe_obj

    path_str = params.get("path", "")
    object_kind = params.get("kind", "table")
    object_id = params.get("objectId", "")

    if not path_str:
        return ActionResult(
            success=False,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Missing 'path' parameter. Provide dot-separated path to the object.",
                None,
                False,
            ),
        )

    path = path_str.split(".")

    preview_params = {
        "objectId": object_id or path_str,
        "limit": min(params.get("limit", 25), MAX_PREVIEW_LIMIT),
        "columns": params.get("columns"),
        "filter": params.get("filter"),
        "sort": params.get("sort"),
    }

    preview_request = PreviewRequest.from_dict(preview_params, path, object_kind)

    # Get schema columns for validation (SQL only)
    schema_columns: list[str] = []
    db_type = config.get("type")
    if db_type != "mongodb":
        desc_result = describe_obj(config, source_id, path, object_kind)
        if not desc_result.error and hasattr(desc_result, "columns"):
            schema_columns = [col.name for col in desc_result.columns]

    result = preview_data(config, preview_request, schema_columns, MAX_RESPONSE_BYTES)

    return ActionResult(
        success=result.error is None,
        data=result.to_dict(),
        error=result.error,
    )


def execute_validate_config(
    config: dict[str, Any],
    params: dict[str, Any],
    source_id: str,
) -> ActionResult:
    """Execute validateConfig action."""
    # Use provided config or fall back to instance config
    config_to_validate = params.get("config", config)

    db_type = config_to_validate.get("type") or config.get("type")
    if not db_type:
        return ActionResult(
            success=True,
            data={
                "valid": False,
                "errors": ["Missing 'type' field in configuration"],
                "warnings": [],
            },
        )

    # Validate against schema
    is_valid, errors = validate_database_config(config_to_validate)

    # Check for warnings (non-blocking issues)
    warnings = []
    if config_to_validate.get("auth", {}).get("password"):
        warnings.append("Password provided directly in config. Consider using secretRef for production.")

    if config_to_validate.get("tls", {}).get("mode") == "disable":
        warnings.append("TLS is disabled. Consider enabling for production use.")

    # Get schema for reference
    schema = DATABASE_CONFIG_SCHEMAS.get(db_type, {})

    return ActionResult(
        success=True,
        data={
            "valid": is_valid,
            "errors": errors,
            "warnings": warnings,
            "schema": schema,
        },
    )


def execute_refresh_catalog(
    config: dict[str, Any],
    params: dict[str, Any],
    source_id: str,
) -> ActionResult:
    """Execute refreshCatalog action."""
    include_system = params.get("includeSystem", False)

    # Invalidate cache first
    invalidate_catalog_cache(source_id)

    # Rediscover with cache disabled to force fresh query
    result = discover_catalog(config, source_id, include_system, use_cache=False)

    data = result.to_dict()
    data["cacheInvalidated"] = True

    return ActionResult(
        success=result.error is None,
        data=data,
        error=result.error,
    )


def execute_get_object_stats(
    config: dict[str, Any],
    params: dict[str, Any],
    source_id: str,
) -> ActionResult:
    """Execute getObjectStats action."""
    path_str = params.get("path", "")

    if not path_str:
        return ActionResult(
            success=False,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Missing 'path' parameter. Provide dot-separated path to the object.",
                None,
                False,
            ),
        )

    path = path_str.split(".")
    result = get_object_stats(config, source_id, path)

    return ActionResult(
        success=result.error is None,
        data=result.to_dict(),
        error=result.error,
    )


def execute_search_catalog(
    config: dict[str, Any],
    params: dict[str, Any],
    source_id: str,
) -> ActionResult:
    """Execute searchCatalog action."""
    pattern = params.get("pattern", "")
    kinds = params.get("kind", [])
    include_system = params.get("includeSystem", False)
    limit = min(params.get("limit", 100), 500)

    if not pattern:
        return ActionResult(
            success=False,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Missing 'pattern' parameter.",
                None,
                False,
            ),
        )

    # Get full catalog first
    catalog_result = discover_catalog(config, source_id, include_system)

    if catalog_result.error:
        return ActionResult(
            success=False,
            data=catalog_result.to_dict(),
            error=catalog_result.error,
        )

    # Compile pattern
    if pattern.startswith("/") and pattern.endswith("/"):
        # Regex pattern
        try:
            regex = re.compile(pattern[1:-1], re.IGNORECASE)
            match_func = lambda name: regex.search(name) is not None
        except re.error as e:
            return ActionResult(
                success=False,
                error=DbError(
                    DbErrorCode.UNKNOWN,
                    f"Invalid regex pattern: {e}",
                    None,
                    False,
                ),
            )
    else:
        # Glob pattern (fnmatch)
        match_func = lambda name: fnmatch.fnmatch(name.lower(), pattern.lower())

    # Filter items
    matching_items = []
    for item in catalog_result.items:
        # Filter by kind if specified
        if kinds and item.kind.value not in kinds:
            continue

        # Match name against pattern
        if match_func(item.name):
            matching_items.append(item)

    total_matches = len(matching_items)
    truncated = total_matches > limit
    matching_items = matching_items[:limit]

    return ActionResult(
        success=True,
        data={
            "sourceId": catalog_result.source_id,
            "vendor": catalog_result.vendor,
            "items": [item.to_dict() for item in matching_items],
            "totalMatches": total_matches,
            "truncated": truncated,
        },
    )


def execute_get_server_info(
    config: dict[str, Any],
    params: dict[str, Any],
    source_id: str,
) -> ActionResult:
    """Execute getServerInfo action."""
    db_type = config.get("type")

    # Get capabilities without connecting
    capabilities = get_database_capabilities(db_type) if db_type else {}

    # Vendor mapping
    vendor_names = {
        "postgres": "PostgreSQL",
        "mysql": "MySQL",
        "sqlserver": "Microsoft SQL Server",
        "oracle": "Oracle Database",
        "mongodb": "MongoDB",
    }

    # Try to get version by testing connection
    result = test_database_connection(config)

    return ActionResult(
        success=True,
        data={
            "vendor": vendor_names.get(db_type, db_type or "Unknown"),
            "version": result.server.get("version") if result.ok else None,
            "capabilities": capabilities,
            "connected": result.ok,
            "error": result.error.to_dict() if result.error else None,
        },
    )


def execute_check_permissions(
    config: dict[str, Any],
    params: dict[str, Any],
    source_id: str,
) -> ActionResult:
    """Execute checkPermissions action."""
    path_str = params.get("path", "")

    if not path_str:
        return ActionResult(
            success=False,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Missing 'path' parameter. Provide dot-separated path to the object.",
                None,
                False,
            ),
        )

    path = path_str.split(".")
    result = check_permissions(config, source_id, path)

    return ActionResult(
        success=result.error is None,
        data=result.to_dict(),
        error=result.error,
    )


def execute_get_sample_values(
    config: dict[str, Any],
    params: dict[str, Any],
    source_id: str,
) -> ActionResult:
    """Execute getSampleValues action."""
    path_str = params.get("path", "")
    column = params.get("column", "")

    if not path_str:
        return ActionResult(
            success=False,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Missing 'path' parameter. Provide dot-separated path to the object.",
                None,
                False,
            ),
        )

    if not column:
        return ActionResult(
            success=False,
            error=DbError(
                DbErrorCode.UNKNOWN,
                "Missing 'column' parameter. Specify the column to sample.",
                None,
                False,
            ),
        )

    path = path_str.split(".")
    result = get_sample_values(config, source_id, path, column)

    return ActionResult(
        success=result.error is None,
        data=result.to_dict(),
        error=result.error,
    )


# =============================================================================
# Action Registry
# =============================================================================


ACTION_HANDLERS: dict[str, Callable[[dict[str, Any], dict[str, Any], str], ActionResult]] = {
    ConnectorAction.TEST_CONNECTION.value: execute_test_connection,
    ConnectorAction.GET_CATALOG.value: execute_get_catalog,
    ConnectorAction.DESCRIBE_OBJECT.value: execute_describe_object,
    ConnectorAction.PREVIEW_OBJECT.value: execute_preview_object,
    ConnectorAction.VALIDATE_CONFIG.value: execute_validate_config,
    ConnectorAction.REFRESH_CATALOG.value: execute_refresh_catalog,
    ConnectorAction.GET_OBJECT_STATS.value: execute_get_object_stats,
    ConnectorAction.SEARCH_CATALOG.value: execute_search_catalog,
    ConnectorAction.GET_SERVER_INFO.value: execute_get_server_info,
    ConnectorAction.CHECK_PERMISSIONS.value: execute_check_permissions,
    ConnectorAction.GET_SAMPLE_VALUES.value: execute_get_sample_values,
}


def get_available_actions(source_type: str | None) -> list[ActionDefinition]:
    """
    Get available actions for a connector type.

    Args:
        source_type: Connector source type (e.g., 'postgres', 'mysql')

    Returns:
        List of action definitions available for this connector type
    """
    if source_type in DB_SOURCE_TYPES:
        return list(DB_ACTION_DEFINITIONS.values())
    return []


def execute_action(
    action_name: str,
    config: dict[str, Any],
    params: dict[str, Any],
    source_id: str,
    source_type: str | None,
) -> ActionResult:
    """
    Execute a connector action.

    Args:
        action_name: Name of the action to execute
        config: Connector instance configuration
        params: Action parameters from request body
        source_id: Connector instance ID
        source_type: Connector source type

    Returns:
        ActionResult with success status and data/error
    """
    # Validate action exists
    if action_name not in ACTION_HANDLERS:
        return ActionResult(
            success=False,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                f"Unknown action '{action_name}'. Available actions: {list(ACTION_HANDLERS.keys())}",
                None,
                False,
            ),
        )

    # Validate connector supports actions
    if source_type not in DB_SOURCE_TYPES:
        return ActionResult(
            success=False,
            error=DbError(
                DbErrorCode.UNSUPPORTED_FEATURE,
                f"Actions not supported for connector type '{source_type}'. Only database connectors support actions.",
                None,
                False,
            ),
        )

    # Ensure config has type
    if "type" not in config:
        config = dict(config)
        config["type"] = source_type

    # Execute action
    handler = ACTION_HANDLERS[action_name]

    logger.info(f"Executing action '{action_name}' for source {source_id} (type={source_type})")

    try:
        result = handler(config, params, source_id)

        if result.success:
            logger.info(f"Action '{action_name}' completed successfully for {source_id}")
        else:
            logger.warning(
                f"Action '{action_name}' failed for {source_id}: "
                f"{result.error.code if result.error else 'unknown'}"
            )

        return result

    except Exception as e:
        logger.exception(f"Action '{action_name}' raised exception for {source_id}")
        return ActionResult(
            success=False,
            error=DbError(
                DbErrorCode.UNKNOWN,
                f"Action execution failed: {str(e)}",
                None,
                False,
            ),
        )
