"""Record-level sensitivity gate for draft tools (Guide Studio v1 §7.3).

Persona allowlists are tool-level (a conservator can run
`propose_condition_report_draft`); they are not record-level. This adds the
record-level check: before a draft is produced, the target record is screened
for sensitivity, and a forbidden combination is refused with a clear,
persona-facing message the planner uses to abort the step gracefully — not
retry.

The gate is a **registry of checks** (`_CHECKS`), each a pure function of the
screening context. The first refusal wins. New sensitivity classes are added by
appending a check — entity types and the existing classes all inherit one gate.

Classes implemented (all on data that already exists — no new tables):

- **NAGPRA** (`collections.nagpra_actions`): an active hold, or access consent
  that is not granted/conditional, blocks any draft on that object.
- **Media publication rights**: publishing a media item whose copyright state
  restricts redistribution and which has no rights statement is refused — the
  same restricted-copyright set the bulk-download rights gate uses.
- **Object rights clearance**: a reproduction request on an object whose rights
  are a hard blocker (denied / expired / disputed) is refused.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable
from uuid import UUID

# Consent states under which physical access / examination is permitted (NAGPRA).
_CONSENT_OK = {"granted", "conditional"}

# Media copyright states that restrict publication / redistribution. Mirrors the
# bulk-download rights gate (fastapi_app/routers/media_workspaces) so the
# platform speaks with one voice about restricted media.
_RESTRICTED_COPYRIGHT = {
    "rights_reserved", "in_copyright", "orphan_work", "copyright_undetermined",
}

# Object-rights statuses that clearly block reuse. Conservative on purpose —
# only hard blockers, so a draft is never refused on an uncertain / in-progress
# status (e.g. 'requested', 'unknown'), which would break valid workflows.
_RIGHTS_BLOCKING = {"denied", "expired", "disputed"}

_ACTION_VERB = {
    "create": "Creating a record",
    "update": "Updating a record",
    "link": "Linking a record",
}


@dataclass
class SensitivityResult:
    allowed: bool
    reason: str | None = None


@dataclass(frozen=True)
class _ScreenContext:
    session: object
    persona: str
    entity_type: str
    action: str
    organization_id: UUID
    sensitivity_entity_type: str | None
    object_id: UUID | None
    media_id: UUID | None


def check_record_sensitivity(
    session,
    *,
    persona: str,
    entity_type: str,
    action: str,
    payload,
    organization_id: UUID,
    sensitivity_entity_type: str | None = None,
) -> SensitivityResult:
    """Screen the record a draft pertains to against every registered check.
    Returns the first refusal (allowed=False with a graceful reason); otherwise
    allowed. Nothing to screen → allowed."""
    sc = _ScreenContext(
        session=session,
        persona=persona,
        entity_type=entity_type,
        action=action,
        organization_id=organization_id,
        sensitivity_entity_type=sensitivity_entity_type,
        object_id=getattr(payload, "object_id", None),
        media_id=getattr(payload, "media_id", None),
    )
    for check in _CHECKS:
        result = check(sc)
        if not result.allowed:
            return result
    return SensitivityResult(True)


def _check_nagpra(sc: _ScreenContext) -> SensitivityResult:
    if sc.object_id is None:
        return SensitivityResult(True)
    from app.models.nagpra import NagpraAction

    rec = (
        sc.session.query(NagpraAction)
        .filter(
            NagpraAction.organization_id == sc.organization_id,
            NagpraAction.object_id == sc.object_id,
        )
        .first()
    )
    if rec is None:
        return SensitivityResult(True)

    verb = _ACTION_VERB.get(sc.action, "This action")
    if rec.hold_active:
        return SensitivityResult(
            False,
            f"{verb} for an object under an active NAGPRA hold requires NAGPRA "
            f"coordinator authorization. Ask the NAGPRA coordinator before "
            f"proceeding.",
        )
    if rec.access_consent not in _CONSENT_OK:
        return SensitivityResult(
            False,
            f"{verb} for this object requires granted NAGPRA access consent "
            f"(currently '{rec.access_consent}'). Ask the NAGPRA coordinator "
            f"to confirm consent with the affiliated party.",
        )
    return SensitivityResult(True)


def _check_media_publication_rights(sc: _ScreenContext) -> SensitivityResult:
    """Publishing a media item with a restrictive copyright state and no rights
    statement is refused — rights must be cleared before it goes public."""
    if (
        sc.sensitivity_entity_type != "media"
        or sc.entity_type != "media_publish"
        or sc.media_id is None
    ):
        return SensitivityResult(True)
    from app.models import Media

    media = (
        sc.session.query(Media)
        .filter(
            Media.organization_id == sc.organization_id,
            Media.media_id == sc.media_id,
        )
        .first()
    )
    if media is None:
        return SensitivityResult(True)
    if media.copyright_status in _RESTRICTED_COPYRIGHT and not (
        media.rights_statement and media.rights_statement.strip()
    ):
        return SensitivityResult(
            False,
            f"Publishing this media item is blocked: its copyright status is "
            f"'{media.copyright_status}' with no rights statement on record. "
            f"Clear the rights (record a rights statement / license) before "
            f"publishing.",
        )
    return SensitivityResult(True)


def _check_object_rights_clearance(sc: _ScreenContext) -> SensitivityResult:
    """A reproduction request on an object whose rights are a hard blocker
    (denied / expired / disputed) is refused."""
    if sc.entity_type != "reproduction_request" or sc.object_id is None:
        return SensitivityResult(True)
    from app.models.objects import ObjectRight

    blocking = (
        sc.session.query(ObjectRight)
        .filter(
            ObjectRight.organization_id == sc.organization_id,
            ObjectRight.object_id == sc.object_id,
            ObjectRight.status.in_(_RIGHTS_BLOCKING),
        )
        .first()
    )
    if blocking is not None:
        return SensitivityResult(
            False,
            f"A reproduction request for this object is blocked: it has a "
            f"'{blocking.status}' rights record. Resolve the object's rights "
            f"(clearance, license, or expiry) before requesting reproduction.",
        )
    return SensitivityResult(True)


# The ordered check registry. Append a function here to add a sensitivity class.
_CHECKS: tuple[Callable[[_ScreenContext], SensitivityResult], ...] = (
    _check_nagpra,
    _check_media_publication_rights,
    _check_object_rights_clearance,
)
