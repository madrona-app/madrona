"""Pydantic response models for budget endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class BudgetLinkOut(BaseModel):
    link_id: str
    entity_type: str
    entity_id: str
    label: str | None = None


class BudgetLineOut(BaseModel):
    line_id: str
    exhibition_id: str
    category: str
    category_label: str
    description: str | None = None
    estimated_amount: float
    actual_amount: float | None = None
    vendor: str | None = None
    notes: str | None = None
    sort_order: int
    currency_code: str
    links: list[BudgetLinkOut]
    created_at: str | None = None
    updated_at: str | None = None


class CategoryTotals(BaseModel):
    category: str
    category_label: str
    estimated: float
    actual: float
    variance: float
    count: int


class BudgetTotals(BaseModel):
    by_category: list[CategoryTotals]
    total_estimated: float
    total_actual: float
    total_variance: float
    line_count: int


class BudgetLinesListResponse(BaseModel):
    lines: list[BudgetLineOut] | None = None
    groups: list[Any] | None = None
    totals: BudgetTotals
    currency_code: str


class BudgetSummaryResponse(BudgetTotals):
    currency_code: str


class BulkOpResult(BaseModel):
    index: int
    op: str
    line_id: str


class BulkOpError(BaseModel):
    index: int
    error: str


class BulkBudgetResponse(BaseModel):
    results: list[BulkOpResult]
    errors: list[BulkOpError]
    totals: BudgetTotals


class BudgetEnumItem(BaseModel):
    value: str
    label: str


class BudgetEnumsResponse(BaseModel):
    categories: list[BudgetEnumItem]
    link_entity_types: list[BudgetEnumItem]
