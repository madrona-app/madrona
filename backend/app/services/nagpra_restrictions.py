"""
NAGPRA duty-of-care gates (43 CFR 10, 2024 rule) for search indexing and
public publishing.

Two independent gates, each mapped to its consent field on NagpraAction:

- Display gate (``display_consent``): governs whether an object may be made
  publicly discoverable. Enforced in every code path that sets
  ``is_discoverable = True`` (single/bulk toggles, publish-by-criteria,
  scheduled publishes) and re-enforced when consent changes on the action.

- Access gate (``access_consent``): governs whether the object's interpretive
  and locational record content may enter the search index at all. Enforced
  at ingestion in ``CollectionObjectTransformer``: sensitive fields are never
  indexed and no semantic embedding is generated unless access consent is
  granted (article-style "never embedded", not filtered at query time).

Only the literal consent value ``"granted"`` opens a gate. ``restricted``,
``requested``, ``denied`` and ``conditional`` all keep it closed —
``conditional`` consent requires a human to configure what the conditions
allow, which the index cannot represent, so it stays closed.
"""

from __future__ import annotations

import logging
from typing import Iterable
from uuid import UUID

from sqlalchemy.orm import Session, object_session

logger = logging.getLogger(__name__)

CONSENT_GRANTED = "granted"


def display_restricted_ids(
    session: Session,
    organization_id,
    object_ids: Iterable,
) -> set[UUID]:
    """
    Return the subset of ``object_ids`` that must not be made publicly
    discoverable: objects with a NAGPRA action whose display consent is
    anything other than ``granted``.
    """
    from app.models import NagpraAction

    ids = list(object_ids)
    if not ids:
        return set()

    rows = (
        session.query(NagpraAction.object_id)
        .filter(
            NagpraAction.organization_id == organization_id,
            NagpraAction.object_id.in_(ids),
            NagpraAction.display_consent != CONSENT_GRANTED,
        )
        .all()
    )
    return {row.object_id for row in rows}


def is_display_restricted(session: Session, organization_id, object_id) -> bool:
    """True when the object may not be made publicly discoverable."""
    return bool(display_restricted_ids(session, organization_id, [object_id]))


def is_access_restricted_for_index(obj) -> bool:
    """
    Ingestion gate for the search index: True when the object's record
    content (descriptions, provenance, location, condition, associations,
    subjects, inscriptions) must be kept out of the index and no semantic
    embedding may be generated.

    Fails closed: if the object's NAGPRA state cannot be determined because
    the instance is detached from a session, the object is treated as
    restricted rather than indexed in full.
    """
    from app.models import NagpraAction

    session = object_session(obj)
    if session is None:
        logger.warning(
            "NAGPRA ingestion gate: object %s is not session-attached; "
            "failing closed (indexing identity fields only)",
            getattr(obj, "object_id", "?"),
        )
        return True

    row = (
        session.query(NagpraAction.access_consent)
        .filter(
            NagpraAction.organization_id == obj.organization_id,
            NagpraAction.object_id == obj.object_id,
        )
        .first()
    )
    return row is not None and row.access_consent != CONSENT_GRANTED
