"""Pydantic response models for exhibit_exports router."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ExportOut(BaseModel):
    export_id: str
    export_type: str | None = None
    floor_plan_id: str | None = None
    wall_id: str | None = None
    file_url: str | None = None
    export_metadata: Any = None
    created_at: str
    created_by: str | None = None


class ExportListResponse(BaseModel):
    exports: list[ExportOut]


class ExecutionDashboardResponse(BaseModel):
    exhibition: Any
    checklist: Any
    info_requests: Any
    shipments: Any
    loans: Any
    budget: Any
    generated_at: str
