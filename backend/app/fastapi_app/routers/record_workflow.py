"""Record flags, completeness rules and the record review workflow (Collections).

Flags and completeness rules are defined by the organization's administrator.
The review workflow: a cataloguer (for example an intern) submits a record for
review to an assigned reviewer, who is notified; the reviewer approves it or
requests changes, and every review is kept as documentation on the record.
"""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, check_permission_for_session, require_permission
from app.models import (
    CollectionObject,
    CompletenessRule,
    ObjectFlag,
    OrganizationMembership,
    RecordFlagDefinition,
    User,
)
from app.permissions import Permission
from app.services import record_workflow as wf

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Collections: record workflow"])

_BASE = "/api/organizations/{organization_id}/collections"


def _err(e: wf.WorkflowError):
    raise HTTPException(status_code=e.status, detail={"code": e.code, "message": str(e)})


def _get_object(db: Session, org_id: UUID, object_id: UUID) -> CollectionObject:
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
        CollectionObject.is_deleted.is_(False),
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Object not found"})
    return obj


def _is_admin(db: Session, auth: AuthContext, org_id: UUID) -> bool:
    return check_permission_for_session(db, auth.user_id, org_id, Permission.ORG_MANAGE_SETTINGS)


# ═════════════════════════════════════════════════════════════════════════════
# Flag definitions (administrator)
# ═════════════════════════════════════════════════════════════════════════════

@router.get(_BASE + "/settings/record-flags", response_model=dict, summary="List record flag definitions")
def list_record_flags(
    organization_id: UUID,
    include_inactive: bool = True,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    items = wf.list_flag_definitions(db, organization_id, include_inactive=include_inactive)
    return {"items": [wf.serialize_flag_definition(d) for d in items], "total": len(items)}


def _apply_flag_fields(d: RecordFlagDefinition, data: dict) -> None:
    if "label" in data:
        label = (data.get("label") or "").strip()
        if not label:
            raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "A flag needs a name", "field": "label"})
        if len(label) > 120:
            raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Flag names are limited to 120 characters", "field": "label"})
        d.label = label
    if "description" in data:
        d.description = (data.get("description") or "").strip() or None
    if "sort_order" in data and data["sort_order"] is not None:
        d.sort_order = int(data["sort_order"])
    if "is_active" in data:
        d.is_active = bool(data["is_active"])


@router.post(_BASE + "/settings/record-flags", status_code=201, response_model=dict, summary="Create record flag")
def create_record_flag(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOOKUPS_MANAGE)),
    db: Session = Depends(get_db),
):
    label = (data.get("label") or "").strip()
    key = wf.slugify_key(data.get("key") or label)
    if not label or not key:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "A flag needs a name", "field": "label"})
    if db.query(RecordFlagDefinition).filter(
        RecordFlagDefinition.organization_id == organization_id, RecordFlagDefinition.key == key,
    ).first():
        raise HTTPException(status_code=409, detail={"code": "conflict", "message": f"A flag named “{label}” already exists", "field": "label"})
    count = db.query(RecordFlagDefinition).filter(RecordFlagDefinition.organization_id == organization_id).count()
    d = RecordFlagDefinition(organization_id=organization_id, key=key, label=label, sort_order=count, created_by=auth.user_id)
    _apply_flag_fields(d, {**data, "label": label})
    db.add(d)
    db.commit()
    return wf.serialize_flag_definition(d)


def _get_flag(db: Session, org_id: UUID, flag_id: UUID) -> RecordFlagDefinition:
    d = db.query(RecordFlagDefinition).filter(
        RecordFlagDefinition.organization_id == org_id, RecordFlagDefinition.flag_id == flag_id,
    ).first()
    if not d:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Flag not found"})
    return d


@router.put(_BASE + "/settings/record-flags/{flag_id}", response_model=dict, summary="Update record flag")
def update_record_flag(
    organization_id: UUID,
    flag_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.LOOKUPS_MANAGE)),
    db: Session = Depends(get_db),
):
    d = _get_flag(db, organization_id, flag_id)
    _apply_flag_fields(d, data)
    db.commit()
    return wf.serialize_flag_definition(d)


@router.delete(_BASE + "/settings/record-flags/{flag_id}", response_model=dict, summary="Delete record flag")
def delete_record_flag(
    organization_id: UUID,
    flag_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOOKUPS_MANAGE)),
    db: Session = Depends(get_db),
):
    d = _get_flag(db, organization_id, flag_id)
    if db.query(CompletenessRule.rule_id).filter(CompletenessRule.flag_id == flag_id).first():
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": "A completeness rule sets this flag. Delete or change the rule first, or deactivate the flag.",
        })
    in_use = db.query(ObjectFlag).filter(ObjectFlag.flag_id == flag_id).count()
    db.delete(d)
    db.commit()
    return {"deleted": True, "removed_from_records": in_use}


# ═════════════════════════════════════════════════════════════════════════════
# Flags on an object
# ═════════════════════════════════════════════════════════════════════════════

@router.get(_BASE + "/objects/{object_id}/flags", response_model=dict, summary="List an object's flags")
def get_object_flags(
    organization_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    _get_object(db, organization_id, object_id)
    return {"items": wf.object_flags(db, object_id)}


@router.put(_BASE + "/objects/{object_id}/flags", response_model=dict, summary="Set an object's flags")
def set_object_flags(
    organization_id: UUID,
    object_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    obj = _get_object(db, organization_id, object_id)
    try:
        wf.set_manual_flags(db, organization_id, obj, data.get("flag_ids") or [], auth.user_id)
    except wf.WorkflowError as e:
        db.rollback()
        _err(e)
    db.commit()
    return {"items": wf.object_flags(db, object_id)}


# ═════════════════════════════════════════════════════════════════════════════
# Completeness rules (administrator)
# ═════════════════════════════════════════════════════════════════════════════

def _serialize_rule(r: CompletenessRule) -> dict:
    return {
        "rule_id": str(r.rule_id),
        "name": r.name,
        "description": r.description,
        "requirements": r.requirements or [],
        "flag_id": str(r.flag_id),
        "flag_label": r.flag.label if r.flag else None,
        "required_for_publication": r.required_for_publication,
        "is_active": r.is_active,
    }


@router.get(_BASE + "/settings/completeness-rules", response_model=dict, summary="List completeness rules")
def list_completeness_rules(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    rules = db.query(CompletenessRule).filter(
        CompletenessRule.organization_id == organization_id,
    ).order_by(CompletenessRule.name).all()
    return {"items": [_serialize_rule(r) for r in rules], "fields": wf.checkable_fields()}


def _apply_rule(db: Session, org_id: UUID, rule: CompletenessRule, data: dict, actor: UUID) -> None:
    if "name" in data or rule.name is None:
        name = (data.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "A rule needs a name", "field": "name"})
        rule.name = name[:120]
    if "description" in data:
        rule.description = (data.get("description") or "").strip() or None
    if "requirements" in data or not rule.requirements:
        try:
            rule.requirements = wf.validate_requirements(data.get("requirements"))
        except wf.WorkflowError as e:
            raise HTTPException(status_code=422, detail={"code": "validation_error", "message": str(e), "field": "requirements"})
    if "required_for_publication" in data:
        rule.required_for_publication = bool(data["required_for_publication"])
    if "is_active" in data:
        rule.is_active = bool(data["is_active"])
    # The flag records that meet the rule receive. Created with the rule's name
    # unless an existing flag is chosen.
    if data.get("flag_id"):
        flag = _get_flag(db, org_id, UUID(str(data["flag_id"])))
    elif rule.flag_id is None:
        key = wf.slugify_key(rule.name)
        flag = db.query(RecordFlagDefinition).filter(
            RecordFlagDefinition.organization_id == org_id, RecordFlagDefinition.key == key,
        ).first()
        if flag is None:
            flag = RecordFlagDefinition(organization_id=org_id, key=key, label=rule.name[:120],
                                        description=f"Set automatically when a record meets the rule “{rule.name}”.",
                                        created_by=actor)
            db.add(flag)
            db.flush()
    else:
        flag = None
    if flag is not None:
        flag.is_rule_managed = True
        rule.flag_id = flag.flag_id


@router.post(_BASE + "/settings/completeness-rules", status_code=201, response_model=dict, summary="Create completeness rule")
def create_completeness_rule(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    rule = CompletenessRule(organization_id=organization_id, created_by=auth.user_id, requirements=[])
    rule.name = None
    _apply_rule(db, organization_id, rule, data, auth.user_id)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _serialize_rule(rule)


def _get_rule(db: Session, org_id: UUID, rule_id: UUID) -> CompletenessRule:
    rule = db.query(CompletenessRule).filter(
        CompletenessRule.organization_id == org_id, CompletenessRule.rule_id == rule_id,
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Rule not found"})
    return rule


@router.put(_BASE + "/settings/completeness-rules/{rule_id}", response_model=dict, summary="Update completeness rule")
def update_completeness_rule(
    organization_id: UUID,
    rule_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    rule = _get_rule(db, organization_id, rule_id)
    _apply_rule(db, organization_id, rule, data, auth.user_id)
    db.commit()
    db.refresh(rule)
    return _serialize_rule(rule)


@router.delete(_BASE + "/settings/completeness-rules/{rule_id}", response_model=dict, summary="Delete completeness rule")
def delete_completeness_rule(
    organization_id: UUID,
    rule_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    rule = _get_rule(db, organization_id, rule_id)
    flag_id = rule.flag_id
    db.query(ObjectFlag).filter(ObjectFlag.flag_id == flag_id, ObjectFlag.source == "rule").delete(synchronize_session=False)
    db.delete(rule)
    db.flush()
    # The flag is free for manual use again once no rule manages it.
    if not db.query(CompletenessRule.rule_id).filter(CompletenessRule.flag_id == flag_id).first():
        flag = db.get(RecordFlagDefinition, flag_id)
        if flag is not None:
            flag.is_rule_managed = False
    db.commit()
    return {"deleted": True}


@router.post(_BASE + "/settings/completeness-rules/recompute", response_model=dict, summary="Re-check every record against the completeness rules")
def recompute_completeness(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    count = wf.recompute_org(db, organization_id)
    db.commit()
    return {"records_checked": count}


@router.get(_BASE + "/objects/{object_id}/completeness", response_model=dict, summary="Check a record against the completeness rules")
def get_object_completeness(
    organization_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    obj = _get_object(db, organization_id, object_id)
    return {"items": wf.evaluate_object(db, organization_id, obj)}


# ═════════════════════════════════════════════════════════════════════════════
# Review workflow
# ═════════════════════════════════════════════════════════════════════════════

@router.get(_BASE + "/reviewers", response_model=dict, summary="People who can be assigned a review")
def list_reviewers(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    # Only people who can act on the review: the org's review rule decides.
    approver = wf.review_rule(db, organization_id).approver_permission
    db.commit()
    rows = (
        db.query(User)
        .join(OrganizationMembership, OrganizationMembership.user_id == User.user_id)
        .filter(OrganizationMembership.organization_id == organization_id, OrganizationMembership.status == "active")
        .all()
    )
    items = [
        {"user_id": str(u.user_id), "name": u.display_name or u.email}
        for u in rows
        if u.user_id != auth.user_id
        and check_permission_for_session(db, u.user_id, organization_id, approver)
    ]
    items.sort(key=lambda x: x["name"].lower())
    return {"items": items}


@router.get(_BASE + "/objects/{object_id}/reviews", response_model=dict, summary="Review history for a record")
def list_object_reviews(
    organization_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    obj = _get_object(db, organization_id, object_id)
    return {
        "cataloging_status": obj.cataloging_status,
        "items": [wf.serialize_review(db, r) for r in wf.object_reviews(db, object_id)],
        "can_decide_admin": _is_admin(db, auth, organization_id),
    }


@router.post(_BASE + "/objects/{object_id}/reviews", status_code=201, response_model=dict, summary="Submit a record for review")
def submit_object_for_review(
    organization_id: UUID,
    object_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Put the record "In review" with an assigned reviewer.

    Creates an approval request (it appears in the reviewer's Approvals
    queue) and notifies the reviewer.
    """
    obj = _get_object(db, organization_id, object_id)
    try:
        reviewer_id = UUID(str(data.get("reviewer_id")))
    except ValueError:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Choose a reviewer", "field": "reviewer_id"})
    try:
        review = wf.submit_for_review(db, organization_id, obj, auth.user_id, reviewer_id, data.get("note"))
    except wf.WorkflowError as e:
        db.rollback()
        _err(e)
    db.commit()
    return wf.serialize_review(db, review)


def _get_review(db: Session, org_id: UUID, review_id: UUID):
    r = wf.get_review(db, org_id, review_id)
    if not r:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Review not found"})
    return r


@router.post(_BASE + "/record-reviews/{review_id}/decision", response_model=dict, summary="Approve a record or request changes")
def decide_object_review(
    organization_id: UUID,
    review_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    review = _get_review(db, organization_id, review_id)
    try:
        wf.decide_review(db, organization_id, review, auth.user_id, data.get("decision"), data.get("note"),
                         is_admin=_is_admin(db, auth, organization_id))
    except wf.WorkflowError as e:
        db.rollback()
        _err(e)
    db.commit()
    return wf.serialize_review(db, review)


@router.post(_BASE + "/record-reviews/{review_id}/cancel", response_model=dict, summary="Cancel a pending review")
def cancel_object_review(
    organization_id: UUID,
    review_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    review = _get_review(db, organization_id, review_id)
    try:
        wf.cancel_review(db, review, auth.user_id, is_admin=_is_admin(db, auth, organization_id))
    except wf.WorkflowError as e:
        db.rollback()
        _err(e)
    db.commit()
    return wf.serialize_review(db, review)
