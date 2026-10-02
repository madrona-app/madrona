"""Exhibit Export API — 10 routes migrated from Flask.

Sources:
- app/api/exhibit_exports.py
"""

import csv
import logging
from datetime import datetime
from io import BytesIO, StringIO
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth
from app.models import (
    Exhibition,
    ExhibitionFloorPlan,
    FloorPlan,
    Placement,
    Export,
    ExhibitionChecklist,
    ChecklistItem,
    ChecklistPhase,
    ChecklistItemStatus,
    ChecklistRole,
    Shipment,
    ShipmentItem,
    ShipmentReference,
    ExhibitionLoan,
    ExhibitionLoanObject,
    ExhibitionBudgetLine,
    BudgetCategory,
    User,
)
from app.services.exhibit_pdf_service import (
    ElevationPDFGenerator,
    InstallationSpecGenerator,
    ObjectChecklistGenerator,
    ChecklistPDFGenerator,
    ShipmentSummaryPDFGenerator,
    ObjectListPDFGenerator,
)
from app.fastapi_app.schemas.exhibit_exports import (
    ExecutionDashboardResponse,
    ExportListResponse,
)
from app.services.report_export import export_to_csv, format_value

logger = logging.getLogger(__name__)

router = APIRouter(tags=["exhibit_exports"])


# =============================================================================
# Helper functions
# =============================================================================


def _get_exhibition_data(
    db: Session, org_id: UUID, exhibition_id: UUID
) -> tuple[dict, list[dict], list[dict]]:
    """Fetch exhibition, floor plans, and placements data."""
    exhibition = db.execute(
        select(Exhibition).where(
            Exhibition.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not exhibition:
        raise ValueError("Exhibition not found")

    # Floor plans reach an exhibition through the exhibition_floor_plans join
    # table, not a column on floor_plans — a floor plan belongs to a venue and
    # can be used by several exhibitions. `FloorPlan.exhibition_id` does not
    # exist, so this raised AttributeError on every call, which is why all
    # three exports below returned 500 for every exhibition ever tried.
    floor_plans = db.execute(
        select(FloorPlan)
        .join(
            ExhibitionFloorPlan,
            ExhibitionFloorPlan.floor_plan_id == FloorPlan.floor_plan_id,
        )
        .where(ExhibitionFloorPlan.exhibition_id == exhibition_id)
        .order_by(ExhibitionFloorPlan.visit_order)
    ).scalars().all()

    placements = db.execute(
        select(Placement).where(Placement.exhibition_id == exhibition_id)
    ).scalars().all()

    return (
        {
            "exhibition_id": str(exhibition.exhibition_id),
            "title": exhibition.title,
            "description": exhibition.description,
            "status": exhibition.status,
        },
        [
            {
                "floor_plan_id": str(fp.floor_plan_id),
                "name": fp.name,
                "geometry": fp.geometry,
                "wall_color": fp.wall_color,
                "ceiling_height_cm": fp.ceiling_height_cm,
            }
            for fp in floor_plans
        ],
        [
            {
                "placement_id": str(p.placement_id),
                "collection_object_id": str(p.collection_object_id) if p.collection_object_id else None,
                "display_title": p.display_title,
                "display_artist": p.display_artist,
                "width_cm": float(p.width_cm) if p.width_cm else 0,
                "height_cm": float(p.height_cm) if p.height_cm else 0,
                "depth_cm": float(p.depth_cm) if p.depth_cm else 0,
                "wall_id": p.wall_id,
                "position_x": float(p.position_x) if p.position_x else 0,
                "position_y": float(p.position_y) if p.position_y else 0,
                "position_z": float(p.position_z) if p.position_z else 0,
                "frame_style": p.frame_style,
                "frame_width_cm": float(p.frame_width_cm) if p.frame_width_cm else 0,
                "mount_type": p.mount_type,
                "label_position": p.label_position,
            }
            for p in placements
        ],
    )


def _record_export(
    db: Session,
    exhibition_id: UUID,
    export_type: str,
    user_id: UUID | None,
    floor_plan_id: UUID | None = None,
    wall_id: str | None = None,
    metadata: dict | None = None,
) -> Export:
    """Record an export in the database."""
    export = Export(
        exhibition_id=exhibition_id,
        export_type=export_type,
        floor_plan_id=floor_plan_id,
        wall_id=wall_id,
        metadata=metadata or {},
        created_by=user_id,
    )
    db.add(export)
    db.commit()
    db.refresh(export)
    return export


# =============================================================================
# Execution Pack — data-fetching helpers
# =============================================================================


def _get_checklist_export_data(
    session: Session, org_id: UUID, exhibition_id: UUID, phase: str | None = None, include_completed: bool = True
) -> tuple[dict, list[dict]]:
    """
    Fetch checklist data for export.

    Returns:
        Tuple of (exhibition_dict, list of checklist_item_dicts)
    """
    exhibition = session.execute(
        select(Exhibition).where(
            Exhibition.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not exhibition:
        raise ValueError("Exhibition not found")

    checklists = session.execute(
        select(ExhibitionChecklist).where(
            ExhibitionChecklist.exhibition_id == exhibition_id
        )
    ).scalars().all()

    checklist_ids = [c.checklist_id for c in checklists]

    query = select(ChecklistItem).where(ChecklistItem.checklist_id.in_(checklist_ids))

    if phase:
        query = query.where(ChecklistItem.phase == phase)

    if not include_completed:
        query = query.where(ChecklistItem.status != ChecklistItemStatus.DONE)

    query = query.order_by(ChecklistItem.phase, ChecklistItem.sort_order)

    items = session.execute(query).scalars().all()

    # Get user names for assigned users
    user_ids = [i.assigned_user_id for i in items if i.assigned_user_id]
    users_by_id = {}
    if user_ids:
        users = session.execute(
            select(User).where(User.user_id.in_(user_ids))
        ).scalars().all()
        users_by_id = {u.user_id: u.display_name or u.email for u in users}

    return (
        {
            "exhibition_id": str(exhibition.exhibition_id),
            "title": exhibition.title,
            "description": exhibition.description,
            "status": exhibition.status,
        },
        [
            {
                "item_id": str(item.item_id),
                "phase": item.phase,
                "phase_label": ChecklistPhase.LABELS.get(item.phase, item.phase),
                "title": item.title,
                "description": item.description,
                "status": item.status,
                "status_label": ChecklistItemStatus.LABELS.get(item.status, item.status),
                "due_date": item.due_date.isoformat() if item.due_date else None,
                "assigned_user_name": users_by_id.get(item.assigned_user_id, ""),
                "responsible_role": ChecklistRole.LABELS.get(item.responsible_role, item.responsible_role),
            }
            for item in items
        ],
    )


def _get_shipment_export_data(
    session: Session, org_id: UUID, exhibition_id: UUID
) -> tuple[dict, list[dict]]:
    """
    Fetch shipment data for export.

    Returns:
        Tuple of (exhibition_dict, list of shipment_dicts)
    """
    exhibition = session.execute(
        select(Exhibition).where(
            Exhibition.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not exhibition:
        raise ValueError("Exhibition not found")

    DIRECTION_LABELS = {"inbound": "Inbound", "outbound": "Outbound"}
    STATUS_LABELS = {
        "draft": "Draft", "confirmed": "Confirmed", "dispatched": "Dispatched",
        "in_transit": "In Transit", "delayed": "Delayed", "delivered": "Delivered",
        "completed": "Completed", "cancelled": "Cancelled",
    }
    shipments = session.execute(
        select(Shipment)
        .join(ShipmentReference, ShipmentReference.shipment_id == Shipment.shipment_id)
        .where(
            ShipmentReference.procedure_type == "exhibition_venue",
            ShipmentReference.procedure_id == exhibition_id,
        )
        .order_by(Shipment.direction, Shipment.estimated_dispatch_date)
    ).scalars().all()

    return (
        {
            "exhibition_id": str(exhibition.exhibition_id),
            "title": exhibition.title,
            "description": exhibition.description,
            "status": exhibition.status,
        },
        [
            {
                "shipment_id": str(s.shipment_id),
                "shipment_number": s.shipment_number or "",
                "direction": s.direction or "",
                "direction_label": DIRECTION_LABELS.get(s.direction, s.direction or ""),
                "carrier": s.shipment_type or "",
                "tracking_number": "",
                "ship_date": s.estimated_dispatch_date.isoformat() if s.estimated_dispatch_date else "",
                "expected_arrival": s.estimated_arrival_date.isoformat() if s.estimated_arrival_date else "",
                "actual_arrival": s.actual_arrival_date.isoformat() if s.actual_arrival_date else "",
                "status": s.status,
                "status_label": STATUS_LABELS.get(s.status, s.status),
                "origin": "",
                "destination": "",
            }
            for s in shipments
        ],
    )


def _get_object_list_export_data(
    session: Session, org_id: UUID, exhibition_id: UUID
) -> tuple[dict, list[dict]]:
    """
    Fetch object list data for export.

    Combines Placement data with loan and shipment information.

    Returns:
        Tuple of (exhibition_dict, list of object_dicts)
    """
    exhibition = session.execute(
        select(Exhibition).where(
            Exhibition.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not exhibition:
        raise ValueError("Exhibition not found")

    placements = session.execute(
        select(Placement)
        .where(Placement.exhibition_id == exhibition_id)
        .order_by(Placement.wall_id, Placement.position_x)
    ).scalars().all()

    # Get loans for this exhibition (to find lender names)
    loans = session.execute(
        select(ExhibitionLoan).where(ExhibitionLoan.exhibition_id == exhibition_id)
    ).scalars().all()

    # Build mapping of object_id to lender name via loan objects
    lender_by_object: dict[UUID, str] = {}
    for loan in loans:
        loan_objects = session.execute(
            select(ExhibitionLoanObject).where(ExhibitionLoanObject.link_id == loan.link_id)
        ).scalars().all()
        for lo in loan_objects:
            if loan.party_name:
                lender_by_object[lo.object_id] = loan.party_name

    # Get shipment items to find packing notes
    shipment_ids_result = session.execute(
        select(Shipment.shipment_id)
        .join(ShipmentReference, ShipmentReference.shipment_id == Shipment.shipment_id)
        .where(
            ShipmentReference.procedure_type == "exhibition_venue",
            ShipmentReference.procedure_id == exhibition_id,
        )
    ).scalars().all()

    packing_notes_by_object: dict[UUID, str] = {}
    if shipment_ids_result:
        shipment_items = session.execute(
            select(ShipmentItem).where(ShipmentItem.shipment_id.in_(shipment_ids_result))
        ).scalars().all()
        for si in shipment_items:
            if si.packing_notes:
                packing_notes_by_object[si.object_id] = si.packing_notes

    placement_status_labels = {
        "draft": "Draft",
        "proposed": "Proposed",
        "approved": "Approved",
    }

    return (
        {
            "exhibition_id": str(exhibition.exhibition_id),
            "title": exhibition.title,
            "description": exhibition.description,
            "status": exhibition.status,
        },
        [
            {
                "placement_id": str(p.placement_id),
                "object_id": str(p.source_id) if p.source_id else "",
                "object_number": f"P-{str(p.placement_id)[:8]}",
                "display_title": p.display_title or "Untitled",
                "display_artist": p.display_artist or "Unknown",
                "lender_name": lender_by_object.get(p.source_id, "") if p.source_id else "",
                "packing_notes": packing_notes_by_object.get(p.source_id, "") if p.source_id else "",
                "placement_status": p.placement_status,
                "placement_status_label": placement_status_labels.get(p.placement_status, p.placement_status),
                "wall_id": p.wall_id,
                "mount_type": p.mount_type,
            }
            for p in placements
        ],
    )


def _get_budget_export_data(
    session: Session, org_id: UUID, exhibition_id: UUID
) -> tuple[dict, list[dict]]:
    """
    Fetch budget data for export.

    Returns:
        Tuple of (exhibition_dict, list of budget_line_dicts)
    """
    exhibition = session.execute(
        select(Exhibition).where(
            Exhibition.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not exhibition:
        raise ValueError("Exhibition not found")

    budget_lines = session.execute(
        select(ExhibitionBudgetLine)
        .where(ExhibitionBudgetLine.exhibition_id == exhibition_id)
        .order_by(ExhibitionBudgetLine.category, ExhibitionBudgetLine.sort_order)
    ).scalars().all()

    return (
        {
            "exhibition_id": str(exhibition.exhibition_id),
            "title": exhibition.title,
            "description": exhibition.description,
            "status": exhibition.status,
        },
        [
            {
                "line_id": str(bl.line_id),
                "category": bl.category,
                "category_label": BudgetCategory.LABELS.get(bl.category, bl.category),
                "description": bl.description,
                "estimated_amount": float(bl.estimated_amount) if bl.estimated_amount else 0.0,
                "actual_amount": float(bl.actual_amount) if bl.actual_amount else None,
                "vendor": bl.vendor or "",
                "currency_code": bl.currency_code or "USD",
            }
            for bl in budget_lines
        ],
    )


def _safe_filename(name: str, max_length: int = 30) -> str:
    """Create a safe filename from a string."""
    safe = ''.join(c for c in name if c.isalnum() or c in ' -_')
    return safe[:max_length].strip()


def _get_execution_dashboard_data(
    session: Session, org_id: UUID, exhibition_id: UUID
) -> dict:
    """
    Aggregate execution readiness metrics for the dashboard.

    Returns dict with:
    - checklist: completion %, blocked count, overdue count
    - info_requests: overdue count, missing required count
    - shipments: upcoming dates, in transit count
    - loans: missing agreements count, missing documents count
    - budget: estimated total, actual total, delta, variance %
    """
    from app.models import ExhibitionInfoRequest, InfoRequestStatus
    from datetime import timedelta

    exhibition = session.execute(
        select(Exhibition).where(
            Exhibition.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not exhibition:
        raise ValueError("Exhibition not found")

    today = datetime.now().date()

    # === CHECKLIST METRICS ===
    checklists = session.execute(
        select(ExhibitionChecklist).where(
            ExhibitionChecklist.exhibition_id == exhibition_id
        )
    ).scalars().all()

    checklist_ids = [c.checklist_id for c in checklists]
    checklist_items = []
    if checklist_ids:
        checklist_items = session.execute(
            select(ChecklistItem).where(ChecklistItem.checklist_id.in_(checklist_ids))
        ).scalars().all()

    total_tasks = len(checklist_items)
    completed_tasks = sum(1 for i in checklist_items if i.status == ChecklistItemStatus.DONE)
    blocked_tasks = sum(1 for i in checklist_items if i.status == ChecklistItemStatus.BLOCKED)
    overdue_tasks = sum(
        1 for i in checklist_items
        if i.status not in [ChecklistItemStatus.DONE, ChecklistItemStatus.NOT_APPLICABLE]
        and i.due_date and i.due_date < today
    )
    completion_pct = round((completed_tasks / total_tasks * 100) if total_tasks > 0 else 0, 1)

    checklist_metrics = {
        "total": total_tasks,
        "completed": completed_tasks,
        "blocked": blocked_tasks,
        "overdue": overdue_tasks,
        "completion_pct": completion_pct,
    }

    # === INFO REQUEST METRICS ===
    info_requests = session.execute(
        select(ExhibitionInfoRequest).where(
            ExhibitionInfoRequest.exhibition_id == exhibition_id
        )
    ).scalars().all()

    overdue_requests = sum(
        1 for r in info_requests
        if r.status == InfoRequestStatus.REQUESTED
        and r.due_date and r.due_date < today
    )
    missing_required = sum(
        1 for r in info_requests
        if r.status == InfoRequestStatus.REQUESTED and r.is_required
    )

    info_request_metrics = {
        "total": len(info_requests),
        "overdue": overdue_requests,
        "missing_required": missing_required,
    }

    # === SHIPMENT METRICS ===
    shipments = session.execute(
        select(Shipment)
        .join(ShipmentReference, ShipmentReference.shipment_id == Shipment.shipment_id)
        .where(
            ShipmentReference.procedure_type == "exhibition_venue",
            ShipmentReference.procedure_id == exhibition_id,
        )
    ).scalars().all()

    in_transit = sum(
        1 for s in shipments
        if s.status in ["dispatched", "in_transit"]
    )
    delayed = sum(1 for s in shipments if s.status == "delayed")

    # Upcoming shipments (next 14 days)
    upcoming_cutoff = today + timedelta(days=14)
    upcoming_shipments = [
        {
            "shipment_id": str(s.shipment_id),
            "shipment_number": s.shipment_number or "",
            "direction": s.direction or "",
            "carrier": s.shipment_type or "",
            "ship_date": s.estimated_dispatch_date.isoformat() if s.estimated_dispatch_date else None,
            "expected_arrival": s.estimated_arrival_date.isoformat() if s.estimated_arrival_date else None,
        }
        for s in shipments
        if s.status in ["confirmed", "dispatched", "in_transit"]
        and (
            (s.estimated_dispatch_date and today <= s.estimated_dispatch_date <= upcoming_cutoff)
            or (s.estimated_arrival_date and today <= s.estimated_arrival_date <= upcoming_cutoff)
        )
    ]

    shipment_metrics = {
        "total": len(shipments),
        "in_transit": in_transit,
        "delayed": delayed,
        "upcoming": upcoming_shipments[:5],
        "upcoming_count": len(upcoming_shipments),
    }

    # === LOAN METRICS ===
    loans = session.execute(
        select(ExhibitionLoan).where(
            ExhibitionLoan.exhibition_id == exhibition_id
        )
    ).scalars().all()

    from app.models import LoanStatus as LS
    active_loans = [l for l in loans if l.status in LS.ACTIVE]
    missing_agreements = sum(1 for l in active_loans if not l.agreement_signed)
    missing_insurance = sum(1 for l in active_loans if not l.insurance_confirmed)

    loan_metrics = {
        "total": len(loans),
        "active": len(active_loans),
        "missing_agreements": missing_agreements,
        "missing_insurance": missing_insurance,
    }

    # === BUDGET METRICS ===
    budget_lines = session.execute(
        select(ExhibitionBudgetLine).where(
            ExhibitionBudgetLine.exhibition_id == exhibition_id
        )
    ).scalars().all()

    estimated_total = sum(float(bl.estimated_amount) for bl in budget_lines if bl.estimated_amount)
    actual_total = sum(float(bl.actual_amount) for bl in budget_lines if bl.actual_amount)
    budget_delta = actual_total - estimated_total
    variance_pct = round((budget_delta / estimated_total * 100) if estimated_total > 0 else 0, 1)

    currency = budget_lines[0].currency_code if budget_lines else "USD"

    budget_metrics = {
        "estimated_total": estimated_total,
        "actual_total": actual_total,
        "delta": budget_delta,
        "variance_pct": variance_pct,
        "currency": currency,
        "line_count": len(budget_lines),
    }

    return {
        "exhibition": {
            "exhibition_id": str(exhibition.exhibition_id),
            "title": exhibition.title,
            "status": exhibition.status,
            "planned_start_date": exhibition.planned_start_date.isoformat() if exhibition.planned_start_date else None,
            "planned_end_date": exhibition.planned_end_date.isoformat() if exhibition.planned_end_date else None,
        },
        "checklist": checklist_metrics,
        "info_requests": info_request_metrics,
        "shipments": shipment_metrics,
        "loans": loan_metrics,
        "budget": budget_metrics,
        "generated_at": datetime.now().isoformat(),
    }


# =============================================================================
# Route 1: Elevation PDF
# =============================================================================


@router.post(
    "/organizations/{org_id}/collections/exhibitions/{exhibition_id}/exports/elevation-pdf", summary="Generate elevation pdf")
async def generate_elevation_pdf(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
):
    """Generate elevation PDF for an exhibition."""
    try:
        data = await request.json() if await request.body() else {}
        floor_plan_id = data.get("floor_plan_id")
        wall_id = data.get("wall_id")
        scale = data.get("scale", 50)
        include_dimensions = data.get("include_dimensions", True)

        exhibition, floor_plans, placements = _get_exhibition_data(
            db, org_id, exhibition_id
        )

        if floor_plan_id:
            floor_plan = next(
                (fp for fp in floor_plans if fp["floor_plan_id"] == floor_plan_id),
                None,
            )
            if not floor_plan:
                raise HTTPException(status_code=404, detail="Floor plan not found")
        else:
            floor_plan = floor_plans[0] if floor_plans else {
                "geometry": {"type": "rectangular", "width_cm": 800, "depth_cm": 600}
            }

        generator = ElevationPDFGenerator(
            exhibition=exhibition,
            floor_plan=floor_plan,
            placements=placements,
            wall_id=wall_id,
            scale=scale,
            include_dimensions=include_dimensions,
        )
        pdf_bytes = generator.generate()

        _record_export(
            db,
            exhibition_id,
            "elevation_pdf",
            user_id=auth.user_id,
            floor_plan_id=UUID(floor_plan_id) if floor_plan_id else None,
            wall_id=wall_id,
            metadata={"scale": scale, "include_dimensions": include_dimensions},
        )

        filename = f"elevation_{exhibition['title'][:20]}_{datetime.now().strftime('%Y%m%d')}.pdf"
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to generate elevation PDF")
        raise HTTPException(status_code=500, detail="Failed to generate elevation PDF")


# =============================================================================
# Route 2: Installation Spec
# =============================================================================


@router.post(
    "/organizations/{org_id}/collections/exhibitions/{exhibition_id}/exports/installation-spec", summary="Generate installation spec")
async def generate_installation_spec(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
):
    """Generate installation specifications PDF."""
    try:
        data = await request.json() if await request.body() else {}
        floor_plan_id = data.get("floor_plan_id")

        exhibition, floor_plans, placements = _get_exhibition_data(
            db, org_id, exhibition_id
        )

        if floor_plan_id:
            floor_plan = next(
                (fp for fp in floor_plans if fp["floor_plan_id"] == floor_plan_id),
                None,
            )
        else:
            floor_plan = floor_plans[0] if floor_plans else {}

        generator = InstallationSpecGenerator(
            exhibition=exhibition,
            floor_plan=floor_plan or {},
            placements=placements,
        )
        pdf_bytes = generator.generate()

        _record_export(
            db,
            exhibition_id,
            "install_spec",
            user_id=auth.user_id,
            floor_plan_id=UUID(floor_plan_id) if floor_plan_id else None,
        )

        filename = f"install_spec_{exhibition['title'][:20]}_{datetime.now().strftime('%Y%m%d')}.pdf"
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to generate installation spec")
        raise HTTPException(status_code=500, detail="Failed to generate installation spec")


# =============================================================================
# Route 3: Object Checklist
# =============================================================================


@router.post(
    "/organizations/{org_id}/collections/exhibitions/{exhibition_id}/exports/object-checklist", summary="Generate object checklist")
async def generate_object_checklist(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
):
    """Generate object checklist PDF."""
    try:
        data = await request.json() if await request.body() else {}
        include_images = data.get("include_images", False)

        exhibition, _, placements = _get_exhibition_data(db, org_id, exhibition_id)

        generator = ObjectChecklistGenerator(
            exhibition=exhibition,
            placements=placements,
            include_images=include_images,
        )
        pdf_bytes = generator.generate()

        _record_export(
            db,
            exhibition_id,
            "object_checklist",
            user_id=auth.user_id,
            metadata={"include_images": include_images},
        )

        filename = f"checklist_{exhibition['title'][:20]}_{datetime.now().strftime('%Y%m%d')}.pdf"
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to generate object checklist")
        raise HTTPException(status_code=500, detail="Failed to generate object checklist")


# =============================================================================
# Route 4: List Export History
# =============================================================================


@router.get(
    "/organizations/{org_id}/collections/exhibitions/{exhibition_id}/exports",
    response_model=ExportListResponse, summary="List exports")
def list_exports(
    org_id: UUID,
    exhibition_id: UUID,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
):
    """List export history for an exhibition."""
    exhibition = db.execute(
        select(Exhibition).where(
            Exhibition.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not exhibition:
        raise HTTPException(status_code=404, detail="Exhibition not found")

    exports = db.execute(
        select(Export)
        .where(Export.exhibition_id == exhibition_id)
        .order_by(Export.created_at.desc())
    ).scalars().all()

    return {
        "exports": [
            {
                "export_id": str(e.export_id),
                "export_type": e.export_type,
                "floor_plan_id": str(e.floor_plan_id) if e.floor_plan_id else None,
                "wall_id": e.wall_id,
                "file_url": e.file_url,
                "export_metadata": e.export_metadata,
                "created_at": e.created_at.isoformat(),
                "created_by": str(e.created_by) if e.created_by else None,
            }
            for e in exports
        ]
    }


# =============================================================================
# Route 5: Execution Pack — Checklist PDF
# =============================================================================


@router.post(
    "/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/exports/execution-pack/checklist-pdf", summary="Export checklist pdf")
async def export_checklist_pdf(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
):
    """Generate checklist PDF for an exhibition."""
    try:
        data = await request.json() if await request.body() else {}
        phase = data.get("phase")
        include_completed = data.get("include_completed", True)

        exhibition, items = _get_checklist_export_data(
            db, org_id, exhibition_id, phase, include_completed
        )

        generator = ChecklistPDFGenerator(
            exhibition=exhibition,
            items=items,
            phase_filter=phase,
        )
        pdf_bytes = generator.generate()

        safe_title = _safe_filename(exhibition['title'])
        filename = f"checklist_{safe_title}_{datetime.now().strftime('%Y%m%d')}.pdf"
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to generate checklist PDF")
        raise HTTPException(status_code=500, detail="Failed to generate checklist PDF")


# =============================================================================
# Route 6: Execution Pack — Shipment PDF
# =============================================================================


@router.post(
    "/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/exports/execution-pack/shipment-pdf", summary="Export shipment pdf")
def export_shipment_pdf(
    org_id: UUID,
    exhibition_id: UUID,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
):
    """Generate shipment summary PDF for an exhibition."""
    try:
        exhibition, shipments = _get_shipment_export_data(db, org_id, exhibition_id)

        generator = ShipmentSummaryPDFGenerator(
            exhibition=exhibition,
            shipments=shipments,
        )
        pdf_bytes = generator.generate()

        safe_title = _safe_filename(exhibition['title'])
        filename = f"shipments_{safe_title}_{datetime.now().strftime('%Y%m%d')}.pdf"
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to generate shipment PDF")
        raise HTTPException(status_code=500, detail="Failed to generate shipment PDF")


# =============================================================================
# Route 7: Execution Pack — Object List CSV
# =============================================================================


@router.post(
    "/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/exports/execution-pack/object-list-csv", summary="Export object list csv")
def export_object_list_csv(
    org_id: UUID,
    exhibition_id: UUID,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
):
    """Generate object list CSV for an exhibition."""
    try:
        exhibition, objects = _get_object_list_export_data(db, org_id, exhibition_id)

        columns = [
            {"field": "object_number", "label": "Object Identifier"},
            {"field": "display_title", "label": "Title"},
            {"field": "display_artist", "label": "Artist"},
            {"field": "lender_name", "label": "Lender"},
            {"field": "packing_notes", "label": "Packing Notes"},
            {"field": "placement_status_label", "label": "Placement Status"},
        ]

        output = StringIO()
        output.write("# Note: Placement status reflects planning decisions. Draft/proposed placements are not final installation positions.\n")
        output.write(f"# Exhibition: {exhibition['title']}\n")
        output.write(f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
        output.write(f"# Object Count: {len(objects)}\n")
        output.write("\n")

        csv_bytes = export_to_csv(objects, columns)
        output.write(csv_bytes.decode('utf-8'))

        safe_title = _safe_filename(exhibition['title'])
        filename = f"object_list_{safe_title}_{datetime.now().strftime('%Y%m%d')}.csv"

        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to generate object list CSV")
        raise HTTPException(status_code=500, detail="Failed to generate object list CSV")


# =============================================================================
# Route 8: Execution Pack — Object List PDF
# =============================================================================


@router.post(
    "/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/exports/execution-pack/object-list-pdf", summary="Export object list pdf")
def export_object_list_pdf(
    org_id: UUID,
    exhibition_id: UUID,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
):
    """Generate object list PDF for an exhibition."""
    try:
        exhibition, objects = _get_object_list_export_data(db, org_id, exhibition_id)

        generator = ObjectListPDFGenerator(
            exhibition=exhibition,
            objects=objects,
        )
        pdf_bytes = generator.generate()

        safe_title = _safe_filename(exhibition['title'])
        filename = f"object_list_{safe_title}_{datetime.now().strftime('%Y%m%d')}.pdf"
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to generate object list PDF")
        raise HTTPException(status_code=500, detail="Failed to generate object list PDF")


# =============================================================================
# Route 9: Execution Pack — Budget CSV
# =============================================================================


@router.post(
    "/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/exports/execution-pack/budget-csv", summary="Export budget csv")
async def export_budget_csv(
    org_id: UUID,
    exhibition_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
):
    """Generate budget CSV for an exhibition."""
    try:
        data = await request.json() if await request.body() else {}
        include_line_items = data.get("include_line_items", True)

        exhibition, budget_lines = _get_budget_export_data(db, org_id, exhibition_id)

        output = StringIO()

        # Add disclaimer/header
        output.write("# Note: Estimated amounts are projections. Actual amounts may be incomplete if expenses are still being recorded.\n")
        output.write(f"# Exhibition: {exhibition['title']}\n")
        output.write(f"# Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
        output.write("\n")

        # Calculate totals by category
        category_totals: dict[str, dict] = {}
        grand_estimated = 0.0
        grand_actual = 0.0

        for line in budget_lines:
            cat = line["category"]
            if cat not in category_totals:
                category_totals[cat] = {
                    "label": line["category_label"],
                    "estimated": 0.0,
                    "actual": 0.0,
                }
            category_totals[cat]["estimated"] += line["estimated_amount"]
            if line["actual_amount"] is not None:
                category_totals[cat]["actual"] += line["actual_amount"]

            grand_estimated += line["estimated_amount"]
            if line["actual_amount"] is not None:
                grand_actual += line["actual_amount"]

        writer = csv.writer(output)

        if include_line_items:
            writer.writerow(["Category", "Description", "Estimated", "Actual", "Vendor", "Currency"])

            for line in budget_lines:
                writer.writerow([
                    line["category_label"],
                    line["description"],
                    f"{line['estimated_amount']:.2f}",
                    f"{line['actual_amount']:.2f}" if line["actual_amount"] is not None else "",
                    line["vendor"],
                    line["currency_code"],
                ])

            writer.writerow([])

        # Category totals section
        writer.writerow(["--- Category Totals ---", "", "", "", "", ""])
        writer.writerow(["Category", "", "Estimated Total", "Actual Total", "", ""])
        for cat, totals in category_totals.items():
            writer.writerow([
                totals["label"],
                "",
                f"{totals['estimated']:.2f}",
                f"{totals['actual']:.2f}" if totals['actual'] > 0 else "",
                "",
                "",
            ])

        # Grand total
        writer.writerow([])
        writer.writerow(["GRAND TOTAL", "", f"{grand_estimated:.2f}", f"{grand_actual:.2f}" if grand_actual > 0 else "", "", ""])

        safe_title = _safe_filename(exhibition['title'])
        filename = f"budget_{safe_title}_{datetime.now().strftime('%Y%m%d')}.csv"

        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to generate budget CSV")
        raise HTTPException(status_code=500, detail="Failed to generate budget CSV")


# =============================================================================
# Route 10: Execution Dashboard
# =============================================================================


@router.get(
    "/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/execution-dashboard",
    response_model=ExecutionDashboardResponse, summary="Get execution dashboard")
def get_execution_dashboard(
    org_id: UUID,
    exhibition_id: UUID,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
):
    """
    Get aggregated execution readiness metrics for an exhibition.

    Returns a single dashboard object with:
    - checklist: completion %, blocked count
    - info_requests: overdue count
    - shipments: upcoming dates, in transit
    - loans: missing agreements/documents
    - budget: estimated vs actual delta
    """
    try:
        dashboard_data = _get_execution_dashboard_data(db, org_id, exhibition_id)
        return dashboard_data

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
