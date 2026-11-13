"""Audit campaign check lists: draw a sample, record checks, keep counters.

A campaign's scope (target locations and object types) defines the
population; its sampling method picks which objects go on the check list.
Each listed object becomes a pending AuditResult carrying its position in the
list (check_sequence) and the location it is expected to be in. The seed and
the effective parameters are stored on the campaign, so the same population
and seed always give the same list.

The draw itself (``draw_sample``) is a pure function over an ordered
population so it can be tested without a database.
"""

from __future__ import annotations

import math
import random
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import AuditCampaign, AuditResult, CollectionObject, Location

SAMPLING_ALGORITHM = "python-random-mt19937/v1"
MAX_SEED = 2**53 - 1  # stays exact in JavaScript numbers

SAMPLED_METHODS = {"random", "systematic", "stratified"}
ALL_METHODS = SAMPLED_METHODS | {"complete", "targeted"}

CHECK_OUTCOMES = {"found", "not_found", "wrong_location", "pending"}


class CheckListError(ValueError):
    """A request the check list cannot satisfy; the message is user-facing."""

    def __init__(self, message: str, code: str = "invalid", status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class PopulationItem:
    object_id: UUID
    object_number: str
    location_id: UUID | None


# ---------------------------------------------------------------------------
# Sampling (pure)
# ---------------------------------------------------------------------------


def target_count(population_size: int, sample_size: int | None, sample_percentage: float | None) -> int:
    """Number of objects to draw. sample_size wins over sample_percentage."""
    if sample_size is not None:
        if sample_size < 1:
            raise CheckListError("Sample size must be at least 1.")
        n = sample_size
    elif sample_percentage is not None:
        if not (0 < sample_percentage <= 100):
            raise CheckListError("Sample percentage must be more than 0 and at most 100.")
        n = math.ceil(population_size * sample_percentage / 100)
    else:
        raise CheckListError(
            "Set a sample size or a sample percentage before generating a sampled check list.",
            code="sample_size_required",
        )
    return max(0, min(n, population_size))


def _largest_remainder(n: int, sizes: list[int]) -> list[int]:
    """Split n across strata in proportion to their sizes, summing exactly to n."""
    total = sum(sizes)
    if total == 0 or n == 0:
        return [0] * len(sizes)
    quotas = [n * s / total for s in sizes]
    alloc = [math.floor(q) for q in quotas]
    remaining = n - sum(alloc)
    # Largest fractional part first; ties go to the earlier stratum.
    order = sorted(range(len(sizes)), key=lambda i: (-(quotas[i] - alloc[i]), i))
    for i in order[:remaining]:
        alloc[i] += 1
    return alloc


def draw_sample(
    population: list[PopulationItem],
    method: str,
    seed: int,
    sample_size: int | None = None,
    sample_percentage: float | None = None,
) -> tuple[list[PopulationItem], dict[str, Any]]:
    """Choose check-list members from an already stably ordered population.

    Returns the chosen items (in population order) and the details needed to
    explain the draw.
    """
    if method not in ALL_METHODS:
        raise CheckListError(f"Unknown sampling method: {method}")

    N = len(population)
    details: dict[str, Any] = {"population_count": N}

    if method in ("complete", "targeted"):
        details["target_count"] = N
        return list(population), details

    n = target_count(N, sample_size, sample_percentage)
    details["target_count"] = n
    rng = random.Random(seed)

    if n == 0:
        return [], details

    if method == "random":
        indices = sorted(rng.sample(range(N), n))
    elif method == "systematic":
        interval = N // n
        start = rng.randrange(interval)
        indices = [start + i * interval for i in range(n)]
        details["interval"] = interval
        details["start_index"] = start
    else:  # stratified by current location
        strata: dict[str, list[int]] = {}
        for i, item in enumerate(population):
            strata.setdefault(str(item.location_id) if item.location_id else "", []).append(i)
        # Stable stratum order: by location id, objects with no location last.
        keys = sorted(strata, key=lambda k: (k == "", k))
        alloc = _largest_remainder(n, [len(strata[k]) for k in keys])
        indices = []
        allocation = []
        for key, take in zip(keys, alloc):
            members = strata[key]
            picked = rng.sample(members, take) if take else []
            indices.extend(picked)
            allocation.append({"location_id": key or None, "population": len(members), "selected": take})
        indices.sort()
        details["strata"] = allocation

    return [population[i] for i in indices], details


# ---------------------------------------------------------------------------
# Scope
# ---------------------------------------------------------------------------


def _scope_locations(db: Session, org_id: UUID, target_locations: list[Any] | None) -> tuple[set[UUID] | None, list[dict]]:
    """Resolve target_locations to a set of location ids (with descendants).

    Entries may be a location id string or {"location_id", "include_children"}
    (include_children defaults to true). Returns (None, []) when unscoped.
    """
    if not target_locations:
        return None, []

    roots: list[tuple[UUID, bool]] = []
    for entry in target_locations:
        if isinstance(entry, str):
            raw, include_children = entry, True
        elif isinstance(entry, dict):
            raw, include_children = entry.get("location_id"), entry.get("include_children", True) is not False
        else:
            raw, include_children = None, True
        try:
            roots.append((UUID(str(raw)), include_children))
        except (TypeError, ValueError):
            raise CheckListError(f"Scope location {raw!r} is not a valid location id.")

    rows = db.query(Location.location_id, Location.parent_id).filter(Location.organization_id == org_id).all()
    known = {r.location_id for r in rows}
    children: dict[UUID, list[UUID]] = {}
    for r in rows:
        if r.parent_id:
            children.setdefault(r.parent_id, []).append(r.location_id)

    resolved: set[UUID] = set()
    described = []
    for root, include_children in roots:
        if root not in known:
            raise CheckListError("A scope location no longer exists in this organization.", code="scope_location_missing")
        described.append({"location_id": str(root), "include_children": include_children})
        stack = [root]
        while stack:
            loc = stack.pop()
            if loc in resolved:
                continue
            resolved.add(loc)
            if include_children:
                stack.extend(children.get(loc, []))
    return resolved, described


def load_population(db: Session, campaign: AuditCampaign) -> tuple[list[PopulationItem], dict[str, Any]]:
    """Objects in the campaign's scope, ordered by object number then id."""
    if campaign.target_collections:
        raise CheckListError(
            "This campaign is scoped by collection, which check lists don't support yet. "
            "Scope it by location or object type instead.",
            code="unsupported_scope",
        )
    location_ids, described = _scope_locations(db, campaign.organization_id, campaign.target_locations)
    object_types = [t for t in (campaign.target_object_types or []) if isinstance(t, str) and t]

    q = db.query(
        CollectionObject.object_id,
        CollectionObject.object_number,
        CollectionObject.current_location_id,
    ).filter(
        CollectionObject.organization_id == campaign.organization_id,
        CollectionObject.is_deleted == False,  # noqa: E712
    )
    if location_ids is not None:
        q = q.filter(CollectionObject.current_location_id.in_(location_ids))
    if object_types:
        q = q.filter(CollectionObject.object_type.in_(object_types))

    rows = q.all()
    population = [PopulationItem(r.object_id, r.object_number, r.current_location_id) for r in rows]
    population.sort(key=lambda p: (p.object_number, str(p.object_id)))
    scope = {"locations": described, "object_types": object_types}
    return population, scope


# ---------------------------------------------------------------------------
# Generate
# ---------------------------------------------------------------------------


def check_list_state(db: Session, campaign_id: UUID) -> tuple[int, int]:
    """(total results, results already checked) for a campaign."""
    total = db.query(func.count(AuditResult.result_id)).filter(AuditResult.campaign_id == campaign_id).scalar() or 0
    checked = db.query(func.count(AuditResult.result_id)).filter(
        AuditResult.campaign_id == campaign_id,
        AuditResult.result_status != "pending",
    ).scalar() or 0
    return total, checked


def generate_check_list(
    db: Session,
    campaign: AuditCampaign,
    user_id: UUID | None,
    seed: int | None = None,
    replace: bool = False,
) -> dict[str, Any]:
    """Draw the campaign's check list and store it as pending results.

    Refuses once any check has been recorded, and refuses to replace an
    existing unchecked list unless ``replace`` is true. Does not commit.
    """
    if campaign.status in ("completed", "cancelled"):
        raise CheckListError(f"This campaign is {campaign.status}; its check list can't be changed.", code="campaign_closed", status_code=409)

    total, checked = check_list_state(db, campaign.campaign_id)
    if checked:
        raise CheckListError(
            f"{checked} check{'s have' if checked != 1 else ' has'} already been recorded, so the list can't be regenerated.",
            code="checks_started",
            status_code=409,
        )
    if total and not replace:
        raise CheckListError(
            "This campaign already has a check list. Confirm that you want to replace it.",
            code="check_list_exists",
            status_code=409,
        )

    method = campaign.sample_method or "complete"
    if seed is None:
        seed = secrets.randbelow(2**48)
    elif not (0 <= seed <= MAX_SEED):
        raise CheckListError(f"Seed must be between 0 and {MAX_SEED}.")

    population, scope = load_population(db, campaign)
    sample_percentage = float(campaign.sample_percentage) if campaign.sample_percentage is not None else None
    chosen, details = draw_sample(population, method, seed, campaign.sample_size, sample_percentage)

    # Walking order: by expected location, then object number.
    loc_ids = {p.location_id for p in chosen if p.location_id}
    loc_paths: dict[UUID, str] = {}
    if loc_ids:
        for r in db.query(Location.location_id, Location.path, Location.name).filter(Location.location_id.in_(loc_ids)).all():
            loc_paths[r.location_id] = r.path or r.name or ""
    chosen_sorted = sorted(
        chosen,
        key=lambda p: (p.location_id is None, loc_paths.get(p.location_id, "") if p.location_id else "", p.object_number, str(p.object_id)),
    )

    if total:
        db.query(AuditResult).filter(
            AuditResult.campaign_id == campaign.campaign_id,
            AuditResult.result_status == "pending",
        ).delete(synchronize_session=False)

    now = datetime.now(timezone.utc)
    for seq, item in enumerate(chosen_sorted, start=1):
        db.add(AuditResult(
            campaign_id=campaign.campaign_id,
            organization_id=campaign.organization_id,
            object_id=item.object_id,
            expected_location_id=item.location_id,
            verified=False,
            verification_date=now,
            result_status="pending",
            check_sequence=seq,
        ))

    params = {
        "algorithm": SAMPLING_ALGORITHM,
        "ordering": "object_number,object_id",
        "sample_method": method,
        "sample_size": campaign.sample_size,
        "sample_percentage": sample_percentage,
        "scope": scope,
        **details,
        "selected_count": len(chosen_sorted),
    }
    campaign.check_list_seed = seed
    campaign.check_list_generated_at = now
    campaign.check_list_generated_by_id = user_id
    campaign.check_list_params = params
    campaign.objects_total = len(chosen_sorted)
    campaign.locations_total = len(loc_ids)
    campaign.updated_by_id = user_id
    campaign.updated_at = now
    db.flush()
    recompute_campaign_counters(db, campaign)
    return params


# ---------------------------------------------------------------------------
# Record a check
# ---------------------------------------------------------------------------


def apply_check_outcome(
    result: AuditResult,
    outcome: str,
    user_id: UUID | None,
    actual_location_id: UUID | None = None,
    note: str | None = None,
) -> None:
    """Set a result's fields for a found / not found / wrong location check."""
    if outcome not in CHECK_OUTCOMES:
        raise CheckListError(f"Unknown check outcome: {outcome}")
    now = datetime.now(timezone.utc)

    if outcome == "pending":
        result.result_status = "pending"
        result.verified = False
        result.location_correct = None
        result.actual_location_id = None
        result.discrepancy_type = None
        result.follow_up_required = False
        result.follow_up_action = None
        result.verified_by_id = None
        result.location_discrepancy_note = None
        if note is not None:
            result.result_note = note or None
        return

    result.verified_by_id = user_id
    result.verification_date = now
    if note is not None:
        result.result_note = note or None

    if outcome == "found":
        result.result_status = "verified"
        result.verified = True
        result.location_correct = True
        result.actual_location_id = result.expected_location_id
        result.discrepancy_type = None
        result.location_discrepancy_note = None
        result.follow_up_required = False
        result.follow_up_action = None
    elif outcome == "not_found":
        result.result_status = "not_found"
        result.verified = False
        result.location_correct = None
        result.actual_location_id = None
        result.discrepancy_type = "not_found"
        result.follow_up_required = True
        result.follow_up_action = "unresolved"
        result.follow_up_completed = False
    else:  # wrong_location
        if not actual_location_id:
            raise CheckListError("Choose the location where the object was found.", code="actual_location_required")
        if result.expected_location_id and actual_location_id == result.expected_location_id:
            raise CheckListError(
                "The found location is the expected location; record the object as found instead.",
                code="same_location",
            )
        result.result_status = "discrepancy"
        result.verified = True
        result.location_correct = False
        result.actual_location_id = actual_location_id
        result.discrepancy_type = "location_mismatch"
        result.follow_up_required = True
        result.follow_up_action = "unresolved"
        result.follow_up_completed = False


def outcome_of(result: AuditResult) -> str:
    """Map a stored result back to the check-list outcome vocabulary."""
    if result.result_status == "pending":
        return "pending"
    if result.result_status == "not_found":
        return "not_found"
    if result.discrepancy_type == "location_mismatch" or result.location_correct is False:
        return "wrong_location"
    if result.result_status == "verified":
        return "found"
    return result.result_status


def recompute_campaign_counters(db: Session, campaign: AuditCampaign) -> None:
    """Derive progress counters from the campaign's results."""
    db.flush()
    rows = db.query(
        AuditResult.result_status,
        AuditResult.discrepancy_type,
        AuditResult.location_correct,
        AuditResult.condition_changed,
        AuditResult.expected_location_id,
    ).filter(AuditResult.campaign_id == campaign.campaign_id).all()

    checked = [r for r in rows if r.result_status != "pending"]
    audited = len(checked)
    verified = sum(1 for r in checked if r.result_status == "verified")
    campaign.objects_audited = audited
    campaign.objects_verified = verified
    campaign.objects_not_found = sum(1 for r in checked if r.result_status == "not_found")
    campaign.objects_location_discrepancy = sum(
        1 for r in checked if r.discrepancy_type == "location_mismatch" or r.location_correct is False
    )
    campaign.objects_condition_change = sum(1 for r in checked if r.condition_changed)
    campaign.discrepancies_found = sum(1 for r in checked if r.result_status in ("discrepancy", "not_found"))
    campaign.locations_audited = len({r.expected_location_id for r in checked if r.expected_location_id})
    campaign.accuracy_rate = round(verified / audited * 100, 2) if audited else None
