"""
Tests for agent guardrails — source grounding, name normalization, format compliance.
"""

import pytest

from app.services.agent_guardrails import (
    GuardrailService,
    _normalize_person_name,
    _normalize_year,
    _normalize_accession,
)


class TestNameNormalization:
    """Tests for _normalize_person_name."""

    def test_comma_reversed(self):
        forms = _normalize_person_name("Monet, Claude")
        assert "monet" in forms
        assert "claude monet" in forms
        assert "monet claude" in forms

    def test_diacritics(self):
        forms = _normalize_person_name("Dürer, Albrecht")
        assert "durer" in forms
        assert "albrecht durer" in forms
        assert "durer albrecht" in forms

    def test_cjk_name(self):
        forms = _normalize_person_name("葛飾北斎")
        assert "葛飾北斎" in forms

    def test_van_gogh_lowercase(self):
        forms = _normalize_person_name("van Gogh, Vincent")
        assert "van gogh" in forms
        assert "vincent van gogh" in forms

    def test_simple_name(self):
        forms = _normalize_person_name("Rembrandt")
        assert "rembrandt" in forms

    def test_empty(self):
        forms = _normalize_person_name("")
        assert forms == set()

    def test_spaces_only(self):
        forms = _normalize_person_name("   ")
        assert forms == set()


class TestYearNormalization:
    """Tests for _normalize_year."""

    def test_single_year(self):
        assert _normalize_year("1872") == {"1872"}

    def test_circa(self):
        assert _normalize_year("c. 1642") == {"1642"}

    def test_range(self):
        assert _normalize_year("c. 1642-1645") == {"1642", "1645"}

    def test_display_date(self):
        assert "1889" in _normalize_year("about 1889")


class TestAccessionNormalization:
    def test_basic(self):
        assert _normalize_accession("2024.1.5") == "2024.1.5"

    def test_strips_spaces(self):
        assert _normalize_accession("  2024.1.5  ") == "2024.1.5"


class TestSourceGrounding:
    """Tests for _check_source_grounding."""

    def _svc(self):
        return GuardrailService()

    def test_comma_reversed_passes(self):
        """'painted by Monet' with 'Monet, Claude' in tool results → passes."""
        result = self._svc().check_response(
            "This stunning work painted by Monet captures the light beautifully.",
            [{"creators": [{"name": "Monet, Claude"}], "object_number": "2024.1.1"}],
            persona="visitor",
        )
        grounding_warnings = [w for w in result.warnings if w["check"] == "source_grounding"]
        assert len(grounding_warnings) == 0

    def test_artist_was_pattern(self):
        """'The artist was Monet' triggers check, passes with correct data."""
        result = self._svc().check_response(
            "The artist was Claude Monet, one of the founders of Impressionism.",
            [{"creators": [{"name": "Monet, Claude"}], "object_number": "2024.1.1"}],
            persona="visitor",
        )
        grounding_warnings = [w for w in result.warnings if w["check"] == "source_grounding"]
        assert len(grounding_warnings) == 0

    def test_diacritics_passes(self):
        """'made by Dürer' with 'Durer, Albrecht' → passes (diacritics normalized)."""
        result = self._svc().check_response(
            "This engraving made by Dürer shows incredible detail.",
            [{"creators": [{"name": "Dürer, Albrecht"}], "object_number": "E.100"}],
            persona="visitor",
        )
        grounding_warnings = [w for w in result.warnings if w["check"] == "source_grounding"]
        assert len(grounding_warnings) == 0

    def test_cjk_name_passes(self):
        """'created by 葛飾北斎' with '葛飾北斎' in creators → passes."""
        result = self._svc().check_response(
            "This woodblock print created by 葛飾北斎 is iconic.",
            [{"creators": [{"name": "葛飾北斎"}], "object_number": "J.500"}],
            persona="visitor",
        )
        grounding_warnings = [w for w in result.warnings if w["check"] == "source_grounding"]
        assert len(grounding_warnings) == 0

    def test_van_gogh_lowercase_passes(self):
        """'painted by van Gogh' with 'van Gogh, Vincent' → passes (lowercase start)."""
        result = self._svc().check_response(
            "This masterpiece painted by van Gogh during his stay at Saint-Rémy.",
            [{"creators": [{"name": "van Gogh, Vincent"}], "object_number": "2024.2.1"}],
            persona="visitor",
        )
        grounding_warnings = [w for w in result.warnings if w["check"] == "source_grounding"]
        assert len(grounding_warnings) == 0

    def test_ungrounded_visitor_blocks_retryable(self):
        """'painted by Vermeer' with only Rembrandt → visitor: blocked + retryable."""
        result = self._svc().check_response(
            "This painting painted by Vermeer shows the characteristic use of light.",
            [{"creators": [{"name": "Rembrandt"}], "object_number": "2024.1.1"}],
            persona="visitor",
        )
        assert result.blocked is True
        assert result.retryable is True
        assert any(w["check"] == "source_grounding" for w in result.warnings)

    def test_ungrounded_staff_warns(self):
        """'painted by Vermeer' with only Rembrandt → staff: warn only."""
        result = self._svc().check_response(
            "This painting painted by Vermeer shows the characteristic use of light.",
            [{"creators": [{"name": "Rembrandt"}], "object_number": "2024.1.1"}],
            persona="staff",
        )
        assert result.blocked is False
        assert any(
            w["check"] == "source_grounding" and w["severity"] == "warning"
            for w in result.warnings
        )

    def test_general_history_no_trigger(self):
        """General art history context should not trigger grounding checks."""
        result = self._svc().check_response(
            "Impressionism originated in France in the 1860s and was characterized "
            "by loose brushwork and a focus on capturing light.",
            [{"creators": [{"name": "Monet, Claude"}], "object_number": "2024.1.1"}],
            persona="visitor",
        )
        # No ungrounded warnings (Impressionism/France are general knowledge, not object claims)
        grounding_warnings = [w for w in result.warnings if w["check"] == "source_grounding"]
        assert len(grounding_warnings) == 0

    def test_it_dates_to_pattern(self):
        """'it dates to 1872' → triggers date check."""
        result = self._svc().check_response(
            "This beautiful piece dates to 1872 and captures a serene morning.",
            [{"creation_date": "1872", "creators": [{"name": "Monet, Claude"}], "object_number": "2024.1.1"}],
            persona="visitor",
        )
        grounding_warnings = [w for w in result.warnings if w["check"] == "source_grounding"]
        assert len(grounding_warnings) == 0  # Date matches

    def test_date_warns_never_blocks(self):
        """Date mismatches should warn, never block."""
        result = self._svc().check_response(
            "This piece was painted circa 1900 in a bold new style.",
            [{"creation_date": "1872", "creators": [{"name": "Monet, Claude"}], "object_number": "2024.1.1"}],
            persona="visitor",
        )
        date_warnings = [
            w for w in result.warnings
            if w["check"] == "source_grounding" and "date" in w["message"].lower()
        ]
        assert len(date_warnings) == 1
        assert date_warnings[0]["severity"] == "warning"
        assert result.blocked is False  # Date never blocks

    def test_context_grounding(self):
        """Grounding truth built from context_text as well as tool results."""
        result = self._svc().check_response(
            "This work created by Monet is breathtaking.",
            [],  # No tool results, but context_text provides data
            persona="visitor",
            context_text="Creator(s): Monet, Claude; Date: 1872",
        )
        grounding_warnings = [w for w in result.warnings if w["check"] == "source_grounding"]
        assert len(grounding_warnings) == 0

    def test_no_grounding_data_skips(self):
        """If no grounding data available, skip the check entirely."""
        result = self._svc().check_response(
            "This painting by Someone Unknown is lovely.",
            [{"summary": "Found 1 result"}],  # No creators/dates
            persona="visitor",
        )
        grounding_warnings = [w for w in result.warnings if w["check"] == "source_grounding"]
        assert len(grounding_warnings) == 0


class TestContentSafety:
    """Tests for content safety checks."""

    def test_blocked_pattern(self):
        svc = GuardrailService({"blocked_patterns": ["harmful_content"]})
        result = svc.check_response("This contains harmful_content here", [])
        assert result.blocked is True

    def test_clean_passes(self):
        svc = GuardrailService({"blocked_patterns": ["harmful_content"]})
        result = svc.check_response("This is perfectly fine content", [])
        assert result.passed is True


class TestFormatCompliance:
    """Tests for format compliance (already partially tested in integration)."""

    def test_broken_markdown(self):
        svc = GuardrailService()
        result = svc.check_response(
            "Check out [this link](broken/url\nmore text here",
            [],
            persona="visitor",
        )
        assert any(
            w["check"] == "format_compliance" and "broken" in w["message"]
            for w in result.warnings
        )

class TestPriorAssistantGrounding:
    """URLs/facts already shown to the visitor in prior (guardrail-approved)
    assistant turns are grounded — "give me that link again" must not block.
    User-pasted content must never ground anything (injection laundering)."""

    def _svc(self):
        return GuardrailService()

    PRIOR = (
        "We have [The Great Wave](/c/museum/objects/482ce826) — the iconic "
        "Hokusai woodblock print."
    )

    def test_repeating_prior_link_passes(self):
        result = self._svc().check_response(
            "Here's the link again: [The Great Wave](/c/museum/objects/482ce826)",
            [],  # no tool calls this turn
            persona="visitor",
            prior_assistant_text=self.PRIOR,
        )
        assert result.passed, result.warnings
        assert result.replacement is None

    def test_novel_link_still_blocks_without_tools(self):
        result = self._svc().check_response(
            "Check out [Sunflowers](/c/museum/objects/deadbeef-0000)",
            [],
            persona="visitor",
            prior_assistant_text=self.PRIOR,
        )
        url_blocks = [w for w in result.warnings if w["check"] == "url_integrity"]
        assert len(url_blocks) == 1
        assert result.replacement  # canned fallback applied

    def test_no_prior_text_behaves_as_before(self):
        result = self._svc().check_response(
            "Here: [The Great Wave](/c/museum/objects/482ce826)",
            [],
            persona="visitor",
        )
        url_blocks = [w for w in result.warnings if w["check"] == "url_integrity"]
        assert len(url_blocks) == 1

    def test_fallback_text_does_not_promise_a_search(self):
        result = self._svc().check_response(
            "Here: [Fake](/c/museum/objects/not-real)",
            [],
            persona="visitor",
        )
        assert result.replacement
        assert "Let me search" not in result.replacement

