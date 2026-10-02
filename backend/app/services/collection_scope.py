"""Collection scope disclosure for the Guide (issue #77).

Renders an organization's OrganizationCollectionProfile into a compact
"Collection scope" block that is injected into the Guide's system prompt. The
goal is the archival-AI-readiness concern (Colavizza & Jaillant 2026): an AI
answering over a collection should disclose its coverage and known gaps rather
than present partial or selectively-digitized holdings as comprehensive.

The disclosure instruction is embedded INSIDE the block so it survives a
DB-overridden system prompt.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

_COVERAGE_FIELDS = (
    ("date_range", "Dates"),
    ("record_types", "Types"),
    ("geography", "Geography"),
    ("languages", "Languages"),
)

_HEADER = (
    "## Collection scope\n"
    "What this organization's collection covers and its limits. When the user asks "
    "what is in the collection, how much of it there is, its coverage, or what is "
    "missing, draw on this and DISCLOSE partial digitization and known gaps. Never "
    "imply the holdings are complete when completeness or digitization is partial, "
    "minimal, or only representative.\n"
)


def build_collection_scope_block(session: Session, organization_id: UUID) -> str | None:
    """Return the scope block for an org, or None if there's no usable profile."""
    from app.models import OrganizationCollectionProfile

    profile = (
        session.query(OrganizationCollectionProfile)
        .filter_by(organization_id=organization_id)
        .first()
    )
    if profile is None:
        return None

    lines: list[str] = []

    if profile.scope_note and profile.scope_note.strip():
        lines.append(f"Scope: {profile.scope_note.strip()}")

    coverage = profile.coverage or {}
    coverage_bits: list[str] = []
    for key, label in _COVERAGE_FIELDS:
        val = coverage.get(key)
        if not val:
            continue
        if isinstance(val, (list, tuple)):
            val = ", ".join(str(v) for v in val if v)
        val = str(val).strip()
        if val:
            coverage_bits.append(f"{label}: {val}")
    if coverage_bits:
        lines.append("Coverage — " + "; ".join(coverage_bits))

    if profile.completeness:
        completeness = f"Completeness: {profile.completeness}"
        if profile.extent_note and profile.extent_note.strip():
            completeness += f" ({profile.extent_note.strip()})"
        lines.append(completeness)

    if profile.digitization_status:
        lines.append(f"Digitization: {profile.digitization_status}")

    if profile.known_gaps and profile.known_gaps.strip():
        lines.append(f"Known gaps / excluded: {profile.known_gaps.strip()}")

    if not lines:
        return None

    return _HEADER + "\n".join(f"- {line}" for line in lines)
