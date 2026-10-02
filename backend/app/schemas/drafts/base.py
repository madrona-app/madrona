"""Shared draft schema primitives."""

from typing import Literal

from pydantic import BaseModel, Field

CitationKind = Literal["tool_result", "corpus_chunk", "entity_link"]


class Citation(BaseModel):
    """A resolvable source backing a fact in a draft (v1 §7.2).

    `ref` is validated at draft-creation against the appropriate store
    (the conversation's tool-call ledger, the reference-corpus chunk store, or
    a live entity) so cited provenance is real, not hallucinated. The resolver
    dispatches on `kind`.
    """

    kind: CitationKind
    ref: str = Field(
        ...,
        description="tool_call id, corpus chunk id, or entity id — dispatched on kind",
    )
    note: str | None = None
