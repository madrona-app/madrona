"""
Tests for museum policy gates — multilingual, tiered rights, user+output gating.
"""

import pytest

from app.services.agent_guardrails import GuardrailService


class TestPreCheckUserInput:
    """Tests for check_user_input (visitor pre-check before Ollama)."""

    def _svc(self):
        return GuardrailService()

    def test_visitor_valuation_blocked(self):
        result = self._svc().check_user_input("How much is this painting worth?", "visitor")
        assert result is not None
        assert result.blocked is True
        assert any(w["check"] == "museum_policy_valuation" for w in result.warnings)

    def test_visitor_valuation_spanish(self):
        result = self._svc().check_user_input("¿Cuánto vale esta pintura?", "visitor")
        assert result is not None
        assert result.blocked is True

    def test_visitor_valuation_french(self):
        result = self._svc().check_user_input("Combien vaut ce tableau?", "visitor")
        assert result is not None
        assert result.blocked is True

    def test_visitor_authenticity_blocked(self):
        result = self._svc().check_user_input("Is this painting authentic?", "visitor")
        assert result is not None
        assert result.blocked is True
        assert any(w["check"] == "museum_policy_authenticity" for w in result.warnings)

    def test_visitor_authenticity_french(self):
        result = self._svc().check_user_input("Est-ce authentique?", "visitor")
        assert result is not None
        assert result.blocked is True

    def test_visitor_cultural_sensitivity(self):
        result = self._svc().check_user_input(
            "Tell me about the NAGPRA repatriation process", "visitor"
        )
        assert result is not None
        assert result.blocked is True

    def test_staff_precheck_none(self):
        """Staff should never be pre-check blocked."""
        result = self._svc().check_user_input("How much is this worth?", "staff")
        assert result is None

    def test_no_false_positive_value_sentence(self):
        """'valuable to art history' should NOT trigger valuation gate."""
        result = self._svc().check_user_input(
            "This piece is valuable to art history.", "visitor"
        )
        # Should not trigger — doesn't contain valuation keywords
        assert result is None

    def test_clean_message_passes(self):
        result = self._svc().check_user_input("Tell me about this painting", "visitor")
        assert result is None


class TestMuseumPolicyOutputGating:
    """Tests for _check_museum_policy on assistant output."""

    def _svc(self):
        return GuardrailService()

    def test_visitor_authenticity_response_blocked(self):
        result = self._svc().check_response(
            "This painting is definitely authentic and dates to the 17th century.",
            [{"object_number": "2024.1.1"}],
            persona="visitor",
        )
        assert result.blocked is True
        assert any("authenticity" in w["check"] for w in result.warnings)

    def test_staff_authenticity_warned(self):
        result = self._svc().check_response(
            "This painting is definitely authentic based on the provenance records.",
            [{"object_number": "2024.1.1"}],
            persona="staff",
        )
        assert result.blocked is False
        assert any("authenticity" in w["check"] for w in result.warnings)

    def test_cultural_sensitivity_blocked(self):
        result = self._svc().check_response(
            "The NAGPRA repatriation process for this object is underway.",
            [],
            persona="visitor",
            user_message="What about NAGPRA?",
        )
        assert result.blocked is True


class TestTieredRights:
    """Tests for tiered rights enforcement."""

    def _svc(self):
        return GuardrailService()

    def test_unrestricted_allowed_pd(self):
        """'free to use' + Public Domain → allowed."""
        result = self._svc().check_response(
            "This image is free to use for any purpose.",
            [{"rights_status": "Public Domain", "object_number": "2024.1.1"}],
            persona="visitor",
        )
        rights_warnings = [w for w in result.warnings if "rights" in w.get("check", "")]
        assert len(rights_warnings) == 0

    def test_unrestricted_blocked_ccby(self):
        """'free to use' + CC-BY → blocked, replacement mentions attribution."""
        result = self._svc().check_response(
            "This image is free to use for any purpose.",
            [{"rights_status": "CC-BY", "object_number": "2024.1.1"}],
            persona="visitor",
        )
        assert result.blocked is True
        assert result.replacement is not None
        assert "attribution" in result.replacement.lower()

    def test_conditional_allowed(self):
        """'reusable with attribution' + CC-BY → allowed (condition phrase matches)."""
        result = self._svc().check_response(
            "This work is reusable with attribution to the museum.",
            [{"rights_status": "CC-BY", "object_number": "2024.1.1"}],
            persona="visitor",
        )
        rights_warnings = [w for w in result.warnings if "rights" in w.get("check", "")]
        assert len(rights_warnings) == 0

    def test_conditional_missing_phrase(self):
        """'reusable' + CC-BY, no 'with attribution' → blocked, condition added."""
        result = self._svc().check_response(
            "This work may be reused for your project.",
            [{"rights_status": "CC-BY", "object_number": "2024.1.1"}],
            persona="visitor",
        )
        assert result.blocked is True
        assert "attribution" in result.replacement.lower()

    def test_unrestricted_blocked_no_record(self):
        """'free to use' + no rights → blocked, rights dept redirect."""
        result = self._svc().check_response(
            "This image is free to use.",
            [{"object_number": "2024.1.1"}],
            persona="visitor",
        )
        assert result.blocked is True
        assert "rights department" in result.replacement.lower()

    def test_no_rights_claim_passes(self):
        """Response without rights claims → no rights check."""
        result = self._svc().check_response(
            "This beautiful painting shows a landscape scene.",
            [{"rights_status": "CC-BY", "object_number": "2024.1.1"}],
            persona="visitor",
        )
        rights_warnings = [w for w in result.warnings if "rights" in w.get("check", "")]
        assert len(rights_warnings) == 0

    def test_staff_rights_warned_not_blocked(self):
        """Staff: rights issues warn, don't block."""
        result = self._svc().check_response(
            "This image is free to use.",
            [{"rights_status": "CC-BY", "object_number": "2024.1.1"}],
            persona="staff",
        )
        assert result.blocked is False
        assert any("rights" in w.get("check", "") for w in result.warnings)


class TestMultilingualSecondarySignal:
    """Tests that user_message is checked as secondary signal."""

    def _svc(self):
        return GuardrailService()

    def test_english_response_to_spanish_question_caught(self):
        """Model answers in English to a Spanish valuation question → caught."""
        result = self._svc().check_response(
            "This piece is valued at $50,000 based on recent sales.",
            [{"object_number": "2024.1.1"}],
            persona="visitor",
            user_message="¿Cuánto vale?",
        )
        assert result.blocked is True
