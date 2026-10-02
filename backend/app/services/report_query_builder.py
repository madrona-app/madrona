"""Report Query Builder Service.

Data source model mapping and query sorting utilities for the report builder.
"""
from typing import Any

from sqlalchemy.orm import Query

from app.models import (
    CollectionObject,
    Movement,
    Acquisition,
    LoanIn,
    LoanOut,
    ConditionReport,
    Deaccession,
    IncidentReport,
)


# ============================================================================
# DATA SOURCE MODEL MAPPING
# ============================================================================

DATA_SOURCE_MODELS = {
    "collections": CollectionObject,
    "movements": Movement,
    "acquisitions": Acquisition,
    "loans_in": LoanIn,
    "loans_out": LoanOut,
    "condition_reports": ConditionReport,
    "deaccessions": Deaccession,
    "incidents": IncidentReport,
}


# ============================================================================
# SORTING
# ============================================================================

def apply_sorting(
    query: Query,
    model: Any,
    sort_config: list[dict[str, Any]] | None,
) -> Query:
    """Apply sorting to a query based on sort configuration."""
    if not sort_config:
        return query

    for sort_item in sort_config:
        field = sort_item.get("field")
        direction = sort_item.get("direction", "asc").lower()

        if field and hasattr(model, field):
            column = getattr(model, field)
            if direction == "desc":
                query = query.order_by(column.desc())
            else:
                query = query.order_by(column.asc())

    return query
