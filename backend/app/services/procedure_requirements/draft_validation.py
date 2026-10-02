"""Pre-approval procedure validation for Guide Studio drafts (§7 trust).

A governed draft proposed by Studio is checked against the procedure it
belongs to BEFORE a human approves it, so the approver sees that the agent
followed the procedure rather than free-forming a write. The result backs the
"procedure pre-approval ribbon" in the drafts inbox.

The check is conservative and stage-aware: it evaluates the *proposal-stage*
blocking requirements (those required at the procedure's first status) against
the draft payload. Most procedures have no blocking requirement at the proposal
stage — so a sound proposal reads as "pre-validated" — while procedures that do
(valuation, movement, conservation, condition reports, reproduction) get a real
field check. Predicate-backed requirements need client-side context and are not
server-evaluable here, so they're excluded rather than guessed.
"""

from __future__ import annotations

from typing import Any

from app.services.procedure_requirements import PROCEDURE_REQUIREMENTS

# Draft entity_type → procedure_type. Entities without a procedure
# procedure (location, constituent, object_right, use_request, media_*) get no
# ribbon — validate_draft_against_procedure returns None for them.
ENTITY_TO_PROCEDURE: dict[str, str] = {
    "acquisition": "acquisition",
    "deaccession": "deaccession",
    "collection_object": "cataloging",
    "condition_report": "condition_report",
    "valuation": "valuation",
    "movement": "movement",
    "loan_in": "loan_in",
    "loan_out": "loan_out",
    "conservation_treatment": "conservation",
    "object_entry": "object_entry",
    "object_exit": "object_exit",
    "reproduction_request": "reproduction_request",
}


def _field_present(payload: dict, path: str) -> bool:
    """A field counts as satisfied when it resolves to a non-empty value. Dotted
    paths walk nested dicts; a missing/empty leaf is unsatisfied."""
    cur: Any = payload
    for part in path.split("."):
        if not isinstance(cur, dict):
            return False
        cur = cur.get(part)
        if cur is None:
            return False
    return cur not in (None, "", [], {})


def validate_draft_against_procedure(entity_type: str, payload: dict) -> dict | None:
    """Return a pre-approval validation summary for a draft, or None when the
    entity has no procedure to validate against.

    {
      procedure_type, procedure_label, procedure, evaluated_status,
      blocking_total, blocking_met, passed: bool, missing: [{id, label}]
    }
    """
    proc_type = ENTITY_TO_PROCEDURE.get(entity_type)
    if proc_type is None:
        return None
    proc = PROCEDURE_REQUIREMENTS.get(proc_type)
    if proc is None or not proc.status_order:
        return None

    target_status = proc.status_order[0]
    payload = payload or {}

    checked = []
    for group in proc.requirement_groups:
        for req in group.requirements:
            if req.severity != "blocking" or req.has_predicate:
                continue
            if target_status not in req.required_for_statuses:
                continue
            met = all(_field_present(payload, fp) for fp in req.field_paths)
            checked.append((req, met))

    total = len(checked)
    met = sum(1 for _, ok in checked if ok)
    missing = [{"id": r.id, "label": r.label} for r, ok in checked if not ok]
    return {
        "procedure_type": proc.procedure_type,
        "procedure_label": proc.procedure_label,
        "procedure": proc.procedure,
        "evaluated_status": target_status,
        "blocking_total": total,
        "blocking_met": met,
        "passed": met == total,
        "missing": missing,
    }
