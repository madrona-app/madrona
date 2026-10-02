"""
Entities Current API endpoints (FastAPI).

Provides cursor-paginated querying and streaming export of canonical entities.
Migrated from app/api/entities_current.py.
"""

import ast
import base64
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission, get_authorized_org_id
from app.models import EntityCurrent, DatasetTransformer
from app.permissions import Permission
from app.services.api_security import sanitize_error_message
from app.fastapi_app.schemas.entities_current import EntityCurrentListResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["entities-current"])

# =============================================================================
# Transformer security infrastructure (ported verbatim — critical for safety)
# =============================================================================

_FORBIDDEN_AST_NODES = (
    ast.Import,
    ast.ImportFrom,
    ast.Global,
    ast.Nonlocal,
)

_FORBIDDEN_ATTRIBUTES = frozenset({
    '__import__', '__builtins__', '__globals__', '__code__',
    '__subclasses__', '__bases__', '__mro__', '__class__',
    '__getattr__', '__setattr__', '__delattr__',
    '__init_subclass__', '__set_name__',
})

_FORBIDDEN_CALLS = frozenset({
    'exec', 'eval', 'compile', '__import__',
    'getattr', 'setattr', 'delattr',
    'globals', 'locals', 'vars', 'dir',
    'open', 'input', 'breakpoint',
    'exit', 'quit',
})


def _validate_transformer_ast(code: str) -> None:
    """Validate transformer code via AST inspection before execution."""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise ValueError(f"Transformer code has syntax error: {e}")

    for node in ast.walk(tree):
        if isinstance(node, _FORBIDDEN_AST_NODES):
            raise ValueError(
                f"Transformer code must not contain {type(node).__name__} statements"
            )
        if isinstance(node, ast.Attribute) and node.attr in _FORBIDDEN_ATTRIBUTES:
            raise ValueError(
                f"Transformer code must not access '{node.attr}'"
            )
        if isinstance(node, ast.Call):
            func = node.func
            name = None
            if isinstance(func, ast.Name):
                name = func.id
            elif isinstance(func, ast.Attribute):
                name = func.attr
            if name and name in _FORBIDDEN_CALLS:
                raise ValueError(
                    f"Transformer code must not call '{name}()'"
                )


def compile_transformer(transformer_code: str):
    """Compile and return the transform function from AI-generated code."""
    _validate_transformer_ast(transformer_code)

    safe_namespace = {
        '__builtins__': {
            'len': len, 'str': str, 'int': int, 'float': float,
            'bool': bool, 'dict': dict, 'list': list, 'tuple': tuple,
            'set': set, 'range': range, 'enumerate': enumerate,
            'zip': zip, 'map': map, 'filter': filter, 'sorted': sorted,
            'sum': sum, 'min': min, 'max': max, 'any': any, 'all': all,
            'isinstance': isinstance, 'type': type,
            'None': None, 'True': True, 'False': False,
        }
    }

    exec(transformer_code, safe_namespace)  # noqa: S102 - validated by _validate_transformer_ast

    if 'transform' not in safe_namespace:
        raise ValueError("Transformer code must define a 'transform' function")

    return safe_namespace['transform']


# =============================================================================
# Cursor helpers
# =============================================================================

def encode_cursor(updated_at: datetime, entity_key: str) -> str:
    cursor_str = f"{updated_at.isoformat()}|{entity_key}"
    return base64.urlsafe_b64encode(cursor_str.encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        cursor_str = base64.urlsafe_b64decode(cursor.encode()).decode()
        updated_at_str, entity_key = cursor_str.split('|', 1)
        updated_at = datetime.fromisoformat(updated_at_str)
        return updated_at, entity_key
    except (ValueError, UnicodeDecodeError, TypeError) as e:
        raise ValueError(f"Invalid cursor format: {e}")


# =============================================================================
# Routes
# =============================================================================

@router.get("/api/entities-current", response_model=EntityCurrentListResponse, summary="Query entities")
def query_entities(
    request: Request,
    organization_id: str = Query(..., description="Organization UUID"),
    limit: int = Query(100, ge=1, le=1000),
    cursor: str | None = Query(None),
    dataset_id: list[str] = Query(None),
    pipeline_id: list[str] = Query(None),
    entity_type: list[str] = Query(None),
    updated_after: str | None = Query(None),
    updated_before: str | None = Query(None),
    include_deleted: bool = Query(False),
    auth: AuthContext = Depends(require_permission(Permission.DATA_QUERY)),
    db: Session = Depends(get_db),
):
    """Query canonical entities with cursor-based pagination and filtering."""
    org_id = get_authorized_org_id(request, auth, query_org_id=organization_id)
    query = db.query(EntityCurrent).filter_by(organization_id=org_id)

    if not include_deleted:
        query = query.filter(EntityCurrent.is_deleted == False)  # noqa: E712

    if cursor:
        try:
            cursor_updated_at, cursor_entity_key = decode_cursor(cursor)
            query = query.filter(
                or_(
                    EntityCurrent.updated_at < cursor_updated_at,
                    and_(
                        EntityCurrent.updated_at == cursor_updated_at,
                        EntityCurrent.entity_key < cursor_entity_key,
                    ),
                )
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=sanitize_error_message(e))

    if dataset_id:
        query = query.filter(EntityCurrent.dataset_id.in_(dataset_id))
    if pipeline_id:
        from app.models import Run
        query = query.filter(EntityCurrent.last_run_id.in_(
            db.query(Run.run_id).filter(Run.pipeline_id.in_(pipeline_id))
        ))
    if entity_type:
        query = query.filter(EntityCurrent.entity_type.in_(entity_type))

    if updated_after:
        try:
            dt = datetime.fromisoformat(updated_after.replace('Z', '+00:00'))
            query = query.filter(EntityCurrent.updated_at >= dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="updated_after must be ISO timestamp")

    if updated_before:
        try:
            dt = datetime.fromisoformat(updated_before.replace('Z', '+00:00'))
            query = query.filter(EntityCurrent.updated_at <= dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="updated_before must be ISO timestamp")

    query = query.order_by(EntityCurrent.updated_at.desc(), EntityCurrent.entity_key.desc())

    entities = query.limit(limit + 1).all()
    has_more = len(entities) > limit
    if has_more:
        entities = entities[:limit]

    data = []
    for entity in entities:
        data.append({
            'entity_key': entity.entity_key,
            'entity_type': entity.entity_type,
            'dataset_id': str(entity.dataset_id) if entity.dataset_id else None,
            'source_system': entity.source_system,
            'source_id': entity.source_id,
            'canonical_url': entity.canonical_url,
            'payload': entity.payload,
            'extracted_at': entity.extracted_at.isoformat(),
            'last_seen_at': entity.last_seen_at.isoformat(),
            'updated_at': entity.updated_at.isoformat(),
            'last_run_id': str(entity.last_run_id) if entity.last_run_id else None,
        })

    return {
        'items': data,
        'next_cursor': encode_cursor(entities[-1].updated_at, entities[-1].entity_key) if has_more else None,
    }


@router.get("/api/entities-current/export", summary="Export entities")
def export_entities(
    request: Request,
    organization_id: str = Query(..., description="Organization UUID"),
    format: str = Query("jsonl", alias="format"),
    dataset_id: list[str] = Query(None),
    entity_type: list[str] = Query(None),
    updated_after: str | None = Query(None),
    updated_before: str | None = Query(None),
    include_deleted: bool = Query(False),
    auth: AuthContext = Depends(require_permission(Permission.DATA_EXPORT)),
    db: Session = Depends(get_db),
):
    """Export canonical entities in JSONL, JSON, or transformed formats."""
    org_id = get_authorized_org_id(request, auth, query_org_id=organization_id)

    export_format = format.lower()
    valid_formats = ('json', 'jsonl', 'dublin-core', 'lido', 'schema-org', 'cdwa')
    if export_format not in valid_formats:
        raise HTTPException(status_code=400, detail=f'format must be one of: {", ".join(valid_formats)}')

    # Transformer formats
    is_transformer_format = export_format in ('dublin-core', 'lido', 'schema-org', 'cdwa')
    transform_func = None

    if is_transformer_format:
        if not dataset_id or len(dataset_id) != 1:
            raise HTTPException(
                status_code=400,
                detail=f'Transformer format {export_format} requires exactly one dataset_id',
            )
        transformer = db.execute(
            select(DatasetTransformer).where(
                DatasetTransformer.dataset_id == dataset_id[0],
                DatasetTransformer.target_format == export_format,
                DatasetTransformer.status == 'active',
            )
        ).scalar_one_or_none()
        if not transformer:
            raise HTTPException(
                status_code=404,
                detail=f"Active {export_format} transformer for dataset {dataset_id[0]} not found",
            )
        try:
            transform_func = compile_transformer(transformer.transformer_code)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Transformer compilation failed: {sanitize_error_message(e)}")

    # Build query
    query = db.query(EntityCurrent).filter_by(organization_id=org_id)
    if not include_deleted:
        query = query.filter(EntityCurrent.is_deleted == False)  # noqa: E712
    if dataset_id:
        query = query.filter(EntityCurrent.dataset_id.in_(dataset_id))
    if entity_type:
        query = query.filter(EntityCurrent.entity_type.in_(entity_type))
    if updated_after:
        try:
            dt = datetime.fromisoformat(updated_after.replace('Z', '+00:00'))
            query = query.filter(EntityCurrent.updated_at >= dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="updated_after must be ISO timestamp")
    if updated_before:
        try:
            dt = datetime.fromisoformat(updated_before.replace('Z', '+00:00'))
            query = query.filter(EntityCurrent.updated_at <= dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="updated_before must be ISO timestamp")

    query = query.order_by(EntityCurrent.updated_at.desc(), EntityCurrent.entity_key.desc())

    if export_format == 'json':
        count = query.count()
        if count > 10000:
            raise HTTPException(
                status_code=400,
                detail=f'JSON export limited to 10,000 records (found {count}). Use format=jsonl for large exports.',
            )

    def _serialize_entity(entity):
        return {
            'entity_key': entity.entity_key,
            'entity_type': entity.entity_type,
            'dataset_id': str(entity.dataset_id) if entity.dataset_id else None,
            'source_system': entity.source_system,
            'source_id': entity.source_id,
            'canonical_url': entity.canonical_url,
            'payload': entity.payload,
            'extracted_at': entity.extracted_at.isoformat(),
            'last_seen_at': entity.last_seen_at.isoformat(),
            'updated_at': entity.updated_at.isoformat(),
            'last_run_id': str(entity.last_run_id) if entity.last_run_id else None,
        }

    def generate_jsonl():
        for entity in query.yield_per(100):
            if transform_func:
                try:
                    payload = entity.payload
                    if isinstance(payload, str):
                        payload = json.loads(payload)
                    yield json.dumps(transform_func(payload)) + '\n'
                except Exception:
                    logger.error("Transform failed for entity %s", entity.entity_key, exc_info=True)
                    continue
            else:
                yield json.dumps(_serialize_entity(entity)) + '\n'

    def generate_json():
        yield '['
        first = True
        for entity in query.yield_per(100):
            if transform_func:
                try:
                    payload = entity.payload
                    if isinstance(payload, str):
                        payload = json.loads(payload)
                    record = transform_func(payload)
                except Exception:
                    logger.error("Transform failed for entity %s", entity.entity_key, exc_info=True)
                    continue
            else:
                record = _serialize_entity(entity)
            if not first:
                yield ','
            yield json.dumps(record)
            first = False
        yield ']'

    org_prefix = organization_id[:8]
    if export_format == 'jsonl':
        return StreamingResponse(
            generate_jsonl(),
            media_type='application/x-ndjson',
            headers={'Content-Disposition': f'attachment; filename="entities-export-{org_prefix}.jsonl"'},
        )
    else:
        return StreamingResponse(
            generate_json(),
            media_type='application/json',
            headers={'Content-Disposition': f'attachment; filename="entities-export-{org_prefix}.json"'},
        )
