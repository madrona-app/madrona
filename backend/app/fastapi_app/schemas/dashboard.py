"""Pydantic response models for dashboard endpoints."""

from __future__ import annotations

from pydantic import BaseModel


class AttentionItemOut(BaseModel):
    id: str
    label: str
    due_date: str | None = None
    severity: str | None = None
    href: str | None = None


class AttentionCategoryOut(BaseModel):
    total: int
    samples: list[AttentionItemOut]


class AttentionSummaryResponse(BaseModel):
    loans: AttentionCategoryOut
    rights: AttentionCategoryOut
    audits: AttentionCategoryOut


# ---------------------------------------------------------------------------
# V2 — flat AttentionItem[] for the redesigned home screen
# ---------------------------------------------------------------------------


class AttentionItemV2Out(BaseModel):
    id: str
    type: str  # incident | loan | accession | condition_report
    severity: str  # urgent | this_week | informational
    ref_number: str
    title: str
    context: str
    href: str


class AttentionV2Response(BaseModel):
    items: list[AttentionItemV2Out]


class PulseStatOut(BaseModel):
    value: int
    label: str


class PulseRecentObjectOut(BaseModel):
    name: str
    href: str
    updated_ago: str


class PulseResponse(BaseModel):
    stats: list[PulseStatOut]
    recent_object: PulseRecentObjectOut | None


class WorkshopCountsResponse(BaseModel):
    bridge_running: int
    collections_records: int
    guide_active_conversations: int
    content_drafts: int
    media_assets: int


class GreetingResponse(BaseModel):
    subtitle: str


class SuggestionsResponse(BaseModel):
    suggestions: list[str]


class ActivityEntryOut(BaseModel):
    id: str
    kind: str  # self | incident | system
    text: str
    href: str | None = None
    timestamp: int  # unix ms


class ActivityResponse(BaseModel):
    entries: list[ActivityEntryOut]


class DashboardSummaryResponse(BaseModel):
    greeting: GreetingResponse
    suggestions: SuggestionsResponse
    attention: AttentionV2Response
    pulse: PulseResponse
    workshop: WorkshopCountsResponse
    activity: ActivityResponse
