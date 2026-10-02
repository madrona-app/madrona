"""
Agent response quality guardrails.

Checks agent output for hallucinated objects, fabricated URLs, content safety
violations, and format compliance issues. Returns a structured result that the
agent service uses to annotate or replace responses.
"""

import logging
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# Markdown link pattern: [text](url)
_LINK_RE = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')

# Object number patterns (common formats: 2023.1.2, X.123, ACC-456)
_OBJECT_NUMBER_RE = re.compile(r'\b\d{4}\.\d+(?:\.\d+)*\b|\b[A-Z]{1,4}[-.]\d{3,}\b')

# --- Source grounding claim extraction patterns ---
# Broad capture groups: not gated on [A-Z], handles CJK, lowercase ("van Gogh"), diacritics.
_CREATOR_CLAIM_PATTERNS = [
    re.compile(
        r'(?:painted by|sculpted by|made by|attributed to|created by|designed by|crafted by|work by|piece by|art by)'
        r'\s+(.+?)(?:\.|,\s|$|\n|\s(?:in|at|during|who|which|is|was|shows|depicts|and|the|this|from|using|with)\s)',
        re.IGNORECASE,
    ),
    re.compile(
        r'(?:the artist was|the maker was|this\s+(?:work|piece|painting|sculpture|object)\s+(?:is|was)\s+by)'
        r'\s+(.+?)(?:\.|,\s|$|\n|\s(?:in|at|during|who|which|is|was|and|one|from)\s)',
        re.IGNORECASE,
    ),
]

# Max length for a captured name claim — anything longer is not a person name
_MAX_CLAIM_NAME_LEN = 50

_DATE_CLAIM_PATTERNS = [
    re.compile(
        r'(?:dated?|created?|painted|made|circa|c\.|ca\.)\s+'
        r'((?:circa\s+|c\.\s*|ca\.\s*)?\d{3,4}(?:\s*[-–]\s*\d{3,4})?)',
        re.IGNORECASE,
    ),
    re.compile(
        r'(?:it\s+dates?\s+(?:to|from)|dates?\s+from|from)\s+'
        r'((?:circa\s+|c\.\s*|ca\.\s*)?\d{3,4}(?:\s*[-–]\s*\d{3,4})?)',
        re.IGNORECASE,
    ),
]

_ACCESSION_CLAIM_PATTERNS = [
    re.compile(r'(?:accession|catalog|catalog)\s+(?:number|no\.?|#)\s*:?\s*(\S+)', re.IGNORECASE),
]


# --- Name normalization ---

def _normalize_text(s: str) -> str:
    """NFKD normalize and strip diacritics for comparison."""
    nfkd = unicodedata.normalize("NFKD", s)
    ascii_stripped = nfkd.encode("ascii", "ignore").decode("ascii")
    return ascii_stripped.lower().strip()


def _normalize_person_name(name: str) -> set[str]:
    """Normalize a person name into a set of comparison forms.

    Handles:
    - Comma-reversed: 'Monet, Claude' → {'monet', 'claude monet', 'monet claude'}
    - Diacritics: 'Dürer, Albrecht' → {'durer', 'albrecht durer', ...}
    - CJK: '葛飾北斎' → {'葛飾北斎'} (kept as-is, lowercased)
    """
    forms: set[str] = set()
    name = name.strip()
    if not name:
        return forms

    # Add original lowered + NFKD form
    forms.add(name.lower())
    normalized = _normalize_text(name)
    if normalized:
        forms.add(normalized)

    # Comma-reversed splitting
    if "," in name:
        parts = [p.strip() for p in name.split(",", 1)]
        if len(parts) == 2 and parts[0] and parts[1]:
            last, first = parts
            last_n = _normalize_text(last)
            first_n = _normalize_text(first)
            if last_n:
                forms.add(last_n)
            if first_n and last_n:
                forms.add(f"{first_n} {last_n}")
                forms.add(f"{last_n} {first_n}")
    else:
        # Space-separated: add individual parts + full
        parts = name.split()
        for p in parts:
            n = _normalize_text(p)
            if n:
                forms.add(n)

    return forms


def _normalize_year(date_str: str) -> set[str]:
    """Extract year values from a date string.

    'c. 1642-1645' → {'1642', '1645'}
    'circa 1872' → {'1872'}
    """
    return set(re.findall(r'\d{3,4}', date_str))


def _normalize_accession(acc: str) -> str:
    """Normalize an accession number for comparison."""
    return acc.strip().lower()


# --- Museum policy gates ---
# Multilingual keyword sets per gate (en/es/fr/de/zh/ja)

_VALUATION_KEYWORDS = {
    "how much is", "what is it worth", "price", "apprais", "valuation", "market value",
    "auction estimate", "insurance value",
    "cuánto vale", "precio", "valoración", "tasación",
    "combien vaut", "prix", "valeur", "estimation",
    "wert", "preis", "schätzung", "bewertung",
    "值多少", "价格", "估价", "市场价值",
    "いくら", "価格", "鑑定", "評価額",
}

_AUTHENTICITY_KEYWORDS = {
    "authentic", "is it real", "is this genuine", "forgery", "fake", "counterfeit",
    "definitely authentic", "certificate of authenticity",
    "auténtic", "genuino", "falsificación", "falso",
    "authentique", "véritable", "contrefaçon", "faux",
    "authentisch", "echt", "fälschung",
    "真品", "赝品", "伪造", "鉴定真伪",
    "本物", "偽物", "贋作", "鑑定",
}

_RIGHTS_USAGE_KEYWORDS = {
    "can i use", "can i download", "can i copy", "can i reproduce",
    "commercial use", "print this", "use this image",
    "puedo usar", "puedo descargar", "puedo copiar",
    "puis-je utiliser", "puis-je télécharger",
    "darf ich", "herunterladen", "kopieren",
    "可以使用", "可以下载", "可以复制",
    "使用できますか", "ダウンロード",
}

_CULTURAL_SENSITIVITY_KEYWORDS = {
    "nagpra", "repatriation", "sacred object", "burial", "human remains",
    "repatriación", "objeto sagrado", "restos humanos",
    "rapatriement", "objet sacré", "restes humains",
    "repatriierung", "heiliger gegenstand",
}

# Tiered rights
_UNRESTRICTED_RIGHTS = {
    "public domain", "cc0", "no known copyright", "no known restrictions",
    "no copyright", "pd", "creative commons zero",
}

_CONDITIONAL_RIGHTS = {
    "cc-by": "with attribution",
    "cc-by-sa": "with attribution and share-alike",
    "cc-by-nc": "for non-commercial use only",
    "cc-by-nc-sa": "for non-commercial use with attribution and share-alike",
}

# Claims about unrestricted rights in response text
_UNRESTRICTED_CLAIMS_RE = re.compile(
    r'free to (?:use|download|copy|reproduce)|no copyright|public domain|'
    r'freely available|no restrictions|unrestricted',
    re.IGNORECASE,
)

# Conditional/permissive claims
_CONDITIONAL_CLAIMS_RE = re.compile(
    r'(?:reusable|may be reused|can be used|may be reproduced|available for use)',
    re.IGNORECASE,
)

# Response-level gate patterns (English) for output checking
_VALUATION_RESPONSE_RE = re.compile(
    r'(?:worth|valued at|estimated at|appraised|market value|auction)\s+\$?\d',
    re.IGNORECASE,
)
_AUTHENTICITY_RESPONSE_RE = re.compile(
    r'(?:definitely|certainly|undoubtedly|is)\s+(?:authentic|genuine|real|original)\b'
    r'|(?:confirmed|verified)\s+(?:as\s+)?(?:authentic|genuine)',
    re.IGNORECASE,
)


@dataclass
class GuardrailResult:
    """Result of guardrail checks on an agent response."""
    passed: bool = True
    blocked: bool = False
    retryable: bool = False
    warnings: list[dict] = field(default_factory=list)
    replacement: str | None = None

    def add_warning(
        self,
        check: str,
        message: str,
        severity: str = "warning",
        retryable: bool = False,
    ) -> None:
        self.warnings.append({
            "check": check,
            "message": message,
            "severity": severity,
        })
        if severity == "block":
            self.passed = False
            self.blocked = True
            if retryable:
                self.retryable = True


class GuardrailService:
    """Runs quality and safety checks on agent responses."""

    def __init__(self, config: dict | None = None):
        self.config = config or {}
        self._blocked_patterns: list[re.Pattern] = []
        for pattern in self.config.get("blocked_patterns", []):
            try:
                self._blocked_patterns.append(re.compile(pattern, re.IGNORECASE))
            except re.error:
                logger.warning("Invalid blocked pattern: %s", pattern)

    def check_response(
        self,
        response_text: str,
        tool_results: list[dict] | None = None,
        persona: str = "staff",
        context_text: str | None = None,
        user_message: str | None = None,
        prior_assistant_text: str | None = None,
    ) -> GuardrailResult:
        """Run all guardrail checks on an agent response.

        Args:
            response_text: The agent's text response.
            tool_results: List of tool result dicts from the conversation turn.
            persona: "staff" or "visitor" — controls severity levels.
            context_text: Entity context text injected into the system prompt.
            user_message: The user's message (for secondary signal checks).

        Returns:
            GuardrailResult with pass/fail status and any warnings.
        """
        result = GuardrailResult()
        tool_results = tool_results or []

        # Pipeline order: short-circuit on first block for visitor
        self._check_content_safety(response_text, result)
        if result.blocked and persona == "visitor":
            self._set_default_replacement(result)
            return result

        if prior_assistant_text:
            # Treat previously-emitted (already guardrail-approved) assistant
            # replies as grounding: "give me that link again" must not block.
            # User messages are never included — that would let a visitor
            # launder fabricated URLs/titles into approved output.
            tool_results = list(tool_results) + [
                {"_prior_assistant": prior_assistant_text}
            ]

        self._check_museum_policy(response_text, result, persona, tool_results, user_message)
        if result.blocked and persona == "visitor":
            self._set_default_replacement(result)
            return result

        self._check_hallucinated_objects(response_text, tool_results, result, persona)
        if result.blocked and persona == "visitor":
            self._set_default_replacement(result)
            return result

        self._check_url_integrity(response_text, tool_results, result, persona)
        if result.blocked and persona == "visitor":
            self._set_default_replacement(result)
            return result

        self._check_source_grounding(response_text, tool_results, result, persona, context_text)
        if result.blocked and persona == "visitor":
            self._set_default_replacement(result)
            return result

        self._check_format_compliance(response_text, result, persona, user_message)

        if result.blocked:
            self._set_default_replacement(result)

        return result

    @staticmethod
    def _set_default_replacement(result: GuardrailResult) -> None:
        """Set default replacement text if none provided."""
        if not result.replacement:
            result.replacement = (
                "I couldn't verify part of that answer against the collection "
                "records, so I'd rather not guess. Could you ask me again — "
                "mentioning the object's name or what it looks like helps me "
                "look it up properly."
            )

    def check_user_input(
        self,
        user_message: str,
        persona: str,
    ) -> GuardrailResult | None:
        """Pre-check user input before sending to Ollama.

        Visitor-only. Returns a GuardrailResult with a block+replacement
        if the message triggers a policy gate, or None if OK.
        """
        if persona != "visitor":
            return None

        msg_lower = user_message.lower()

        # Valuation
        if any(kw in msg_lower for kw in _VALUATION_KEYWORDS):
            result = GuardrailResult()
            result.add_warning(
                check="museum_policy_valuation",
                message="Valuation request detected in user input",
                severity="block",
            )
            result.replacement = (
                "I'm not able to provide valuations or price estimates for artworks. "
                "For appraisal services, I'd recommend contacting a certified appraiser "
                "or auction house."
            )
            return result

        # Authenticity
        if any(kw in msg_lower for kw in _AUTHENTICITY_KEYWORDS):
            result = GuardrailResult()
            result.add_warning(
                check="museum_policy_authenticity",
                message="Authenticity question detected in user input",
                severity="block",
            )
            result.replacement = (
                "Authentication requires hands-on examination by a specialist. "
                "I'd recommend contacting the museum's curatorial department for guidance."
            )
            return result

        # Cultural sensitivity
        if any(kw in msg_lower for kw in _CULTURAL_SENSITIVITY_KEYWORDS):
            result = GuardrailResult()
            result.add_warning(
                check="museum_policy_cultural_sensitivity",
                message="Cultural sensitivity topic detected in user input",
                severity="block",
            )
            result.replacement = (
                "Questions about repatriation, sacred objects, and cultural heritage "
                "are important and sensitive. Please contact the museum directly for "
                "information about their policies and practices."
            )
            return result

        return None

    def _check_museum_policy(
        self,
        response_text: str,
        result: GuardrailResult,
        persona: str,
        tool_results: list[dict] | None = None,
        user_message: str | None = None,
    ) -> None:
        """Check assistant output against museum policy gates.

        Checks both the response text AND the user_message as secondary signal
        (model may answer in English to a foreign-language question).

        Visitor: block + replacement. Staff: warn + disclaimer.
        """
        tool_results = tool_results or []
        is_visitor = persona == "visitor"

        # Combine response + user message for checking
        check_text = response_text
        if user_message:
            check_text += " " + user_message
        check_lower = check_text.lower()

        # Valuation gate — check response
        if _VALUATION_RESPONSE_RE.search(response_text):
            self._add_museum_policy_warning(
                result, "museum_policy_valuation",
                "Response contains valuation/pricing information",
                is_visitor,
                "I'm not able to provide valuations or price estimates. "
                "For appraisal services, please contact a certified appraiser.",
            )
            return

        # Valuation — secondary signal from user message
        if any(kw in check_lower for kw in _VALUATION_KEYWORDS):
            if _VALUATION_RESPONSE_RE.search(response_text):
                self._add_museum_policy_warning(
                    result, "museum_policy_valuation",
                    "Valuation keywords in context",
                    is_visitor,
                )
                return

        # Authenticity gate
        if _AUTHENTICITY_RESPONSE_RE.search(response_text):
            self._add_museum_policy_warning(
                result, "museum_policy_authenticity",
                "Response makes authenticity claims",
                is_visitor,
                "Authentication requires hands-on examination by a specialist. "
                "Please contact the museum's curatorial department for guidance.",
            )
            return

        # Authenticity — secondary signal
        if any(kw in check_lower for kw in _AUTHENTICITY_KEYWORDS):
            if _AUTHENTICITY_RESPONSE_RE.search(response_text):
                self._add_museum_policy_warning(
                    result, "museum_policy_authenticity",
                    "Authenticity keywords in context",
                    is_visitor,
                )
                return

        # Cultural sensitivity gate
        if any(kw in check_lower for kw in _CULTURAL_SENSITIVITY_KEYWORDS):
            # Only block if the response discusses the topic, not just mentions it
            resp_lower = response_text.lower()
            if any(kw in resp_lower for kw in _CULTURAL_SENSITIVITY_KEYWORDS):
                self._add_museum_policy_warning(
                    result, "museum_policy_cultural_sensitivity",
                    "Response discusses culturally sensitive topic",
                    is_visitor,
                    "Questions about repatriation and cultural heritage are important. "
                    "Please contact the museum directly for their policies.",
                )
                return

        # Rights gate — tiered
        self._check_rights_gate(response_text, result, is_visitor, tool_results)

    def _check_rights_gate(
        self,
        response_text: str,
        result: GuardrailResult,
        is_visitor: bool,
        tool_results: list[dict],
    ) -> None:
        """Tiered rights checking with condition-phrase enforcement."""
        # Extract rights from tool results
        record_rights = self._extract_rights(tool_results)

        # Check for unrestricted claims in response
        has_unrestricted_claim = bool(_UNRESTRICTED_CLAIMS_RE.search(response_text))
        has_conditional_claim = bool(_CONDITIONAL_CLAIMS_RE.search(response_text))

        if not has_unrestricted_claim and not has_conditional_claim:
            return

        # Determine record rights status
        has_unrestricted_record = bool(record_rights & _UNRESTRICTED_RIGHTS)
        conditional_right = None
        for right_key, condition in _CONDITIONAL_RIGHTS.items():
            if right_key in record_rights:
                conditional_right = (right_key, condition)
                break

        if has_unrestricted_claim:
            if has_unrestricted_record:
                return  # OK: unrestricted claim + unrestricted record
            if conditional_right:
                # Blocked: claiming unrestricted but record is conditional
                right_key, condition = conditional_right
                self._add_museum_policy_warning(
                    result, "museum_policy_rights",
                    f"Unrestricted rights claim but record is {right_key}",
                    is_visitor,
                    f"This work may be reusable {condition}. "
                    "Please contact the museum's rights department for details.",
                )
                return
            if not record_rights:
                # No rights info: block
                self._add_museum_policy_warning(
                    result, "museum_policy_rights",
                    "Unrestricted rights claim but no rights information available",
                    is_visitor,
                    "Rights information is not available for this work. "
                    "Please contact the museum's rights department for details.",
                )
                return

        if has_conditional_claim:
            if conditional_right:
                right_key, condition = conditional_right
                # Check if response contains the required condition phrase
                if condition.lower() in response_text.lower():
                    return  # OK: condition phrase present
                # Missing condition phrase
                self._add_museum_policy_warning(
                    result, "museum_policy_rights",
                    f"Conditional claim without required phrase for {right_key}",
                    is_visitor,
                    f"This work may be reusable {condition}. "
                    "Please contact the museum's rights department for details.",
                )
                return
            if not record_rights:
                self._add_museum_policy_warning(
                    result, "museum_policy_rights",
                    "Conditional rights claim but no rights information available",
                    is_visitor,
                    "Rights information is not available for this work. "
                    "Please contact the museum's rights department for details.",
                )
                return

    def _extract_rights(self, tool_results: list[dict]) -> set[str]:
        """Recursively extract rights information from tool results."""
        rights: set[str] = set()
        for tr in tool_results:
            self._extract_rights_recursive(tr, rights)
        return rights

    def _extract_rights_recursive(self, data: Any, rights: set[str]) -> None:
        """Recursively find rights-related fields."""
        if isinstance(data, str):
            return
        if isinstance(data, dict):
            for key in ("rights", "rights_status", "copyright", "license",
                        "rights_statement", "credit_line"):
                if key in data and isinstance(data[key], str):
                    rights.add(data[key].strip().lower())
            for v in data.values():
                if isinstance(v, (dict, list)):
                    self._extract_rights_recursive(v, rights)
        elif isinstance(data, list):
            for item in data:
                if isinstance(item, (dict, list)):
                    self._extract_rights_recursive(item, rights)

    @staticmethod
    def _add_museum_policy_warning(
        result: GuardrailResult,
        check: str,
        message: str,
        is_visitor: bool,
        replacement: str | None = None,
    ) -> None:
        """Add a museum policy warning/block."""
        result.add_warning(
            check=check,
            message=message,
            severity="block" if is_visitor else "warning",
        )
        if is_visitor and replacement:
            result.replacement = replacement

    def _check_hallucinated_objects(
        self,
        response_text: str,
        tool_results: list[dict],
        result: GuardrailResult,
        persona: str = "staff",
    ) -> None:
        """Check for object numbers mentioned that weren't in tool results."""
        # Collect all object numbers from tool results
        known_numbers: set[str] = set()
        for tr in tool_results:
            self._extract_object_numbers(tr, known_numbers)

        # If no tools were called, skip this check (agent may be using injected context)
        if not tool_results:
            return

        # Find object numbers in response
        mentioned = set(_OBJECT_NUMBER_RE.findall(response_text))
        hallucinated = mentioned - known_numbers

        if hallucinated:
            is_visitor = persona == "visitor"
            result.add_warning(
                check="hallucinated_objects",
                message=f"Object numbers not found in tool results: {', '.join(sorted(hallucinated))}",
                severity="block" if is_visitor else "warning",
                retryable=is_visitor,
            )

    def _extract_object_numbers(self, data: dict | list | str, numbers: set[str]) -> None:
        """Recursively extract object numbers from tool result data."""
        if isinstance(data, str):
            numbers.update(_OBJECT_NUMBER_RE.findall(data))
        elif isinstance(data, dict):
            for key in ("object_number", "accession_number"):
                if key in data and isinstance(data[key], str):
                    numbers.add(data[key])
            for v in data.values():
                if isinstance(v, (dict, list)):
                    self._extract_object_numbers(v, numbers)
        elif isinstance(data, list):
            for item in data:
                self._extract_object_numbers(item, numbers)

    def _check_url_integrity(
        self,
        response_text: str,
        tool_results: list[dict],
        result: GuardrailResult,
        persona: str = "staff",
    ) -> None:
        """Ensure all URLs in the response came from tool results."""
        # Collect URLs from tool results
        known_urls: set[str] = set()
        for tr in tool_results:
            self._extract_urls(tr, known_urls)

        # Find markdown links in response
        links = _LINK_RE.findall(response_text)
        for _text, url in links:
            # Allow relative paths that match tool result patterns
            if url.startswith("/c/") or url.startswith("/organizations/"):
                # Check if any tool result contains this path
                if not any(url in known_url for known_url in known_urls):
                    # Also check if the URL path segment exists in any tool result
                    if not any(url in str(tr) for tr in tool_results):
                        is_visitor = persona == "visitor"
                        result.add_warning(
                            check="url_integrity",
                            message=f"URL not from tool results: {url}",
                            severity="block" if is_visitor else "warning",
                            retryable=is_visitor,
                        )
                        return  # One bad URL is enough to block
            elif url.startswith("http"):
                if url not in known_urls:
                    is_visitor = persona == "visitor"
                    result.add_warning(
                        check="url_integrity",
                        message=f"External URL not from tool results: {url}",
                        severity="block" if is_visitor else "warning",
                        retryable=is_visitor,
                    )
                    return

    def _extract_urls(self, data: dict | list | str, urls: set[str]) -> None:
        """Recursively extract URLs from tool result data."""
        if isinstance(data, str):
            if data.startswith("/") or data.startswith("http"):
                urls.add(data)
        elif isinstance(data, dict):
            for key in ("url", "link", "website", "ticketing_url", "registration_url",
                        "website_url", "venue_ticketing_url"):
                if key in data and isinstance(data[key], str):
                    urls.add(data[key])
            for v in data.values():
                if isinstance(v, (dict, list)):
                    self._extract_urls(v, urls)
        elif isinstance(data, list):
            for item in data:
                self._extract_urls(item, urls)

    def _check_content_safety(
        self,
        response_text: str,
        result: GuardrailResult,
    ) -> None:
        """Check response against configured blocked patterns."""
        for pattern in self._blocked_patterns:
            if pattern.search(response_text):
                result.add_warning(
                    check="content_safety",
                    message=f"Response matched blocked pattern: {pattern.pattern}",
                    severity="block",
                )
                return

    def _build_grounding_truth(
        self,
        tool_results: list[dict],
        context_text: str | None = None,
    ) -> dict[str, set[str]]:
        """Build grounding truth from structured tool results and context text.

        Returns dict with keys: 'creators', 'dates', 'accessions', 'materials'.
        """
        truth: dict[str, set[str]] = {
            "creators": set(),
            "dates": set(),
            "accessions": set(),
            "materials": set(),
        }

        for tr in tool_results:
            self._extract_grounding_from_dict(tr, truth)

        # Also parse context_text for "Field: value" format
        if context_text:
            for line in context_text.split(";"):
                line = line.strip()
                if line.startswith("Creator(s):"):
                    names = line[len("Creator(s):"):].strip()
                    for name in names.split(","):
                        truth["creators"].update(_normalize_person_name(name.strip()))
                elif line.startswith("Date:"):
                    truth["dates"].update(_normalize_year(line[len("Date:"):].strip()))
                elif line.startswith("Materials:"):
                    for m in line[len("Materials:"):].strip().split(","):
                        m = m.strip().lower()
                        if m:
                            truth["materials"].add(m)

        return truth

    def _extract_grounding_from_dict(self, data: dict | list, truth: dict[str, set[str]]) -> None:
        """Recursively extract grounding fields from tool result dicts."""
        if isinstance(data, list):
            for item in data:
                if isinstance(item, (dict, list)):
                    self._extract_grounding_from_dict(item, truth)
            return

        if not isinstance(data, dict):
            return

        # Creators
        if "creators" in data:
            creators = data["creators"]
            if isinstance(creators, list):
                for c in creators:
                    if isinstance(c, str):
                        truth["creators"].update(_normalize_person_name(c))
                    elif isinstance(c, dict) and c.get("name"):
                        truth["creators"].update(_normalize_person_name(c["name"]))

        # Dates
        for key in ("creation_date", "creation_date_display"):
            if key in data and isinstance(data[key], str):
                truth["dates"].update(_normalize_year(data[key]))
            elif key in data and isinstance(data[key], dict):
                display = data[key].get("display") or data[key].get("display_date", "")
                if display:
                    truth["dates"].update(_normalize_year(display))

        # Accessions
        for key in ("object_number", "accession_number"):
            if key in data and isinstance(data[key], str):
                truth["accessions"].add(_normalize_accession(data[key]))

        # Materials/techniques
        for key in ("materials", "techniques"):
            if key in data:
                val = data[key]
                if isinstance(val, str):
                    for m in val.split(","):
                        m = m.strip().lower()
                        if m:
                            truth["materials"].add(m)
                elif isinstance(val, list):
                    for m in val:
                        if isinstance(m, str):
                            truth["materials"].add(m.strip().lower())

        # Recurse into nested dicts/lists
        for v in data.values():
            if isinstance(v, (dict, list)):
                self._extract_grounding_from_dict(v, truth)

    def _check_source_grounding(
        self,
        response_text: str,
        tool_results: list[dict],
        result: GuardrailResult,
        persona: str = "staff",
        context_text: str | None = None,
    ) -> None:
        """Check that factual claims about specific objects are grounded in tool results.

        Creator/accession mismatches: block + retryable for visitor, warn for staff.
        Date mismatches: always warn (never block).
        General art history/cultural context: no trigger.
        """
        if not tool_results and not context_text:
            return

        truth = self._build_grounding_truth(tool_results, context_text)

        # Skip if we have no grounding data at all
        if not any(truth.values()):
            return

        # Extract creator claims from response
        for pattern in _CREATOR_CLAIM_PATTERNS:
            for match in pattern.finditer(response_text):
                claimed_name = match.group(1).strip()
                if not claimed_name or len(claimed_name) > _MAX_CLAIM_NAME_LEN:
                    continue
                # Normalize the claim
                claimed_forms = _normalize_person_name(claimed_name)
                # Check if any claimed form matches any known form
                if not claimed_forms.intersection(truth["creators"]):
                    # Only flag if we have creator data to compare against
                    if truth["creators"]:
                        is_visitor = persona == "visitor"
                        result.add_warning(
                            check="source_grounding",
                            message=f"Ungrounded creator claim: '{claimed_name}'",
                            severity="block" if is_visitor else "warning",
                            retryable=is_visitor,
                        )
                        return

        # Extract date claims from response
        for pattern in _DATE_CLAIM_PATTERNS:
            for match in pattern.finditer(response_text):
                claimed_date = match.group(1).strip()
                claimed_years = _normalize_year(claimed_date)
                if claimed_years and truth["dates"]:
                    if not claimed_years.intersection(truth["dates"]):
                        result.add_warning(
                            check="source_grounding",
                            message=f"Ungrounded date claim: '{claimed_date}'",
                            severity="warning",
                        )
                        return

        # Extract accession claims from response
        for pattern in _ACCESSION_CLAIM_PATTERNS:
            for match in pattern.finditer(response_text):
                claimed_acc = _normalize_accession(match.group(1))
                if claimed_acc and truth["accessions"]:
                    if claimed_acc not in truth["accessions"]:
                        is_visitor = persona == "visitor"
                        result.add_warning(
                            check="source_grounding",
                            message=f"Ungrounded accession claim: '{claimed_acc}'",
                            severity="block" if is_visitor else "warning",
                            retryable=is_visitor,
                        )
                        return

    def _check_format_compliance(
        self,
        response_text: str,
        result: GuardrailResult,
        persona: str = "staff",
        user_message: str | None = None,
    ) -> None:
        """Check for format violations (bullet lists, broken markdown links).

        Staff requesting lists explicitly get a pass. Numbered steps
        (e.g. "1. Check the accession number") are excluded from the count.
        Never blocks — always advisory.
        """
        # Staff with list-request keywords → skip entirely
        if persona == "staff" and user_message:
            list_keywords = {"list", "bullet", "enumerate", "steps", "checklist"}
            msg_lower = user_message.lower()
            if any(kw in msg_lower for kw in list_keywords):
                return

        lines = response_text.strip().split("\n")
        bullet_count = 0
        for line in lines:
            stripped = line.strip()
            # Numbered steps like "Step 1: Check accession" are excluded
            if re.match(r'^\d+\.\s+[A-Z]', stripped):
                continue
            if stripped.startswith("- ") or stripped.startswith("* ") or re.match(r'^\d+\.\s', stripped):
                bullet_count += 1

        if bullet_count >= 3:
            result.add_warning(
                check="format_compliance",
                message=f"Response uses list formatting ({bullet_count} list items detected)",
                severity="warning",
            )

        # Check for broken markdown links
        broken = re.findall(r'\[[^\]]*\]\([^)]*$', response_text, re.MULTILINE)
        if broken:
            result.add_warning(
                check="format_compliance",
                message="Response contains broken markdown links",
                severity="warning",
            )


# Singleton
_guardrail_service: GuardrailService | None = None


def get_guardrail_service(config: dict | None = None) -> GuardrailService:
    global _guardrail_service
    if _guardrail_service is None:
        _guardrail_service = GuardrailService(config)
    return _guardrail_service
