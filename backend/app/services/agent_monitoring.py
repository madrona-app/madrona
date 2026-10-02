"""Guide AI production monitoring.

Tracks per-request metrics for the Guide AI including latency,
tool usage, token counts, error rates, and deferral rates.

Integrates with the existing Prometheus metrics in app.metrics AND
persists to a database table for historical analysis and alerting.
"""

import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from prometheus_client import Counter, Histogram, Gauge

from sqlalchemy import DateTime, Index, Integer, String, Text, Boolean, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.database import Base
from app.models._helpers import uuid_pk, uuid_fk, timestamp_now, JSONType

logger = logging.getLogger(__name__)


# =============================================================================
# Prometheus Metrics (real-time, for dashboards and alerts)
# =============================================================================

guide_requests_total = Counter(
    "madrona_guide_requests_total",
    "Total Guide AI requests",
    ["persona", "model_provider"],
)

guide_request_duration_seconds = Histogram(
    "madrona_guide_request_duration_seconds",
    "Guide AI end-to-end request duration in seconds",
    ["persona", "model_provider"],
    buckets=(0.5, 1.0, 2.5, 5.0, 10.0, 15.0, 20.0, 30.0, 45.0, 60.0, 90.0, 120.0),
)

guide_ttft_seconds = Histogram(
    "madrona_guide_time_to_first_token_seconds",
    "Time to first token from Guide AI",
    ["persona", "model_provider"],
    buckets=(0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 20.0, 30.0, 60.0),
)

guide_tool_calls_total = Counter(
    "madrona_guide_tool_calls_total",
    "Total tool calls made by Guide AI",
    ["tool_name", "persona"],
)

guide_llm_rounds_total = Counter(
    "madrona_guide_llm_rounds_total",
    "Total LLM rounds in Guide AI tool loops",
    ["persona"],
)

guide_errors_total = Counter(
    "madrona_guide_errors_total",
    "Total Guide AI errors",
    ["persona", "error_type"],
)

guide_deferrals_total = Counter(
    "madrona_guide_deferrals_total",
    "Total Guide AI guardrail deferrals (blocked responses)",
    ["persona"],
)

guide_guardrail_triggers_total = Counter(
    "madrona_guide_guardrail_triggers_total",
    "Total Guide AI guardrail triggers (blocked or warned)",
    ["persona"],
)

guide_active_requests = Gauge(
    "madrona_guide_active_requests",
    "Number of active Guide AI requests",
    ["persona"],
)


# =============================================================================
# SQLAlchemy Model (historical persistence)
# =============================================================================

class GuideMetric(Base):
    """Persisted per-request metrics for Guide AI."""

    __tablename__ = "guide_metrics"

    id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    persona: Mapped[str] = mapped_column(String(20), nullable=False)

    # Timing
    request_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    response_latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    time_to_first_token_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Model
    model_provider: Mapped[str] = mapped_column(String(20), nullable=False)

    # Usage
    tool_calls_count: Mapped[int] = mapped_column(Integer, default=0)
    tool_names: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    llm_rounds: Mapped[int] = mapped_column(Integer, default=1)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Quality signals
    was_deferral: Mapped[bool] = mapped_column(Boolean, default=False)
    had_error: Mapped[bool] = mapped_column(Boolean, default=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    guardrail_triggered: Mapped[bool] = mapped_column(Boolean, default=False)

    # Question telemetry — what the user asked and what context they were in.
    # Truncated to 500 chars to avoid bloating the metrics table.
    user_question: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_route: Mapped[str | None] = mapped_column(String(512), nullable=True)
    page_entity_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    page_entity_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Tool result quality — how many tools returned empty results
    empty_tool_results: Mapped[int] = mapped_column(Integer, default=0)

    # Satisfaction — set later via the feedback endpoint (null = no signal)
    satisfaction: Mapped[str | None] = mapped_column(String(10), nullable=True)  # 'positive' | 'negative'

    created_at: Mapped[datetime] = timestamp_now()

    __table_args__ = (
        Index("ix_guide_metrics_org_id", "organization_id"),
        Index("ix_guide_metrics_started_at", "request_started_at"),
        Index("ix_guide_metrics_org_started", "organization_id", "request_started_at"),
    )


# =============================================================================
# Request Tracker (collects metrics during a single request lifecycle)
# =============================================================================

@dataclass
class RequestTracker:
    """Tracks metrics for a single Guide AI request lifecycle.

    Usage:
        tracker = RequestTracker(organization_id=..., persona=..., model_provider=...)
        # ... during the request ...
        tracker.record_tool_call("search_collection")
        tracker.record_llm_round()
        tracker.record_first_token()
        # ... at the end ...
        tracker.finish(db)
    """

    organization_id: str
    persona: str
    model_provider: str
    user_id: str | None = None
    conversation_id: str | None = None

    # Internal tracking state
    _start_time: float = field(default_factory=time.monotonic)
    _first_token_time: float | None = field(default=None, repr=False)
    _tool_calls: list[str] = field(default_factory=list, repr=False)
    _llm_rounds: int = field(default=0, repr=False)
    _input_tokens: int = field(default=0, repr=False)
    _output_tokens: int = field(default=0, repr=False)
    _was_deferral: bool = field(default=False, repr=False)
    _had_error: bool = field(default=False, repr=False)
    _error_message: str | None = field(default=None, repr=False)
    _guardrail_triggered: bool = field(default=False, repr=False)
    _finished: bool = field(default=False, repr=False)
    _user_question: str | None = field(default=None, repr=False)
    _page_route: str | None = field(default=None, repr=False)
    _page_entity_type: str | None = field(default=None, repr=False)
    _page_entity_id: str | None = field(default=None, repr=False)
    _empty_tool_results: int = field(default=0, repr=False)

    def __post_init__(self):
        guide_active_requests.labels(persona=self.persona).inc()

    def record_first_token(self):
        """Record when the first token is streamed to the client."""
        if self._first_token_time is None:
            self._first_token_time = time.monotonic()

    def record_tool_call(self, tool_name: str):
        """Record a tool execution."""
        self._tool_calls.append(tool_name)
        guide_tool_calls_total.labels(
            tool_name=tool_name, persona=self.persona,
        ).inc()

    def record_llm_round(self):
        """Record an LLM call in the tool loop."""
        self._llm_rounds += 1
        guide_llm_rounds_total.labels(persona=self.persona).inc()

    def record_tokens(self, input_tokens: int, output_tokens: int):
        """Accumulate token counts across LLM rounds."""
        self._input_tokens += input_tokens
        self._output_tokens += output_tokens

    def record_deferral(self):
        """Record that the response was blocked/deferred by guardrails."""
        self._was_deferral = True
        guide_deferrals_total.labels(persona=self.persona).inc()

    def record_error(self, message: str, error_type: str = "unknown"):
        """Record an error during the request."""
        self._had_error = True
        self._error_message = message[:500]  # Truncate long error messages
        guide_errors_total.labels(
            persona=self.persona, error_type=error_type,
        ).inc()

    def record_guardrail(self):
        """Record that guardrails triggered (blocked or warned)."""
        self._guardrail_triggered = True
        guide_guardrail_triggers_total.labels(persona=self.persona).inc()

    def record_question(self, text: str):
        """Record the user's question (truncated to 500 chars)."""
        self._user_question = text[:500] if text else None

    def record_page_context(self, page_context: dict | None):
        """Record the page the user was on when they asked."""
        if not page_context:
            return
        self._page_route = str(page_context.get("route", ""))[:512] or None
        entity = page_context.get("entity")
        if isinstance(entity, dict):
            self._page_entity_type = str(entity.get("type", ""))[:64] or None
            self._page_entity_id = str(entity.get("id", ""))[:128] or None

    def record_empty_tool_result(self):
        """Record that a tool returned empty/no results."""
        self._empty_tool_results += 1

    def finish(self, db: Session) -> GuideMetric | None:
        """Persist the collected metrics. Best-effort — never raises."""
        if self._finished:
            return None
        self._finished = True

        elapsed = time.monotonic() - self._start_time
        elapsed_ms = int(elapsed * 1000)

        # Update Prometheus gauges/histograms
        guide_active_requests.labels(persona=self.persona).dec()
        guide_requests_total.labels(
            persona=self.persona, model_provider=self.model_provider,
        ).inc()
        guide_request_duration_seconds.labels(
            persona=self.persona, model_provider=self.model_provider,
        ).observe(elapsed)

        ttft_ms = None
        if self._first_token_time is not None:
            ttft = self._first_token_time - self._start_time
            ttft_ms = int(ttft * 1000)
            guide_ttft_seconds.labels(
                persona=self.persona, model_provider=self.model_provider,
            ).observe(ttft)

        # Persist to database
        metric = GuideMetric(
            organization_id=self.organization_id,
            user_id=self.user_id,
            conversation_id=self.conversation_id,
            persona=self.persona,
            request_started_at=datetime.now(timezone.utc) - timedelta(milliseconds=elapsed_ms),
            response_latency_ms=elapsed_ms,
            time_to_first_token_ms=ttft_ms,
            model_provider=self.model_provider,
            tool_calls_count=len(self._tool_calls),
            tool_names=self._tool_calls,
            llm_rounds=self._llm_rounds,
            input_tokens=self._input_tokens if self._input_tokens > 0 else None,
            output_tokens=self._output_tokens if self._output_tokens > 0 else None,
            was_deferral=self._was_deferral,
            had_error=self._had_error,
            error_message=self._error_message,
            guardrail_triggered=self._guardrail_triggered,
            user_question=self._user_question,
            page_route=self._page_route,
            page_entity_type=self._page_entity_type,
            page_entity_id=self._page_entity_id,
            empty_tool_results=self._empty_tool_results,
        )

        try:
            db.add(metric)
            db.flush()
        except Exception:
            logger.exception("Failed to persist guide metric")
            try:
                db.rollback()
            except Exception:
                pass
            return None

        return metric


# =============================================================================
# Health summary (for alerting endpoints)
# =============================================================================

def get_health_summary(db: Session, hours: int = 1) -> dict:
    """Get health summary for the Guide AI over a recent time window.

    Returns error rate, p95 latency, deferral rate, and any alerts
    that exceed defined thresholds.
    """
    from sqlalchemy import func, cast

    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    row = db.query(
        func.count(GuideMetric.id).label("total"),
        func.avg(GuideMetric.response_latency_ms).label("avg_latency"),
        func.percentile_cont(0.95).within_group(
            GuideMetric.response_latency_ms
        ).label("p95_latency"),
        func.sum(cast(GuideMetric.had_error, Integer)).label("error_count"),
        func.sum(cast(GuideMetric.was_deferral, Integer)).label("deferrals"),
        func.avg(GuideMetric.tool_calls_count).label("avg_tools"),
        func.avg(GuideMetric.llm_rounds).label("avg_rounds"),
    ).filter(
        GuideMetric.request_started_at >= since,
    ).first()

    total = row.total or 0
    return {
        "period_hours": hours,
        "total_requests": total,
        "avg_latency_ms": round(row.avg_latency or 0, 1),
        "p95_latency_ms": round(row.p95_latency or 0, 1),
        "error_rate": round((row.error_count or 0) / max(total, 1), 3),
        "deferral_rate": round((row.deferrals or 0) / max(total, 1), 3),
        "avg_tool_calls": round(row.avg_tools or 0, 2),
        "avg_llm_rounds": round(row.avg_rounds or 0, 2),
        "alerts": _check_alerts(total, row),
    }


def _check_alerts(total: int, row) -> list[str]:
    """Check if any metrics exceed alert thresholds."""
    alerts = []
    if total < 10:
        return alerts  # Need minimum sample size

    error_rate = (row.error_count or 0) / total
    if error_rate > 0.05:
        alerts.append(f"HIGH_ERROR_RATE: {error_rate:.1%} (threshold: 5%)")

    p95 = row.p95_latency or 0
    if p95 > 30000:
        alerts.append(f"HIGH_LATENCY: p95={p95:.0f}ms (threshold: 30s)")

    deferral_rate = (row.deferrals or 0) / total
    if deferral_rate > 0.20:
        alerts.append(f"HIGH_DEFERRAL_RATE: {deferral_rate:.1%} (threshold: 20%)")

    return alerts
