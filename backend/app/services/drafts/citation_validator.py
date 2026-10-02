"""Citation validation for drafts (Guide Studio v1 §7.2).

Hallucinated citations are worse than none — they look like provenance and
aren't. Every citation `ref` is resolved at draft-creation against the right
store, dispatched on `kind`; an unresolvable cite fails draft creation.

Resolvers:
- corpus_chunk → exists in `reference_chunks.chunk_id`
- entity_link  → exists as a live collection object (`collection_objects.object_id`)
- tool_result  → appears in this conversation's `messages.tool_calls` ledger
                 (requires a conversation; an unverifiable tool cite is rejected)
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import text

_VALID_KINDS = {"tool_result", "corpus_chunk", "entity_link"}


class CitationValidator:
    def __init__(self, session, conversation_id: UUID | None = None):
        self.session = session
        self.conversation_id = conversation_id

    def unresolved(self, citations: list[dict] | None) -> list[str]:
        """Return the refs that could not be resolved (empty == all good)."""
        bad: list[str] = []
        for c in citations or []:
            if not isinstance(c, dict):
                bad.append(repr(c))
                continue
            kind = c.get("kind")
            ref = c.get("ref")
            if kind not in _VALID_KINDS or not ref:
                bad.append(f"{kind}:{ref}")
                continue
            if not self._resolve(kind, str(ref)):
                bad.append(f"{kind}:{ref}")
        return bad

    def _resolve(self, kind: str, ref: str) -> bool:
        if kind == "corpus_chunk":
            return self._exists_uuid(
                "SELECT 1 FROM reference_chunks WHERE chunk_id = cast(:r as uuid)", ref
            )
        if kind == "entity_link":
            return self._exists_uuid(
                "SELECT 1 FROM collections.collection_objects "
                "WHERE object_id = cast(:r as uuid)",
                ref,
            )
        if kind == "tool_result":
            return self._tool_result_exists(ref)
        return False

    def _exists_uuid(self, sql: str, ref: str) -> bool:
        try:
            UUID(ref)  # cast(:r as uuid) would error on a non-UUID; pre-check
        except (ValueError, TypeError):
            return False
        row = self.session.execute(text(sql + " LIMIT 1"), {"r": ref}).first()
        return row is not None

    def _tool_result_exists(self, ref: str) -> bool:
        # A tool-result cite must point at a tool call made in THIS conversation.
        # Without a conversation we can't verify it, so it's rejected (fail
        # closed). Containment check on the tool_calls JSON catches fabricated
        # ids without coupling to the exact tool_call schema.
        if self.conversation_id is None:
            return False
        row = self.session.execute(
            text(
                "SELECT 1 FROM messages "
                "WHERE conversation_id = cast(:c as uuid) "
                "AND tool_calls IS NOT NULL "
                "AND tool_calls::text LIKE :pat LIMIT 1"
            ),
            {"c": str(self.conversation_id), "pat": f"%{ref}%"},
        ).first()
        return row is not None
