"""Shared draft schema primitives."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

# A value key from an organization-extendable lookup category. The allowed
# set is per organization, so it is checked against the database when a draft
# is proposed or edited (app/services/lookup_fields.check_draft_lookup_values).
LookupKey = Annotated[str, StringConstraints(min_length=1, max_length=100)]

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
