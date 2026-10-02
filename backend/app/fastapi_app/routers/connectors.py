"""
Connector Definitions and Instances API — FastAPI router.

Migrated from app/api/connectors.py (19 routes).
"""

import copy
import logging
import re
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.fastapi_app.schemas.connectors import (
    ConnectorActionsResponse,
    ConnectorDefinitionOut,
    ConnectorInstanceOut,
    CreateConnectorInstanceBody,
    ExtractionSchemaListResponse,
    ExtractionSchemaResponse,
    UpdateConnectorInstanceBody,
)
from app.models import ConnectorDefinition, ConnectorInstance
from app.permissions import Permission
from app.connectors.db import (
    test_database_connection,
    discover_catalog,
    describe_object,
    preview_data,
    PreviewRequest,
    MAX_PREVIEW_LIMIT,
    MAX_RESPONSE_BYTES,
    DbErrorCode,
    DbError,
)
from app.connectors.actions import (
    execute_action,
    get_available_actions,
    get_db_source_type,
    DB_ACTION_DEFINITIONS,
)
from app.schemas.database_source import (
    DATABASE_EXTRACTION_CONFIG_SCHEMA,
    EXTRACTION_OBJECT_SCHEMA,
    COLUMN_MAPPING_SCHEMA,
    get_extraction_config_schema,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# =============================================================================
# Config redaction helpers (from Flask connectors.py)
# =============================================================================

REDACTED = "***REDACTED***"

SENSITIVE_KEY_PATTERNS = [
    r"password",
    r"secret",
    r"token",
    r"api[_-]?key",
    r"private[_-]?key",
    r"client[_-]?key",
    r"access[_-]?key",
    r"auth[_-]?token",
    r"bearer",
    r"credential",
]

_SENSITIVE_PATTERNS = [re.compile(p, re.IGNORECASE) for p in SENSITIVE_KEY_PATTERNS]


def _is_sensitive_key(key: str) -> bool:
    """Check if a key name indicates a sensitive value."""
    return any(pattern.search(key) for pattern in _SENSITIVE_PATTERNS)


def redact_config(config: dict[str, Any] | None) -> dict[str, Any] | None:
    """Recursively redact sensitive values from a connector config."""
    if config is None:
        return None

    result: dict[str, Any] = {}
    for key, value in config.items():
        if _is_sensitive_key(key):
            if value is not None and value != "":
                result[key] = REDACTED
            else:
                result[key] = value
        elif isinstance(value, dict):
            result[key] = redact_config(value)
        elif isinstance(value, list):
            result[key] = [
                redact_config(item) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            result[key] = value

    return result


def merge_config_preserving_secrets(
    new_config: dict[str, Any] | None,
    existing_config: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Merge new config with existing config, preserving sensitive values."""
    if new_config is None:
        return existing_config
    if existing_config is None:
        return new_config

    result: dict[str, Any] = {}

    for key, value in new_config.items():
        if _is_sensitive_key(key) and value == REDACTED:
            if key in existing_config:
                result[key] = existing_config[key]
        elif isinstance(value, dict) and key in existing_config and isinstance(existing_config[key], dict):
            result[key] = merge_config_preserving_secrets(value, existing_config[key])
        elif isinstance(value, list):
            if key in existing_config and isinstance(existing_config[key], list):
                result[key] = [
                    merge_config_preserving_secrets(item, existing_config[key][i])
                    if isinstance(item, dict) and i < len(existing_config[key]) and isinstance(existing_config[key][i], dict)
                    else item
                    for i, item in enumerate(value)
                ]
            else:
                result[key] = value
        else:
            result[key] = value

    for key, value in existing_config.items():
        if key not in result:
            result[key] = value

    return result


# Database source types that support connectivity testing
DB_SOURCE_TYPES = {"postgres", "mysql", "sqlserver", "oracle", "mongodb"}


def _serialize_instance(instance: ConnectorInstance) -> dict:
    """Serialize a connector instance for API response."""
    return {
        "connector_instance_id": str(instance.connector_instance_id),
        "organization_id": str(instance.organization_id),
        "connector_definition_id": str(instance.connector_definition_id),
        "name": instance.name,
        "status": instance.status,
        "config": redact_config(instance.config),
        "direction": instance.connector_definition.direction if instance.connector_definition else None,
        "definition_key": instance.connector_definition.key if instance.connector_definition else None,
        "created_at": instance.created_at.isoformat(),
    }


def _resolve_source_type(definition: ConnectorDefinition) -> str | None:
    """Resolve the DB source type from a connector definition."""
    source_type = definition.source_type
    if source_type not in DB_SOURCE_TYPES:
        if definition.key.startswith("db-"):
            source_type = definition.key.replace("db-", "")
        else:
            return None
    return source_type


def _build_config_with_type(instance: ConnectorInstance, source_type: str) -> dict:
    """Build config dict with type field set."""
    config = dict(instance.config)
    if "type" not in config and source_type:
        config["type"] = source_type
    return config


def _get_instance_for_org(
    db: Session, connector_instance_id: str, organization_id: str,
) -> ConnectorInstance | None:
    """Fetch connector instance with tenant isolation."""
    return db.query(ConnectorInstance).filter_by(
        connector_instance_id=connector_instance_id,
        organization_id=organization_id,
    ).first()


def _unsupported_error(feature: str, definition_key: str, source_type: str | None, extra: dict | None = None):
    """Build error response for unsupported connector types."""
    body = {
        **(extra or {}),
        "error": {
            "code": DbErrorCode.UNSUPPORTED_FEATURE.value,
            "message": f"{feature} not supported for connector type '{definition_key}'. Only database sources (postgres, mysql, sqlserver, oracle, mongodb) are supported.",
            "vendorCode": None,
            "retryable": False,
        },
    }
    return JSONResponse(status_code=400, content=body)


# =============================================================================
# Route 1: List connector definitions
# =============================================================================

@router.get("/api/connector-definitions", response_model=list[ConnectorDefinitionOut], summary="List connector definitions")
def list_connector_definitions(
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """List connector definitions."""
    definitions = db.query(ConnectorDefinition).order_by(ConnectorDefinition.display_name).all()

    return [
        {
            "connector_definition_id": str(d.connector_definition_id),
            "key": d.key,
            "display_name": d.display_name,
            "direction": d.direction,
            "implementation_key": d.implementation_key,
            "source_type": d.source_type,
            "version": d.version,
            "category": d.category,
            "config_schema": d.config_schema,
            "created_at": d.created_at.isoformat(),
        }
        for d in definitions
    ]


# =============================================================================
# Route 2: Get extraction schema for a definition
# =============================================================================

@router.get("/api/connector-definitions/{definition_key}/extraction-schema", response_model=ExtractionSchemaResponse, summary="Get connector extraction schema")
def get_connector_extraction_schema(
    definition_key: str,
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get connector extraction schema."""
    definition = db.query(ConnectorDefinition).filter_by(key=definition_key).first()
    if not definition:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector definition not found",
        })

    if not definition_key.startswith("db-"):
        return {
            "definitionKey": definition_key,
            "extractionSchema": None,
            "objectSchema": None,
            "columnMappingSchema": None,
            "message": f"Extraction schema not available for connector type '{definition_key}'. Only database connectors (db-*) have extraction schemas.",
        }

    return {
        "definitionKey": definition_key,
        "extractionSchema": DATABASE_EXTRACTION_CONFIG_SCHEMA,
        "objectSchema": EXTRACTION_OBJECT_SCHEMA,
        "columnMappingSchema": COLUMN_MAPPING_SCHEMA,
    }


# =============================================================================
# Route 3: List extraction schemas
# =============================================================================

@router.get("/api/extraction-schemas", response_model=ExtractionSchemaListResponse, summary="List extraction schemas")
def list_extraction_schemas(
    direction: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """List extraction schemas."""
    query = db.query(ConnectorDefinition).filter(
        ConnectorDefinition.key.like("db-%")
    )

    if direction:
        if direction in ("source", "target"):
            query = query.filter(
                (ConnectorDefinition.direction == direction)
                | (ConnectorDefinition.direction == "both")
            )
        else:
            query = query.filter(ConnectorDefinition.direction == direction)

    definitions = query.order_by(ConnectorDefinition.display_name).all()

    schemas = []
    for d in definitions:
        schemas.append({
            "definitionKey": d.key,
            "displayName": d.display_name,
            "direction": d.direction,
            "sourceType": d.source_type,
            "extractionSchema": DATABASE_EXTRACTION_CONFIG_SCHEMA,
            "objectSchema": EXTRACTION_OBJECT_SCHEMA,
            "columnMappingSchema": COLUMN_MAPPING_SCHEMA,
        })

    return {"schemas": schemas}


# =============================================================================
# Route 4: List connector instances
# =============================================================================

@router.get("/api/connector-instances", response_model=list[ConnectorInstanceOut], summary="List connector instances")
def list_connector_instances(
    organization_id: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """List connector instances."""
    org_id = organization_id or (str(auth.active_organization_id) if auth.active_organization_id else None)

    if not org_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Organization context required",
        })

    instances = (
        db.query(ConnectorInstance)
        .filter_by(organization_id=org_id)
        .order_by(ConnectorInstance.created_at.desc())
        .all()
    )

    return [_serialize_instance(i) for i in instances]


# =============================================================================
# Route 5: Create connector instance
# =============================================================================

@router.post("/api/connector-instances", status_code=201, response_model=ConnectorInstanceOut, summary="Create connector instance")
def create_connector_instance(
    body: CreateConnectorInstanceBody,
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_EDIT)),
    db: Session = Depends(get_db),
):
    """Create connector instance."""
    definition = db.query(ConnectorDefinition).filter_by(
        connector_definition_id=body.connector_definition_id,
    ).first()
    if not definition:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector definition not found",
        })

    instance = ConnectorInstance(
        organization_id=body.organization_id,
        connector_definition_id=body.connector_definition_id,
        name=body.name,
        config=body.config or {},
    )
    db.add(instance)
    db.commit()
    db.refresh(instance)

    return _serialize_instance(instance)


# =============================================================================
# Route 6: Get connector instance
# =============================================================================

@router.get("/api/connector-instances/{connector_instance_id}", response_model=ConnectorInstanceOut, summary="Get connector instance")
def get_connector_instance(
    connector_instance_id: str,
    organization_id: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get connector instance."""
    org_id = organization_id or (str(auth.active_organization_id) if auth.active_organization_id else None)

    if not org_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Organization context required",
        })

    instance = _get_instance_for_org(db, connector_instance_id, org_id)
    if not instance:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector instance not found",
        })

    return _serialize_instance(instance)


# =============================================================================
# Route 7: Update connector instance
# =============================================================================

@router.patch("/api/connector-instances/{connector_instance_id}", response_model=ConnectorInstanceOut, summary="Update connector instance")
@router.put("/api/connector-instances/{connector_instance_id}", response_model=ConnectorInstanceOut, summary="Update connector instance")
def update_connector_instance(
    connector_instance_id: str,
    body: UpdateConnectorInstanceBody,
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update connector instance."""
    org_id = (
        str(body.organization_id) if body.organization_id
        else (str(auth.active_organization_id) if auth.active_organization_id else None)
    )

    if not org_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Organization context required",
        })

    instance = _get_instance_for_org(db, connector_instance_id, org_id)
    if not instance:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector instance not found",
        })

    if body.name is not None:
        instance.name = body.name
    if body.config is not None:
        instance.config = merge_config_preserving_secrets(body.config, instance.config)

    db.commit()
    db.refresh(instance)

    return _serialize_instance(instance)


# =============================================================================
# Route 8: Delete connector instance
# =============================================================================

@router.delete("/api/connector-instances/{connector_instance_id}", status_code=204, summary="Delete connector instance")
def delete_connector_instance(
    connector_instance_id: str,
    organization_id: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete connector instance."""
    org_id = organization_id or (str(auth.active_organization_id) if auth.active_organization_id else None)

    if not org_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Organization context required",
        })

    instance = _get_instance_for_org(db, connector_instance_id, org_id)
    if not instance:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector instance not found",
        })

    db.delete(instance)
    db.commit()


# =============================================================================
# Route 9: List connector actions
# =============================================================================

@router.get("/api/connector-instances/{connector_instance_id}/actions", response_model=ConnectorActionsResponse, summary="List connector actions")
def list_connector_actions(
    connector_instance_id: str,
    organization_id: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """List connector actions."""
    org_id = organization_id or (str(auth.active_organization_id) if auth.active_organization_id else None)

    if not org_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Organization context required",
        })

    instance = _get_instance_for_org(db, connector_instance_id, org_id)
    if not instance:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector instance not found",
        })

    definition = instance.connector_definition
    if not definition:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector definition not found",
        })

    source_type = get_db_source_type(definition.key, definition.source_type)
    actions = get_available_actions(source_type)

    return {
        "connectorInstanceId": str(instance.connector_instance_id),
        "connectorType": definition.key,
        "sourceType": source_type,
        "actions": [action.to_dict() for action in actions],
    }


# =============================================================================
# Route 10: Execute connector action
# =============================================================================

@router.post("/api/connector-instances/{connector_instance_id}/actions/{action_name}", response_model=dict, summary="Execute connector action")
async def execute_connector_action(
    connector_instance_id: str,
    action_name: str,
    request: Request,
    organization_id: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """Execute connector action."""
    org_id = organization_id or (str(auth.active_organization_id) if auth.active_organization_id else None)

    if not org_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Organization context required",
        })

    instance = _get_instance_for_org(db, connector_instance_id, org_id)
    if not instance:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector instance not found",
        })

    definition = instance.connector_definition
    if not definition:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector definition not found",
        })

    source_type = get_db_source_type(definition.key, definition.source_type)

    # Get action parameters from request body
    try:
        params = await request.json()
    except Exception:
        params = {}

    config = _build_config_with_type(instance, source_type)

    logger.info(
        "Executing action '%s' for connector %s (type=%s, org=%s)",
        action_name, connector_instance_id, source_type, org_id,
    )

    result = execute_action(
        action_name=action_name,
        config=config,
        params=params,
        source_id=connector_instance_id,
        source_type=source_type,
    )

    if not result.success:
        error_code = result.error.code if result.error else DbErrorCode.UNKNOWN
        if error_code == DbErrorCode.UNSUPPORTED_FEATURE:
            return JSONResponse(status_code=400, content=result.to_dict())
        elif error_code == DbErrorCode.AUTH_FAILED:
            return JSONResponse(status_code=401, content=result.to_dict())
        elif error_code == DbErrorCode.PERMISSION_DENIED:
            return JSONResponse(status_code=403, content=result.to_dict())

    return result.to_dict()


# =============================================================================
# Route 11: Test connector instance
# =============================================================================

@router.post("/api/connector-instances/{connector_instance_id}/test", response_model=dict, summary="Test connector instance")
def test_connector_instance(
    connector_instance_id: str,
    organization_id: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """Test connector instance."""
    org_id = organization_id or (str(auth.active_organization_id) if auth.active_organization_id else None)

    if not org_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Organization context required",
        })

    instance = _get_instance_for_org(db, connector_instance_id, org_id)
    if not instance:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector instance not found",
        })

    definition = instance.connector_definition
    if not definition:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector definition not found",
        })

    source_type = _resolve_source_type(definition)
    if source_type is None:
        return JSONResponse(status_code=400, content={
            "ok": False,
            "latencyMs": 0,
            "server": {"vendor": definition.source_type or "unknown"},
            "capabilities": {},
            "error": {
                "code": DbErrorCode.UNSUPPORTED_FEATURE.value,
                "message": f"Connectivity testing not supported for connector type '{definition.key}'. Only database sources (postgres, mysql, sqlserver, oracle, mongodb) are supported.",
                "vendorCode": None,
                "retryable": False,
            },
        })

    config = _build_config_with_type(instance, source_type)

    logger.info(
        "Testing database connection for instance %s (type=%s, org=%s)",
        connector_instance_id, source_type, org_id,
    )

    result = test_database_connection(config)

    if result.ok:
        logger.info(
            "Connection test successful for %s: latency=%.2fms, version=%s",
            connector_instance_id, result.latency_ms, result.server.get("version", "unknown"),
        )
    else:
        logger.warning(
            "Connection test failed for %s: code=%s, message=%s",
            connector_instance_id,
            result.error.code if result.error else "unknown",
            result.error.message if result.error else "unknown",
        )

    return result.to_dict()


# =============================================================================
# Route 12: Test source config (ad-hoc, no instance)
# =============================================================================

@router.post("/api/sources/test", response_model=dict, summary="Test source config")
async def test_source_config(
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_EDIT)),
    db: Session = Depends(get_db),
):
    """Test source config."""
    config = await request.json()

    if not config:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Configuration required",
        })

    db_type = config.get("type")
    if not db_type:
        return JSONResponse(status_code=400, content={
            "ok": False,
            "latencyMs": 0,
            "server": {"vendor": "unknown"},
            "capabilities": {},
            "error": {
                "code": DbErrorCode.UNKNOWN.value,
                "message": "Database type is required. Specify 'type' as one of: postgres, mysql, sqlserver, oracle, mongodb",
                "vendorCode": None,
                "retryable": False,
            },
        })

    if db_type not in DB_SOURCE_TYPES:
        return JSONResponse(status_code=400, content={
            "ok": False,
            "latencyMs": 0,
            "server": {"vendor": db_type},
            "capabilities": {},
            "error": {
                "code": DbErrorCode.UNSUPPORTED_FEATURE.value,
                "message": f"Unsupported database type '{db_type}'. Supported: postgres, mysql, sqlserver, oracle, mongodb",
                "vendorCode": None,
                "retryable": False,
            },
        })

    logger.info("Testing database connection config (type=%s)", db_type)

    result = test_database_connection(config)

    if result.ok:
        logger.info(
            "Connection test successful: latency=%.2fms, version=%s",
            result.latency_ms, result.server.get("version", "unknown"),
        )
    else:
        logger.warning(
            "Connection test failed: code=%s, message=%s",
            result.error.code if result.error else "unknown",
            result.error.message if result.error else "unknown",
        )

    return result.to_dict()


# =============================================================================
# Route 13: Get connector catalog
# =============================================================================

@router.get("/api/connector-instances/{connector_instance_id}/catalog", summary="Get connector catalog")
def get_connector_catalog(
    connector_instance_id: str,
    organization_id: str | None = None,
    include_system: str = "false",
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get connector catalog."""
    org_id = organization_id or (str(auth.active_organization_id) if auth.active_organization_id else None)
    include_sys = include_system.lower() == "true"

    if not org_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Organization context required",
        })

    instance = _get_instance_for_org(db, connector_instance_id, org_id)
    if not instance:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector instance not found",
        })

    definition = instance.connector_definition
    if not definition:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector definition not found",
        })

    source_type = _resolve_source_type(definition)
    if source_type is None:
        return _unsupported_error(
            "Catalog discovery", definition.key, definition.source_type,
            {"sourceId": connector_instance_id, "vendor": definition.source_type or "unknown", "items": []},
        )

    config = _build_config_with_type(instance, source_type)

    logger.info(
        "Discovering catalog for instance %s (type=%s, org=%s, include_system=%s)",
        connector_instance_id, source_type, org_id, include_sys,
    )

    result = discover_catalog(config, connector_instance_id, include_sys)

    if result.error:
        logger.warning(
            "Catalog discovery failed for %s: code=%s, message=%s",
            connector_instance_id, result.error.code, result.error.message,
        )
    else:
        logger.info(
            "Catalog discovery successful for %s: %d items discovered",
            connector_instance_id, len(result.items),
        )

    response = JSONResponse(content=result.to_dict())
    response.headers["Cache-Control"] = "private, max-age=300"
    return response


# =============================================================================
# Route 14: Get source catalog (alias)
# =============================================================================

@router.get("/api/sources/{source_id}/catalog", summary="Get source catalog")
async def get_source_catalog(
    source_id: UUID,
    # UUID, not str: a connector instance id is a UUID, and typing it as str let
    # a malformed one reach a query that compares it against a uuid column,
    # producing DataError -> 500 for what is a client mistake. FastAPI now
    # rejects it with 422 before the handler runs. The module keeps strings
    # internally, hence str() at the delegate call.
    organization_id: str | None = None,
    include_system: str = "false",
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get source catalog."""
    return await get_connector_catalog(
        connector_instance_id=str(source_id),
        organization_id=organization_id,
        include_system=include_system,
        auth=auth,
        db=db,
    )


# =============================================================================
# Route 15: Test source instance (alias)
# =============================================================================

@router.post("/api/sources/{source_id}/test", response_model=dict, summary="Test source instance")
async def test_source_instance(
    source_id: UUID,
    # UUID, not str: a connector instance id is a UUID, and typing it as str let
    # a malformed one reach a query that compares it against a uuid column,
    # producing DataError -> 500 for what is a client mistake. FastAPI now
    # rejects it with 422 before the handler runs. The module keeps strings
    # internally, hence str() at the delegate call.
    organization_id: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """Test source instance."""
    return await test_connector_instance(
        connector_instance_id=str(source_id),
        organization_id=organization_id,
        auth=auth,
        db=db,
    )


# =============================================================================
# Route 16: Describe connector object
# =============================================================================

@router.get("/api/connector-instances/{connector_instance_id}/catalog/{object_id}", summary="Describe connector object route")
def describe_connector_object_route(
    connector_instance_id: str,
    object_id: str,
    organization_id: str | None = None,
    path: str = "",
    kind: str = "table",
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """Describe connector object route."""
    org_id = organization_id or (str(auth.active_organization_id) if auth.active_organization_id else None)

    if not org_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Organization context required",
        })

    if not path:
        return JSONResponse(status_code=400, content={
            "objectId": object_id,
            "error": {
                "code": DbErrorCode.UNKNOWN.value,
                "message": "Missing 'path' query parameter. Provide the dot-separated path to the object (e.g., 'mydb.public.users').",
                "vendorCode": None,
                "retryable": False,
            },
        })

    instance = _get_instance_for_org(db, connector_instance_id, org_id)
    if not instance:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector instance not found",
        })

    definition = instance.connector_definition
    if not definition:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector definition not found",
        })

    source_type = _resolve_source_type(definition)
    if source_type is None:
        return _unsupported_error(
            "Object description", definition.key, definition.source_type,
            {"objectId": object_id},
        )

    config = _build_config_with_type(instance, source_type)
    path_parts = path.split(".")

    logger.info(
        "Describing object for instance %s (type=%s, path=%s, kind=%s, org=%s)",
        connector_instance_id, source_type, path_parts, kind, org_id,
    )

    result = describe_object(config, connector_instance_id, path_parts, kind)

    if result.error:
        logger.warning(
            "Object description failed for %s: code=%s, message=%s",
            connector_instance_id, result.error.code, result.error.message,
        )
    else:
        if hasattr(result, "columns"):
            logger.info(
                "Object description successful for %s: %d columns",
                connector_instance_id, len(result.columns),
            )
        else:
            logger.info(
                "Object description successful for %s: %d fields",
                connector_instance_id, len(result.fields),
            )

    response = JSONResponse(content=result.to_dict())
    response.headers["Cache-Control"] = "private, max-age=300"
    return response


# =============================================================================
# Route 17: Describe source object (alias)
# =============================================================================

@router.get("/api/sources/{source_id}/catalog/{object_id}", summary="Describe source object")
async def describe_source_object(
    source_id: UUID,
    # UUID, not str: a connector instance id is a UUID, and typing it as str let
    # a malformed one reach a query that compares it against a uuid column,
    # producing DataError -> 500 for what is a client mistake. FastAPI now
    # rejects it with 422 before the handler runs. The module keeps strings
    # internally, hence str() at the delegate call.
    object_id: str,
    organization_id: str | None = None,
    path: str = "",
    kind: str = "table",
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """Describe source object."""
    # describe_connector_object_route is sync and returns a JSONResponse;
    # awaiting it raised TypeError on every call to this endpoint.
    return describe_connector_object_route(
        connector_instance_id=str(source_id),
        object_id=object_id,
        organization_id=organization_id,
        path=path,
        kind=kind,
        auth=auth,
        db=db,
    )


# =============================================================================
# Route 18: Preview connector data
# =============================================================================

@router.post("/api/connector-instances/{connector_instance_id}/preview", response_model=dict, summary="Preview connector data")
async def preview_connector_data(
    connector_instance_id: str,
    request: Request,
    organization_id: str | None = None,
    path: str = "",
    kind: str = "table",
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """Preview connector data."""
    org_id = organization_id or (str(auth.active_organization_id) if auth.active_organization_id else None)

    data = await request.json()
    if not data:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Request body required",
        })

    if not org_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Organization context required",
        })

    object_id = data.get("objectId", "")
    if not object_id:
        return JSONResponse(status_code=400, content={
            "error": {
                "code": DbErrorCode.UNKNOWN.value,
                "message": "Missing 'objectId' in request body.",
                "vendorCode": None,
                "retryable": False,
            },
        })

    if not path:
        return JSONResponse(status_code=400, content={
            "objectId": object_id,
            "error": {
                "code": DbErrorCode.UNKNOWN.value,
                "message": "Missing 'path' query parameter. Provide the dot-separated path to the object (e.g., 'mydb.public.users').",
                "vendorCode": None,
                "retryable": False,
            },
        })

    instance = _get_instance_for_org(db, connector_instance_id, org_id)
    if not instance:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector instance not found",
        })

    definition = instance.connector_definition
    if not definition:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Connector definition not found",
        })

    source_type = _resolve_source_type(definition)
    if source_type is None:
        return _unsupported_error(
            "Preview", definition.key, definition.source_type,
            {"objectId": object_id},
        )

    config = _build_config_with_type(instance, source_type)
    path_parts = path.split(".")

    preview_request = PreviewRequest.from_dict(data, path_parts, kind)

    # Get schema columns for validation (SQL databases only)
    schema_columns: list[str] = []
    if source_type != "mongodb":
        desc_result = describe_object(config, connector_instance_id, path_parts, kind)
        if not desc_result.error and hasattr(desc_result, "columns"):
            schema_columns = [col.name for col in desc_result.columns]

    logger.info(
        "Previewing data for instance %s (type=%s, path=%s, kind=%s, limit=%s, org=%s)",
        connector_instance_id, source_type, path_parts, kind, preview_request.limit, org_id,
    )

    max_bytes = MAX_RESPONSE_BYTES
    result = preview_data(config, preview_request, schema_columns, max_bytes)

    if result.error:
        logger.warning(
            "Preview failed for %s: code=%s, message=%s",
            connector_instance_id, result.error.code, result.error.message,
        )
    else:
        count = result.meta.get("rowCount", result.meta.get("docCount", 0))
        logger.info(
            "Preview successful for %s: %s rows/docs, truncated=%s",
            connector_instance_id, count, result.truncated,
        )

    return result.to_dict()


# =============================================================================
# Route 19: Preview source data (alias)
# =============================================================================

@router.post("/api/sources/{source_id}/preview", response_model=dict, summary="Preview source data")
async def preview_source_data(
    source_id: UUID,
    # UUID, not str: a connector instance id is a UUID, and typing it as str let
    # a malformed one reach a query that compares it against a uuid column,
    # producing DataError -> 500 for what is a client mistake. FastAPI now
    # rejects it with 422 before the handler runs. The module keeps strings
    # internally, hence str() at the delegate call.
    request: Request,
    organization_id: str | None = None,
    path: str = "",
    kind: str = "table",
    auth: AuthContext = Depends(require_permission(Permission.CONNECTORS_VIEW)),
    db: Session = Depends(get_db),
):
    """Preview source data."""
    return await preview_connector_data(
        connector_instance_id=str(source_id),
        request=request,
        organization_id=organization_id,
        path=path,
        kind=kind,
        auth=auth,
        db=db,
    )
