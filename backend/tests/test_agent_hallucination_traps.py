"""
Hallucination trap tests — fabricated provenance, rights, creators, valuations.

These tests verify that the guardrail pipeline catches common LLM hallucination
patterns in museum context responses.
"""

import pytest

from app.services.agent_guardrails import GuardrailService


class TestFabricatedProvenance:
    """Fabricated provenance claims should trigger grounding checks."""

    def _svc(self):
        return GuardrailService()

    def test_fabricated_provenance_claim(self):
        """Claiming specific provenance not in tool results → grounding warning."""
        result = self._svc().check_response(
            "This painting was created by Rembrandt in his Amsterdam studio.",
            [{"creators": [{"name": "Unknown Artist"}], "object_number": "2024.1.1"}],
            persona="visitor",
        )
        # "created by Rembrandt" doesn't match "Unknown Artist"
        assert result.blocked is True
        assert any(w["check"] == "source_grounding" for w in result.warnings)


class TestFabricatedRights:
    """Fabricated rights claims should be caught by tiered rights enforcement."""

    def _svc(self):
        return GuardrailService()

    def test_fabricated_rights_no_record(self):
        """Claiming 'free to use' when no rights info exists → blocked."""
        result = self._svc().check_response(
            "This image is free to use for any purpose.",
            [{"object_number": "2024.1.1"}],
            persona="visitor",
        )
        assert result.blocked is True
        assert "rights department" in result.replacement.lower()

    def test_fabricated_rights_permissive(self):
        """Claiming 'free to use' when rights are CC-BY → blocked (needs attribution)."""
        result = self._svc().check_response(
            "This image is free to download and use without restriction.",
            [{"rights_status": "CC-BY", "object_number": "2024.1.1"}],
            persona="visitor",
        )
        assert result.blocked is True
        assert "attribution" in result.replacement.lower()

    def test_fabricated_rights_ccby_free_blocked(self):
        """'free to use' + CC-BY → blocked, replacement mentions attribution."""
        result = self._svc().check_response(
            "This work is free to copy and share.",
            [{"rights_status": "CC-BY", "object_number": "2024.1.1"}],
            persona="visitor",
        )
        assert result.blocked is True
        assert result.replacement is not None


class TestFabricatedValuation:
    """Fabricated valuation claims should be caught by museum policy gates."""

    def _svc(self):
        return GuardrailService()

    def test_fabricated_valuation(self):
        """Assigning a specific dollar value → blocked by museum policy."""
        result = self._svc().check_response(
            "This piece is valued at $50,000 based on recent sales.",
            [{"object_number": "2024.1.1"}],
            persona="visitor",
        )
        assert result.blocked is True
        assert any("valuation" in w["check"] for w in result.warnings)


class TestFabricatedAttribution:
    """Fabricated attribution claims should trigger source grounding."""

    def _svc(self):
        return GuardrailService()

    def test_fabricated_creator(self):
        """Claiming wrong creator → blocked + retryable for visitor."""
        result = self._svc().check_response(
            "This masterpiece was painted by Picasso during his Blue Period.",
            [{"creators": [{"name": "Monet, Claude"}], "object_number": "2024.1.1"}],
            persona="visitor",
        )
        assert result.blocked is True
        assert result.retryable is True
        assert any(w["check"] == "source_grounding" for w in result.warnings)

    def test_correct_attribution_passes(self):
        """Correct creator claim → no grounding warning."""
        result = self._svc().check_response(
            "This work was painted by Monet during his time at Giverny.",
            [{"creators": [{"name": "Monet, Claude"}], "object_number": "2024.1.1"}],
            persona="visitor",
        )
        grounding = [w for w in result.warnings if w["check"] == "source_grounding"]
        assert len(grounding) == 0


class TestSensitiveMaterial:
    """Cultural sensitivity topics should be blocked for visitors."""

    def _svc(self):
        return GuardrailService()

    def test_sensitive_material(self):
        """NAGPRA-related content → blocked for visitor."""
        result = self._svc().check_response(
            "This sacred object is subject to NAGPRA repatriation proceedings.",
            [],
            persona="visitor",
            user_message="Tell me about this object's NAGPRA status",
        )
        assert result.blocked is True

    def test_sensitive_staff_warned(self):
        """NAGPRA-related content → warned (not blocked) for staff."""
        result = self._svc().check_response(
            "This sacred object is subject to NAGPRA repatriation proceedings.",
            [],
            persona="staff",
            user_message="Tell me about this object's NAGPRA status",
        )
        assert result.blocked is False
        assert any("cultural" in w["check"] for w in result.warnings)
