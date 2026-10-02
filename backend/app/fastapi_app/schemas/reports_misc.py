"""Pydantic response schemas for reports-misc endpoints."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# On-Demand Reports
# ---------------------------------------------------------------------------

class OnDemandReportDef(BaseModel):
    report_key: str
    name: str
    description: str | None = None
    category: str | None = None
    style: str | None = None
    supported_formats: list[str] | None = None
    default_format: str | None = None


class AvailableReportsResponse(BaseModel):
    reports: list[OnDemandReportDef]
    total: int


class GenerateReportResponse(BaseModel):
    run_id: str
    status: str
    report_key: str
    export_format: str


class OnDemandRunOut(BaseModel):
    run_id: str
    report_key: str | None = None
    context_type: str | None = None
    status: str | None = None
    triggered_by: str | None = None
    export_format: str | None = None
    row_count: int | None = None
    execution_time_ms: int | None = None
    error_message: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str | None = None
    has_download: bool = False


class OnDemandRunListResponse(BaseModel):
    items: list[OnDemandRunOut]
    total: int
    limit: int
    offset: int


class DownloadUrlResponse(BaseModel):
    download_url: str


# ---------------------------------------------------------------------------
# Report Templates (HTML upload/download)
# ---------------------------------------------------------------------------

class ReportTemplateItem(BaseModel):
    name: str
    size: int | None = None
    last_modified: str | None = None


class ReportTemplateListResponse(BaseModel):
    templates: list[ReportTemplateItem]


class ReportTemplateUploadedResponse(BaseModel):
    name: str
    size: int
    message: str


# ---------------------------------------------------------------------------
# Dashboard Reports
# ---------------------------------------------------------------------------

class DashboardSummaryResponse(BaseModel):
    total_runs: int
    successful_runs: int
    failed_runs: int
    success_rate: float
    total_entities: int
    active_pipelines: int
    avg_duration_ms: int
    period_days: int


class DailyRunStat(BaseModel):
    date: str | None = None
    total: int = 0
    success: int = 0
    failed: int = 0
    entities: int = 0


class DailyRunsResponse(BaseModel):
    days: list[DailyRunStat]


class DatasetSummaryItem(BaseModel):
    dataset_id: str
    name: str | None = None
    entity_count: int = 0
    last_run_at: str | None = None
    runs_total: int = 0
    runs_successful: int = 0
    success_rate: float | None = None


class DatasetsSummaryResponse(BaseModel):
    datasets: list[DatasetSummaryItem]


# ---------------------------------------------------------------------------
# Page Documentation
# ---------------------------------------------------------------------------

class PageKeysResponse(BaseModel):
    page_keys: list[str]


class OrgScopedDocOut(BaseModel):
    doc_id: str
    organization_id: str
    page_key: str | None = None
    title: str | None = None
    summary: str | None = None
    body_markdown: str | None = None
    audience: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class DocListResponse(BaseModel):
    docs: list[OrgScopedDocOut]


class DocResponse(BaseModel):
    doc: OrgScopedDocOut | None = None


class DocDeleteResponse(BaseModel):
    success: bool = True
    deleted_page_key: str


class DeleteReportTemplateResponse(BaseModel):
    message: str
