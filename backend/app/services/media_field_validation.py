"""
Validation helpers for media field values that have DB CHECK constraints.

Mirrors the constraints declared on app.models.media.Media. Used by:
  - metadata-template create/update endpoints (reject bad values upstream)
  - bulk-action handlers (skip bad values mid-batch instead of crashing
    the whole commit)

When you add a new CHECK constraint to a Media field, add the allowed set
here and extend ``validate_template_fields``.
"""
from __future__ import annotations


VALID_COPYRIGHT_STATUSES: frozenset[str] = frozenset({
    "public_domain",
    "in_copyright",
    "copyright_undetermined",
    "orphan_work",
    "cc_by",
    "cc_by_sa",
    "cc_by_nc",
    "cc_by_nc_sa",
    "cc0",
    "rights_reserved",
})


def validate_template_fields(fields: dict | None) -> list[str]:
    """
    Check a metadata-template ``template_fields`` dict against Media CHECK
    constraints. Returns a list of human-readable error messages — empty
    list means the template is acceptable.

    Today this only covers ``copyright_status``; extend as more constrained
    fields are added to templates.
    """
    if not fields:
        return []

    errors: list[str] = []
    cs = fields.get("copyright_status")
    if cs is not None and cs != "" and cs not in VALID_COPYRIGHT_STATUSES:
        allowed = ", ".join(sorted(VALID_COPYRIGHT_STATUSES))
        errors.append(
            f"copyright_status='{cs}' is not allowed. Use one of: {allowed}"
        )
    return errors
