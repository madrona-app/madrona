"""Tests for the AI layout-suggester service.

Pure: the LLM client is stubbed, so these don't touch the DB or a real model.
"""

import json
from types import SimpleNamespace

import pytest

import app.services.llm_client as llm_mod
from app.services.layout_suggester import (
    CatalogSection,
    LayoutSuggestionError,
    suggest_layout_delta,
)

CATALOG = [
    CatalogSection(id="media", label="Media", group="overview"),
    CatalogSection(id="identification", label="Identification", group="overview", required=True),
    CatalogSection(id="rights", label="Rights", group="care"),
    CatalogSection(id="valuations", label="Valuations", group="operations"),
]


def _stub_llm(monkeypatch, content: str):
    def fake_get_llm_client(_settings):
        return SimpleNamespace(
            chat=lambda *a, **k: SimpleNamespace(content=content)
        )

    monkeypatch.setattr(llm_mod, "get_llm_client", fake_get_llm_client)


def test_valid_delta(monkeypatch):
    _stub_llm(
        monkeypatch,
        json.dumps({"hidden_sections": ["valuations"], "group_order": ["care", "overview"]}),
    )
    d = suggest_layout_delta(object(), "hide valuations", CATALOG)
    assert d.hidden_sections == ["valuations"]
    assert d.group_order == ["care", "overview"]


def test_unknown_ids_dropped(monkeypatch):
    _stub_llm(
        monkeypatch,
        json.dumps({"hidden_sections": ["ghost", "rights"], "section_order": ["nope", "media"]}),
    )
    d = suggest_layout_delta(object(), "x", CATALOG)
    assert d.hidden_sections == ["rights"]
    assert d.section_order == ["media"]


def test_required_section_never_hidden(monkeypatch):
    _stub_llm(monkeypatch, json.dumps({"hidden_sections": ["identification", "rights"]}))
    d = suggest_layout_delta(object(), "hide everything", CATALOG)
    assert d.hidden_sections == ["rights"]  # identification is required → dropped


def test_tolerant_of_fences_and_prose(monkeypatch):
    _stub_llm(monkeypatch, 'Sure!\n```json\n{"hidden_sections": ["rights"]}\n```\ndone')
    d = suggest_layout_delta(object(), "x", CATALOG)
    assert d.hidden_sections == ["rights"]


def test_non_json_raises(monkeypatch):
    _stub_llm(monkeypatch, "I cannot help with that.")
    with pytest.raises(LayoutSuggestionError):
        suggest_layout_delta(object(), "x", CATALOG)


def test_llm_init_failure_raises(monkeypatch):
    def boom(_settings):
        raise RuntimeError("provider down")

    monkeypatch.setattr(llm_mod, "get_llm_client", boom)
    with pytest.raises(LayoutSuggestionError):
        suggest_layout_delta(object(), "x", CATALOG)
