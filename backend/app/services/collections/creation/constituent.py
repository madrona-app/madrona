"""Shared create logic for Constituent.

Extracted from the inline ``create_constituent`` router so the draft applier and
the API route share one implementation, including the ``variant_names`` →
VariantTerm child aggregate. The caller owns the transaction.
"""

from __future__ import annotations

from uuid import UUID

from app.models import Constituent


def create_constituent(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> Constituent:
    """Create a live Constituent (and any variant-name terms). The caller owns
    the transaction. ``open_approval``/``proposed_by`` are accepted for
    signature uniformity; constituents are not approval-gated and record no
    separate proposer.
    """
    p = payload
    constituent = Constituent(
        organization_id=organization_id,
        constituent_type=p["constituent_type"],
        name=p["name"],
        first_name=p.get("first_name"),
        last_name=p.get("last_name"),
        title=p.get("title"),
        role=p.get("role"),
        organization_name=p.get("organization_name"),
        department=p.get("department"),
        email=p.get("email"),
        phone=p.get("phone"),
        phone_secondary=p.get("phone_secondary"),
        website=p.get("website"),
        address=p.get("address"),
        contact_categories=p.get("contact_categories"),
        sort_name=p.get("sort_name"),
        display_name=p.get("display_name"),
        given_name=p.get("given_name"),
        family_name=p.get("family_name"),
        name_prefix=p.get("name_prefix"),
        name_suffix=p.get("name_suffix"),
        name_type=p.get("name_type"),
        nationality=p.get("nationality"),
        nationalities=p.get("nationalities"),
        culture=p.get("culture"),
        life_roles=p.get("life_roles"),
        gender=p.get("gender"),
        birth_date_display=p.get("birth_date_display"),
        birth_place=p.get("birth_place"),
        death_date_display=p.get("death_date_display"),
        death_place=p.get("death_place"),
        biography=p.get("biography"),
        biography_source=p.get("biography_source"),
        ulan_id=p.get("ulan_id"),
        viaf_id=p.get("viaf_id"),
        wikidata_id=p.get("wikidata_id"),
        loc_id=p.get("loc_id"),
        external_uris=p.get("external_uris"),
        notes=p.get("notes"),
        internal_notes=p.get("internal_notes"),
        cataloger_notes=p.get("cataloger_notes"),
        created_by=actor,
    )
    session.add(constituent)
    session.flush()

    from app.models import VariantTerm

    for idx, vn in enumerate(p.get("variant_names") or []):
        session.add(
            VariantTerm(
                organization_id=constituent.organization_id,
                entity_type="constituent",
                entity_id=constituent.constituent_id,
                term=vn.get("name", ""),
                term_type=vn.get("type"),
                language=vn.get("language"),
                display_order=idx,
            )
        )

    return constituent
