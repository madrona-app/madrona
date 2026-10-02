"""
Exhibition Budget API endpoints (FastAPI).

Provides CRUD operations for budget lines, summary totals, and CSV export.
Migrated from app/api/budget.py — 11 routes.
"""
import csv
import io
import logging
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    Exhibition,
    ExhibitionBudgetLine,
    BudgetLineLink,
    BudgetCategory,
    BudgetLinkEntityType,
)
from app.permissions import Permission
from app.fastapi_app.schemas.budget import (
    BudgetLineOut,
    BudgetLinesListResponse,
    BudgetSummaryResponse,
    BulkBudgetResponse,
    BudgetLinkOut,
    BudgetEnumsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["budget"])


# ============================================================================
# SERIALIZERS / HELPERS
# ============================================================================


def _serialize_budget_line(line: ExhibitionBudgetLine) -> dict:
    return {
        "line_id": str(line.line_id),
        "exhibition_id": str(line.exhibition_id),
        "category": line.category,
        "category_label": BudgetCategory.LABELS.get(line.category, line.category),
        "description": line.description,
        "estimated_amount": float(line.estimated_amount) if line.estimated_amount else 0,
        "actual_amount": float(line.actual_amount) if line.actual_amount else None,
        "vendor": line.vendor,
        "notes": line.notes,
        "sort_order": line.sort_order,
        "currency_code": line.currency_code,
        "links": [
            {
                "link_id": str(link.link_id),
                "entity_type": link.entity_type,
                "entity_id": str(link.entity_id),
                "label": link.label,
            }
            for link in (line.links or [])
        ],
        "created_at": line.created_at.isoformat() if line.created_at else None,
        "updated_at": line.updated_at.isoformat() if line.updated_at else None,
    }


def _calculate_totals(lines: list) -> dict:
    by_category = {}
    overall_estimated = Decimal("0")
    overall_actual = Decimal("0")

    for line in lines:
        cat = line.category
        if cat not in by_category:
            by_category[cat] = {
                "category": cat,
                "category_label": BudgetCategory.LABELS.get(cat, cat),
                "estimated": Decimal("0"),
                "actual": Decimal("0"),
                "count": 0,
            }

        estimated = line.estimated_amount or Decimal("0")
        actual = line.actual_amount or Decimal("0")

        by_category[cat]["estimated"] += estimated
        by_category[cat]["actual"] += actual
        by_category[cat]["count"] += 1

        overall_estimated += estimated
        overall_actual += actual

    for cat_data in by_category.values():
        cat_data["estimated"] = float(cat_data["estimated"])
        cat_data["actual"] = float(cat_data["actual"])
        cat_data["variance"] = cat_data["actual"] - cat_data["estimated"]

    return {
        "by_category": list(by_category.values()),
        "total_estimated": float(overall_estimated),
        "total_actual": float(overall_actual),
        "total_variance": float(overall_actual - overall_estimated),
        "line_count": len(lines),
    }


def _get_exhibition_or_404(db: Session, org_id: UUID, exhibition_id: UUID) -> Exhibition:
    exhibition = db.query(Exhibition).filter(
        Exhibition.exhibition_id == exhibition_id,
        Exhibition.organization_id == org_id,
    ).first()
    if not exhibition:
        raise HTTPException(status_code=404, detail="Exhibition not found")
    return exhibition


# ============================================================================
# LIST & SUMMARY
# ============================================================================


@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/budget", response_model=BudgetLinesListResponse, summary="List budget lines")
def list_budget_lines(
    org_id: UUID,
    exhibition_id: UUID,
    category: str = Query(None),
    group_by: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """List budget lines."""
    _get_exhibition_or_404(db, org_id, exhibition_id)

    query = db.query(ExhibitionBudgetLine).filter(
        ExhibitionBudgetLine.exhibition_id == exhibition_id
    )

    if category and category in BudgetCategory.ALL:
        query = query.filter(ExhibitionBudgetLine.category == category)

    query = query.order_by(
        ExhibitionBudgetLine.category,
        ExhibitionBudgetLine.sort_order,
        ExhibitionBudgetLine.created_at,
    )

    lines = query.all()
    totals = _calculate_totals(lines)

    if group_by == "category":
        grouped = {}
        for line in lines:
            cat = line.category
            if cat not in grouped:
                grouped[cat] = {
                    "category": cat,
                    "category_label": BudgetCategory.LABELS.get(cat, cat),
                    "lines": [],
                }
            grouped[cat]["lines"].append(_serialize_budget_line(line))

        for cat_total in totals["by_category"]:
            if cat_total["category"] in grouped:
                grouped[cat_total["category"]]["totals"] = cat_total

        return {
            "groups": list(grouped.values()),
            "totals": totals,
            "currency_code": lines[0].currency_code if lines else "USD",
        }

    return {
        "lines": [_serialize_budget_line(line) for line in lines],
        "totals": totals,
        "currency_code": lines[0].currency_code if lines else "USD",
    }


@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/budget/summary", response_model=BudgetSummaryResponse, summary="Get budget summary")
def get_budget_summary(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get budget summary."""
    _get_exhibition_or_404(db, org_id, exhibition_id)

    lines = db.query(ExhibitionBudgetLine).filter(
        ExhibitionBudgetLine.exhibition_id == exhibition_id
    ).all()

    totals = _calculate_totals(lines)
    totals["currency_code"] = lines[0].currency_code if lines else "USD"

    return totals


# ============================================================================
# CSV EXPORT (static path — must be before {line_id} routes)
# ============================================================================


@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/budget/export", summary="Export budget csv")
def export_budget_csv(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Export budget csv."""
    exhibition = _get_exhibition_or_404(db, org_id, exhibition_id)

    lines = db.query(ExhibitionBudgetLine).filter(
        ExhibitionBudgetLine.exhibition_id == exhibition_id
    ).order_by(
        ExhibitionBudgetLine.category,
        ExhibitionBudgetLine.sort_order,
    ).all()

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "Category", "Description", "Estimated", "Actual", "Variance", "Vendor", "Notes", "Currency"
    ])

    for line in lines:
        estimated = float(line.estimated_amount or 0)
        actual = float(line.actual_amount or 0)
        variance = actual - estimated

        writer.writerow([
            BudgetCategory.LABELS.get(line.category, line.category),
            line.description,
            f"{estimated:.2f}",
            f"{actual:.2f}" if line.actual_amount is not None else "",
            f"{variance:.2f}" if line.actual_amount is not None else "",
            line.vendor or "",
            line.notes or "",
            line.currency_code,
        ])

    totals = _calculate_totals(lines)
    writer.writerow([])
    writer.writerow(["TOTALS", "", f'{totals["total_estimated"]:.2f}', f'{totals["total_actual"]:.2f}', f'{totals["total_variance"]:.2f}', "", "", ""])

    writer.writerow([])
    writer.writerow(["By Category"])
    for cat in totals["by_category"]:
        writer.writerow([
            cat["category_label"],
            f'{cat["count"]} items',
            f'{cat["estimated"]:.2f}',
            f'{cat["actual"]:.2f}',
            f'{cat["variance"]:.2f}',
            "", "", "",
        ])

    output.seek(0)

    safe_title = "".join(c for c in exhibition.title if c.isalnum() or c in " -_")[:30]
    filename = f"budget_{safe_title}_{datetime.now().strftime('%Y%m%d')}.csv"

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ============================================================================
# BULK OPERATIONS (static path — must be before {line_id} routes)
# ============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/budget/bulk", response_model=BulkBudgetResponse, summary="Bulk update budget")
def bulk_update_budget(
    org_id: UUID,
    exhibition_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Bulk update budget."""
    _get_exhibition_or_404(db, org_id, exhibition_id)

    operations = body.get("operations", [])
    results = []
    errors = []

    for i, op in enumerate(operations):
        op_type = op.get("op")
        op_data = op.get("data", {})

        try:
            if op_type == "create":
                if not op_data.get("description"):
                    errors.append({"index": i, "error": "Description is required"})
                    continue

                category = op_data.get("category", BudgetCategory.OTHER)
                max_sort = db.query(func.max(ExhibitionBudgetLine.sort_order)).filter(
                    ExhibitionBudgetLine.exhibition_id == exhibition_id,
                    ExhibitionBudgetLine.category == category,
                ).scalar() or 0

                line = ExhibitionBudgetLine(
                    exhibition_id=exhibition_id,
                    category=category,
                    description=op_data["description"],
                    estimated_amount=Decimal(str(op_data.get("estimated_amount", 0))),
                    actual_amount=Decimal(str(op_data["actual_amount"])) if op_data.get("actual_amount") is not None else None,
                    vendor=op_data.get("vendor"),
                    notes=op_data.get("notes"),
                    sort_order=max_sort + 1,
                    currency_code=op_data.get("currency_code", "USD"),
                    created_by=auth.user_id,
                    updated_by=auth.user_id,
                )
                db.add(line)
                db.flush()
                results.append({"index": i, "op": "create", "line_id": str(line.line_id)})

            elif op_type == "update":
                op_line_id = op_data.get("line_id")
                if not op_line_id:
                    errors.append({"index": i, "error": "line_id is required for update"})
                    continue

                line = db.query(ExhibitionBudgetLine).filter(
                    ExhibitionBudgetLine.line_id == op_line_id,
                    ExhibitionBudgetLine.exhibition_id == exhibition_id,
                ).first()

                if not line:
                    errors.append({"index": i, "error": "Budget line not found"})
                    continue

                if "category" in op_data:
                    line.category = op_data["category"]
                if "description" in op_data:
                    line.description = op_data["description"]
                if "estimated_amount" in op_data:
                    line.estimated_amount = Decimal(str(op_data["estimated_amount"]))
                if "actual_amount" in op_data:
                    line.actual_amount = Decimal(str(op_data["actual_amount"])) if op_data["actual_amount"] is not None else None
                if "vendor" in op_data:
                    line.vendor = op_data["vendor"]
                if "notes" in op_data:
                    line.notes = op_data["notes"]
                if "sort_order" in op_data:
                    line.sort_order = op_data["sort_order"]

                line.updated_at = datetime.now(timezone.utc)
                line.updated_by = auth.user_id
                results.append({"index": i, "op": "update", "line_id": str(line.line_id)})

            elif op_type == "delete":
                op_line_id = op_data.get("line_id")
                if not op_line_id:
                    errors.append({"index": i, "error": "line_id is required for delete"})
                    continue

                line = db.query(ExhibitionBudgetLine).filter(
                    ExhibitionBudgetLine.line_id == op_line_id,
                    ExhibitionBudgetLine.exhibition_id == exhibition_id,
                ).first()

                if line:
                    db.delete(line)
                    results.append({"index": i, "op": "delete", "line_id": op_line_id})
                else:
                    errors.append({"index": i, "error": "Budget line not found"})

            else:
                errors.append({"index": i, "error": f"Unknown operation: {op_type}"})

        except Exception as e:
            errors.append({"index": i, "error": str(e)})

    if errors and not results:
        db.rollback()
        raise HTTPException(status_code=400, detail={"error": "All operations failed", "errors": errors})

    db.commit()

    lines = db.query(ExhibitionBudgetLine).filter(
        ExhibitionBudgetLine.exhibition_id == exhibition_id
    ).all()
    totals = _calculate_totals(lines)

    return {
        "results": results,
        "errors": errors,
        "totals": totals,
    }


# ============================================================================
# CRUD OPERATIONS
# ============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/budget", response_model=BudgetLineOut, status_code=201, summary="Create budget line")
def create_budget_line(
    org_id: UUID,
    exhibition_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Create budget line."""
    _get_exhibition_or_404(db, org_id, exhibition_id)

    if not body.get("description"):
        raise HTTPException(status_code=400, detail="Description is required")

    category = body.get("category", BudgetCategory.OTHER)
    if category not in BudgetCategory.ALL:
        raise HTTPException(status_code=400, detail=f"Invalid category. Must be one of: {BudgetCategory.ALL}")

    max_sort = db.query(func.max(ExhibitionBudgetLine.sort_order)).filter(
        ExhibitionBudgetLine.exhibition_id == exhibition_id,
        ExhibitionBudgetLine.category == category,
    ).scalar() or 0

    line = ExhibitionBudgetLine(
        exhibition_id=exhibition_id,
        category=category,
        description=body["description"],
        estimated_amount=Decimal(str(body.get("estimated_amount", 0))),
        actual_amount=Decimal(str(body["actual_amount"])) if body.get("actual_amount") is not None else None,
        vendor=body.get("vendor"),
        notes=body.get("notes"),
        sort_order=max_sort + 1,
        currency_code=body.get("currency_code", "USD"),
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )

    db.add(line)
    db.flush()

    for link_data in body.get("links", []):
        if link_data.get("entity_type") in BudgetLinkEntityType.ALL and link_data.get("entity_id"):
            link = BudgetLineLink(
                line_id=line.line_id,
                entity_type=link_data["entity_type"],
                entity_id=link_data["entity_id"],
                label=link_data.get("label"),
            )
            db.add(link)

    db.commit()

    return _serialize_budget_line(line)


@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/budget/{line_id}", response_model=BudgetLineOut, summary="Get budget line")
def get_budget_line(
    org_id: UUID,
    exhibition_id: UUID,
    line_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get budget line."""
    line = db.query(ExhibitionBudgetLine).filter(
        ExhibitionBudgetLine.line_id == line_id,
        ExhibitionBudgetLine.exhibition_id == exhibition_id,
    ).first()

    if not line:
        raise HTTPException(status_code=404, detail="Budget line not found")

    _get_exhibition_or_404(db, org_id, exhibition_id)

    return _serialize_budget_line(line)


@router.patch("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/budget/{line_id}", response_model=BudgetLineOut, summary="Update budget line")
def update_budget_line(
    org_id: UUID,
    exhibition_id: UUID,
    line_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update budget line."""
    line = db.query(ExhibitionBudgetLine).filter(
        ExhibitionBudgetLine.line_id == line_id,
        ExhibitionBudgetLine.exhibition_id == exhibition_id,
    ).first()

    if not line:
        raise HTTPException(status_code=404, detail="Budget line not found")

    _get_exhibition_or_404(db, org_id, exhibition_id)

    if "category" in body:
        if body["category"] not in BudgetCategory.ALL:
            raise HTTPException(status_code=400, detail=f"Invalid category. Must be one of: {BudgetCategory.ALL}")
        line.category = body["category"]

    if "description" in body:
        line.description = body["description"]

    if "estimated_amount" in body:
        line.estimated_amount = Decimal(str(body["estimated_amount"]))

    if "actual_amount" in body:
        line.actual_amount = Decimal(str(body["actual_amount"])) if body["actual_amount"] is not None else None

    if "vendor" in body:
        line.vendor = body["vendor"]

    if "notes" in body:
        line.notes = body["notes"]

    if "sort_order" in body:
        line.sort_order = body["sort_order"]

    if "currency_code" in body:
        line.currency_code = body["currency_code"]

    line.updated_at = datetime.now(timezone.utc)
    line.updated_by = auth.user_id

    db.commit()

    return _serialize_budget_line(line)


@router.delete("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/budget/{line_id}", summary="Delete budget line")
def delete_budget_line(
    org_id: UUID,
    exhibition_id: UUID,
    line_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete budget line."""
    line = db.query(ExhibitionBudgetLine).filter(
        ExhibitionBudgetLine.line_id == line_id,
        ExhibitionBudgetLine.exhibition_id == exhibition_id,
    ).first()

    if not line:
        raise HTTPException(status_code=404, detail="Budget line not found")

    _get_exhibition_or_404(db, org_id, exhibition_id)

    db.delete(line)
    db.commit()

    return Response(status_code=204)


# ============================================================================
# LINKS
# ============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/budget/{line_id}/links", response_model=BudgetLinkOut, status_code=201, summary="Add budget link")
def add_budget_link(
    org_id: UUID,
    exhibition_id: UUID,
    line_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Add budget link."""
    # exhibition_budget_lines / budget_line_links carry no organization_id.
    # Every other handler in this file goes through
    # _get_exhibition_or_404; these two skipped it, so org A could write onto
    # org B's budget line.
    _get_exhibition_or_404(db, org_id, exhibition_id)

    line = db.query(ExhibitionBudgetLine).filter(
        ExhibitionBudgetLine.line_id == line_id,
        ExhibitionBudgetLine.exhibition_id == exhibition_id,
    ).first()

    if not line:
        raise HTTPException(status_code=404, detail="Budget line not found")

    entity_type = body.get("entity_type")
    entity_id = body.get("entity_id")

    if not entity_type or entity_type not in BudgetLinkEntityType.ALL:
        raise HTTPException(status_code=400, detail=f"Invalid entity_type. Must be one of: {BudgetLinkEntityType.ALL}")

    if not entity_id:
        raise HTTPException(status_code=400, detail="entity_id is required")

    link = BudgetLineLink(
        line_id=line.line_id,
        entity_type=entity_type,
        entity_id=entity_id,
        label=body.get("label"),
    )

    db.add(link)
    db.commit()

    return {
        "link_id": str(link.link_id),
        "entity_type": link.entity_type,
        "entity_id": str(link.entity_id),
        "label": link.label,
    }


@router.delete("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/budget/{line_id}/links/{link_id}", summary="Remove budget link")
def remove_budget_link(
    org_id: UUID,
    exhibition_id: UUID,
    line_id: UUID,
    link_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove budget link."""
    _get_exhibition_or_404(db, org_id, exhibition_id)

    # Join through the budget line to this org's exhibition: (link_id, line_id)
    # alone matches another institution's link, and neither table carries an
    # organization_id of its own.
    link = (
        db.query(BudgetLineLink)
        .join(ExhibitionBudgetLine, ExhibitionBudgetLine.line_id == BudgetLineLink.line_id)
        .filter(
            BudgetLineLink.link_id == link_id,
            BudgetLineLink.line_id == line_id,
            ExhibitionBudgetLine.exhibition_id == exhibition_id,
        )
        .first()
    )

    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    db.delete(link)
    db.commit()

    return Response(status_code=204)


# ============================================================================
# ENUMS
# ============================================================================


@router.get("/api/organizations/{org_id}/exhibit/budget/enums", response_model=BudgetEnumsResponse, summary="Get budget enums")
def get_budget_enums(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get budget enums."""
    return {
        "categories": [
            {"value": cat, "label": BudgetCategory.LABELS[cat]}
            for cat in BudgetCategory.ALL
        ],
        "link_entity_types": [
            {"value": t, "label": t.replace("_", " ").title()}
            for t in BudgetLinkEntityType.ALL
        ],
    }
