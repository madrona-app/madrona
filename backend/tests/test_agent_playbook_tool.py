"""
Tests for the lookup_playbook agent tool.

Mocks out the embedding call and the pgvector search so the tool can be
exercised without Ollama or a database. Verifies:
  - query validation
  - wiring to _search_chunks with source='playbook'
  - dominant-document selection (not just top-1 similarity)
  - playbook title + nav hint resolved via PLAYBOOKS map
  - graceful handling of unmapped playbooks and empty results
  - playbook_links filenames match what's actually on disk
"""

from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.services.agent_tools import AgentContext
from app.services.agent_tools.playbook_links import (
    PLAYBOOKS,
    _document_to_slug,
    get_playbook_meta,
)
from app.services.agent_tools.playbook_tools import (
    _best_playbook_meta,
    _build_nav_hint,
    _pick_dominant_document,
    lookup_playbook,
)


def _make_ctx() -> AgentContext:
    return AgentContext(
        organization_id=uuid4(),
        user_id=uuid4(),
        persona="staff",
        db_session=None,
    )


@pytest.fixture
def fake_embed():
    with patch(
        "app.services.agent_tools.playbook_tools._embed_query",
        return_value=[0.1] * 768,
    ):
        yield


class TestDocumentToSlug:
    def test_strips_md(self):
        assert _document_to_slug("accession_new_object.md") == "accession_new_object"

    def test_strips_txt(self):
        assert _document_to_slug("foo.txt") == "foo"

    def test_leaves_other_untouched(self):
        assert _document_to_slug("already_a_slug") == "already_a_slug"


class TestGetPlaybookMeta:
    def test_resolves_known_filename(self):
        meta = get_playbook_meta("accession_new_object.md")
        assert meta is not None
        assert meta.title == "Accession a New Object"
        assert meta.nav_item == "collections:acquisitions"

    def test_resolves_bare_slug(self):
        assert get_playbook_meta("process_loan_in") is not None

    def test_unknown_returns_none(self):
        assert get_playbook_meta("something_random.md") is None


class TestPickDominantDocument:
    def test_picks_document_with_most_chunks(self):
        # Accession playbook has 3 of 4 chunks — should win even if the
        # first (highest-sim) chunk belongs to a different playbook.
        results = [
            {"document": "receive_object_entry.md", "similarity": 0.75},
            {"document": "accession_new_object.md", "similarity": 0.74},
            {"document": "accession_new_object.md", "similarity": 0.73},
            {"document": "accession_new_object.md", "similarity": 0.71},
        ]
        assert _pick_dominant_document(results) == "accession_new_object.md"

    def test_tie_breaks_on_sum_of_similarities(self):
        # 2 chunks each — tie-break on sum, not max. `foo` has a single
        # high-sim outlier but `bar` has two consistently strong hits;
        # summing rewards the consistent one.
        results = [
            {"document": "foo.md", "similarity": 0.90},  # outlier
            {"document": "foo.md", "similarity": 0.40},  # weak second
            {"document": "bar.md", "similarity": 0.72},
            {"document": "bar.md", "similarity": 0.70},
        ]
        # foo sum = 1.30, bar sum = 1.42 → bar wins
        assert _pick_dominant_document(results) == "bar.md"

    def test_empty_returns_none(self):
        assert _pick_dominant_document([]) is None

    def test_skips_rows_without_document(self):
        results = [
            {"document": "", "similarity": 0.9},
            {"document": "foo.md", "similarity": 0.5},
        ]
        assert _pick_dominant_document(results) == "foo.md"


class TestBestPlaybookMeta:
    def test_returns_doc_and_meta_for_known_playbook(self):
        results = [{"document": "start_conservation_treatment.md", "similarity": 0.8}]
        document, meta = _best_playbook_meta(results)
        assert document == "start_conservation_treatment.md"
        assert meta is not None
        assert meta.nav_item == "collections:conservation"

    def test_returns_doc_only_for_unmapped(self):
        results = [{"document": "unknown.md", "similarity": 0.8}]
        document, meta = _best_playbook_meta(results)
        assert document == "unknown.md"
        assert meta is None


class TestBuildNavHint:
    def test_builds_hint_for_known_playbook(self):
        meta = PLAYBOOKS["start_conservation_treatment"]
        hint = _build_nav_hint(meta)
        assert hint is not None
        assert hint["kind"] == "navigation"
        target = hint["target"]
        assert target["id"] == "collections:conservation"
        assert ":orgId" in target["path"]
        assert target["label"]
        assert target["breadcrumb"]


class TestPlaybookLinksCatalogCoverage:
    """Every hand-maintained nav_item id must resolve in the catalog."""

    def test_all_playbook_links_resolve(self):
        from app.services.agent_tools.nav_catalog import load_nav_catalog

        catalog = load_nav_catalog()
        for slug, meta in PLAYBOOKS.items():
            entry = catalog.get(meta.nav_item)
            assert entry is not None, (
                f"Playbook '{slug}' maps to nav id '{meta.nav_item}' "
                "which is not in shared/nav_catalog.json. Update either "
                "playbook_links.py or regenerate the catalog."
            )


class TestPlaybookLinksFilenameCoverage:
    """Every playbook slug must correspond to a file in backend/playbooks/."""

    def test_slugs_match_files_on_disk(self):
        backend_root = Path(__file__).resolve().parents[1]
        playbook_dir = backend_root / "playbooks"
        on_disk = {p.stem for p in playbook_dir.glob("*.md")}
        in_map = set(PLAYBOOKS.keys())
        missing_from_map = on_disk - in_map
        missing_on_disk = in_map - on_disk
        assert not missing_from_map, (
            f"Playbooks on disk but missing from PLAYBOOKS map: {missing_from_map}. "
            "Add them to playbook_links.py."
        )
        assert not missing_on_disk, (
            f"Playbooks in PLAYBOOKS map but not on disk: {missing_on_disk}. "
            "Either rename the .md file or remove the map entry."
        )


class TestLookupPlaybook:
    def test_rejects_empty_query(self, fake_embed):
        result = lookup_playbook({"query": "   "}, _make_ctx())
        assert "error" in result

    def test_surfaces_embedding_failure(self):
        with patch(
            "app.services.agent_tools.playbook_tools._embed_query",
            return_value=None,
        ):
            result = lookup_playbook({"query": "how do I accession"}, _make_ctx())
            assert "error" in result
            assert "Embedding" in result["error"]

    def test_happy_path_attaches_nav_hint(self, fake_embed):
        # Accession playbook dominates — 2 of 3 chunks even though a
        # competing playbook has the top similarity.
        fake_results = {
            "results": [
                {
                    "source": "Madrona Playbook",
                    "document": "receive_object_entry.md",
                    "section": "After the entry",
                    "content": "…",
                    "similarity": 0.75,
                },
                {
                    "source": "Madrona Playbook",
                    "document": "accession_new_object.md",
                    "section": "Essential fields",
                    "content": "…",
                    "similarity": 0.74,
                },
                {
                    "source": "Madrona Playbook",
                    "document": "accession_new_object.md",
                    "section": "Before you save",
                    "content": "…",
                    "similarity": 0.72,
                },
            ]
        }
        with patch(
            "app.services.agent_tools.playbook_tools._search_chunks",
            return_value=fake_results,
        ) as search_mock:
            result = lookup_playbook(
                {"query": "how do I accession a new object"}, _make_ctx()
            )

        call_kwargs = search_mock.call_args.kwargs
        assert call_kwargs.get("source") == "playbook"
        assert call_kwargs.get("org_only") is False

        # Dominant playbook wins, not the top-1 chunk.
        assert result["playbook"] == "Accession a New Object"
        assert "_ui" in result
        assert result["_ui"]["target"]["id"] == "collections:acquisitions"

        # Results are reordered so the dominant playbook's chunks come first.
        assert result["results"][0]["document"] == "accession_new_object.md"
        assert result["results"][1]["document"] == "accession_new_object.md"
        assert result["results"][-1]["document"] == "receive_object_entry.md"

    def test_no_results_returns_message_without_hint(self, fake_embed):
        with patch(
            "app.services.agent_tools.playbook_tools._search_chunks",
            return_value={"results": [], "message": "none"},
        ):
            result = lookup_playbook({"query": "?"}, _make_ctx())
            assert result["results"] == []
            assert "_ui" not in result
            assert "No Madrona playbook" in result["message"]

    def test_unmapped_playbook_omits_hint(self, fake_embed):
        fake_results = {
            "results": [
                {
                    "source": "Madrona Playbook",
                    "document": "completely_unmapped.md",
                    "section": "x",
                    "content": "y",
                    "similarity": 0.9,
                },
            ]
        }
        with patch(
            "app.services.agent_tools.playbook_tools._search_chunks",
            return_value=fake_results,
        ):
            result = lookup_playbook({"query": "?"}, _make_ctx())
            # Falls back to the filename when the slug isn't mapped
            assert result["playbook"] == "completely_unmapped.md"
            assert "_ui" not in result

    def test_default_limit_is_six(self, fake_embed):
        with patch(
            "app.services.agent_tools.playbook_tools._search_chunks",
            return_value={"results": []},
        ) as search_mock:
            lookup_playbook({"query": "x"}, _make_ctx())
            assert search_mock.call_args.kwargs.get("limit") == 6

    def test_honors_limit_cap(self, fake_embed):
        with patch(
            "app.services.agent_tools.playbook_tools._search_chunks",
            return_value={"results": []},
        ) as search_mock:
            lookup_playbook({"query": "x", "limit": 99}, _make_ctx())
            assert search_mock.call_args.kwargs.get("limit") == 8

    def test_search_error_passes_through(self, fake_embed):
        with patch(
            "app.services.agent_tools.playbook_tools._search_chunks",
            return_value={"error": "db down"},
        ):
            result = lookup_playbook({"query": "x"}, _make_ctx())
            assert result == {"error": "db down"}
