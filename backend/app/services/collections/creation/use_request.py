"""Shared create logic for UseRequest (Use of Collections).

Extracted from the inline ``create_use_request`` router so the draft applier and
the API route share one implementation, including the USE-{year}-NNN request
number generation. The caller owns the transaction.
"""

from __future__ import annotations

import re
from datetime import date
from uuid import UUID

from app.models import UseRequest


def _as_uuid(value) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    return UUID(str(value))


def _as_date(value) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _generate_request_number(session, organization_id: UUID) -> str:
    """Year-based USE-{year}-NNN number (mirrors the router helper)."""
    year = date.today().year
    prefix = f"USE-{year}-"
    existing = (
        session.query(UseRequest.request_number)
        .filter(
            UseRequest.organization_id == organization_id,
            UseRequest.request_number.like(f"{prefix}%"),
        )
        .all()
    )
    max_num = 0
    for (num_str,) in existing:
        match = re.search(r"USE-\d{4}-(\d+)", num_str or "")
        if match:
            max_num = max(max_num, int(match.group(1)))
    return f"{prefix}{max_num + 1:03d}"


def create_use_request(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> UseRequest:
    """Create a live UseRequest in status='submitted'. The caller owns the
    transaction. ``open_approval``/``proposed_by`` are accepted for signature
    uniformity; use requests are not approval-gated at creation and record no
    separate proposer."""
    p = payload
    request_number = p.get("request_number") or _generate_request_number(
        session, organization_id
    )

    req = UseRequest(
        organization_id=organization_id,
        request_number=request_number,
        request_date=_as_date(p.get("request_date")) or date.today(),
        use_type=p["use_type"],
        use_subtype=p.get("use_subtype"),
        use_purpose=p["use_purpose"],
        use_description=p.get("use_description"),
        requester_user_id=_as_uuid(p.get("requester_user_id")),
        requester_name=p["requester_name"],
        requester_title=p.get("requester_title"),
        requester_institution=p.get("requester_institution"),
        requester_address=p.get("requester_address"),
        requester_email=p.get("requester_email"),
        requester_phone=p.get("requester_phone"),
        access_date_start=_as_date(p.get("access_date_start")),
        access_date_end=_as_date(p.get("access_date_end")),
        location_required=p.get("location_required"),
        special_requirements=p.get("special_requirements"),
        project_title=p.get("project_title"),
        project_description=p.get("project_description"),
        project_deadline=_as_date(p.get("project_deadline")),
        status=p.get("status", "submitted"),
        request_note=p.get("request_note") or p.get("notes"),
        internal_note=p.get("internal_note"),
        created_by_id=actor,
        updated_by_id=actor,
    )
    session.add(req)
    session.flush()
    return req
