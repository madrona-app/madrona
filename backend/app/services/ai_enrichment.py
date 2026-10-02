"""
AI-assisted enrichment service for filling in missing fields.

Uses Claude API (with Ollama fallback) to intelligently suggest values for
missing fields based on existing record data and profile requirements.

USAGE:
    from app.services.ai_enrichment import AIEnrichmentService

    service = AIEnrichmentService()

    # Suggest values for missing fields
    suggestions = service.suggest_missing_fields(
        record={"properties": {"title": "Untitled Portrait", "medium": "Oil on canvas"}},
        profile_name="collections",
    )
    # Returns: [
    #     EnrichmentSuggestion(field="object_type", value="painting", confidence=0.9),
    #     EnrichmentSuggestion(field="classification", value="Paintings", confidence=0.8),
    # ]

    # Enhance a description
    enhanced = service.enhance_description(
        title="The Starry Night",
        existing_description="Painting by Van Gogh",
        context={"date_display": "June 1889", "medium": "Oil on canvas"}
    )

NOTE: Requires ANTHROPIC_API_KEY environment variable for Claude API access.
"""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

import requests
from anthropic import Anthropic, APIError

from app.config import get_settings
from app.schemas.profiles import get_profile, PROFILE_REGISTRY

logger = logging.getLogger(__name__)


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class EnrichmentSuggestion:
    """A suggested value for a missing field."""

    field: str
    value: Any
    confidence: float
    reasoning: str | None = None
    source: str = "ai"  # "ai", "inferred", "default"

    def to_dict(self) -> dict[str, Any]:
        result = {
            "field": self.field,
            "value": self.value,
            "confidence": self.confidence,
            "source": self.source,
        }
        if self.reasoning:
            result["reasoning"] = self.reasoning
        return result


@dataclass
class EnrichmentResult:
    """Result of an enrichment operation."""

    record: dict[str, Any]
    suggestions: list[EnrichmentSuggestion] = field(default_factory=list)
    applied_count: int = 0
    skipped_count: int = 0
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "suggestions": [s.to_dict() for s in self.suggestions],
            "applied_count": self.applied_count,
            "skipped_count": self.skipped_count,
            "error": self.error,
        }


# =============================================================================
# PROFILE FIELD DESCRIPTIONS
# =============================================================================

# Common field descriptions for context
FIELD_DESCRIPTIONS = {
    "object_type": "The type or category of the object (e.g., painting, sculpture, photograph, textile, furniture)",
    "classification": "Broader classification category (e.g., Paintings, Sculpture, Decorative Arts)",
    "department": "Museum department that curates this object",
    "culture": "Cultural or geographic origin (e.g., American, French, Chinese)",
    "period": "Historical period or era (e.g., Renaissance, Modern, Ancient)",
    "dynasty": "Dynastic period if applicable",
    "date_display": "Human-readable date string (e.g., 'ca. 1889', '19th century', '1450-1500')",
    "medium": "Materials and techniques used (e.g., 'Oil on canvas', 'Bronze', 'Woodblock print')",
    "credit_line": "Acknowledgment text for donors/acquisition",
    "provenance": "Ownership history summary",
    "description": "Descriptive text about the object",
}


# =============================================================================
# AI ENRICHMENT SERVICE
# =============================================================================

class AIEnrichmentService:
    """Service for AI-assisted field enrichment."""

    def __init__(self):
        self.settings = get_settings()
        self._anthropic_client: Anthropic | None = None

    @property
    def anthropic_client(self) -> Anthropic | None:
        """Lazy-load Anthropic client."""
        if self._anthropic_client is None and self.settings.anthropic_api_key:
            self._anthropic_client = Anthropic(api_key=self.settings.anthropic_api_key)
        return self._anthropic_client

    def suggest_missing_fields(
        self,
        record: dict[str, Any],
        profile_name: str | None = None,
        fields_to_suggest: list[str] | None = None,
        min_confidence: float = 0.6,
    ) -> list[EnrichmentSuggestion]:
        """
        Suggest values for missing fields based on existing record data.

        Args:
            record: The record to analyze
            profile_name: Optional profile to determine which fields to suggest
            fields_to_suggest: Explicit list of fields to suggest values for
            min_confidence: Minimum confidence threshold for suggestions

        Returns:
            List of EnrichmentSuggestion objects
        """
        properties = record.get("properties", {})

        # Determine which fields to suggest
        if fields_to_suggest:
            missing_fields = [f for f in fields_to_suggest if not properties.get(f)]
        elif profile_name:
            missing_fields = self._get_missing_profile_fields(record, profile_name)
        else:
            # Default to common fields
            missing_fields = [
                f for f in ["object_type", "classification", "culture", "period"]
                if not properties.get(f)
            ]

        if not missing_fields:
            return []

        # Build context from existing fields
        context = self._build_context(record)

        if not context:
            logger.warning("No context available for AI enrichment")
            return []

        # Use AI to suggest values
        suggestions = self._suggest_with_ai(
            context=context,
            missing_fields=missing_fields,
            profile_name=profile_name,
        )

        # Filter by confidence
        return [s for s in suggestions if s.confidence >= min_confidence]

    def enhance_description(
        self,
        title: str,
        existing_description: str | None = None,
        context: dict[str, Any] | None = None,
        max_length: int = 500,
    ) -> EnrichmentSuggestion | None:
        """
        Enhance or generate a description for an object.

        Args:
            title: Object title
            existing_description: Existing description to enhance (or None to generate)
            context: Additional context (date, medium, creator, etc.)
            max_length: Maximum description length

        Returns:
            EnrichmentSuggestion with enhanced description, or None if failed
        """
        if not self.anthropic_client:
            logger.warning("Anthropic API not available for description enhancement")
            return None

        prompt = self._build_description_prompt(
            title=title,
            existing_description=existing_description,
            context=context or {},
            max_length=max_length,
        )

        try:
            response = self.anthropic_client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=1024,
                temperature=0.7,  # Slightly higher for creative text
                messages=[{"role": "user", "content": prompt}],
            )

            result = response.content[0].text.strip()

            # Parse JSON response
            try:
                data = json.loads(result)
                description = data.get("description", result)
                confidence = data.get("confidence", 0.7)
            except json.JSONDecodeError:
                description = result
                confidence = 0.6

            return EnrichmentSuggestion(
                field="description",
                value=description[:max_length],
                confidence=confidence,
                source="ai",
            )

        except Exception as e:
            logger.error(f"Description enhancement failed: {e}")
            return None

    def generate_tiered_descriptions(
        self,
        image_url: str,
        context: dict[str, Any] | None = None,
        model: str = "claude-sonnet-4-6",
    ) -> dict[str, Any] | None:
        """
        Generate three tiers of descriptions for an image (Cooper Hewitt pattern).

        Tiers:
            alt_text: ~15 words, factual identification for screen readers / fallback
            description_long: 100-300 words, richer contextual/compositional detail
            emoji: 1-4 emojis capturing the gist (language-agnostic summary)

        ``context`` should carry what we know about the asset — title, creator,
        date, medium, etc. The model uses it to ground the description rather
        than invent facts from pixels alone.

        Returns a dict with keys: ``alt_text``, ``description_long``, ``emoji``,
        ``model``. Returns ``None`` on failure.
        """
        if not self.anthropic_client:
            logger.warning("Anthropic API not available for description generation")
            return None

        ctx_block = ""
        if context:
            ctx_block = (
                "Known metadata (use this to ground your descriptions "
                "rather than guess from the image alone):\n"
                f"{json.dumps(context, indent=2)}\n\n"
            )

        prompt = (
            f"{ctx_block}"
            "Produce three tiers of description for the attached image, following the "
            "Cooper Hewitt accessibility guidelines.\n\n"
            "Return a single JSON object with exactly these keys and constraints:\n"
            '  "alt_text": a single sentence of roughly 15 words that factually identifies '
            "what is in the image for screen-reader use. Lead with the noun subject. "
            "No interpretive language.\n"
            '  "description_long": 100-300 words describing composition, subject, materials/'
            "technique if visible, and relevant context. Ground statements in the metadata. "
            "If something is uncertain, say so ('appears to be'). Avoid flowery prose.\n"
            '  "emoji": 1 to 4 emojis capturing the essence of the image, separated by nothing. '
            "Think of it as a language-independent tag.\n\n"
            "Be respectful of cultural subject matter. If the image may depict sacred, "
            "sensitive, or culturally restricted content, keep descriptions factual and "
            "succinct and add a final key \"sensitivity_flag\": true on the JSON object. "
            "Otherwise omit that key.\n\n"
            "Output ONLY the JSON object, no preamble or markdown fencing."
        )

        # Build the image content block. The URL-source form is simplest but
        # newer Anthropic SDKs only; fall back to base64 if the API rejects it.
        def _build_image_block_url() -> dict[str, Any]:
            return {"type": "image", "source": {"type": "url", "url": image_url}}

        def _build_image_block_b64() -> dict[str, Any] | None:
            try:
                import base64
                r = requests.get(image_url, timeout=30)
                r.raise_for_status()
                media_type = r.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
                data = base64.standard_b64encode(r.content).decode("ascii")
                return {
                    "type": "image",
                    "source": {"type": "base64", "media_type": media_type, "data": data},
                }
            except Exception as e:
                logger.error(f"Could not fetch image for base64 encoding: {e}")
                return None

        def _call(image_block: dict[str, Any]) -> str | None:
            try:
                response = self.anthropic_client.messages.create(
                    model=model,
                    max_tokens=1024,
                    temperature=0.2,
                    messages=[{
                        "role": "user",
                        "content": [image_block, {"type": "text", "text": prompt}],
                    }],
                )
                return response.content[0].text.strip()
            except APIError as e:
                # Surface the underlying message to logs but let caller decide to retry.
                logger.warning(f"Claude API error during tiered description: {e}")
                raise
            except Exception as e:
                logger.error(f"Tiered description call failed: {e}")
                raise

        raw: str | None = None
        try:
            raw = _call(_build_image_block_url())
        except APIError as e:
            # If the URL form is unsupported on this SDK/account, retry with base64.
            msg = str(e).lower()
            if "url" in msg or "source" in msg or "invalid_request" in msg or getattr(e, "status_code", None) == 400:
                logger.info("Retrying tiered description with base64-encoded image")
                b64_block = _build_image_block_b64()
                if b64_block is None:
                    return None
                try:
                    raw = _call(b64_block)
                except Exception:
                    return None
            else:
                return None
        except Exception:
            return None

        if not raw:
            return None

        # Strip a possible ```json fence even though we asked for bare JSON.
        cleaned = raw
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
            cleaned = re.sub(r"\n?```$", "", cleaned)

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            logger.warning("Tiered description response was not JSON: %r", raw[:200])
            return None

        alt = (data.get("alt_text") or "").strip()
        long_desc = (data.get("description_long") or "").strip()
        emoji = (data.get("emoji") or "").strip()

        if not alt and not long_desc and not emoji:
            logger.warning("Tiered description returned empty fields")
            return None

        return {
            "alt_text": alt[:500] or None,
            "description_long": long_desc or None,
            "emoji": emoji[:50] or None,
            "sensitivity_flag": bool(data.get("sensitivity_flag", False)),
            "model": model,
        }

    def classify_object_type(
        self,
        record: dict[str, Any],
    ) -> EnrichmentSuggestion | None:
        """
        Classify an object's type based on available information.

        Args:
            record: Record with properties to analyze

        Returns:
            EnrichmentSuggestion for object_type, or None if failed
        """
        properties = record.get("properties", {})

        # Check if already classified
        if properties.get("object_type"):
            return None

        context = self._build_context(record)
        if not context:
            return None

        suggestions = self._suggest_with_ai(
            context=context,
            missing_fields=["object_type", "classification"],
            profile_name="collections",
        )

        # Return first object_type suggestion
        for s in suggestions:
            if s.field == "object_type":
                return s

        return None

    def enrich_record(
        self,
        record: dict[str, Any],
        profile_name: str | None = None,
        auto_apply: bool = False,
        min_confidence: float = 0.7,
    ) -> EnrichmentResult:
        """
        Enrich a record with AI-suggested values.

        Args:
            record: Record to enrich
            profile_name: Profile to use for field requirements
            auto_apply: If True, apply suggestions above min_confidence
            min_confidence: Minimum confidence for auto-apply

        Returns:
            EnrichmentResult with suggestions and optionally modified record
        """
        suggestions = self.suggest_missing_fields(
            record=record,
            profile_name=profile_name,
            min_confidence=0.5,  # Get all suggestions, filter for apply
        )

        result = EnrichmentResult(
            record=dict(record),
            suggestions=suggestions,
        )

        if auto_apply and suggestions:
            properties = result.record.get("properties", {})
            if not isinstance(properties, dict):
                properties = {}
                result.record["properties"] = properties

            for suggestion in suggestions:
                if suggestion.confidence >= min_confidence:
                    properties[suggestion.field] = suggestion.value
                    result.applied_count += 1
                else:
                    result.skipped_count += 1

        return result

    # -------------------------------------------------------------------------
    # Private Methods
    # -------------------------------------------------------------------------

    def _get_missing_profile_fields(
        self,
        record: dict[str, Any],
        profile_name: str,
    ) -> list[str]:
        """Get list of missing recommended/required fields for a profile."""
        profile = get_profile(profile_name)
        if not profile:
            return []

        properties = record.get("properties", {})
        missing = []

        # Check required fields
        for field_name in profile.required_properties:
            if not properties.get(field_name):
                missing.append(field_name)

        # Check recommended fields (limit to avoid too many suggestions)
        for field_name in profile.recommended_properties[:10]:
            if not properties.get(field_name) and field_name not in missing:
                missing.append(field_name)

        return missing

    def _build_context(self, record: dict[str, Any]) -> dict[str, Any]:
        """Build context dict from existing record data."""
        context = {}

        # Add label/title
        if record.get("label"):
            context["title"] = record["label"]

        # Add type
        if record.get("type"):
            context["entity_type"] = record["type"]

        # Add properties
        properties = record.get("properties", {})
        for key, value in properties.items():
            if value and key not in context:
                context[key] = value

        # Limit context size
        if len(context) > 15:
            # Keep most important fields
            priority_fields = [
                "title", "entity_type", "medium", "date_display", "creator",
                "date_created", "accession_number", "dimensions", "description"
            ]
            filtered = {k: context[k] for k in priority_fields if k in context}
            # Add a few more
            for k, v in list(context.items())[:5]:
                if k not in filtered:
                    filtered[k] = v
            context = filtered

        return context

    def _suggest_with_ai(
        self,
        context: dict[str, Any],
        missing_fields: list[str],
        profile_name: str | None = None,
    ) -> list[EnrichmentSuggestion]:
        """Use AI to suggest values for missing fields."""
        if not self.anthropic_client:
            logger.warning("Anthropic API not available for field suggestions")
            return []

        prompt = self._build_suggestion_prompt(
            context=context,
            missing_fields=missing_fields,
            profile_name=profile_name,
        )

        try:
            response = self.anthropic_client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=2048,
                temperature=0.3,  # Lower temperature for factual suggestions
                messages=[{"role": "user", "content": prompt}],
            )

            result = response.content[0].text.strip()

            # Parse JSON response
            return self._parse_suggestions(result, missing_fields)

        except APIError as e:
            logger.error(f"Claude API error during enrichment: {e}")
            return []
        except Exception as e:
            logger.error(f"Enrichment failed: {e}")
            return []

    def _build_suggestion_prompt(
        self,
        context: dict[str, Any],
        missing_fields: list[str],
        profile_name: str | None = None,
    ) -> str:
        """Build prompt for field suggestion."""
        # Build field descriptions
        field_desc = []
        for field in missing_fields:
            desc = FIELD_DESCRIPTIONS.get(field, f"The {field.replace('_', ' ')} of the object")
            field_desc.append(f"- {field}: {desc}")

        profile_context = ""
        if profile_name:
            profile_context = f"\nThis record is for a {profile_name} profile (museum/cultural heritage data)."

        return f"""You are analyzing a museum/cultural heritage record to suggest values for missing fields.

EXISTING RECORD DATA:
{json.dumps(context, indent=2)}
{profile_context}

FIELDS TO SUGGEST VALUES FOR:
{chr(10).join(field_desc)}

Based on the existing data, suggest appropriate values for each missing field.
Be conservative - only suggest values you're confident about based on the available context.
For date_display, use standard museum date formats (e.g., "ca. 1889", "late 19th century", "1450-1500").
For object_type, use common museum terminology (e.g., "painting", "sculpture", "photograph", "textile").
For classification, use broader categories (e.g., "Paintings", "Sculpture", "Decorative Arts", "Photographs").

Respond with a JSON object containing:
{{
  "suggestions": [
    {{
      "field": "field_name",
      "value": "suggested value",
      "confidence": 0.0-1.0,
      "reasoning": "brief explanation"
    }}
  ]
}}

Only include suggestions where you have reasonable confidence (>0.5).
If you cannot suggest a value for a field, omit it from the response."""

    def _build_description_prompt(
        self,
        title: str,
        existing_description: str | None,
        context: dict[str, Any],
        max_length: int,
    ) -> str:
        """Build prompt for description enhancement."""
        context_str = json.dumps(context, indent=2) if context else "No additional context"

        if existing_description:
            task = f"""Enhance and expand the following description while keeping it factual and museum-appropriate:

EXISTING DESCRIPTION:
{existing_description}"""
        else:
            task = "Generate a brief, informative museum-style description."

        return f"""You are writing a description for a museum object.

TITLE: {title}

CONTEXT:
{context_str}

TASK:
{task}

Requirements:
- Keep the description factual and based only on the provided information
- Use professional museum language
- Maximum {max_length} characters
- Do not invent specific historical facts not supported by the context
- Focus on observable characteristics, materials, and significance

Respond with a JSON object:
{{
  "description": "your description here",
  "confidence": 0.0-1.0
}}"""

    def _parse_suggestions(
        self,
        response: str,
        expected_fields: list[str],
    ) -> list[EnrichmentSuggestion]:
        """Parse AI response into EnrichmentSuggestion objects."""
        suggestions = []

        try:
            # Try to extract JSON from response
            json_match = re.search(r'\{[\s\S]*\}', response)
            if json_match:
                data = json.loads(json_match.group())
            else:
                logger.warning("No JSON found in AI response")
                return []

            for item in data.get("suggestions", []):
                field = item.get("field")
                value = item.get("value")
                confidence = item.get("confidence", 0.5)

                if field and value and field in expected_fields:
                    suggestions.append(EnrichmentSuggestion(
                        field=field,
                        value=value,
                        confidence=float(confidence),
                        reasoning=item.get("reasoning"),
                        source="ai",
                    ))

        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse AI response as JSON: {e}")
        except Exception as e:
            logger.error(f"Error parsing suggestions: {e}")

        return suggestions


# =============================================================================
# MODULE-LEVEL FUNCTIONS
# =============================================================================

_service: AIEnrichmentService | None = None


def get_enrichment_service() -> AIEnrichmentService:
    """Get or create the AI enrichment service singleton."""
    global _service
    if _service is None:
        _service = AIEnrichmentService()
    return _service


def suggest_missing_fields(
    record: dict[str, Any],
    profile_name: str | None = None,
    fields_to_suggest: list[str] | None = None,
) -> list[EnrichmentSuggestion]:
    """Convenience function to suggest missing fields."""
    return get_enrichment_service().suggest_missing_fields(
        record=record,
        profile_name=profile_name,
        fields_to_suggest=fields_to_suggest,
    )


def enrich_record(
    record: dict[str, Any],
    profile_name: str | None = None,
    auto_apply: bool = False,
    min_confidence: float = 0.7,
) -> EnrichmentResult:
    """Convenience function to enrich a record."""
    return get_enrichment_service().enrich_record(
        record=record,
        profile_name=profile_name,
        auto_apply=auto_apply,
        min_confidence=min_confidence,
    )
