"""
Transformers, Field Access, and Projection Profiles API endpoints (FastAPI).

Batch F — 13 routes:
  - Transformers (6 routes): generate, list, get, update, activate, delete
  - Field Access (4 routes): list policies, get grants, upsert grants, delete grant
  - Projection Profiles (3 routes): get, update, delete

Migrated from app/api/transformers.py, app/api/field_access.py,
app/api/projection_profiles.py.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.fastapi_app.schemas.common import DeletedResponse
from app.fastapi_app.schemas.data_tools import (
    FieldGrantListResponse,
    FieldGrantUpsertResponse,
    FieldPolicyListResponse,
    ProjectionProfileResponse,
    TransformerActivateResponse,
    TransformerDetailOut,
    TransformerGeneratedOut,
    TransformerListResponse,
    TransformerUpdateResponse,
)
from app.models import Dataset, DatasetTransformer, EntityCurrent, Organization
from app.permissions import Permission
from app.services.field_access_service import (
    get_field_policies,
    get_role_field_grants,
    upsert_field_grants,
    delete_field_grant,
)
from app.schemas.projection_config import (
    get_default_projection_config,
    normalize_projection_config,
    validate_projection_config,
    ProjectionConfigValidationError,
)
from app.services.rls import set_rls_context_for_session

logger = logging.getLogger(__name__)

router = APIRouter(tags=["data-tools"])


# ============================================================================
# TRANSFORMER ENDPOINTS
# ============================================================================


@router.post("/api/datasets/{dataset_id}/transformers/generate", response_model=TransformerGeneratedOut, status_code=201, summary="Generate transformer")
def generate_transformer(
    dataset_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """Generate transformer code using AI."""
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    target_format = body.get("target_format")
    sample_count = body.get("sample_count", 3)

    if not target_format:
        raise HTTPException(status_code=400, detail="target_format is required")

    if target_format not in ["dublin-core", "lido", "schema-org", "cdwa"]:
        raise HTTPException(status_code=400, detail="Invalid target_format. Must be dublin-core, lido, schema-org, or cdwa")

    existing = db.execute(
        select(DatasetTransformer).where(
            DatasetTransformer.dataset_id == dataset_id,
            DatasetTransformer.target_format == target_format,
            DatasetTransformer.status == "active",
        )
    ).scalar_one_or_none()

    if existing:
        raise HTTPException(status_code=409, detail=f"Active {target_format} transformer already exists for this dataset")

    sample_entities = db.execute(
        select(EntityCurrent).where(EntityCurrent.dataset_id == dataset_id).limit(sample_count)
    ).scalars().all()

    if not sample_entities:
        raise HTTPException(status_code=400, detail="No entities found in dataset")

    sample_payloads = [entity.payload for entity in sample_entities]

    from app.services.ai_service import get_ai_service
    ai_service = get_ai_service()
    transformer_code, ai_provider = ai_service.generate_transformer(
        source_system=dataset.source_type or "unknown",
        target_format=target_format,
        sample_payloads=sample_payloads,
        entity_type=sample_entities[0].entity_type if sample_entities else "record",
    )

    transformer = DatasetTransformer(
        dataset_id=dataset_id,
        organization_id=dataset.organization_id,
        target_format=target_format,
        transformer_code=transformer_code,
        status="draft",
        ai_provider=ai_provider,
        sample_count=len(sample_payloads),
    )

    db.add(transformer)
    db.commit()
    db.refresh(transformer)

    return {
        "transformer_id": str(transformer.transformer_id),
        "dataset_id": str(transformer.dataset_id),
        "target_format": transformer.target_format,
        "status": transformer.status,
        "ai_provider": transformer.ai_provider,
        "sample_count": transformer.sample_count,
        "code_length": len(transformer.transformer_code),
        "generated_at": transformer.generated_at.isoformat(),
    }


@router.get("/api/datasets/{dataset_id}/transformers", response_model=TransformerListResponse, summary="List transformers")
def list_transformers(
    dataset_id: UUID,
    status: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """List all transformers for a dataset."""
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    query = select(DatasetTransformer).where(DatasetTransformer.dataset_id == dataset_id)
    if status:
        query = query.where(DatasetTransformer.status == status)
    query = query.order_by(DatasetTransformer.generated_at.desc())

    transformers = db.execute(query).scalars().all()

    return {
        "transformers": [
            {
                "transformer_id": str(t.transformer_id),
                "target_format": t.target_format,
                "status": t.status,
                "ai_provider": t.ai_provider,
                "sample_count": t.sample_count,
                "code_length": len(t.transformer_code),
                "generated_at": t.generated_at.isoformat(),
                "activated_at": t.activated_at.isoformat() if t.activated_at else None,
            }
            for t in transformers
        ]
    }


@router.get("/api/datasets/{dataset_id}/transformers/{target_format}", response_model=TransformerDetailOut, summary="Get transformer")
def get_transformer(
    dataset_id: UUID,
    target_format: str,
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get active transformer code for a specific format."""
    transformer = db.execute(
        select(DatasetTransformer).where(
            DatasetTransformer.dataset_id == dataset_id,
            DatasetTransformer.target_format == target_format,
            DatasetTransformer.status == "active",
        )
    ).scalar_one_or_none()

    if not transformer:
        raise HTTPException(status_code=404, detail="Active transformer not found")

    return {
        "transformer_id": str(transformer.transformer_id),
        "dataset_id": str(transformer.dataset_id),
        "target_format": transformer.target_format,
        "status": transformer.status,
        "ai_provider": transformer.ai_provider,
        "transformer_code": transformer.transformer_code,
        "generated_at": transformer.generated_at.isoformat(),
        "activated_at": transformer.activated_at.isoformat() if transformer.activated_at else None,
    }


@router.put("/api/datasets/transformers/{transformer_id}", response_model=TransformerUpdateResponse, summary="Update transformer")
def update_transformer(
    transformer_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """Update transformer code (manual edits)."""
    transformer = db.get(DatasetTransformer, transformer_id)
    if not transformer:
        raise HTTPException(status_code=404, detail="Transformer not found")

    new_code = body.get("transformer_code")
    if not new_code:
        raise HTTPException(status_code=400, detail="transformer_code is required")

    transformer.transformer_code = new_code
    db.commit()

    return {"transformer_id": str(transformer.transformer_id), "updated": True}


@router.post("/api/datasets/transformers/{transformer_id}/activate", response_model=TransformerActivateResponse, summary="Activate transformer")
def activate_transformer(
    transformer_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """Activate a transformer."""
    transformer = db.get(DatasetTransformer, transformer_id)
    if not transformer:
        raise HTTPException(status_code=404, detail="Transformer not found")

    if transformer.status == "active":
        raise HTTPException(status_code=400, detail="Transformer is already active")

    for existing in db.execute(
        select(DatasetTransformer).where(
            DatasetTransformer.dataset_id == transformer.dataset_id,
            DatasetTransformer.target_format == transformer.target_format,
            DatasetTransformer.status == "active",
        )
    ).scalars():
        existing.status = "archived"

    transformer.status = "active"
    transformer.activated_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "transformer_id": str(transformer.transformer_id),
        "status": "active",
        "activated_at": transformer.activated_at.isoformat(),
    }


@router.delete("/api/datasets/transformers/{transformer_id}", response_model=DeletedResponse, summary="Delete transformer")
def delete_transformer(
    transformer_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """Delete a transformer."""
    transformer = db.get(DatasetTransformer, transformer_id)
    if not transformer:
        raise HTTPException(status_code=404, detail="Transformer not found")

    if transformer.status == "active":
        raise HTTPException(status_code=400, detail="Cannot delete active transformer. Archive it first.")

    db.delete(transformer)
    db.commit()

    return {"deleted": True}


# ============================================================================
# FIELD ACCESS ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/field-access/policies", response_model=FieldPolicyListResponse, summary="List field policies")
def list_field_policies(
    org_id: str,
    app_key: str = Query("collections"),
    entity_type: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """List all field access policies."""
    set_rls_context_for_session(db, org_id)
    policies = get_field_policies(db, app_key=app_key, entity_type=entity_type)
    return {"policies": policies}


@router.get("/api/organizations/{org_id}/field-access/grants/{role_id}", response_model=FieldGrantListResponse, summary="Get grants for role")
def get_grants_for_role(
    org_id: str,
    role_id: str,
    app_key: str = Query("collections"),
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Get field access grants for a specific role."""
    set_rls_context_for_session(db, org_id)
    grants = get_role_field_grants(db, UUID(org_id), UUID(role_id), app_key=app_key)
    return {"grants": grants}


@router.put("/api/organizations/{org_id}/field-access/grants/{role_id}", response_model=FieldGrantUpsertResponse, summary="Bulk upsert grants")
def bulk_upsert_grants(
    org_id: str,
    role_id: str,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Bulk upsert field access grants for a role."""
    set_rls_context_for_session(db, org_id)

    if not body or "grants" not in body:
        raise HTTPException(status_code=400, detail="Missing grants array")

    grants = body["grants"]
    if not isinstance(grants, list):
        raise HTTPException(status_code=400, detail="grants must be an array")

    results = upsert_field_grants(
        db, UUID(org_id), UUID(role_id), grants, granted_by=auth.user_id,
    )

    return {
        "grants": results,
        "message": f"Updated {len(results)} field access grant(s)",
    }


@router.delete("/api/organizations/{org_id}/field-access/grants/{role_id}/{policy_id}", summary="Remove grant")
def remove_grant(
    org_id: str,
    role_id: str,
    policy_id: str,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Remove a single field access grant."""
    set_rls_context_for_session(db, org_id)
    deleted = delete_field_grant(db, UUID(org_id), UUID(role_id), UUID(policy_id))
    if not deleted:
        raise HTTPException(status_code=404, detail="Grant not found")

    return JSONResponse(status_code=204, content=None)


# ============================================================================
# PROJECTION PROFILES ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/projection-profiles", response_model=ProjectionProfileResponse, summary="Get projection profiles")
def get_projection_profiles(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get the projection configuration for an organization."""
    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    stored_config = org.display_projections
    effective_config = normalize_projection_config(stored_config, org_id=str(org_id))
    is_default = stored_config is None

    return {
        "organization_id": str(org_id),
        "config": effective_config,
        "is_default": is_default,
        "defaults": get_default_projection_config(),
    }


@router.put("/api/organizations/{org_id}/projection-profiles", response_model=ProjectionProfileResponse, summary="Update projection profiles")
def update_projection_profiles(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Update the projection configuration for an organization."""
    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if not body:
        raise HTTPException(status_code=400, detail="Request body is required")

    try:
        validated_config = validate_projection_config(body)
    except ProjectionConfigValidationError as e:
        raise HTTPException(status_code=400, detail=e.to_dict())

    org.display_projections = validated_config
    db.commit()
    db.refresh(org)

    return {
        "organization_id": str(org_id),
        "config": validated_config,
        "is_default": False,
        "message": "Projection configuration updated successfully",
    }


@router.delete("/api/organizations/{org_id}/projection-profiles", response_model=ProjectionProfileResponse, summary="Delete projection profiles")
def delete_projection_profiles(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Reset the projection configuration to system defaults."""
    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    had_custom_config = org.display_projections is not None
    org.display_projections = None
    db.commit()

    return {
        "organization_id": str(org_id),
        "config": get_default_projection_config(),
        "is_default": True,
        "message": "Projection configuration reset to defaults" if had_custom_config else "Already using defaults",
    }
