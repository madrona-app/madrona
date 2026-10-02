"""Shared create logic for ConditionReport.

Extracted from the original ``draft_service._apply_condition_report`` so the
draft applier and (future) router create path share one implementation. Produces
the same row the applier did: sequential ``CR`` number, ``status='draft'``,
``examiner_id`` = the proposer.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID

from app.models.objects import ConditionReport
from app.services.sequence import next_sequential_number


def _as_uuid(value) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    return UUID(str(value))


def _as_date(value) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def create_condition_report(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> ConditionReport:
    """Create a live ConditionReport. The caller owns the transaction.

    ``open_approval`` is accepted for signature uniformity; condition reports
    are created in ``status='draft'`` and are not approval-gated at creation
    (the existing applier opened no approval), so it is a no-op here.
    ``proposed_by`` becomes the examiner when present, mirroring the draft
    applier's ``examiner_id = proposed_by_user_id``.
    """
    p = payload
    # examiner_id is a CONSTITUENT reference. Prefer an explicitly referenced
    # examiner; otherwise fall back to the proposer's staff constituent (created
    # on demand via the user↔constituent link) — never a bare user id.
    examiner_id = _as_uuid(p.get("examiner_id"))
    if examiner_id is None:
        from app.services.constituent_service import find_or_create_staff_constituent
        staff = find_or_create_staff_constituent(
            session, organization_id, proposed_by or actor,
        )
        examiner_id = staff.constituent_id if staff else None
    report = ConditionReport(
        organization_id=organization_id,
        report_number=next_sequential_number(session, organization_id, "CR"),
        report_type=p["report_type"],
        report_date=_as_date(p.get("report_date")) or datetime.now(timezone.utc).date(),
        object_id=_as_uuid(p.get("object_id")),
        examiner_id=examiner_id,
        examiner_name=p.get("examiner_name"),
        examiner_institution=p.get("examiner_institution"),
        overall_condition=p.get("overall_condition"),
        condition_summary=p.get("condition_summary"),
        detailed_findings=p.get("detailed_findings"),
        check_reason=p.get("check_reason"),
        examination_method=p.get("examination_method"),
        recommendations=p.get("recommendations"),
        conservation_needed=p.get("conservation_needed", False),
        conservation_priority=p.get("conservation_priority"),
        next_check_date=_as_date(p.get("next_check_date")),
        handling_requirements=p.get("handling_requirements"),
        display_restrictions=p.get("display_restrictions"),
        hazard_summary=p.get("hazard_summary"),
        status="draft",
        created_by=actor,
        updated_by=actor,
    )
    session.add(report)
    session.flush()
    return report
