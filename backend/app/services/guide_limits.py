"""
Default Guide limits, keyed on who pays for inference.

The previous version of this module held a pricing ladder — free, solo, core,
professional, team — seeded onto an organization at self-serve signup. That
signup is gone, so nothing set those tiers and the table became unreachable.
The limits that remain are not a commercial ladder; they exist to stop one
surface, the public visitor widget, from spending someone else's money.

The visitor widget is the only anonymous, unauthenticated path to an LLM in
this codebase. Whether it needs a cap comes down to one question: does one
more query cost anything?

  Fixed-cost inference — a local Ollama, or open-weight models on capacity
  bought up front — has no marginal cost per query. The
  bill is the same whether the widget answers ten questions or ten thousand,
  so counting them protects nobody. Default: unmetered.

  Per-use inference — Anthropic, OpenAI — bills the operator per token for
  traffic arriving from the open internet. Absent a cap, enabling the widget
  exposes that key to unbounded public spend. Default: finite.

An organization's own config always wins, including an explicit null, which is
how an operator says "I know, leave it unmetered" for a third-party key. Only
an absent key falls back to these defaults, which is the distinction
config.get() cannot make on its own.
"""

from __future__ import annotations

# Providers with no marginal cost per query: the capacity is already paid for.
# An unknown provider falls into the per-use branch, failing safe rather than
# open.
#
# RunPod sits here by inheritance rather than by argument: serverless GPU time
# is billed per second, so a busy widget does cost more. It is grouped with the
# fixed-cost providers because an operator provisions that endpoint knowingly,
# but if that assumption stops holding, move it.
FIXED_COST_PROVIDERS = frozenset({"ollama", "runpod"})

# Monthly visitor-widget queries allowed when inference is billed per use and
# the organization has not set its own cap. Deliberately modest: it is
# a guard against an unattended bill, not a product limit. Raise it per
# organization via the Guide app config.
DEFAULT_WIDGET_QUERIES_ON_METERED_PROVIDER = 1000

# Documents an organization may upload when it has not set its own limit.
# Storage is bounded separately by a per-file size cap.
DEFAULT_MAX_DOCUMENTS = 5


def provider_is_fixed_cost(provider: str | None) -> bool:
    """True when an extra query does not add to the operator's bill."""
    return (provider or "").lower() in FIXED_COST_PROVIDERS


def default_widget_queries(provider: str | None) -> int | None:
    """Default monthly widget cap for a provider. None means unmetered."""
    if provider_is_fixed_cost(provider):
        return None
    return DEFAULT_WIDGET_QUERIES_ON_METERED_PROVIDER


def resolve_widget_queries(config: dict, provider: str | None) -> int | None:
    """The effective widget cap: the org's setting, else the provider default.

    A key present in config wins even when its value is null — that is an
    operator deliberately choosing uncapped. Only an absent key defaults.
    """
    if "max_widget_queries" in config:
        return config["max_widget_queries"]
    return default_widget_queries(provider)


def resolve_max_documents(config: dict) -> int:
    """The effective document limit: the org's setting, else the default."""
    value = config.get("max_documents")
    return DEFAULT_MAX_DOCUMENTS if value is None else value
