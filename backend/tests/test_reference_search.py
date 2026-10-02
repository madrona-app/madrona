"""Regression test for reference RAG search dimension handling.

A hardcoded `cast(:vec as vector(768))` in _search_chunks broke lookup_reference
after the Voyage 1024-dim migration (psycopg DataException "expected 768
dimensions, not 1024"), which aborted the request transaction and surfaced to
users as a Guide "database connectivity" / "Internal error". _search_chunks now
casts to the query vector's own length, which must match the embedding_vec
pgvector column.
"""

from app.models.reference import ReferenceChunk
from app.services.agent_tools import AgentContext
from app.services.agent_tools.reference_tools import _search_chunks

# Must match the embedding_vec column width (guide_voyage_embeddings_1024).
EMBEDDING_DIM = 1024


def test_search_chunks_matches_column_dimension(db_session, demo_tenant):
    vec = [0.1] * EMBEDDING_DIM
    db_session.add(ReferenceChunk(
        organization_id=None,  # global chunk (staff scope includes it)
        source="playbook",
        document="accession_new_object.md",
        section="Essential fields",
        content="Record the creator or maker on the catalog record.",
        embedding=vec,
        embedding_vec=vec,
    ))
    db_session.flush()

    ctx = AgentContext(
        organization_id=demo_tenant.organization_id,
        user_id=None,
        persona="staff",
        db_session=db_session,
    )

    res = _search_chunks(vec, ctx, org_only=False, limit=4)

    # The hardcoded-768 bug returned {"error": "Reference search unavailable"}.
    assert "error" not in res, res
    assert len(res["results"]) >= 1
    # Identical vectors → cosine similarity ~1.0.
    assert res["results"][0]["similarity"] > 0.99
