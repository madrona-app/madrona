"""Saving the polymorphic compliance_actions rows of a record.

Documentation plans (actions, milestones), audit campaigns (remedial actions)
and incident reports (preventive actions) keep their action lists in
collections.compliance_actions, keyed by entity_type / entity_id /
action_type. Forms send those lists back as plain strings, as the records the
API returned, or as {date, description} milestones; this module turns any of
those into rows, matched and updated in place so an unchanged save writes
(and audits) nothing.
"""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session


def action_items(raw: Any) -> list[dict]:
    """Actions from strings, records, or newline-separated text."""
    if isinstance(raw, str):
        raw = raw.splitlines()
    out = []
    for item in raw or []:
        title = item.get("title") if isinstance(item, dict) else item
        if isinstance(title, str) and title.strip():
            out.append({"title": title.strip()[:500], "due_date": None})
    return out


def milestone_items(raw: Any) -> list[dict]:
    """Milestones from {date, description} (either may be blank, not both)."""
    out = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        title = (item.get("description") or item.get("title") or "").strip()
        when = item.get("date") or item.get("due_date") or None
        if isinstance(when, str):
            try:
                when = date.fromisoformat(when[:10])
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Invalid milestone date: {when}")
        if not title and not when:
            continue
        out.append({"title": (title or "Milestone")[:500], "due_date": when})
    return out


def save_actions(
    db: Session,
    *,
    organization_id: UUID,
    entity_type: str,
    entity_id: UUID,
    action_type: str,
    desired: list[dict],
    user_id: UUID | None,
) -> None:
    """Make the record's rows of ``action_type`` equal ``desired``, in order."""
    from app.models.compliance import ComplianceAction
    from app.services.child_rows import reconcile_rows

    existing = (
        db.query(ComplianceAction)
        .filter(
            ComplianceAction.entity_type == entity_type,
            ComplianceAction.entity_id == entity_id,
            ComplianceAction.action_type == action_type,
        )
        .order_by(ComplianceAction.display_order)
        .all()
    )

    def make_row(i, item):
        return ComplianceAction(
            organization_id=organization_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action_type=action_type,
            title=item["title"],
            due_date=item.get("due_date"),
            display_order=i,
            created_by=user_id,
        )

    reconcile_rows(db, existing, desired, ("title", "due_date"), make_row)
