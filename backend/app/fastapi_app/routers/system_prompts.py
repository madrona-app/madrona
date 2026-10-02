"""
Platform admin API for managing Guide system prompts.

Routes:
  GET    /api/admin/system-prompts              - List all platform prompts
  GET    /api/admin/system-prompts/{prompt_id}  - Get single prompt
  POST   /api/admin/system-prompts              - Create platform default prompt
  PUT    /api/admin/system-prompts/{prompt_id}  - Update prompt content
  DELETE /api/admin/system-prompts/{prompt_id}  - Delete prompt (revert to hardcoded)
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_platform_admin
from app.fastapi_app.schemas.agent import (
    SystemPromptCreateBody,
    SystemPromptListResponse,
    SystemPromptOut,
    SystemPromptUpdateBody,
)
from app.models.agent import GuideSystemPrompt
from app.services.prompt_service import invalidate_cache

logger = logging.getLogger(__name__)

router = APIRouter(tags=["system-prompts"])

_BASE = "/api/admin/system-prompts"


def _serialize(row: GuideSystemPrompt) -> dict:
    return {
        "prompt_id": str(row.prompt_id),
        "organization_id": str(row.organization_id) if row.organization_id else None,
        "persona": row.persona,
        "content": row.content,
        "version": row.version,
        "created_at": row.created_at.isoformat() if row.created_at else "",
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
    }


@router.get(_BASE, response_model=SystemPromptListResponse, summary="List system prompts")
def list_system_prompts(
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """List all platform-level system prompts."""
    rows = (
        db.query(GuideSystemPrompt)
        .order_by(GuideSystemPrompt.persona)
        .all()
    )
    return {"prompts": [_serialize(r) for r in rows]}


@router.get(_BASE + "/{prompt_id}", response_model=SystemPromptOut, summary="Get system prompt")
def get_system_prompt(
    prompt_id: UUID,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Get a single system prompt."""
    row = db.query(GuideSystemPrompt).filter(
        GuideSystemPrompt.prompt_id == prompt_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Prompt not found"})
    return _serialize(row)


@router.post(_BASE, response_model=SystemPromptOut, status_code=201, summary="Create system prompt")
def create_system_prompt(
    body: SystemPromptCreateBody,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Create a platform default prompt for a persona."""
    existing = (
        db.query(GuideSystemPrompt)
        .filter(
            GuideSystemPrompt.organization_id.is_(None),
            GuideSystemPrompt.persona == body.persona,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail={"code": "conflict", "message": f"Prompt for persona '{body.persona}' already exists. Use PUT to update."},
        )

    row = GuideSystemPrompt(
        organization_id=None,
        persona=body.persona,
        content=body.content,
        version=1,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    invalidate_cache(persona=body.persona)
    return _serialize(row)


@router.put(_BASE + "/{prompt_id}", response_model=SystemPromptOut, summary="Update system prompt")
def update_system_prompt(
    prompt_id: UUID,
    body: SystemPromptUpdateBody,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Update a system prompt's content. Bumps the version number."""
    row = db.query(GuideSystemPrompt).filter(
        GuideSystemPrompt.prompt_id == prompt_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Prompt not found"})

    row.content = body.content
    row.version = row.version + 1
    db.commit()
    db.refresh(row)
    invalidate_cache(persona=row.persona)
    return _serialize(row)


@router.delete(_BASE + "/{prompt_id}", status_code=204, summary="Delete system prompt")
def delete_system_prompt(
    prompt_id: UUID,
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Delete a prompt (reverts to hardcoded default)."""
    row = db.query(GuideSystemPrompt).filter(
        GuideSystemPrompt.prompt_id == prompt_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Prompt not found"})

    persona = row.persona
    db.delete(row)
    db.commit()
    invalidate_cache(persona=persona)
