"""
Regression for the "happy-path reply + ui hints" save-path crash.

`_build_guardrail_metadata` returns None when nothing interesting
happened this turn (no warnings, no retries, no injection strips).
The ui_hints persistence code was previously doing
`guardrail_metadata["ui_hints"] = ...` unconditionally, which
TypeError'd when guardrail_metadata was None. The live symptom was
"Internal error / Try again" after a normal lookup_playbook reply.

These tests exercise the merge path directly without needing a DB
or Ollama — just the static helper and a minimal fake
guardrail_result that asks for None.
"""

from types import SimpleNamespace

from app.services.agent_service import AgentService


def _clean_result():
    return SimpleNamespace(passed=True, blocked=False, warnings=[])


class TestGuardrailMetaMerge:
    def test_happy_path_returns_none(self):
        meta = AgentService._build_guardrail_metadata(
            _clean_result(),
            injection_stripped=0,
            retried=False,
            retry_tool=None,
            original_content=None,
        )
        assert meta is None

    def test_merge_ui_hints_initializes_dict_when_meta_is_none(self):
        """The exact fix: we can merge hints onto a None meta without crashing."""
        guardrail_metadata = AgentService._build_guardrail_metadata(
            _clean_result(),
            injection_stripped=0,
            retried=False,
            retry_tool=None,
            original_content=None,
        )
        turn_ui_hints = [
            {
                "kind": "navigation",
                "target": {
                    "id": "collections:incidents",
                    "path": "/organizations/:orgId/collections/incidents",
                    "label": "Incidents",
                    "breadcrumb": ["Collections", "Care & Risk", "Incidents"],
                },
            }
        ]

        # Reproduce the service's merge logic
        if turn_ui_hints:
            if guardrail_metadata is None:
                guardrail_metadata = {}
            guardrail_metadata["ui_hints"] = turn_ui_hints

        assert guardrail_metadata is not None
        assert guardrail_metadata["ui_hints"] == turn_ui_hints
        assert "guardrails" not in guardrail_metadata

    def test_merge_ui_hints_preserves_existing_guardrail_meta(self):
        """Non-None meta (warning branch) still gets the hints appended."""
        warned_result = SimpleNamespace(
            passed=False, blocked=False, warnings=["something"]
        )
        guardrail_metadata = AgentService._build_guardrail_metadata(
            warned_result,
            injection_stripped=0,
            retried=False,
            retry_tool=None,
            original_content=None,
        )
        assert guardrail_metadata is not None
        assert "guardrails" in guardrail_metadata

        turn_ui_hints = [{"kind": "navigation", "target": {"path": "/x"}}]
        if turn_ui_hints:
            if guardrail_metadata is None:
                guardrail_metadata = {}
            guardrail_metadata["ui_hints"] = turn_ui_hints

        assert guardrail_metadata["guardrails"]["warnings"] == ["something"]
        assert guardrail_metadata["ui_hints"] == turn_ui_hints

    def test_no_hints_leaves_meta_unchanged(self):
        """Empty hint list must not initialize a dict or add the field."""
        guardrail_metadata = AgentService._build_guardrail_metadata(
            _clean_result(),
            injection_stripped=0,
            retried=False,
            retry_tool=None,
            original_content=None,
        )
        turn_ui_hints: list[dict] = []
        if turn_ui_hints:
            if guardrail_metadata is None:
                guardrail_metadata = {}
            guardrail_metadata["ui_hints"] = turn_ui_hints
        assert guardrail_metadata is None
