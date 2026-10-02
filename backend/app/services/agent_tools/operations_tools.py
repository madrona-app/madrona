"""
Operational intelligence tools for the agent.

Cross-record queries, compliance summaries, object context with related
procedures, and document readiness checks. All read-only.
"""

import logging
from datetime import datetime, timezone
from uuid import UUID as _UUID

from app.services.agent_tools import AgentContext, ToolRegistry

logger = logging.getLogger(__name__)


# ── Tool 1: Cross-record procedure query ─────────────────────────────────


def query_procedures(args: dict, ctx: AgentContext) -> dict:
    """Query across procedure types with status, date, and text filters."""
    from app.models.procedures import (
        LoanIn, LoanOut, Acquisition, ObjectEntry, ObjectExit,
    )

    db = ctx.db_session
    org_id = ctx.organization_id

    procedure_type = args.get("procedure_type", "").strip().lower()
    status_filter = args.get("status", "").strip().lower()
    date_from = args.get("date_from", "").strip()
    date_to = args.get("date_to", "").strip()
    search_text = args.get("search", "").strip().lower()
    limit = min(int(args.get("limit", 20)), 50)

    PROCEDURES = {
        "loan_in": {
            "model": LoanIn,
            "id_field": "loan_in_id",
            "number_field": "loan_number",
            "label": "Loan In",
            "date_field": "created_at",
            "search_fields": ["loan_number", "lender_name", "purpose"],
        },
        "loan_out": {
            "model": LoanOut,
            "id_field": "loan_out_id",
            "number_field": "loan_number",
            "label": "Loan Out",
            "date_field": "created_at",
            "search_fields": ["loan_number", "borrower_name", "purpose"],
        },
        "acquisition": {
            "model": Acquisition,
            "id_field": "acquisition_id",
            "number_field": "acquisition_number",
            "label": "Acquisition",
            "date_field": "created_at",
            "search_fields": ["acquisition_number", "source_name"],
        },
        "object_entry": {
            "model": ObjectEntry,
            "id_field": "entry_id",
            "number_field": "entry_number",
            "label": "Object Entry",
            "date_field": "created_at",
            "search_fields": ["entry_number", "depositor_name"],
        },
        "object_exit": {
            "model": ObjectExit,
            "id_field": "exit_id",
            "number_field": "exit_number",
            "label": "Object Exit",
            "date_field": "created_at",
            "search_fields": ["exit_number"],
        },
    }

    # Which procedure types to query
    if procedure_type and procedure_type in PROCEDURES:
        types_to_query = {procedure_type: PROCEDURES[procedure_type]}
    elif procedure_type:
        return {"error": f"Unknown procedure_type: {procedure_type}. Options: {', '.join(PROCEDURES.keys())}"}
    else:
        types_to_query = PROCEDURES

    all_results = []

    for ptype, config in types_to_query.items():
        model = config["model"]
        query = db.query(model).filter(model.organization_id == org_id)

        # Status filter
        if status_filter:
            if hasattr(model, "status"):
                query = query.filter(model.status == status_filter)

        # Date range filter
        date_col = getattr(model, config["date_field"], None)
        if date_from and date_col is not None:
            try:
                df = datetime.fromisoformat(date_from)
                query = query.filter(date_col >= df)
            except ValueError:
                pass
        if date_to and date_col is not None:
            try:
                dt = datetime.fromisoformat(date_to)
                query = query.filter(date_col <= dt)
            except ValueError:
                pass

        # Text search across searchable fields
        if search_text:
            from sqlalchemy import or_, cast, String
            conditions = []
            for field_name in config["search_fields"]:
                col = getattr(model, field_name, None)
                if col is not None:
                    conditions.append(cast(col, String).ilike(f"%{search_text}%"))
            if conditions:
                query = query.filter(or_(*conditions))

        records = query.order_by(date_col.desc() if date_col is not None else model.created_at.desc()).limit(limit).all()

        for rec in records:
            item = {
                "procedure_type": ptype,
                "label": config["label"],
                "id": str(getattr(rec, config["id_field"])),
                "number": getattr(rec, config["number_field"], None),
                "status": getattr(rec, "status", None),
                "created_at": rec.created_at.isoformat() if rec.created_at else None,
            }

            # Type-specific fields
            if ptype in ("loan_in", "loan_out"):
                item["start_date"] = rec.loan_start_date.isoformat() if rec.loan_start_date else None
                item["end_date"] = rec.loan_end_date.isoformat() if rec.loan_end_date else None
                if ptype == "loan_in":
                    item["lender"] = rec.lender_name
                else:
                    item["borrower"] = rec.borrower_name
            elif ptype == "acquisition":
                item["source"] = getattr(rec, "source_name", None)
                item["method"] = getattr(rec, "acquisition_method", None)
            elif ptype == "object_entry":
                item["depositor"] = getattr(rec, "depositor_name", None)
                item["reason"] = getattr(rec, "entry_reason", None)
            elif ptype == "object_exit":
                item["reason"] = getattr(rec, "exit_reason", None)

            all_results.append(item)

    # Sort all results by created_at descending
    all_results.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    all_results = all_results[:limit]

    return {
        "results": all_results,
        "count": len(all_results),
        "filters_applied": {
            "procedure_type": procedure_type or "all",
            "status": status_filter or "any",
            "date_from": date_from or None,
            "date_to": date_to or None,
            "search": search_text or None,
        },
    }


# ── Tool 2: Operations dashboard ─────────────────────────────────────────


def operations_dashboard(args: dict, ctx: AgentContext) -> dict:
    """Broad operational summary across all active procedures."""
    from app.models.procedures import (
        LoanIn, LoanOut, Acquisition, ObjectEntry, ObjectExit,
    )
    from app.models.exhibit import Exhibition

    db = ctx.db_session
    org_id = ctx.organization_id
    now = datetime.now(timezone.utc).date()

    dashboard = {}

    # Active loans in
    active_loans_in = (
        db.query(LoanIn.loan_in_id, LoanIn.loan_number, LoanIn.status,
                 LoanIn.loan_end_date, LoanIn.lender_name)
        .filter(
            LoanIn.organization_id == org_id,
            LoanIn.status.notin_(["returned", "closed", "cancelled"]),
        )
        .order_by(LoanIn.loan_end_date.asc().nullslast())
        .limit(15)
        .all()
    )
    dashboard["active_loans_in"] = [
        {
            "number": l.loan_number, "status": l.status,
            "lender": l.lender_name,
            "end_date": l.loan_end_date.isoformat() if l.loan_end_date else None,
            "overdue": l.loan_end_date < now if l.loan_end_date else False,
        }
        for l in active_loans_in
    ]

    # Active loans out
    active_loans_out = (
        db.query(LoanOut.loan_out_id, LoanOut.loan_number, LoanOut.status,
                 LoanOut.loan_end_date, LoanOut.borrower_name)
        .filter(
            LoanOut.organization_id == org_id,
            LoanOut.status.notin_(["returned", "closed", "cancelled"]),
        )
        .order_by(LoanOut.loan_end_date.asc().nullslast())
        .limit(15)
        .all()
    )
    dashboard["active_loans_out"] = [
        {
            "number": l.loan_number, "status": l.status,
            "borrower": l.borrower_name,
            "end_date": l.loan_end_date.isoformat() if l.loan_end_date else None,
            "overdue": l.loan_end_date < now if l.loan_end_date else False,
        }
        for l in active_loans_out
    ]

    # Pending object entries (not yet resolved)
    pending_entries = (
        db.query(ObjectEntry.entry_id, ObjectEntry.entry_number,
                 ObjectEntry.status, ObjectEntry.depositor_name)
        .filter(
            ObjectEntry.organization_id == org_id,
            ObjectEntry.status.notin_(["completed", "cancelled"]),
        )
        .order_by(ObjectEntry.created_at.desc())
        .limit(10)
        .all()
    )
    dashboard["pending_entries"] = [
        {
            "number": e.entry_number, "status": e.status,
            "depositor": e.depositor_name,
        }
        for e in pending_entries
    ]

    # In-progress acquisitions
    in_progress_acquisitions = (
        db.query(Acquisition.acquisition_id, Acquisition.acquisition_number,
                 Acquisition.status, Acquisition.source_name)
        .filter(
            Acquisition.organization_id == org_id,
            Acquisition.status.notin_(["completed", "cancelled"]),
        )
        .order_by(Acquisition.created_at.desc())
        .limit(10)
        .all()
    )
    dashboard["in_progress_acquisitions"] = [
        {
            "number": a.acquisition_number, "status": a.status,
            "source": a.source_name,
        }
        for a in in_progress_acquisitions
    ]

    # Open exhibitions
    open_exhibitions = (
        db.query(Exhibition.exhibition_id, Exhibition.title,
                 Exhibition.status, Exhibition.planned_end_date)
        .filter(
            Exhibition.organization_id == org_id,
            Exhibition.status.in_(["authorized", "in_preparation", "open"]),
        )
        .order_by(Exhibition.planned_end_date.asc().nullslast())
        .limit(10)
        .all()
    )
    dashboard["exhibitions"] = [
        {
            "title": e.title, "status": e.status,
            "end_date": e.planned_end_date.isoformat() if e.planned_end_date else None,
        }
        for e in open_exhibitions
    ]

    # Summary counts
    dashboard["summary"] = {
        "active_loans_in": len(dashboard["active_loans_in"]),
        "overdue_loans_in": sum(1 for l in dashboard["active_loans_in"] if l["overdue"]),
        "active_loans_out": len(dashboard["active_loans_out"]),
        "overdue_loans_out": sum(1 for l in dashboard["active_loans_out"] if l["overdue"]),
        "pending_entries": len(dashboard["pending_entries"]),
        "in_progress_acquisitions": len(dashboard["in_progress_acquisitions"]),
        "open_exhibitions": len(dashboard["exhibitions"]),
    }

    return dashboard


# ── Tool 3: Object full context ──────────────────────────────────────────


def get_object_context(args: dict, ctx: AgentContext) -> dict:
    """Get an object's full operational context — related procedures, loans, exhibitions, movements."""
    from app.models.objects import CollectionObject
    from app.models.procedures import (
        LoanIn, LoanOut, ObjectEntry,
        LoanInObject, LoanOutObject,
    )
    from app.models.exhibit import ExhibitionObject, Exhibition
    from app.models.locations import Movement

    db = ctx.db_session
    org_id = ctx.organization_id

    object_id = args.get("object_id", "").strip()
    object_number = args.get("object_number", "").strip()

    # Fall back to page context
    if not object_id and not object_number:
        if ctx.context_entity_type == "collection_object" and ctx.context_entity_id:
            object_id = str(ctx.context_entity_id)

    if not object_id and not object_number:
        return {"error": "Provide object_id or object_number, or navigate to an object page"}

    query = db.query(CollectionObject).filter(CollectionObject.organization_id == org_id)
    if object_id:
        try:
            query = query.filter(CollectionObject.object_id == _UUID(object_id))
        except (ValueError, TypeError):
            return {"error": "Invalid object_id format"}
    else:
        query = query.filter(CollectionObject.object_number == object_number)

    obj = query.first()
    if not obj:
        return {"error": "Object not found"}

    oid = obj.object_id
    result = {
        "object_id": str(oid),
        "object_number": obj.object_number,
        "object_name": obj.object_name,
        "object_status": getattr(obj, "object_status", None),
        "current_location_id": str(obj.current_location_id) if obj.current_location_id else None,
    }

    # Active loans involving this object
    loan_in_objects = (
        db.query(LoanInObject, LoanIn)
        .join(LoanIn, LoanInObject.loan_in_id == LoanIn.loan_in_id)
        .filter(
            LoanInObject.object_id == oid,
            LoanIn.organization_id == org_id,
            LoanIn.status.notin_(["returned", "closed", "cancelled"]),
        )
        .all()
    )
    result["active_loans_in"] = [
        {
            "loan_number": loan.loan_number,
            "status": loan.status,
            "lender": loan.lender_name,
            "end_date": loan.loan_end_date.isoformat() if loan.loan_end_date else None,
        }
        for _, loan in loan_in_objects
    ]

    loan_out_objects = (
        db.query(LoanOutObject, LoanOut)
        .join(LoanOut, LoanOutObject.loan_out_id == LoanOut.loan_out_id)
        .filter(
            LoanOutObject.object_id == oid,
            LoanOut.organization_id == org_id,
            LoanOut.status.notin_(["returned", "closed", "cancelled"]),
        )
        .all()
    )
    result["active_loans_out"] = [
        {
            "loan_number": loan.loan_number,
            "status": loan.status,
            "borrower": loan.borrower_name,
            "end_date": loan.loan_end_date.isoformat() if loan.loan_end_date else None,
        }
        for _, loan in loan_out_objects
    ]

    # Exhibition placements
    exhibition_objects = (
        db.query(ExhibitionObject, Exhibition)
        .join(Exhibition, ExhibitionObject.exhibition_id == Exhibition.exhibition_id)
        .filter(
            ExhibitionObject.object_id == oid,
            ExhibitionObject.organization_id == org_id,
            Exhibition.status.notin_(["closed", "archived"]),
        )
        .all()
    )
    result["exhibitions"] = [
        {
            "title": exh.title,
            "exhibition_status": exh.status,
            "object_status": eo.object_status,
            "section": eo.section,
        }
        for eo, exh in exhibition_objects
    ]

    # Recent movements (last 5)
    recent_movements = (
        db.query(Movement)
        .filter(
            Movement.object_id == oid,
            Movement.organization_id == org_id,
        )
        .order_by(Movement.created_at.desc())
        .limit(5)
        .all()
    )
    result["recent_movements"] = [
        {
            "date": m.movement_date.isoformat() if m.movement_date else None,
            "reason": m.reason,
            "status": m.status,
        }
        for m in recent_movements
    ]

    # Condition: latest report
    from app.models.objects import ConditionReport
    latest_condition = (
        db.query(ConditionReport)
        .filter(
            ConditionReport.object_id == oid,
            ConditionReport.organization_id == org_id,
        )
        .order_by(ConditionReport.created_at.desc())
        .first()
    )
    if latest_condition:
        result["latest_condition"] = {
            "date": latest_condition.created_at.isoformat() if latest_condition.created_at else None,
            "overall": latest_condition.overall_condition,
            "conservation_needed": latest_condition.conservation_needed,
        }

    # Summary flags
    result["flags"] = {
        "on_loan_in": len(result["active_loans_in"]) > 0,
        "on_loan_out": len(result["active_loans_out"]) > 0,
        "in_exhibition": len(result["exhibitions"]) > 0,
        "has_recent_movement": len(result["recent_movements"]) > 0,
        "needs_conservation": (
            latest_condition.conservation_needed if latest_condition else False
        ),
    }

    return result


# ── Tool 4: Document readiness check ─────────────────────────────────────


def check_document_readiness(args: dict, ctx: AgentContext) -> dict:
    """Check whether a record has enough data to generate a specific document."""
    from app.services.agent_tools.form_registry import FORM_REGISTRY, get_entity_model_map

    db = ctx.db_session
    org_id = ctx.organization_id

    record_type = args.get("record_type", "").strip().lower()
    record_id = args.get("record_id", "").strip()
    document_type = args.get("document_type", "").strip().lower()

    # Fall back to page context
    if not record_type and ctx.context_entity_type:
        record_type = ctx.context_entity_type
    if not record_id and ctx.context_entity_id:
        record_id = str(ctx.context_entity_id)

    if not record_type or not record_id:
        return {"error": "record_type and record_id are required (or navigate to a record page)"}

    # Document type requirements — what fields are needed for each document
    DOCUMENT_REQUIREMENTS = {
        "loan_agreement_out": {
            "record_types": ["loan_out"],
            "required_fields": [
                "loan_number", "borrower_name", "loan_start_date", "loan_end_date",
                "purpose",
            ],
            "recommended_fields": [
                "borrower_contact_id", "insurance_value", "courier_requirements",
            ],
            "requires_items": True,
            "label": "Loan Agreement (Outgoing)",
        },
        "loan_agreement_in": {
            "record_types": ["loan_in"],
            "required_fields": [
                "loan_number", "lender_name", "loan_start_date", "loan_end_date",
                "purpose",
            ],
            "recommended_fields": [
                "lender_contact_id", "insurance_value",
            ],
            "requires_items": True,
            "label": "Loan Agreement (Incoming)",
        },
        "object_receipt": {
            "record_types": ["object_entry"],
            "required_fields": [
                "entry_number", "depositor_name", "entry_date",
            ],
            "recommended_fields": [
                "entry_reason", "depositor_contact_id",
            ],
            "requires_items": True,
            "label": "Object Receipt",
        },
        "packing_list": {
            "record_types": ["loan_out", "loan_in", "object_exit"],
            "required_fields": [],
            "recommended_fields": [],
            "requires_items": True,
            "label": "Packing List",
        },
        "condition_report": {
            "record_types": ["condition_report"],
            "required_fields": [
                "report_number", "object_id", "overall_condition",
            ],
            "recommended_fields": [
                "report_type", "examined_by",
            ],
            "requires_items": False,
            "label": "Condition Report",
        },
    }

    # If no document_type, list available documents for this record type
    if not document_type:
        available = [
            {"document_type": dt, "label": info["label"]}
            for dt, info in DOCUMENT_REQUIREMENTS.items()
            if record_type in info["record_types"]
        ]
        return {
            "record_type": record_type,
            "available_documents": available,
            "hint": "Specify document_type to check readiness for a specific document.",
        }

    if document_type not in DOCUMENT_REQUIREMENTS:
        return {"error": f"Unknown document_type: {document_type}. Options: {', '.join(DOCUMENT_REQUIREMENTS.keys())}"}

    doc_config = DOCUMENT_REQUIREMENTS[document_type]
    if record_type not in doc_config["record_types"]:
        return {
            "error": f"{doc_config['label']} is not available for {record_type}. "
                     f"Valid record types: {', '.join(doc_config['record_types'])}",
        }

    # Load the record
    entity_model_map = get_entity_model_map()
    if record_type not in entity_model_map:
        return {"error": f"Unknown record type: {record_type}"}

    model_cls, pk_field, number_field = entity_model_map[record_type]

    try:
        rid = _UUID(record_id)
    except (ValueError, TypeError):
        return {"error": "Invalid record_id format"}

    record = db.query(model_cls).filter(
        getattr(model_cls, pk_field) == rid,
        model_cls.organization_id == org_id,
    ).first()

    if not record:
        return {"error": f"{record_type} record not found"}

    # Check required fields
    missing_required = []
    filled_required = []
    for field_name in doc_config["required_fields"]:
        val = getattr(record, field_name, None)
        if val is None or (isinstance(val, str) and not val.strip()):
            missing_required.append(field_name)
        else:
            filled_required.append(field_name)

    # Check recommended fields
    missing_recommended = []
    for field_name in doc_config["recommended_fields"]:
        val = getattr(record, field_name, None)
        if val is None or (isinstance(val, str) and not val.strip()):
            missing_recommended.append(field_name)

    # Check items if required
    has_items = True
    item_count = 0
    if doc_config["requires_items"]:
        # Check for related items/objects
        if record_type == "loan_in":
            from app.models.procedures import LoanInObject
            item_count = db.query(LoanInObject).filter(
                LoanInObject.loan_in_id == rid
            ).count()
        elif record_type == "loan_out":
            from app.models.procedures import LoanOutObject
            item_count = db.query(LoanOutObject).filter(
                LoanOutObject.loan_out_id == rid
            ).count()
        elif record_type == "object_entry":
            from app.models.procedures import ObjectEntryItem
            item_count = db.query(ObjectEntryItem).filter(
                ObjectEntryItem.entry_id == rid
            ).count()
        elif record_type == "object_exit":
            from app.models.procedures import ObjectExitItem
            item_count = db.query(ObjectExitItem).filter(
                ObjectExitItem.exit_id == rid
            ).count()
        has_items = item_count > 0

    ready = len(missing_required) == 0 and has_items
    identifier = getattr(record, number_field, None) if number_field else str(rid)

    return {
        "document_type": document_type,
        "document_label": doc_config["label"],
        "record_type": record_type,
        "record_identifier": identifier,
        "ready": ready,
        "required_fields_filled": filled_required,
        "required_fields_missing": missing_required,
        "recommended_fields_missing": missing_recommended,
        "has_items": has_items,
        "item_count": item_count if doc_config["requires_items"] else None,
        "message": (
            f"Ready to generate {doc_config['label']}."
            if ready
            else f"Not ready: {', '.join(missing_required) if missing_required else 'no items added'}."
        ),
    }


# ── Registration ─────────────────────────────────────────────────────────


def register_operations_tools(registry: ToolRegistry) -> None:
    """Register operational intelligence tools."""

    registry.register(
        name="query_procedures",
        description=(
            "Search across procedure records — loans in/out, acquisitions, object "
            "entries, object exits. Filter by type, status, date range, or text search. "
            "Use when someone asks 'show me all entries this month', 'what loans are "
            "in approved status', or 'find acquisitions from the Smith estate'."
        ),
        parameters={
            "type": "object",
            "properties": {
                "procedure_type": {
                    "type": "string",
                    "description": "Filter to a specific procedure type. Omit to search all.",
                    "enum": ["loan_in", "loan_out", "acquisition", "object_entry", "object_exit"],
                },
                "status": {
                    "type": "string",
                    "description": "Filter by status (e.g. 'approved', 'received', 'in_transit').",
                },
                "date_from": {
                    "type": "string",
                    "description": "Start date (ISO format, e.g. '2026-01-01').",
                },
                "date_to": {
                    "type": "string",
                    "description": "End date (ISO format).",
                },
                "search": {
                    "type": "string",
                    "description": "Text to search in record numbers, names, and descriptions.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max results (default 20, max 50).",
                },
            },
        },
        handler=query_procedures,
        personas=["staff"],
    )

    registry.register(
        name="operations_dashboard",
        description=(
            "Get a broad operational overview — active loans (with overdue flags), "
            "pending object entries, in-progress acquisitions, and open exhibitions. "
            "Use when someone asks 'what's going on?', 'give me a status update', "
            "'what needs attention?', or 'morning briefing'."
        ),
        parameters={
            "type": "object",
            "properties": {},
        },
        handler=operations_dashboard,
        personas=["staff"],
    )

    registry.register(
        name="get_object_context",
        description=(
            "Get the full operational context for a collection object — not just its "
            "catalog record, but its active loans, exhibition placements, recent "
            "movements, and latest condition report. Use when someone asks 'what's "
            "happening with this object?', 'is this on loan?', or 'where has this "
            "been recently?'. Falls back to the object the user is currently viewing."
        ),
        parameters={
            "type": "object",
            "properties": {
                "object_id": {
                    "type": "string",
                    "description": "UUID of the object. Defaults to the object being viewed.",
                },
                "object_number": {
                    "type": "string",
                    "description": "Accession/object number (e.g. '2024.015').",
                },
            },
        },
        handler=get_object_context,
        personas=["staff"],
    )

    registry.register(
        name="check_document_readiness",
        description=(
            "Check whether a procedure record has enough data to generate a document — "
            "loan agreement, object receipt, packing list, or condition report. Reports "
            "which required fields are filled, which are missing, and whether items "
            "have been added. Use when someone asks 'can I generate the loan agreement?', "
            "'is this entry ready for a receipt?', or 'what's missing before I can "
            "print the packing list?'. Falls back to the record being viewed."
        ),
        parameters={
            "type": "object",
            "properties": {
                "record_type": {
                    "type": "string",
                    "description": "Type of record. Defaults to the record being viewed.",
                    "enum": ["loan_in", "loan_out", "object_entry", "object_exit", "condition_report"],
                },
                "record_id": {
                    "type": "string",
                    "description": "UUID of the record. Defaults to the record being viewed.",
                },
                "document_type": {
                    "type": "string",
                    "description": "Document to check readiness for. Omit to list available documents.",
                    "enum": ["loan_agreement_out", "loan_agreement_in", "object_receipt",
                             "packing_list", "condition_report"],
                },
            },
        },
        handler=check_document_readiness,
        personas=["staff"],
    )
