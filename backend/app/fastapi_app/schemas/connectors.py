"""Pydantic request/response models for connector endpoints."""

from __future__ import annotations

from typing import Any

from uuid import UUID

from pydantic import BaseModel


# =============================================================================
# Request models
# =============================================================================


class CreateConnectorInstanceBody(BaseModel):
    organization_id: UUID
    connector_definition_id: UUID
    name: str
    config: dict | None = None


class UpdateConnectorInstanceBody(BaseModel):
    organization_id: UUID | None = None
    name: str | None = None
    config: dict | None = None
    status: str | None = None


class TestSourceBody(BaseModel):
    type: str
    # Allow arbitrary additional config keys (host, port, etc.)
    model_config = {"extra": "allow"}


class ExecuteActionBody(BaseModel):
    parameters: dict | None = None


# =============================================================================
# Response models
# =============================================================================


class ConnectorDefinitionOut(BaseModel):
    connector_definition_id: str
    key: str
    display_name: str
    direction: str | None = None
    implementation_key: str | None = None
    source_type: str | None = None
    version: str | None = None
    category: str | None = None
    config_schema: Any = None
    created_at: str


class ExtractionSchemaResponse(BaseModel):
    definitionKey: str
    extractionSchema: Any = None
    objectSchema: Any = None
    columnMappingSchema: Any = None
    message: str | None = None


class ExtractionSchemaItem(BaseModel):
    definitionKey: str
    displayName: str
    direction: str | None = None
    sourceType: str | None = None
    extractionSchema: Any = None
    objectSchema: Any = None
    columnMappingSchema: Any = None


class ExtractionSchemaListResponse(BaseModel):
    schemas: list[ExtractionSchemaItem]


class ConnectorInstanceOut(BaseModel):
    connector_instance_id: str
    organization_id: str
    connector_definition_id: str
    name: str
    status: str | None = None
    config: Any = None
    direction: str | None = None
    definition_key: str | None = None
    created_at: str


class ConnectorActionsResponse(BaseModel):
    connectorInstanceId: str
    connectorType: str
    sourceType: str | None = None
    actions: list[Any]


class ConnectorActionResultResponse(BaseModel):
    success: bool | None = None
    data: Any = None
    error: Any = None


class ConnectorTestResponse(BaseModel):
    ok: bool
    latencyMs: float | None = None
    server: Any = None
    capabilities: Any = None
    error: Any = None
