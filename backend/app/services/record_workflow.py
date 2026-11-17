"""Record flags, completeness rules, and the record review workflow.

See app/models/record_workflow.py for the data model. Everything here is
organization-scoped; callers pass a session whose RLS context is the org.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Callable, Iterable
from uuid import UUID

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from app.models import (
    CollectionObject,
    CompletenessRule,
    ObjectFlag,
    ObjectSubject,
    OrganizationMembership,
    RecordFlagDefinition,
    User,
)
from app.models.core_org import ApprovalRequest, ApprovalRule

logger = logging.getLogger(__name__)


class WorkflowError(ValueError):
    """A request that breaks a workflow rule. ``status`` is the HTTP status to use."""

    def __init__(self, message: str, status: int = 422, code: str = "validation_error"):
        super().__init__(message)
        self.status = status
        self.code = code


# ═════════════════════════════════════════════════════════════════════════════
# Flags
# ═════════════════════════════════════════════════════════════════════════════

def slugify_key(text: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", (text or "").strip().lower()).strip("_")
    return key[:60]


def serialize_flag_definition(d: RecordFlagDefinition) -> dict:
    return {
        "flag_id": str(d.flag_id),
        "key": d.key,
        "label": d.label,
        "description": d.description,
        "sort_order": d.sort_order,
        "is_active": d.is_active,
        "is_rule_managed": d.is_rule_managed,
    }


def list_flag_definitions(db: Session, org_id: UUID, include_inactive: bool = True) -> list[RecordFlagDefinition]:
    q = db.query(RecordFlagDefinition).filter(RecordFlagDefinition.organization_id == org_id)
    if not include_inactive:
        q = q.filter(RecordFlagDefinition.is_active.is_(True))
    return q.order_by(RecordFlagDefinition.sort_order, RecordFlagDefinition.label).all()


def object_flags(db: Session, object_id: UUID) -> list[dict]:
    rows = (
        db.query(ObjectFlag)
        .join(RecordFlagDefinition, RecordFlagDefinition.flag_id == ObjectFlag.flag_id)
        .filter(ObjectFlag.object_id == object_id, RecordFlagDefinition.is_active.is_(True))
        .order_by(RecordFlagDefinition.sort_order, RecordFlagDefinition.label)
        .all()
    )
    return [
        {
            "flag_id": str(r.flag_id),
            "key": r.definition.key,
            "label": r.definition.label,
            "source": r.source,
            "note": r.note,
            "set_at": r.set_at.isoformat() if r.set_at else None,
            "set_by": str(r.set_by) if r.set_by else None,
        }
        for r in rows
    ]


def set_manual_flags(db: Session, org_id: UUID, obj: CollectionObject, flag_ids: Iterable[str], actor: UUID) -> None:
    """Replace the object's manually-set flags with ``flag_ids``.

    Rule-managed flags are owned by completeness rules and are rejected here,
    so a person cannot mark a record "complete" that does not meet the rule.
    """
    wanted: set[UUID] = set()
    for raw in flag_ids or []:
        try:
            wanted.add(UUID(str(raw)))
        except ValueError:
            raise WorkflowError(f"Unknown flag: {raw}")

    defs = {
        d.flag_id: d
        for d in db.query(RecordFlagDefinition).filter(
            RecordFlagDefinition.organization_id == org_id,
            RecordFlagDefinition.flag_id.in_(wanted) if wanted else False,
        )
    } if wanted else {}
    for fid in wanted:
        d = defs.get(fid)
        if d is None or not d.is_active:
            raise WorkflowError(f"Unknown or inactive flag: {fid}")
        if d.is_rule_managed:
            raise WorkflowError(f"“{d.label}” is set automatically by a completeness rule and cannot be set by hand")

    current = {
        f.flag_id: f
        for f in db.query(ObjectFlag).filter(ObjectFlag.object_id == obj.object_id, ObjectFlag.source == "manual")
    }
    for fid, row in current.items():
        if fid not in wanted:
            db.delete(row)
    for fid in wanted - set(current):
        db.add(ObjectFlag(object_id=obj.object_id, flag_id=fid, organization_id=org_id, source="manual", set_by=actor))


# ═════════════════════════════════════════════════════════════════════════════
# Completeness rules
# ═════════════════════════════════════════════════════════════════════════════

def _has_title(obj: CollectionObject, db: Session) -> bool:
    return any((t.title or "").strip() for t in (obj.title_links or []))


def _image_links(obj: CollectionObject):
    return [l for l in (obj.media_links or []) if l.media is not None and (l.media.media_type or "") == "image"]


def _all_images_have_alt(obj: CollectionObject, db: Session) -> bool:
    images = _image_links(obj)
    return bool(images) and all((l.media.alt_text or "").strip() for l in images)


def _has_subjects(obj: CollectionObject, db: Session) -> bool:
    return db.query(ObjectSubject.object_id).filter(ObjectSubject.object_id == obj.object_id).first() is not None


# Checks that are not a single column. Each supports "present" only.
COMPUTED_FIELDS: dict[str, tuple[str, Callable[[CollectionObject, Session], bool]]] = {
    "title": ("Title", _has_title),
    "creator": ("Creator or maker", lambda o, db: bool(o.constituent_xrefs)),
    "subjects": ("Subjects", _has_subjects),
    "measurements": ("Measurements", lambda o, db: bool(o.measurement_links)),
    "materials": ("Materials", lambda o, db: bool(o.material_links)),
    "media": ("At least one attached file", lambda o, db: bool(o.media_links)),
    "primary_image": ("Primary image", lambda o, db: any(l.is_primary for l in (o.media_links or []))),
    "images_alt_text": ("Alternative text on every image", _all_images_have_alt),
    "external_links": ("External links", lambda o, db: bool(o.external_links)),
}

# Columns a rule may not reference (internal or publication state).
_EXCLUDED_COLUMNS = {
    "object_id", "organization_id", "created_at", "created_by", "updated_at", "updated_by",
    "is_deleted", "deleted_at", "deleted_by", "is_discoverable", "discoverable_at", "discoverable_by",
    "extra_metadata", "search_vector",
}


def _column_fields() -> dict[str, str]:
    cols = {}
    for col in sa_inspect(CollectionObject).columns:
        if col.key in _EXCLUDED_COLUMNS:
            continue
        cols[col.key] = col.key.replace("_", " ").capitalize()
    return cols


def checkable_fields() -> list[dict]:
    """Fields a completeness rule can test, for the rule editor."""
    out = [{"field": k, "label": label, "checks": ["present"]} for k, (label, _) in COMPUTED_FIELDS.items()]
    out += [
        {"field": k, "label": label, "checks": ["present", "equals", "one_of"]}
        for k, label in sorted(_column_fields().items(), key=lambda kv: kv[1])
        if k not in COMPUTED_FIELDS
    ]
    return out


def validate_requirements(requirements: Any) -> list[dict]:
    if not isinstance(requirements, list) or not requirements:
        raise WorkflowError("A completeness rule needs at least one requirement")
    columns = _column_fields()
    cleaned = []
    for i, req in enumerate(requirements):
        if not isinstance(req, dict):
            raise WorkflowError(f"Requirement {i + 1} is not valid")
        field = req.get("field")
        check = req.get("check") or "present"
        if field in COMPUTED_FIELDS:
            if check != "present":
                raise WorkflowError(f"Requirement {i + 1}: {COMPUTED_FIELDS[field][0]} can only be checked as present")
            cleaned.append({"field": field, "check": "present"})
            continue
        if field not in columns:
            raise WorkflowError(f"Requirement {i + 1}: unknown field “{field}”")
        if check == "present":
            cleaned.append({"field": field, "check": "present"})
        elif check == "equals":
            if req.get("value") in (None, ""):
                raise WorkflowError(f"Requirement {i + 1}: a value is required")
            cleaned.append({"field": field, "check": "equals", "value": str(req["value"])})
        elif check == "one_of":
            values = req.get("value")
            if isinstance(values, str):
                values = [v.strip() for v in values.split(",")]
            if not isinstance(values, list) or not [v for v in values if str(v).strip()]:
                raise WorkflowError(f"Requirement {i + 1}: list at least one value")
            cleaned.append({"field": field, "check": "one_of", "value": [str(v).strip() for v in values if str(v).strip()]})
        else:
            raise WorkflowError(f"Requirement {i + 1}: unknown check “{check}”")
    return cleaned


def _field_label(field: str) -> str:
    if field in COMPUTED_FIELDS:
        return COMPUTED_FIELDS[field][0]
    return field.replace("_", " ").capitalize()


def _as_text(value: Any) -> str:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return format(value, "f")
    return str(value).strip()


def _is_present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict, tuple, set)):
        return len(value) > 0
    return True


def evaluate_rule(rule: CompletenessRule, obj: CollectionObject, db: Session) -> dict:
    """Return {met, missing: [human-readable reasons]} for one rule."""
    missing: list[str] = []
    for req in rule.requirements or []:
        field, check = req.get("field"), req.get("check", "present")
        label = _field_label(field)
        if field in COMPUTED_FIELDS:
            ok = COMPUTED_FIELDS[field][1](obj, db)
            if not ok:
                missing.append(f"{label} is missing")
            continue
        value = getattr(obj, field, None)
        if check == "present":
            if not _is_present(value):
                missing.append(f"{label} is missing")
        elif check == "equals":
            if not _is_present(value) or _as_text(value).lower() != str(req.get("value", "")).lower():
                missing.append(f"{label} must be “{req.get('value')}”")
        elif check == "one_of":
            allowed = [str(v).lower() for v in req.get("value") or []]
            if not _is_present(value) or _as_text(value).lower() not in allowed:
                missing.append(f"{label} must be one of: {', '.join(req.get('value') or [])}")
    return {"met": not missing, "missing": missing}


def active_rules(db: Session, org_id: UUID) -> list[CompletenessRule]:
    return (
        db.query(CompletenessRule)
        .filter(CompletenessRule.organization_id == org_id, CompletenessRule.is_active.is_(True))
        .order_by(CompletenessRule.name)
        .all()
    )


def evaluate_object(db: Session, org_id: UUID, obj: CollectionObject, rules: list[CompletenessRule] | None = None) -> list[dict]:
    rules = active_rules(db, org_id) if rules is None else rules
    out = []
    for rule in rules:
        result = evaluate_rule(rule, obj, db)
        out.append({
            "rule_id": str(rule.rule_id),
            "name": rule.name,
            "flag_label": rule.flag.label if rule.flag else None,
            "required_for_publication": rule.required_for_publication,
            **result,
        })
    return out


def sync_rule_flags(db: Session, org_id: UUID, obj: CollectionObject, rules: list[CompletenessRule] | None = None) -> list[dict]:
    """Set or clear each active rule's flag on ``obj`` to match the rule result.

    Does not commit. Returns the evaluation results.
    """
    rules = active_rules(db, org_id) if rules is None else rules
    results = evaluate_object(db, org_id, obj, rules)
    existing = {
        f.flag_id: f
        for f in db.query(ObjectFlag).filter(ObjectFlag.object_id == obj.object_id, ObjectFlag.source == "rule")
    }
    met_flags = {rule.flag_id for rule, res in zip(rules, results) if res["met"]}
    rule_flags = {rule.flag_id for rule in rules}
    for fid in rule_flags:
        if fid in met_flags and fid not in existing:
            # A manual row for the same flag would collide on the PK; the rule owns it.
            manual = db.get(ObjectFlag, (obj.object_id, fid))
            if manual is not None:
                manual.source = "rule"
            else:
                db.add(ObjectFlag(object_id=obj.object_id, flag_id=fid, organization_id=org_id, source="rule"))
        elif fid not in met_flags and fid in existing:
            db.delete(existing[fid])
    return results


def delete_flags_audited(db: Session, query, chunk_size: int = 1000) -> int:
    """Delete the ObjectFlag rows ``query`` selects, recording each removal on
    its object's history.

    Rows are loaded a chunk at a time, their removals written as audit events
    in one insert per chunk, then deleted with one statement per chunk, so an
    organization-wide cleanup stays fast while every object's history still
    shows the flag being removed and by whom. Returns the number deleted.
    """
    from sqlalchemy import tuple_
    from app.services.entity_audit_bulk import record_link_events

    total = 0
    while True:
        rows = query.order_by(ObjectFlag.object_id, ObjectFlag.flag_id).limit(chunk_size).all()
        if not rows:
            return total
        record_link_events(db, "ObjectFlag", "link_removed", [(r, None) for r in rows])
        keys = [(r.object_id, r.flag_id) for r in rows]
        db.query(ObjectFlag).filter(
            tuple_(ObjectFlag.object_id, ObjectFlag.flag_id).in_(keys)
        ).delete(synchronize_session=False)
        for r in rows:
            db.expunge(r)
        total += len(rows)


def recompute_org(db: Session, org_id: UUID, batch_size: int = 500) -> int:
    """Re-evaluate every active object in the org. Commits per batch."""
    rules = active_rules(db, org_id)
    # Clear flags of rules that are no longer active.
    active_flag_ids = {r.flag_id for r in rules}
    q = db.query(ObjectFlag).filter(ObjectFlag.organization_id == org_id, ObjectFlag.source == "rule")
    if active_flag_ids:
        q = q.filter(~ObjectFlag.flag_id.in_(active_flag_ids))
    delete_flags_audited(db, q)

    count = 0
    last_id = None
    while True:
        oq = db.query(CollectionObject).filter(
            CollectionObject.organization_id == org_id, CollectionObject.is_deleted.is_(False),
        )
        if last_id is not None:
            oq = oq.filter(CollectionObject.object_id > last_id)
        batch = oq.order_by(CollectionObject.object_id).limit(batch_size).all()
        if not batch:
            break
        for obj in batch:
            sync_rule_flags(db, org_id, obj, rules)
            count += 1
        last_id = batch[-1].object_id
        db.flush()
    return count


def publication_blockers(db: Session, org_id: UUID, obj: CollectionObject) -> list[str]:
    """Reasons ``obj`` may not be published, from rules required for publication."""
    rules = [r for r in active_rules(db, org_id) if r.required_for_publication]
    blockers = []
    for rule in rules:
        res = evaluate_rule(rule, obj, db)
        if not res["met"]:
            blockers.append(f"{rule.name}: " + "; ".join(res["missing"]))
    return blockers


def incomplete_for_publication_ids(db: Session, org_id: UUID, object_ids: Iterable[UUID]) -> set[UUID]:
    """Objects that fail a rule marked required for publication.

    Applied on every publish path (single, bulk, by criteria, workspace bulk
    action, schedules, imports), alongside the NAGPRA display gate.
    """
    rules = [r for r in active_rules(db, org_id) if r.required_for_publication]
    ids = list(object_ids)
    if not rules or not ids:
        return set()
    blocked = set()
    for obj in db.query(CollectionObject).filter(CollectionObject.object_id.in_(ids)):
        if any(not evaluate_rule(rule, obj, db)["met"] for rule in rules):
            blocked.add(obj.object_id)
    return blocked


# ═════════════════════════════════════════════════════════════════════════════
# Review workflow — built on the approval engine (app.services.approval_service)
# ═════════════════════════════════════════════════════════════════════════════
#
# A review is an ApprovalRequest for entity_type 'collection_object' under the
# organization's 'review' ApprovalRule, assigned to the chosen reviewer. So it
# appears in the existing Approvals queue, the assignee is notified by the
# engine, and the decision (who, when, note) is recorded on the request. The
# hook handle_review_decision(), called by approval_service.review_approval,
# moves the record's cataloguing status and notifies the cataloguer, whether
# the reviewer decides on the record page or on the Approvals page.

CATALOGING_STATUSES = ("not_started", "in_progress", "pending_review", "needs_research", "cataloged")
REVIEW_ENTITY = "collection_object"
REVIEW_ACTION = "review"
# Approval statuses -> the words the record page uses.
_REVIEW_STATUS = {"pending": "pending", "approved": "approved", "rejected": "changes_requested", "cancelled": "cancelled"}


def _user_label(db: Session, user_id: UUID | None) -> str | None:
    if not user_id:
        return None
    u = db.get(User, user_id)
    return (u.display_name or u.email) if u else None


def review_rule(db: Session, org_id: UUID) -> ApprovalRule:
    """The org's record-review rule, created on first use.

    approver_permission defaults to collections.edit; an administrator can
    narrow it (e.g. to a head-archivist role's permission) like any rule.
    """
    rule = db.query(ApprovalRule).filter(
        ApprovalRule.organization_id == org_id,
        ApprovalRule.entity_type == REVIEW_ENTITY,
        ApprovalRule.trigger_action == REVIEW_ACTION,
    ).first()
    if rule is None:
        rule = ApprovalRule(
            organization_id=org_id, entity_type=REVIEW_ENTITY, trigger_action=REVIEW_ACTION,
            approver_permission="collections.edit", is_active=True,
            description="Review of a catalogue record submitted for review (e.g. by an intern).",
        )
        db.add(rule)
        db.flush()
    return rule


def _review_requests(db: Session, object_id: UUID):
    return (
        db.query(ApprovalRequest)
        .join(ApprovalRule, ApprovalRule.rule_id == ApprovalRequest.rule_id)
        .filter(
            ApprovalRequest.entity_type == REVIEW_ENTITY,
            ApprovalRequest.entity_id == object_id,
            ApprovalRule.trigger_action == REVIEW_ACTION,
        )
    )


def object_reviews(db: Session, object_id: UUID) -> list[ApprovalRequest]:
    return _review_requests(db, object_id).order_by(ApprovalRequest.created_at.desc()).all()


def pending_review(db: Session, object_id: UUID) -> ApprovalRequest | None:
    return (
        _review_requests(db, object_id)
        .filter(ApprovalRequest.status == "pending")
        .order_by(ApprovalRequest.created_at.desc())
        .first()
    )


def get_review(db: Session, org_id: UUID, request_id: UUID) -> ApprovalRequest | None:
    r = db.query(ApprovalRequest).filter(
        ApprovalRequest.organization_id == org_id, ApprovalRequest.request_id == request_id,
        ApprovalRequest.entity_type == REVIEW_ENTITY,
    ).first()
    if r is not None and r.rule and r.rule.trigger_action == REVIEW_ACTION:
        return r
    return None


def serialize_review(db: Session, r: ApprovalRequest) -> dict:
    action = r.requested_action or {}
    return {
        "review_id": str(r.request_id),
        "object_id": str(r.entity_id),
        "status": _REVIEW_STATUS.get(r.status, r.status),
        "requested_by": str(r.requested_by) if r.requested_by else None,
        "requested_by_name": _user_label(db, r.requested_by),
        "requested_at": r.created_at.isoformat() if r.created_at else None,
        "request_note": action.get("note"),
        "reviewer_id": str(r.assigned_to_user_id) if r.assigned_to_user_id else None,
        "reviewer_name": _user_label(db, r.assigned_to_user_id),
        "decided_by": str(r.reviewed_by) if r.reviewed_by else None,
        "decided_by_name": _user_label(db, r.reviewed_by),
        "decided_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        "decision_note": r.review_note,
    }


def _is_active_member(db: Session, org_id: UUID, user_id: UUID) -> bool:
    return db.query(OrganizationMembership).filter(
        OrganizationMembership.organization_id == org_id,
        OrganizationMembership.user_id == user_id,
        OrganizationMembership.status == "active",
    ).first() is not None


def submit_for_review(
    db: Session, org_id: UUID, obj: CollectionObject, requested_by: UUID, reviewer_id: UUID, note: str | None,
) -> ApprovalRequest:
    """Set the record to "In review", assigned to ``reviewer_id``. Does not commit.

    The approval engine checks the reviewer holds the rule's permission and
    adds their notification to this transaction.
    """
    from app.services.approval_service import create_approval_request

    if reviewer_id == requested_by:
        raise WorkflowError("Choose someone other than yourself to review this record")
    if not _is_active_member(db, org_id, reviewer_id):
        raise WorkflowError("The reviewer must be a member of this organization")
    if pending_review(db, obj.object_id) is not None:
        raise WorkflowError(
            "This record is already in review. Cancel that review first to reassign it.",
            status=409, code="conflict",
        )
    try:
        request = create_approval_request(
            review_rule(db, org_id), REVIEW_ENTITY, obj.object_id, requested_by,
            {"action": REVIEW_ACTION, "note": (note or "").strip() or None, "object_number": obj.object_number},
            db, assigned_to_user_id=reviewer_id,
        )
    except ValueError as e:
        raise WorkflowError(str(e))
    # The server default is now(), the transaction start; set the real time
    # so reviews made in one transaction keep their order in the history.
    request.created_at = datetime.now(timezone.utc)
    # Point the engine's generic notification at the record by name.
    from app.models import Notification
    for n in db.new:
        if isinstance(n, Notification) and n.entity_id == obj.object_id and n.notification_type == "approval_assigned":
            requester = _user_label(db, requested_by) or "A colleague"
            n.title = f"{requester} asked you to review {object_label(obj)}"
            n.message = (note or "").strip() or None
    obj.cataloging_status = "pending_review"
    obj.updated_by = requested_by
    obj.updated_at = datetime.now(timezone.utc)
    return request


def decide_review(
    db: Session, org_id: UUID, review: ApprovalRequest, actor: UUID, decision: str, note: str | None, *, is_admin: bool,
) -> ApprovalRequest:
    """Approve, or request changes (an approval 'rejected'). Does not commit."""
    from app.services.approval_service import review_approval

    if review.status != "pending":
        raise WorkflowError("This review has already been decided", status=409, code="conflict")
    if decision not in ("approved", "changes_requested"):
        raise WorkflowError("Decision must be approved or changes_requested")
    if actor == review.requested_by:
        raise WorkflowError("You submitted this record for review, so someone else must decide it",
                            status=403, code="forbidden")
    if actor != review.assigned_to_user_id and not is_admin:
        raise WorkflowError("Only the assigned reviewer can decide this review", status=403, code="forbidden")
    if decision == "changes_requested" and not (note or "").strip():
        raise WorkflowError("Say what needs to change, so the cataloguer knows what to fix")
    # review_approval calls handle_review_decision, which updates the record.
    review_approval(review.request_id, actor, "approved" if decision == "approved" else "rejected",
                    (note or "").strip() or None, db)
    return review


def is_record_review(request: ApprovalRequest) -> bool:
    return request.entity_type == REVIEW_ENTITY and bool(request.rule) and request.rule.trigger_action == REVIEW_ACTION


def assert_can_decide_review(session: Session, request: ApprovalRequest, reviewer_id: UUID) -> None:
    """Raise ValueError unless ``reviewer_id`` may decide this record review.

    The person who submitted the record can never approve it; otherwise only
    the assigned reviewer, or an administrator (org.manage_settings), decides.
    No-op for other kinds of approval.
    """
    if not is_record_review(request):
        return
    if reviewer_id == request.requested_by:
        raise ValueError("You submitted this record for review, so someone else must decide it")
    if request.assigned_to_user_id and reviewer_id != request.assigned_to_user_id:
        from app.services.rbac_service import check_permission
        if not check_permission(reviewer_id, request.organization_id, "org.manage_settings", session=session):
            raise ValueError("Only the assigned reviewer or an administrator can decide this review")


def handle_review_decision(request_id, session: Session) -> bool:
    """Hook called by approval_service.review_approval for every decision.

    Updates the record's cataloguing status and notifies the cataloguer (in
    the same transaction). Returns True when the request was a record review.
    """
    from app.models import Notification

    request = session.query(ApprovalRequest).filter(ApprovalRequest.request_id == request_id).first()
    if request is None or request.entity_type != REVIEW_ENTITY or not request.rule \
            or request.rule.trigger_action != REVIEW_ACTION or request.status not in ("approved", "rejected"):
        return False
    obj = session.get(CollectionObject, request.entity_id)
    if obj is None:
        return True
    approved = request.status == "approved"
    obj.cataloging_status = "cataloged" if approved else "in_progress"
    obj.updated_by = request.reviewed_by
    obj.updated_at = datetime.now(timezone.utc)
    if request.requested_by and request.requested_by != request.reviewed_by:
        reviewer = _user_label(session, request.reviewed_by) or "The reviewer"
        session.add(Notification(
            organization_id=request.organization_id,
            user_id=request.requested_by,
            notification_type="review_approved" if approved else "review_changes_requested",
            title=(f"{reviewer} approved {object_label(obj)}" if approved
                   else f"{reviewer} asked for changes to {object_label(obj)}"),
            message=request.review_note,
            entity_type=REVIEW_ENTITY,
            entity_id=obj.object_id,
            actor_id=request.reviewed_by,
        ))
    return True


def cancel_review(db: Session, review: ApprovalRequest, actor: UUID, *, is_admin: bool) -> ApprovalRequest:
    if review.status != "pending":
        raise WorkflowError("Only a pending review can be cancelled", status=409, code="conflict")
    if actor not in (review.requested_by, review.assigned_to_user_id) and not is_admin:
        raise WorkflowError("Only the submitter, the reviewer or an administrator can cancel this review",
                            status=403, code="forbidden")
    review.status = "cancelled"
    review.reviewed_by = actor
    review.reviewed_at = datetime.now(timezone.utc)
    obj = db.get(CollectionObject, review.entity_id)
    if obj is not None and obj.cataloging_status == "pending_review":
        obj.cataloging_status = "in_progress"
    return review


def object_label(obj: CollectionObject) -> str:
    title = next((t.title for t in (obj.title_links or []) if t.is_preferred and t.title), None) \
        or next((t.title for t in (obj.title_links or []) if t.title), None) \
        or obj.object_name or "Untitled"
    return f"{obj.object_number}: {title}" if obj.object_number else title


__all__ = [
    "WorkflowError", "CATALOGING_STATUSES", "REVIEW_ENTITY", "REVIEW_ACTION", "review_rule",
    "object_reviews", "get_review", "handle_review_decision",
    "slugify_key", "serialize_flag_definition", "list_flag_definitions", "object_flags", "set_manual_flags",
    "checkable_fields", "validate_requirements", "evaluate_rule", "evaluate_object", "sync_rule_flags",
    "recompute_org", "publication_blockers", "incomplete_for_publication_ids", "active_rules",
    "serialize_review", "pending_review", "submit_for_review", "decide_review", "cancel_review",
    "object_label",
]
