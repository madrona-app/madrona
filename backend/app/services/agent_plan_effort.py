"""Per-step effort scoring + cost estimation (§2A/§2D).

`raw_effort` is an AI-effort score in token-equivalent units (tokens dominate;
rounds/tool-calls/delegation are scaled into the same space). A step with no LLM
signal scores 0 — so a deterministic DB tool_call reads as "no AI cost", never a
fake bar. `weight` is normalized WITHIN a plan at read time (see
`weight(raw, plan_max_raw)`) so it answers "where in this plan did the AI work
hardest"; it is computed in the serializer, not stored, because the plan-max
isn't known until every step has run.

`MODEL_PRICES` is USD per 1,000 tokens (input, output). Unknown model → None
cost (honest): self-hosted Qwen on ollama/runpod has no per-token price.
"""

from __future__ import annotations

import math

# Effort weighting (token-equivalent units).
W_TOKEN = 1.0
ROUND_UNIT = 500.0
TOOL_UNIT = 200.0
DELEG_UNIT = 1000.0

# USD per 1,000 tokens (input, output). Source: claude-api skill model table.
MODEL_PRICES: dict[str, tuple[float, float]] = {
    "claude-opus-4-8": (0.005, 0.025),
    "claude-opus-4-7": (0.005, 0.025),
    "claude-opus-4-6": (0.005, 0.025),
    "claude-opus-4-5": (0.005, 0.025),
    "claude-sonnet-4-6": (0.003, 0.015),
    "claude-sonnet-4-5": (0.003, 0.015),
    "claude-haiku-4-5": (0.001, 0.005),
    # Self-hosted (ollama/runpod Qwen) has no per-token price → omitted (None).
}


def raw_effort(
    input_tokens: int | None,
    output_tokens: int | None,
    llm_rounds: int | None,
    tool_calls: int | None,
    delegation_depth: int | None,
) -> float:
    """AI-effort score. 0 when there was no LLM work (so deterministic steps
    read as 'no AI cost')."""
    tokens = (input_tokens or 0) + (output_tokens or 0)
    rounds = llm_rounds or 0
    if tokens == 0 and rounds == 0:
        return 0.0
    return float(
        W_TOKEN * tokens
        + ROUND_UNIT * rounds
        + TOOL_UNIT * (tool_calls or 0)
        + DELEG_UNIT * (delegation_depth or 0)
    )


def cost_estimate(
    model_id: str | None,
    input_tokens: int | None,
    output_tokens: int | None,
) -> float | None:
    """USD estimate from token counts, or None when the model is unpriced
    (self-hosted) or there are no tokens — never a fabricated 0."""
    if not model_id:
        return None
    price = MODEL_PRICES.get(model_id)
    if price is None:
        return None
    in_price, out_price = price
    cost = (input_tokens or 0) / 1000 * in_price + (output_tokens or 0) / 1000 * out_price
    return round(cost, 6) if cost else None


def weight(raw: float | None, plan_max_raw: float | None) -> float:
    """Normalize raw_effort within the plan: log1p(raw)/log1p(plan_max) so
    outliers compress and the heaviest step → ~1.0. 0 for no-AI-cost steps."""
    if not raw or not plan_max_raw or plan_max_raw <= 0:
        return 0.0
    return round(math.log1p(raw) / math.log1p(plan_max_raw), 4)
