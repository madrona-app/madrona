"""Entity-draft specs — the single source of truth for draftable entities.

IMPORT DISCIPLINE: this module must import only stdlib + the payload schema
classes. It must NOT import ``draft_service``, services, routers, or
``agent_persona`` — it is imported by ``agent_persona`` (to derive specialist
tool allowlists) and sits below the services layer. Any service import here
reintroduces the ``draft_service`` ↔ factory cycle the lazy accessors exist to
avoid.

``create_fn`` is a dotted ``"module:function"`` string resolved lazily by the
generator at apply time, so declaring an entity never eagerly imports its
create-logic module.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from pydantic import BaseModel

from app.schemas.drafts.acquisition import AcquisitionDraftPayload
from app.schemas.drafts.collection_object import CollectionObjectDraftPayload
from app.schemas.drafts.condition_report import ConditionReportDraftPayload
from app.schemas.drafts.conservation_treatment import ConservationTreatmentDraftPayload
from app.schemas.drafts.constituent import ConstituentDraftPayload
from app.schemas.drafts.deaccession import DeaccessionDraftPayload
from app.schemas.drafts.loan_in import LoanInDraftPayload
from app.schemas.drafts.loan_out import LoanOutDraftPayload
from app.schemas.drafts.media_metadata import MediaMetadataDraftPayload
from app.schemas.drafts.media_consent import MediaConsentDraftPayload
from app.schemas.drafts.media_publish import MediaPublishDraftPayload
from app.schemas.drafts.media_review import MediaReviewDraftPayload
from app.schemas.drafts.media_rights import MediaRightsDraftPayload
from app.schemas.drafts.location import LocationDraftPayload
from app.schemas.drafts.movement import MovementDraftPayload
from app.schemas.drafts.object_entry import ObjectEntryDraftPayload
from app.schemas.drafts.object_exit import ObjectExitDraftPayload
from app.schemas.drafts.object_right import ObjectRightDraftPayload
from app.schemas.drafts.reproduction_request import ReproductionRequestDraftPayload
from app.schemas.drafts.use_request import UseRequestDraftPayload
from app.schemas.drafts.valuation import ValuationDraftPayload


@dataclass(frozen=True)
class EntityDraftSpec:
    """One declaration per draftable entity. Adding entity N+1 is one of these
    plus its payload schema and a ``create_<entity>`` function."""

    entity_type: str
    payload_schema: type[BaseModel]
    # Dotted "module:function" path to the shared create function, resolved
    # lazily by the generator. Signature:
    #   create_<entity>(session, organization_id, payload: dict, actor, *,
    #                   open_approval: bool = True, proposed_by=None) -> Model
    create_fn: str
    # Attribute on the created model that holds its primary key (recorded as
    # the draft's applied_entity_id).
    id_attr: str
    # Specialist personas allowed to propose this draft. Unioned into each
    # persona's PersonaPolicy.allowed_tools via factory_draft_tool_names_for.
    personas: tuple[str, ...]
    tool_description: str

    # Optional metadata (carried for downstream workstreams; unused by the
    # single-entity skeleton beyond documentation).
    sequence_prefix: str | None = None
    sensitivity_entity_type: str | None = None
    workflow_entity: str | None = None
    cardinality: str = "single"  # "single" | "batch"
    # Recorded on the draft + shown in the inbox. Defaults "create"; set "update"
    # for single entities whose create_fn actually mutates an existing record
    # (e.g. media_review / media_publish act on an existing Media). Batch always
    # records "update".
    intended_action: str = "create"
    # Builds the human-facing _ui.summary line. Pure function of the payload;
    # must not import services. Defaults to a generic blurb.
    summarize: Callable[[dict], str] | None = field(default=None)

    @property
    def tool_name(self) -> str:
        return f"propose_{self.entity_type}_draft"


# ── Per-entity summary builders (pure; payload in, string out) ───────────────


def _acquisition_summary(p: dict) -> str:
    method = p.get("acquisition_method", "acquisition")
    src = p.get("source_name")
    return f"{method} acquisition" + (f" from {src}" if src else "")


def _deaccession_summary(p: dict) -> str:
    return (
        f"deaccession object {p.get('object_id')} "
        f"({p.get('reason', 'deaccession')})"
    )


def _collection_object_summary(p: dict) -> str:
    name = p.get("object_name") or p.get("object_type") or "object"
    return f"catalog {name} ({p.get('object_number')})"


def _media_metadata_summary(p: dict) -> str:
    fields = ", ".join(p.keys()) or "metadata"
    return f"update media {fields}"


def _condition_report_summary(p: dict) -> str:
    return (
        f"{p.get('report_type', 'condition')} report for "
        f"object {p.get('object_id')}"
    )


def _valuation_summary(p: dict) -> str:
    amount = p.get("valuation_amount")
    currency = p.get("valuation_currency", "USD")
    return (
        f"{p.get('valuation_type', 'valuation')} valuation "
        f"{amount} {currency} for object {p.get('object_id')}"
    )


def _movement_summary(p: dict) -> str:
    return (
        f"move object {p.get('object_id')} to location "
        f"{p.get('to_location_id')} ({p.get('reason', 'movement')})"
    )


def _loan_in_summary(p: dict) -> str:
    who = p.get("lender_name")
    return f"loan in ({p.get('loan_purpose', 'loan')})" + (f" from {who}" if who else "")


def _loan_out_summary(p: dict) -> str:
    who = p.get("borrower_name") or p.get("venue_name")
    return f"loan out ({p.get('loan_purpose', 'loan')})" + (f" to {who}" if who else "")


def _location_summary(p: dict) -> str:
    return (
        f"new {p.get('location_type', 'location')} location "
        f"'{p.get('name')}'"
    )


def _conservation_treatment_summary(p: dict) -> str:
    return (
        f"{p.get('treatment_type', 'conservation')} treatment "
        f"for object {p.get('object_id')}"
    )


def _constituent_summary(p: dict) -> str:
    return (
        f"new {p.get('constituent_type', 'constituent')} "
        f"'{p.get('name')}'"
    )


def _object_entry_summary(p: dict) -> str:
    who = p.get("depositor_name") or p.get("current_owner")
    return f"object entry ({p.get('reason', 'entry')})" + (f" from {who}" if who else "")


def _object_exit_summary(p: dict) -> str:
    who = p.get("recipient_name")
    return f"object exit ({p.get('exit_reason', 'exit')})" + (f" to {who}" if who else "")


def _object_right_summary(p: dict) -> str:
    return (
        f"{p.get('right_type', 'right')} right "
        f"({p.get('status', 'unknown')}) for object {p.get('object_id')}"
    )


def _use_request_summary(p: dict) -> str:
    return (
        f"{p.get('use_type', 'use')} request "
        f"for {p.get('requester_name')}"
    )


def _reproduction_request_summary(p: dict) -> str:
    return (
        f"{p.get('reproduction_type', 'reproduction')} request "
        f"for {p.get('requester_name')}"
    )


def _media_rights_summary(p: dict) -> str:
    holder = p.get("rights_holder")
    return (
        f"{p.get('rights_type', 'rights')} record for media {p.get('media_id')}"
        + (f" (holder: {holder})" if holder else "")
    )


def _media_consent_summary(p: dict) -> str:
    return (
        f"{p.get('consent_type', 'consent')} ({p.get('consent_scope', 'internal')}) "
        f"from {p.get('subject_name')} for media {p.get('media_id')}"
    )


def _media_review_summary(p: dict) -> str:
    return f"sensitive-content review of media {p.get('media_id')}"


def _media_publish_summary(p: dict) -> str:
    return f"publish media {p.get('media_id')}"


# ── The spec list ────────────────────────────────────────────────────────────

ENTITY_DRAFT_SPECS: tuple[EntityDraftSpec, ...] = (
    EntityDraftSpec(
        entity_type="acquisition",
        payload_schema=AcquisitionDraftPayload,
        create_fn="app.services.collections.creation.acquisition:create_acquisition",
        id_attr="acquisition_id",
        personas=("registrar",),
        sequence_prefix="ACQ",
        sensitivity_entity_type="acquisition",
        cardinality="single",
        summarize=_acquisition_summary,
        tool_description=(
            "Propose an acquisition record (a gift, purchase, bequest, etc. — "
            "Acquisition) as a reviewable DRAFT. This never writes the "
            "live record — a registrar reviews and approves it in the drafts "
            "inbox; where the institution requires acquisition sign-off, that "
            "approval is the draft's own gate. Requires acquisition_method."
        ),
    ),
    EntityDraftSpec(
        entity_type="deaccession",
        payload_schema=DeaccessionDraftPayload,
        create_fn="app.services.collections.creation.deaccession:create_deaccession",
        id_attr="deaccession_id",
        personas=("registrar",),
        sequence_prefix="DA",
        sensitivity_entity_type="deaccession",
        cardinality="single",
        summarize=_deaccession_summary,
        tool_description=(
            "Propose deaccessioning an object (removing it from the permanent "
            "collection — Deaccessioning) as a reviewable DRAFT. This "
            "never writes the live record — a registrar reviews and approves it "
            "in the drafts inbox, and the institution's deaccession sign-off is "
            "the draft's own gate. Requires object_id and reason."
        ),
    ),
    EntityDraftSpec(
        entity_type="collection_object",
        payload_schema=CollectionObjectDraftPayload,
        create_fn=(
            "app.services.collections.creation.collection_object:"
            "create_collection_object"
        ),
        id_attr="object_id",
        personas=("registrar",),
        sensitivity_entity_type="collection_object",
        cardinality="single",
        summarize=_collection_object_summary,
        tool_description=(
            "Propose cataloging a new collection object — its core descriptive "
            "record — as a reviewable DRAFT. This never writes the live record — "
            "a registrar reviews and approves it in the drafts inbox, and a "
            "default part is created automatically. Requires object_number."
        ),
    ),
    EntityDraftSpec(
        entity_type="media_metadata",
        payload_schema=MediaMetadataDraftPayload,
        create_fn=(
            "app.services.media.creation.media_metadata:apply_media_metadata"
        ),
        id_attr="media_id",  # unused for batch (no single applied entity)
        personas=("curator",),
        sensitivity_entity_type="media",
        cardinality="batch",
        summarize=_media_metadata_summary,
        tool_description=(
            "Propose a BATCH update of descriptive metadata (title, description, "
            "alt text, credit, creator, source) across many media items as a "
            "reviewable DRAFT. This never writes the live records — a curator "
            "reviews and approves it in the drafts inbox, and on approval the "
            "change is applied to every listed item as one all-or-nothing unit. "
            "Provide target_ids (the media to update) and only the fields to "
            "change."
        ),
    ),
    EntityDraftSpec(
        entity_type="condition_report",
        payload_schema=ConditionReportDraftPayload,
        create_fn=(
            "app.services.collections.creation.condition_report:"
            "create_condition_report"
        ),
        id_attr="report_id",
        personas=("conservator",),
        sequence_prefix="CR",
        sensitivity_entity_type="condition_report",
        cardinality="single",
        summarize=_condition_report_summary,
        tool_description=(
            "Propose a condition report for an object as a reviewable DRAFT. "
            "This never writes the live record — it creates a draft that a "
            "conservator reviews, edits, and approves in the drafts inbox. Use "
            "after examining an object's condition."
        ),
    ),
    EntityDraftSpec(
        entity_type="valuation",
        payload_schema=ValuationDraftPayload,
        create_fn="app.services.collections.creation.valuation:create_valuation",
        id_attr="valuation_id",
        personas=("registrar",),
        sensitivity_entity_type="valuation",
        cardinality="single",
        summarize=_valuation_summary,
        tool_description=(
            "Propose a monetary valuation for an object (Procedure 13) "
            "as a reviewable DRAFT. This never writes the live record — it "
            "creates a draft a registrar reviews, edits, and approves in the "
            "drafts inbox. Marking it current supersedes the prior current "
            "valuation of the same type on approval."
        ),
    ),
    EntityDraftSpec(
        entity_type="movement",
        payload_schema=MovementDraftPayload,
        create_fn="app.services.collections.creation.movement:create_movement",
        id_attr="movement_id",
        personas=("registrar",),
        sequence_prefix="M",
        sensitivity_entity_type="movement",
        cardinality="single",
        summarize=_movement_summary,
        tool_description=(
            "Propose moving an object (or a specific part) to a new location "
            "(Movement) as a reviewable DRAFT. This never writes the "
            "live record — it creates a draft a registrar reviews and approves "
            "in the drafts inbox. On approval the object's current location and "
            "occupancy counts are updated. Requires object_id, to_location_id, "
            "and a reason."
        ),
    ),
    EntityDraftSpec(
        entity_type="loan_in",
        payload_schema=LoanInDraftPayload,
        create_fn="app.services.collections.creation.loan_in:create_loan_in",
        id_attr="loan_in_id",
        personas=("loans_registrar",),
        sequence_prefix="LI",
        sensitivity_entity_type="loan_in",
        workflow_entity="loan_in",
        cardinality="single",
        summarize=_loan_in_summary,
        tool_description=(
            "Propose an incoming loan — borrowing an object from a lender "
            "(Loans In) — as a reviewable DRAFT. This never writes the "
            "live record — a loans registrar reviews and approves it in the "
            "drafts inbox; institutional loan sign-off is the draft's own gate. "
            "Requires loan_purpose."
        ),
    ),
    EntityDraftSpec(
        entity_type="loan_out",
        payload_schema=LoanOutDraftPayload,
        create_fn="app.services.collections.creation.loan_out:create_loan_out",
        id_attr="loan_out_id",
        personas=("loans_registrar",),
        sequence_prefix="LO",
        sensitivity_entity_type="loan_out",
        workflow_entity="loan_out",
        cardinality="single",
        summarize=_loan_out_summary,
        tool_description=(
            "Propose an outgoing loan — lending an object to a borrower/venue "
            "(Loans Out) — as a reviewable DRAFT. This never writes the "
            "live record — a loans registrar reviews and approves it in the "
            "drafts inbox; institutional loan sign-off is the draft's own gate. "
            "Requires loan_purpose."
        ),
    ),
    EntityDraftSpec(
        entity_type="location",
        payload_schema=LocationDraftPayload,
        create_fn="app.services.collections.creation.location:create_location",
        id_attr="location_id",
        personas=("registrar",),
        sensitivity_entity_type="location",
        cardinality="single",
        summarize=_location_summary,
        tool_description=(
            "Propose creating a storage/display location as a reviewable DRAFT "
            "(a supporting record for movements and object placement). This "
            "never writes the live record — a registrar reviews and approves it "
            "in the drafts inbox. A code is auto-generated and the hierarchy "
            "path is derived from the parent when given. Requires name and "
            "location_type."
        ),
    ),
    EntityDraftSpec(
        entity_type="conservation_treatment",
        payload_schema=ConservationTreatmentDraftPayload,
        create_fn=(
            "app.services.collections.creation.conservation_treatment:"
            "create_conservation_treatment"
        ),
        id_attr="treatment_id",
        personas=("conservator",),
        sequence_prefix="CON",
        sensitivity_entity_type="conservation_treatment",
        cardinality="single",
        summarize=_conservation_treatment_summary,
        tool_description=(
            "Propose a conservation treatment for an object (Conservation) "
            "as a reviewable DRAFT. This never writes the live "
            "record — a conservator reviews and approves it in the drafts inbox. "
            "Requires object_id and treatment_type."
        ),
    ),
    EntityDraftSpec(
        entity_type="constituent",
        payload_schema=ConstituentDraftPayload,
        create_fn="app.services.collections.creation.constituent:create_constituent",
        id_attr="constituent_id",
        personas=("registrar",),
        sensitivity_entity_type="constituent",
        cardinality="single",
        summarize=_constituent_summary,
        tool_description=(
            "Propose creating a constituent — a person or organization (artist, "
            "donor, lender, dealer, etc.) — as a reviewable DRAFT (a supporting "
            "record for acquisitions, loans, and authorship). This never writes "
            "the live record — a registrar reviews and approves it in the drafts "
            "inbox. Requires constituent_type and name."
        ),
    ),
    EntityDraftSpec(
        entity_type="object_entry",
        payload_schema=ObjectEntryDraftPayload,
        create_fn="app.services.collections.creation.object_entry:create_object_entry",
        id_attr="entry_id",
        personas=("registrar",),
        sequence_prefix="E",
        sensitivity_entity_type="object_entry",
        cardinality="single",
        summarize=_object_entry_summary,
        tool_description=(
            "Propose an object entry — the record of an object arriving at the "
            "museum (for loan consideration, a gift offer, identification, etc. "
            "— Object Entry) — as a reviewable DRAFT. This never writes "
            "the live record — a registrar reviews and approves it in the drafts "
            "inbox. Requires reason."
        ),
    ),
    EntityDraftSpec(
        entity_type="object_exit",
        payload_schema=ObjectExitDraftPayload,
        create_fn="app.services.collections.creation.object_exit:create_object_exit",
        id_attr="exit_id",
        personas=("registrar",),
        sequence_prefix="EX",
        sensitivity_entity_type="object_exit",
        cardinality="single",
        summarize=_object_exit_summary,
        tool_description=(
            "Propose an object exit — the record of an object leaving the museum "
            "(a loan return, transfer, disposal, repatriation, etc. — Object "
            "Exit) — as a reviewable DRAFT. This never writes the live "
            "record — a registrar reviews and approves it in the drafts inbox; "
            "where the institution requires exit sign-off, that approval is the "
            "draft's own gate. Requires exit_reason."
        ),
    ),
    EntityDraftSpec(
        entity_type="object_right",
        payload_schema=ObjectRightDraftPayload,
        create_fn="app.services.collections.creation.object_right:create_object_right",
        id_attr="right_id",
        personas=("rights_specialist",),
        sensitivity_entity_type="object_right",
        cardinality="single",
        summarize=_object_right_summary,
        tool_description=(
            "Propose a rights record for an object (copyright, reproduction, "
            "licensing, etc. — Rights) as a reviewable DRAFT. This "
            "never writes the live record — a rights specialist reviews and "
            "approves it in the drafts inbox. Requires object_id and right_type."
        ),
    ),
    EntityDraftSpec(
        entity_type="use_request",
        payload_schema=UseRequestDraftPayload,
        create_fn="app.services.collections.creation.use_request:create_use_request",
        id_attr="request_id",
        personas=("rights_specialist",),
        sequence_prefix="USE",
        sensitivity_entity_type="use_request",
        cardinality="single",
        summarize=_use_request_summary,
        tool_description=(
            "Propose a use request — someone's request to use collection items "
            "(research access, reproduction, exhibition, publication, etc. — "
            "Use of Collections) — as a reviewable DRAFT. This never "
            "writes the live record — a rights specialist reviews and approves "
            "it in the drafts inbox. A request number is generated automatically. "
            "Requires use_type, requester_name, and use_purpose."
        ),
    ),
    EntityDraftSpec(
        entity_type="reproduction_request",
        payload_schema=ReproductionRequestDraftPayload,
        create_fn=(
            "app.services.collections.creation.reproduction_request:"
            "create_reproduction_request"
        ),
        id_attr="reproduction_id",
        personas=("rights_specialist",),
        sequence_prefix="REP",
        sensitivity_entity_type="reproduction_request",
        cardinality="single",
        summarize=_reproduction_request_summary,
        tool_description=(
            "Propose a reproduction request (a photograph/scan/cast/etc. of an "
            "object — Procedure 19) as a reviewable DRAFT. This never "
            "writes the live record — a rights specialist reviews and approves "
            "it in the drafts inbox. A request number is generated automatically. "
            "Requires requester_name and reproduction_type."
        ),
    ),
    # ── Media rights / publish (Rights management) ───────────────────────────
    EntityDraftSpec(
        entity_type="media_rights",
        payload_schema=MediaRightsDraftPayload,
        create_fn="app.services.media.creation.media_rights:create_media_rights",
        id_attr="rights_id",
        personas=("rights_specialist",),
        sensitivity_entity_type="media",
        cardinality="single",
        summarize=_media_rights_summary,
        tool_description=(
            "Propose a rights record for a media item (copyright / license / "
            "permission / restriction — Rights management) as a reviewable "
            "DRAFT. This never writes the live record — a rights specialist reviews "
            "and approves it in the drafts inbox. Requires media_id; prefer a "
            "rightsstatements.org URI for rights_statement."
        ),
    ),
    EntityDraftSpec(
        entity_type="media_consent",
        payload_schema=MediaConsentDraftPayload,
        create_fn="app.services.media.creation.media_consent:create_media_consent",
        id_attr="consent_id",
        personas=("rights_specialist",),
        sensitivity_entity_type="media",
        cardinality="single",
        summarize=_media_consent_summary,
        tool_description=(
            "Propose a consent/release record for a media item that depicts an "
            "identifiable person (photo/model release, interview consent, etc.) as "
            "a reviewable DRAFT — required before publishing media of people. A "
            "rights specialist reviews and approves it. Requires media_id and "
            "subject_name."
        ),
    ),
    EntityDraftSpec(
        entity_type="media_review",
        payload_schema=MediaReviewDraftPayload,
        create_fn="app.services.media.creation.media_review:apply_media_review",
        id_attr="media_id",
        personas=("curator",),
        intended_action="update",
        sensitivity_entity_type="media",
        cardinality="single",
        summarize=_media_review_summary,
        tool_description=(
            "Propose the sensitive-content metadata review of a media item as a "
            "reviewable DRAFT — approving it marks the item reviewed, a "
            "precondition for publishing. A curator reviews and approves it. "
            "Requires media_id."
        ),
    ),
    EntityDraftSpec(
        entity_type="media_publish",
        payload_schema=MediaPublishDraftPayload,
        create_fn="app.services.media.creation.media_publish:apply_media_publish",
        id_attr="media_id",
        personas=("curator",),
        intended_action="update",
        sensitivity_entity_type="media",
        cardinality="single",
        summarize=_media_publish_summary,
        tool_description=(
            "Propose publishing a media item as a reviewable DRAFT. Applying it is "
            "HARD-GATED: it will only publish if the item has active rights on file "
            "AND has passed sensitive-content review (and, when require_consent is "
            "set, has valid consent). A curator reviews and approves it. Requires "
            "media_id."
        ),
    ),
)


# ── Light, service-free accessors (safe for low layers) ──────────────────────


def build_payload_schemas() -> dict[str, type[BaseModel]]:
    """entity_type → payload schema, for draft_service validation."""
    return {s.entity_type: s.payload_schema for s in ENTITY_DRAFT_SPECS}


def factory_draft_tool_names_for(persona: str) -> frozenset[str]:
    """Draft tool names a persona may propose. Unioned into the persona's
    allowed_tools so the registry's allowlist gate (which reads
    PersonaPolicy.allowed_tools, not per-tool registration) admits them."""
    return frozenset(
        s.tool_name for s in ENTITY_DRAFT_SPECS if persona in s.personas
    )
