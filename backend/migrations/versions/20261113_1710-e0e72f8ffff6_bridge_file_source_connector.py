"""bridge_file_source_connector

Revision ID: e0e72f8ffff6
Revises: d3c9f5a1e423
Create Date: 2026-11-13 17:00:00.000000

Data-only migration registering two Bridge connector definitions:

- ``file-upload`` (source, category ``file``): reads an uploaded .csv or
  .xlsx from org storage, one record per row
  (app.connectors.core.file_source:FileSourceConnector).
- ``madrona-collections`` (target): writes canonical records into
  Collections objects (app.connectors.core.collections_destination). The
  implementation existed but no definition was registered, so a pipeline
  could not target Collections.

connector_definitions is global (no organization_id). Inserts are
idempotent (ON CONFLICT (key) DO NOTHING). The values below are a frozen
copy of FILE_SOURCE_DEFINITION / COLLECTIONS_TARGET_DEFINITION in
app/connectors/core/file_source.py; tests/test_file_source.py checks they
match.

# MADRONA_MIGRATION_STRATEGY: owner
"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e0e72f8ffff6'
down_revision: Union[str, Sequence[str], None] = 'd3c9f5a1e423'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_MAPPING_VALUE_SCHEMA = {
    "anyOf": [
        {"type": "string"},
        {"type": "array", "items": {"type": "string"}},
        {
            "type": "object",
            "properties": {
                "columns": {"type": "array", "items": {"type": "string"}},
                "default": {"type": ["string", "null"]},
            },
            "additionalProperties": False,
        },
    ]
}

DEFINITIONS = [
    {
        "key": "file-upload",
        "display_name": "Spreadsheet file (CSV or Excel)",
        "direction": "source",
        "implementation_key": "app.connectors.core.file_source:FileSourceConnector",
        "source_type": "file",
        "version": "1.0.0",
        "category": "file",
        "capabilities": {"incremental": False, "full_refresh": True, "upload": True,
                         "formats": ["csv", "xlsx"]},
        "config_schema": {
            "type": "object",
            "properties": {
                "storage_key": {"type": "string", "minLength": 1},
                "filename": {"type": ["string", "null"]},
                "file_format": {"type": "string", "enum": ["csv", "xlsx"]},
                "sheet_name": {"type": ["string", "null"]},
                "header_row": {"type": ["integer", "null"], "minimum": 1},
                "id_column": {"type": ["string", "null"]},
                "record_type": {"type": "string", "enum": ["Object", "Work"]},
                "field_mapping": {"type": "object", "additionalProperties": _MAPPING_VALUE_SCHEMA},
                "mapping_rules": {"type": "array", "items": {"type": "object"}},
            },
            "required": ["storage_key"],
            "additionalProperties": False,
        },
        "default_config": {"record_type": "Object"},
    },
    {
        "key": "madrona-collections",
        "display_name": "Madrona Collections",
        "direction": "target",
        "implementation_key": "app.connectors.core.collections_destination:CollectionsTargetConnector",
        "source_type": "madrona",
        "version": "1.0.0",
        "category": "madrona",
        "capabilities": {"publish_objects": True, "publish_changes": False},
        "config_schema": {
            "type": "object",
            "properties": {"dry_run": {"type": "boolean"}},
            "additionalProperties": False,
        },
        "default_config": {},
    },
]


def upgrade() -> None:
    conn = op.get_bind()
    for d in DEFINITIONS:
        conn.execute(sa.text("""
            INSERT INTO flow.connector_definitions (
                connector_definition_id, key, display_name, direction,
                implementation_key, source_type, version, capabilities,
                config_schema, default_config, is_enabled, category,
                created_at, updated_at
            ) VALUES (
                gen_random_uuid(), :key, :display_name, :direction,
                :implementation_key, :source_type, :version,
                CAST(:capabilities AS jsonb), CAST(:config_schema AS jsonb),
                CAST(:default_config AS jsonb), true, :category, now(), now()
            )
            ON CONFLICT (key) DO NOTHING
        """), {
            **{k: d[k] for k in ("key", "display_name", "direction", "implementation_key",
                                 "source_type", "version", "category")},
            "capabilities": json.dumps(d["capabilities"]),
            "config_schema": json.dumps(d["config_schema"]),
            "default_config": json.dumps(d["default_config"]),
        })


def downgrade() -> None:
    # Remove only definitions nothing uses; an instance (and its runs) keeps
    # its definition rather than being deleted by a schema downgrade.
    conn = op.get_bind()
    conn.execute(sa.text("""
        DELETE FROM flow.connector_definitions d
        WHERE d.key = ANY(:keys)
          AND NOT EXISTS (
              SELECT 1 FROM flow.connector_instances i
              WHERE i.connector_definition_id = d.connector_definition_id
          )
    """), {"keys": [d["key"] for d in DEFINITIONS]})
