"""Security: personal conversation attachments must never leak.

A reference_chunk with conversation_id set is a personal attachment (a user
dropped a doc into one chat). It must surface ONLY inside that conversation —
never in corpus search, never in another conversation, never to a visitor.

We control the embedding vector (query == chunk vector ⇒ similarity 1.0) so the
test isolates the WHERE-clause filter logic, not the embedding service.
"""

from uuid import uuid4

import pytest

from app.models import Organization
from app.models.agent import Conversation
from app.models.reference import ReferenceChunk
from app.services.agent_tools import AgentContext
from app.services.agent_tools.reference_tools import _search_chunks

# A unit-ish 1024-dim vector (matches Vector(1024) / Voyage dims).
VEC = [1.0] + [0.0] * 1023


@pytest.fixture
def world(db_session):
    org = Organization(name="Attach Museum", slug=f"att-{uuid4().hex[:8]}")
    db_session.add(org)
    db_session.flush()
    conv_a = Conversation(organization_id=org.organization_id, persona="staff")
    conv_b = Conversation(organization_id=org.organization_id, persona="staff")
    db_session.add_all([conv_a, conv_b])
    db_session.flush()

    db_session.add_all([
        # corpus (internal) — staff-visible, conversation_id NULL
        ReferenceChunk(source="org_docs", document="Corpus Internal",
                       content="loan return procedure", organization_id=org.organization_id,
                       visibility="internal", embedding_vec=VEC),
        # corpus (public) — visitor-visible
        ReferenceChunk(source="org_docs", document="Corpus Public",
                       content="visitor hours", organization_id=org.organization_id,
                       visibility="public", embedding_vec=VEC),
        # PERSONAL attachment, scoped to conversation A
        ReferenceChunk(source="org_docs", document="Personal A",
                       content="my private notes", organization_id=org.organization_id,
                       conversation_id=conv_a.conversation_id, embedding_vec=VEC),
    ])
    db_session.commit()
    return org, conv_a, conv_b


def _ctx(db_session, org, conv_id=None, persona="staff"):
    return AgentContext(
        organization_id=org.organization_id,
        user_id=None,
        persona=persona,
        db_session=db_session,
        conversation_id=conv_id,
    )


def _docs(result):
    return {r["document"] for r in result.get("results", [])}


class TestPersonalAttachmentIsolation:
    def test_corpus_search_excludes_personal(self, db_session, world):
        org, conv_a, _ = world
        # No conversation context, no opt-in → corpus only.
        docs = _docs(_search_chunks(VEC, _ctx(db_session, org)))
        assert "Corpus Internal" in docs
        assert "Personal A" not in docs

    def test_personal_visible_in_its_own_conversation(self, db_session, world):
        org, conv_a, _ = world
        docs = _docs(_search_chunks(
            VEC, _ctx(db_session, org, conv_a.conversation_id), include_conversation=True))
        assert "Personal A" in docs
        assert "Corpus Internal" in docs  # corpus still included

    def test_personal_hidden_in_other_conversation(self, db_session, world):
        org, _, conv_b = world
        docs = _docs(_search_chunks(
            VEC, _ctx(db_session, org, conv_b.conversation_id), include_conversation=True))
        assert "Personal A" not in docs  # belongs to conv A, not B

    def test_personal_hidden_from_visitor_widget(self, db_session, world):
        org, conv_a, _ = world
        # Visitor/widget path: public_only, no conversation opt-in.
        docs = _docs(_search_chunks(
            VEC, _ctx(db_session, org, conv_a.conversation_id, persona="visitor"),
            org_only=True, public_only=True, include_conversation=False))
        assert docs == {"Corpus Public"}  # only the public corpus chunk
        assert "Personal A" not in docs
        assert "Corpus Internal" not in docs

    def test_opt_in_without_conversation_id_is_corpus_only(self, db_session, world):
        org, _, _ = world
        # include_conversation=True but no conversation_id → still corpus only.
        docs = _docs(_search_chunks(VEC, _ctx(db_session, org), include_conversation=True))
        assert "Personal A" not in docs
