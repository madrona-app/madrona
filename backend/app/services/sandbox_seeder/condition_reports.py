"""
Condition reports seeder — generate ConditionReport records anchored to
the seeded objects and the procedures created in earlier phase-2 steps,
so the demo org has plausible condition documentation.

report_type is always one of the canonical values the API/UI validate
against (intake | loan_out | loan_in | periodic | conservation | incident);
the summary text carries the pre-/post-/return nuance.

Strategy:
    - For each ConservationTreatment (completed or in_progress):
        * 1 conservation report (pre-treatment) with overall_condition=fair/poor
    - For each ConservationTreatment (completed):
        * 1 conservation report (post-treatment) with overall_condition=good/excellent
    - For each LoanOut (on_loan or returned):
        * 1 loan_out report (status of object as it left)
    - For each LoanOut (returned):
        * 1 loan_out report (status when it came back)
    - 3-5 periodic reports for objects not in any active procedure.

Polymorphic linkage: linked_entity_type + linked_entity_id point at the
related procedure (conservation_treatment | loan_out). The procedures
themselves keep their condition_*_id columns NULL on the demo org
because back-linking would require an UPDATE pass; workspace pages
already traverse object → reports for the timeline view.

report_number: CR-YYYY-NNN, scoped to the org via the unique index
(organization_id, report_number).

Idempotent: skips if any ConditionReport already exists for the org.
Determinism: random.Random keyed on org_id.
"""
from __future__ import annotations

import logging
import random
from datetime import date, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.objects import CollectionObject, ConditionReport
from app.models.procedures import ConservationTreatment, LoanOut, LoanOutObject
from app.services.collections.creation.condition_report import (
    create_condition_report,
)

logger = logging.getLogger(__name__)


_PRE_TREATMENT_SUMMARIES = [
    "Surface accretions and yellowed varnish layer obscuring original palette. "
    "Localized losses in lower right quadrant.",
    "Active flaking observed along upper edge; previous restoration discolored.",
    "Substrate weakening; minor tears at vertical centerline. No active losses.",
]

_POST_TREATMENT_SUMMARIES = [
    "Surface cleaning complete; varnish reduced and re-applied with reversible "
    "synthetic resin. Losses inpainted with conservation-grade pigments.",
    "Flaking consolidated and previous restoration removed. Surface stable.",
    "Tears mended; substrate reinforced. Object returned to display readiness.",
]

_LOAN_OUT_SUMMARIES = [
    "Object inspected before crating. Surface stable, mount fitted; minor "
    "stable inherent vice noted in condition photo log.",
    "Pre-shipment inspection complete. Frame intact, glazing free of "
    "scratches. Climate logger included in crate.",
]

_LOAN_RETURN_SUMMARIES = [
    "Object returned in same condition as dispatched. No new damage.",
    "Returned in good condition; minor surface dust addressed before "
    "return to storage.",
]

_PERIODIC_SUMMARIES = [
    "Routine biennial check. No change since previous report.",
    "Quarterly condition survey of storage area. Object stable.",
    "Annual inventory examination. Condition unchanged.",
]


def _make_report(
    session: Session,
    *,
    org_id: UUID,
    admin_user_id: UUID,
    examiner_id: UUID | None,
    object_id: UUID | None,
    report_type: str,
    report_date: date,
    overall_condition: str | None,
    summary: str,
    linked_entity_type: str | None = None,
    linked_entity_id: UUID | None = None,
    conservation_needed: bool = False,
    status: str = "completed",
) -> ConditionReport:
    """Create one ConditionReport via the shared create service.

    The service issues the canonical ``CRYYYY.NNNN`` report_number
    (next_sequential_number), resolves the examiner, and sets created_by; it
    creates in ``status='draft'`` and owns none of the polymorphic-link or
    completion fields, so we stamp those after.
    """
    report = create_condition_report(
        session,
        org_id,
        {
            "report_type": report_type,
            "report_date": report_date,
            "object_id": object_id,
            "examiner_id": examiner_id,
            "overall_condition": overall_condition,
            "condition_summary": summary,
            "examination_method": "visual",
            "conservation_needed": conservation_needed,
        },
        admin_user_id,
    )
    report.linked_entity_type = linked_entity_type
    report.linked_entity_id = linked_entity_id
    report.status = status
    report.completed_date = report_date
    return report


def seed_condition_reports(
    session: Session,
    *,
    org_id: UUID,
    admin_user_id: UUID,
) -> dict[str, Any]:
    """
    Generate ConditionReport records anchored to seeded procedures + objects.

    Idempotent: skips if any ConditionReport already exists.
    """
    if org_id is None or admin_user_id is None:
        raise ValueError("seed_condition_reports requires org_id and admin_user_id")

    existing = (
        session.query(ConditionReport)
        .filter_by(organization_id=org_id)
        .count()
    )
    if existing > 0:
        logger.info(
            "sandbox seeder: condition reports already present for org %s "
            "(count=%d), skipping",
            org_id, existing,
        )
        return {
            "reports_created": 0,
            "reports_existing": existing,
            "skipped_at_target": True,
        }

    rng = random.Random(int(str(org_id).replace("-", "")[:16], 16))

    # examiner_id is a CONSTITUENT reference — resolve the admin user's staff
    # constituent once and pass it into every report (the create service would
    # otherwise resolve it per call). Never a bare user id.
    from app.services.constituent_service import find_or_create_staff_constituent
    _staff = find_or_create_staff_constituent(session, org_id, admin_user_id)
    examiner_cid = _staff.constituent_id if _staff else None

    reports: list[ConditionReport] = []

    # ---- Pre/post-treatment reports tied to ConservationTreatments ----
    treatments: list[ConservationTreatment] = (
        session.query(ConservationTreatment)
        .filter_by(organization_id=org_id)
        .all()
    )
    for t in treatments:
        if t.status not in {"completed", "in_progress"}:
            continue

        pre_date = (t.start_date or t.proposal_date or date.today()) - timedelta(
            days=rng.randint(0, 7)
        )
        reports.append(_make_report(
            session,
            org_id=org_id,
            admin_user_id=admin_user_id,
            examiner_id=examiner_cid,
            object_id=t.object_id,
            report_type="conservation",
            report_date=pre_date,
            overall_condition=rng.choice(["fair", "poor"]),
            summary=rng.choice(_PRE_TREATMENT_SUMMARIES),
            linked_entity_type="conservation_treatment",
            linked_entity_id=t.treatment_id,
            conservation_needed=True,
        ))

        if t.status == "completed" and t.end_date:
            post_date = t.end_date + timedelta(days=rng.randint(0, 5))
            reports.append(_make_report(
                session,
                org_id=org_id,
                admin_user_id=admin_user_id,
                examiner_id=examiner_cid,
                object_id=t.object_id,
                report_type="conservation",
                report_date=post_date,
                overall_condition=rng.choice(["good", "excellent"]),
                summary=rng.choice(_POST_TREATMENT_SUMMARIES),
                linked_entity_type="conservation_treatment",
                linked_entity_id=t.treatment_id,
                conservation_needed=False,
            ))

    # ---- Loan-out / loan-return reports per LoanOutObject ----
    loans_out: list[LoanOut] = (
        session.query(LoanOut)
        .filter_by(organization_id=org_id)
        .all()
    )
    for lo in loans_out:
        if lo.status not in {"on_loan", "returned"}:
            continue
        loan_objects: list[LoanOutObject] = (
            session.query(LoanOutObject)
            .filter_by(loan_out_id=lo.loan_out_id)
            .all()
        )
        for lobj in loan_objects:
            dispatch_date = lo.actual_dispatch_date or lo.loan_start_date or date.today()
            out_report = _make_report(
                session,
                org_id=org_id,
                admin_user_id=admin_user_id,
                examiner_id=examiner_cid,
                object_id=lobj.object_id,
                report_type="loan_out",
                report_date=dispatch_date,
                overall_condition=rng.choice(["good", "excellent"]),
                summary=rng.choice(_LOAN_OUT_SUMMARIES),
                linked_entity_type="loan_out",
                linked_entity_id=lo.loan_out_id,
            )
            reports.append(out_report)
            # Back-link FK the loan workspace's "condition out" slot reads.
            lobj.condition_report_out_id = out_report.report_id

            if lo.status == "returned" and lo.actual_return_date:
                return_date = lo.actual_return_date
                return_report = _make_report(
                    session,
                    org_id=org_id,
                    admin_user_id=admin_user_id,
                    examiner_id=examiner_cid,
                    object_id=lobj.object_id,
                    report_type="loan_out",
                    report_date=return_date,
                    overall_condition=rng.choice(["good", "excellent"]),
                    summary=rng.choice(_LOAN_RETURN_SUMMARIES),
                    linked_entity_type="loan_out",
                    linked_entity_id=lo.loan_out_id,
                )
                reports.append(return_report)
                # Back-link FK the "condition return" slot reads.
                lobj.condition_report_return_id = return_report.report_id

    # ---- Periodic surveys on a few uninvolved objects ----
    own_objects: list[CollectionObject] = (
        session.query(CollectionObject)
        .filter(
            CollectionObject.organization_id == org_id,
            or_(
                CollectionObject.object_number.like("MET-%"),
                CollectionObject.object_number.like("SI-%"),
                CollectionObject.object_number.like("RIJKS-%"),
            ),
        )
        .all()
    )
    rng.shuffle(own_objects)
    n_periodic = min(5, len(own_objects))
    for obj in own_objects[:n_periodic]:
        report_date = date.today() - timedelta(days=rng.randint(30, 540))
        reports.append(_make_report(
            session,
            org_id=org_id,
            admin_user_id=admin_user_id,
            examiner_id=examiner_cid,
            object_id=obj.object_id,
            report_type="periodic",
            report_date=report_date,
            overall_condition=rng.choice(["good", "good", "fair"]),
            summary=rng.choice(_PERIODIC_SUMMARIES),
        ))

    # Reports are already added + flushed by the create service; commit the batch.
    session.commit()

    logger.info(
        "sandbox seeder: condition reports seeded for org %s (count=%d)",
        org_id, len(reports),
    )
    return {
        "reports_created": len(reports),
        "reports_existing": existing,
        "skipped_at_target": False,
    }
