"""Plan-template catalog (§1E).

Canonical multi-step plans the Guide can instantiate deterministically instead
of free-form planning. A template is an ordered list of step templates with
``Param``/``StepRef`` placeholders; ``instantiate`` fills them and emits step
dicts in exactly the shape ``PlanService._validate_steps`` accepts — so a
template plan runs through the same executor + the same validation safety net
as a planned one.

Draft-proposing steps are persona-scoped ``tool_call`` steps (the §1E executor
enabler), so they call ``propose_<entity>_draft`` deterministically under the
right specialist.

Grounded in the procedure model. The sequences encode the real human decision
gates and cross-procedure order:

- **Object Entry** is the shared front door — Acquisition and Loans In trigger
  it then return. Canonical order: record → check condition → location.
- **Acquisition**: propose → *Evaluate the proposal* (board/committee sign-off)
  → receive (object entry) → number + accession the object → intake condition
  check. The sign-off + catalog-approval are real ``draft_approval`` awaits;
  the cataloged object's id threads into the condition report (draft-chaining).
- **Loans In**: record the loan → *Agreeing the loan* (signed-agreement sign-off,
  the loan draft's own approval) → arrival condition report.

Two procedure steps are deliberately NOT templated yet because they need data a
template can't safely supply: a **Movement** to a permanent/storage location
(needs a real ``to_location_id``) and **insurance/indemnity** before receipt
(no draft tool exists). Both are documented follow-ons, not fabricated here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable


class Param:
    """A placeholder filled from the instantiation params (e.g. object_id)."""

    __slots__ = ("name",)

    def __init__(self, name: str):
        self.name = name


class StepRef:
    """A reference to another step in the SAME template, by ``label``. Resolved
    at ``instantiate`` time against the step's position (its plan index):

    - in an await's ``from_step`` → the referenced step's index (so a
      ``draft_approval`` await parks on the draft a prior propose step created);
    - in an arg, with ``field`` set → the runtime threading placeholder
      ``{"$from_step": <idx>, "field": <field>}`` the executor resolves from
      that step's result (e.g. a condition report's object_id = the cataloged
      object's ``applied_entity_id``).
    """

    __slots__ = ("label", "field")

    def __init__(self, label: str, field: str | None = None):
        self.label = label
        self.field = field


@dataclass(frozen=True)
class PlanStepTemplate:
    description: str
    kind: str  # "tool_call" | "delegate" | "await"
    tool: str | None = None
    # tool_call: the specialist whose allowlist the tool runs under.
    # delegate: the target specialist.
    persona: str | None = None
    # arg values may be literals, Param, or StepRef placeholders; None results
    # are dropped (so optional params don't become NULLs).
    args: dict[str, Any] = field(default_factory=dict)
    wait_for: dict[str, Any] | None = None
    # Symbolic name other steps reference via StepRef — avoids hand-counting
    # indices when wiring awaits + id threading.
    label: str | None = None
    # Conditional step: included only when the named param resolves truthy
    # (e.g. a consent step gated on `requires_consent`). Dropped steps don't
    # consume an index, and label-based StepRefs are resolved AFTER dropping,
    # so threading/awaits stay correct.
    when: str | None = None
    # Branching: the branch-group key this step belongs to (None = unconditional).
    # A `kind="decision"` step lists its keys in args.options; the executor skips
    # steps tagged with the decision's non-chosen keys at runtime. `when` is the
    # COMPILE-time fork (intake-known); `branch`/decision is the RUNTIME fork.
    branch: str | None = None
    # Phase-group label for the timeline UI (e.g. "Receipt", "Due diligence").
    # Template-authored only — a property of the known procedure.
    phase: str | None = None


@dataclass(frozen=True)
class ParamSpec:
    """UI metadata for a template param — drives the deterministic "Start
    procedure" form (the forced entry point), so the frontend can render a
    typed input instead of a bare text box. Purely descriptive: matching and
    instantiation still run off required_params/context_params.
    """
    key: str
    label: str
    # "text" | "enum" | "date" | "number" | "boolean" | "entity"
    type: str = "text"
    required: bool = True
    # For type="enum": the allowed values.
    enum_options: tuple[str, ...] = ()
    # Auto-filled from page_context (e.g. object_id, media_id) when the user is
    # already on that entity — then the form hides it. When NOT on the entity
    # (the central surface), the form shows an entity picker instead, so the
    # template is still runnable rather than a guaranteed missing-param.
    from_context: bool = False
    # For type="entity": which kind to search/pick ("object" | "media"). Drives
    # the inline picker on surfaces that don't supply the id from context.
    entity_kind: str | None = None
    help_text: str | None = None


@dataclass(frozen=True)
class PlanTemplate:
    template_id: str
    title: str
    goal: str
    trigger_phrases: tuple[str, ...]
    steps: tuple[PlanStepTemplate, ...]
    # Params that MUST resolve (from page context or explicit args) or the
    # template doesn't match — avoids confidently-wrong drafts.
    required_params: tuple[str, ...] = ()
    # Params pulled from page_context by these keys when not supplied explicitly.
    context_params: tuple[str, ...] = ()
    procedure: str | None = None
    nav_item: str | None = None
    # Typed param metadata for the "Start procedure" form (additive — does not
    # affect matching/instantiation). Keys should cover the params the form must
    # collect; from_context params are declared but rendered by context, not asked.
    params: tuple[ParamSpec, ...] = ()


# ── The catalog ──────────────────────────────────────────────────────────────

CATALOG: tuple[PlanTemplate, ...] = (
    PlanTemplate(
        template_id="loan_in_reception",
        title="Loan-In Reception",
        goal="Receive an incoming loan, agree it, and record the object's arrival condition",
        trigger_phrases=(
            "loan in", "loan-in", "incoming loan", "receive a loan",
            "borrow", "loan reception",
        ),
        procedure="Loans In",
        nav_item="loans-in",
        required_params=("object_id",),
        context_params=("object_id",),
        params=(
            ParamSpec(key="object_id", label="Object", type="entity", from_context=True,
                      entity_kind="object"),
            ParamSpec(key="lender_name", label="Lender"),
            ParamSpec(key="loan_purpose", label="Loan purpose", required=False),
        ),
        steps=(
            PlanStepTemplate(
                label="loan",
                description="Draft the incoming loan record (lender, dates, purpose)",
                kind="tool_call",
                tool="propose_loan_in_draft",
                persona="loans_registrar",
                args={
                    "loan_purpose": Param("loan_purpose"),
                    "lender_name": Param("lender_name"),
                },
            ),
            PlanStepTemplate(
                description="Agree and sign off the loan agreement before receipt",
                kind="await",
                wait_for={"kind": "draft_approval", "from_step": StepRef("loan")},
            ),
            PlanStepTemplate(
                description="Draft the arrival condition report for the object",
                kind="tool_call",
                tool="propose_condition_report_draft",
                persona="conservator",
                # object_id is the EXISTING object the user is on — a real id
                # from page context, so no threading needed here.
                args={
                    "object_id": Param("object_id"),
                    "report_type": "loan_in",
                    "report_date": Param("report_date"),
                },
            ),
        ),
    ),
    PlanTemplate(
        template_id="acquisition_accession",
        title="Acquisition & Accessioning",
        goal=(
            "Propose an acquisition, gain sign-off, receive and accession the "
            "object, and check its intake condition"
        ),
        trigger_phrases=(
            "acquisition", "accession", "acquire", "new acquisition",
            "gift offer", "purchase consideration",
        ),
        procedure="Acquisition",
        nav_item="acquisitions",
        params=(
            ParamSpec(
                key="acquisition_method", label="Acquisition method", type="enum",
                enum_options=("gift", "purchase", "bequest", "transfer", "exchange"),
            ),
            ParamSpec(key="object_number", label="Object number",
                      help_text="Your institution's accession number for the object"),
            ParamSpec(key="source_name", label="Source / donor", required=False),
            ParamSpec(
                key="entry_reason", label="Entry reason", type="enum", required=False,
                enum_options=("gift_offer", "loan_consideration", "identification",
                              "conservation", "photography", "research", "other"),
            ),
        ),
        # object_number is institution-assigned and can't be fabricated, so the
        # full accession chain is only instantiated when it (and the method) are
        # supplied — otherwise the caller falls back to free-form planning.
        required_params=("acquisition_method", "object_number"),
        steps=(
            PlanStepTemplate(
                label="acq",
                description="Draft the acquisition proposal (method, source)",
                kind="tool_call",
                tool="propose_acquisition_draft",
                persona="registrar",
                args={
                    "acquisition_method": Param("acquisition_method"),
                    "source_name": Param("source_name"),
                },
            ),
            # Judgment step (delegate → Curator): the one place reasoning beats a
            # form field — surface provenance/title concerns + significance for the
            # board before they sign off. Output is advisory, shown in the timeline.
            PlanStepTemplate(
                description="Provenance & significance review for the board",
                kind="delegate",
                persona="curator",
                args={
                    "question": (
                        "Review the provenance, title, and significance of this "
                        "proposed acquisition. Flag any ownership gaps, authenticity "
                        "concerns, or red flags, and summarize why it matters for the "
                        "collection — to inform the board's sign-off."
                    ),
                },
            ),
            PlanStepTemplate(
                description="Board/committee sign-off on the acquisition proposal",
                kind="await",
                wait_for={"kind": "draft_approval", "from_step": StepRef("acq")},
            ),
            PlanStepTemplate(
                description="Draft the object entry logging the incoming item",
                kind="tool_call",
                tool="propose_object_entry_draft",
                persona="registrar",
                args={
                    "reason": Param("entry_reason"),
                    "depositor_name": Param("source_name"),
                },
            ),
            PlanStepTemplate(
                label="obj",
                description="Catalog & number the object — the accession record",
                kind="tool_call",
                tool="propose_collection_object_draft",
                persona="registrar",
                args={"object_number": Param("object_number")},
            ),
            PlanStepTemplate(
                label="obj_approved",
                description="Approve the catalog record",
                kind="await",
                wait_for={"kind": "draft_approval", "from_step": StepRef("obj")},
            ),
            PlanStepTemplate(
                description="Draft the intake condition report for the new object",
                kind="tool_call",
                tool="propose_condition_report_draft",
                persona="conservator",
                args={
                    # Threaded: the cataloged object's id, carried in when its
                    # draft is approved + applied (the obj_approved await).
                    "object_id": StepRef("obj_approved", "applied_entity_id"),
                    "report_type": "intake",
                    "report_date": Param("report_date"),
                },
            ),
        ),
    ),
    PlanTemplate(
        template_id="media_publish_clearance",
        title="Clear Rights & Publish a Media Item",
        goal="Record rights, review for sensitive content, and publish a media item",
        trigger_phrases=(
            "publish media", "publish this image", "publish the image",
            "clear rights and publish", "rights and publish", "publish to the web",
        ),
        procedure="Rights management",
        nav_item="media",
        # Targets an EXISTING media item, so media_id must resolve. requires_consent
        # (optional) gates the consent steps for media depicting identifiable people.
        required_params=("media_id",),
        context_params=("media_id",),
        params=(
            ParamSpec(key="media_id", label="Media item", type="entity", from_context=True,
                      entity_kind="media"),
            ParamSpec(key="requires_consent", label="Subject needs consent?", type="boolean", required=False),
            ParamSpec(key="subject_name", label="Subject name", required=False),
            ParamSpec(key="rights_statement", label="Rights statement (URI)", required=False),
        ),
        steps=(
            PlanStepTemplate(
                label="rights",
                description="Draft the rights record (copyright/license + statement)",
                kind="tool_call",
                tool="propose_media_rights_draft",
                persona="rights_specialist",
                args={
                    "media_id": Param("media_id"),
                    "rights_type": Param("rights_type"),
                    "rights_status": Param("rights_status"),
                    "license_type": Param("license_type"),
                    "rights_statement": Param("rights_statement"),
                },
            ),
            PlanStepTemplate(
                description="Sign off the rights and license",
                kind="await",
                wait_for={"kind": "draft_approval", "from_step": StepRef("rights")},
            ),
            PlanStepTemplate(
                label="consent",
                when="requires_consent",
                description="Draft the consent/release (media depicts a person)",
                kind="tool_call",
                tool="propose_media_consent_draft",
                persona="rights_specialist",
                args={
                    "media_id": Param("media_id"),
                    "subject_name": Param("subject_name"),
                    "consent_type": Param("consent_type"),
                    "consent_scope": Param("consent_scope"),
                },
            ),
            PlanStepTemplate(
                when="requires_consent",
                description="Consent sign-off",
                kind="await",
                wait_for={"kind": "draft_approval", "from_step": StepRef("consent")},
            ),
            PlanStepTemplate(
                label="review",
                description="Draft the sensitive-content metadata review",
                kind="tool_call",
                tool="propose_media_review_draft",
                persona="curator",
                args={
                    "media_id": Param("media_id"),
                    "notes": Param("review_notes"),
                },
            ),
            PlanStepTemplate(
                description="Sensitive-content review sign-off (required before publish)",
                kind="await",
                wait_for={"kind": "draft_approval", "from_step": StepRef("review")},
            ),
            PlanStepTemplate(
                description="Publish the media item (hard-gated on rights + review)",
                kind="tool_call",
                tool="propose_media_publish_draft",
                persona="curator",
                args={
                    "media_id": Param("media_id"),
                    "rights_statement": Param("rights_statement"),
                    "published_url": Param("published_url"),
                    # Carries the consent requirement into the publish gate.
                    "require_consent": Param("requires_consent"),
                },
            ),
        ),
    ),
    PlanTemplate(
        template_id="loan_out_dispatch",
        title="Loan-Out Dispatch",
        goal=(
            "Agree an outgoing loan, check the object's condition, and record "
            "its dispatch"
        ),
        trigger_phrases=(
            "loan out", "loan-out", "outgoing loan", "lend", "lend an object",
            "dispatch a loan", "send on loan",
        ),
        procedure="Loans Out",
        nav_item="loans-out",
        # Object-scoped: the condition report + exit target the object the user
        # is on. loan_purpose is the defining field of the loan record.
        required_params=("object_id", "loan_purpose"),
        context_params=("object_id",),
        params=(
            ParamSpec(key="object_id", label="Object", type="entity", from_context=True,
                      entity_kind="object"),
            ParamSpec(
                key="loan_purpose", label="Loan purpose", type="enum",
                enum_options=("exhibition", "research", "conservation", "education",
                              "photography", "touring", "inter_museum", "other"),
            ),
            ParamSpec(key="borrower_name", label="Borrower", required=False),
            ParamSpec(key="exhibition_title", label="Exhibition / project", required=False),
            ParamSpec(key="exit_method", label="Dispatch method", required=False,
                      help_text="e.g. fine-art shipper, hand-carry"),
        ),
        steps=(
            PlanStepTemplate(
                label="loan", phase="Agreement",
                description="Draft the outgoing loan (borrower, dates, purpose)",
                kind="tool_call", tool="propose_loan_out_draft", persona="loans_registrar",
                args={
                    "loan_purpose": Param("loan_purpose"),
                    "borrower_name": Param("borrower_name"),
                    "exhibition_title": Param("exhibition_title"),
                },
            ),
            PlanStepTemplate(
                phase="Agreement",
                description="Agree and sign the loan agreement before dispatch",
                kind="await",
                wait_for={"kind": "draft_approval", "from_step": StepRef("loan")},
            ),
            PlanStepTemplate(
                phase="Dispatch",
                description="Draft the pre-loan (outgoing) condition report",
                kind="tool_call", tool="propose_condition_report_draft", persona="conservator",
                args={
                    "object_id": Param("object_id"),
                    "report_type": "loan_out",
                    "report_date": Param("report_date"),
                },
            ),
            PlanStepTemplate(
                phase="Dispatch",
                description="Record the object's exit on dispatch",
                kind="tool_call", tool="propose_object_exit_draft", persona="registrar",
                args={
                    "exit_reason": "loan_out",
                    "recipient_name": Param("borrower_name"),
                    "exit_method": Param("exit_method"),
                },
            ),
        ),
    ),
    PlanTemplate(
        template_id="deaccession_disposal",
        title="Deaccession & Disposal",
        goal=(
            "Propose a deaccession, gain committee and board sign-off, and "
            "record the object's disposal"
        ),
        trigger_phrases=(
            "deaccession", "dispose of", "disposal", "remove from collection",
            "deaccession and dispose",
        ),
        procedure="Deaccessioning and Disposal",
        nav_item="deaccessions",
        # Object-scoped + governance-heavy: the draft pipeline NAGPRA-gates the
        # object before the proposal is created (a trust feature, automatic).
        required_params=("object_id", "reason"),
        context_params=("object_id",),
        params=(
            ParamSpec(key="object_id", label="Object", type="entity", from_context=True,
                      entity_kind="object"),
            ParamSpec(
                key="reason", label="Deaccession reason", type="enum",
                enum_options=("duplicate", "outside_scope", "deterioration", "damage",
                              "repatriation", "theft_loss", "exchange", "ethical",
                              "donor_request", "legal_requirement", "hazard", "other"),
            ),
            ParamSpec(key="reason_detail", label="Reason detail", required=False),
            ParamSpec(key="recipient_name", label="Disposal recipient", required=False),
        ),
        steps=(
            PlanStepTemplate(
                label="deacc", phase="Proposal",
                description="Draft the deaccession proposal (reason, justification)",
                kind="tool_call", tool="propose_deaccession_draft", persona="registrar",
                args={
                    "object_id": Param("object_id"),
                    "reason": Param("reason"),
                    "reason_detail": Param("reason_detail"),
                },
            ),
            # Judgment step (delegate → Curator): deaccession is the most
            # governance-heavy procedure — surface title, ethics, restrictions,
            # and repatriation considerations for the board. Output is advisory.
            PlanStepTemplate(
                phase="Review",
                description="Provenance, ethics & restrictions review for the board",
                kind="delegate", persona="curator",
                args={
                    "question": (
                        "Review this proposed deaccession: confirm the museum holds "
                        "clear title, surface any donor restrictions, ethical "
                        "(AAM/ICOM) concerns, or repatriation considerations, and "
                        "summarise the case for the deaccession board."
                    ),
                },
            ),
            PlanStepTemplate(
                phase="Review",
                description="Committee and board sign-off on the deaccession",
                kind="await",
                wait_for={"kind": "draft_approval", "from_step": StepRef("deacc")},
            ),
            PlanStepTemplate(
                phase="Disposal",
                description="Record the object's exit on disposal",
                kind="tool_call", tool="propose_object_exit_draft", persona="registrar",
                args={
                    "exit_reason": "deaccession",
                    "recipient_name": Param("recipient_name"),
                },
            ),
        ),
    ),
    PlanTemplate(
        template_id="conservation_treatment",
        title="Conservation Treatment",
        goal=(
            "Assess an object's condition, propose and approve a treatment, and "
            "record the outcome"
        ),
        trigger_phrases=(
            "conservation", "conservation treatment", "treat an object",
            "conserve", "restoration", "stabilize",
        ),
        procedure="Collections Care and Conservation",
        nav_item="conservation",
        required_params=("object_id", "treatment_type"),
        context_params=("object_id",),
        params=(
            ParamSpec(key="object_id", label="Object", type="entity", from_context=True,
                      entity_kind="object"),
            ParamSpec(
                key="treatment_type", label="Treatment type", type="enum",
                enum_options=("preventive", "remedial", "restoration", "analysis",
                              "stabilization", "cleaning", "repair", "documentation",
                              "mount_making", "rehousing", "pest_treatment", "other"),
            ),
            ParamSpec(key="proposal_summary", label="Proposed treatment", required=False,
                      help_text="What the treatment involves and why"),
            ParamSpec(key="conservator_name", label="Conservator", required=False),
        ),
        steps=(
            PlanStepTemplate(
                phase="Assessment",
                description="Draft the pre-treatment condition assessment",
                kind="tool_call", tool="propose_condition_report_draft", persona="conservator",
                args={
                    "object_id": Param("object_id"),
                    "report_type": "pre_treatment",
                    "report_date": Param("report_date"),
                },
            ),
            PlanStepTemplate(
                label="treat", phase="Treatment",
                description="Draft the conservation treatment proposal",
                kind="tool_call", tool="propose_conservation_treatment_draft", persona="conservator",
                args={
                    "object_id": Param("object_id"),
                    "treatment_type": Param("treatment_type"),
                    "proposal_summary": Param("proposal_summary"),
                    "conservator_name": Param("conservator_name"),
                },
            ),
            PlanStepTemplate(
                phase="Treatment",
                description="Approve the treatment proposal before work begins",
                kind="await",
                wait_for={"kind": "draft_approval", "from_step": StepRef("treat")},
            ),
            PlanStepTemplate(
                phase="Outcome",
                description="Draft the post-treatment condition report",
                kind="tool_call", tool="propose_condition_report_draft", persona="conservator",
                args={
                    "object_id": Param("object_id"),
                    "report_type": "post_treatment",
                    "report_date": Param("report_date"),
                },
            ),
        ),
    ),
    PlanTemplate(
        template_id="use_reproduction",
        title="Use Request & Reproduction",
        goal=(
            "Log a use request, clear the rights, gain sign-off, and raise the "
            "reproduction order"
        ),
        trigger_phrases=(
            "use request", "request to use", "reproduction request", "reproduce",
            "image request", "permission to reproduce", "use of collections",
        ),
        procedure="Use of Collections",
        nav_item="use-requests",
        # Not object-scoped — a use request stands alone (object link is optional).
        required_params=("use_type", "requester_name", "use_purpose"),
        params=(
            ParamSpec(
                key="use_type", label="Use type", type="enum",
                enum_options=("research", "exhibition", "reproduction", "education",
                              "publication", "broadcast", "commercial", "conservation",
                              "loan", "digitization", "other"),
            ),
            ParamSpec(key="requester_name", label="Requester"),
            ParamSpec(key="use_purpose", label="Purpose of use"),
            ParamSpec(
                key="reproduction_type", label="Reproduction type", type="enum",
                enum_options=("photograph", "scan", "cast", "3d_print", "digital_copy",
                              "film", "video", "other"),
            ),
        ),
        steps=(
            PlanStepTemplate(
                label="use", phase="Request",
                description="Draft the use request (type, requester, purpose)",
                kind="tool_call", tool="propose_use_request_draft", persona="rights_specialist",
                args={
                    "use_type": Param("use_type"),
                    "requester_name": Param("requester_name"),
                    "use_purpose": Param("use_purpose"),
                },
            ),
            # Judgment step (delegate → Rights specialist): rights are the gate
            # for use — verify clearance against the object's rights records.
            PlanStepTemplate(
                phase="Clearance",
                description="Rights & permissions check for the requested use",
                kind="delegate", persona="rights_specialist",
                args={
                    "question": (
                        "Check whether this use is cleared: review the object's "
                        "rights records, flag any copyright, licensing, or donor "
                        "restrictions, and state whether the requested use can "
                        "proceed or needs further permission."
                    ),
                },
            ),
            PlanStepTemplate(
                label="use_approved", phase="Clearance",
                description="Approve the use request",
                kind="await",
                wait_for={"kind": "draft_approval", "from_step": StepRef("use")},
            ),
            PlanStepTemplate(
                phase="Fulfilment",
                description="Raise the reproduction order for the approved use",
                kind="tool_call", tool="propose_reproduction_request_draft",
                persona="rights_specialist",
                args={
                    "reproduction_type": Param("reproduction_type"),
                    "requester_name": Param("requester_name"),
                    # Threaded from the use request's approval (its applied id).
                    "use_request_id": StepRef("use_approved", "applied_entity_id"),
                },
            ),
        ),
    ),
)

_BY_ID = {t.template_id: t for t in CATALOG}

# Defaults applied when a param isn't supplied/derivable. Conservative: only for
# enum-ish fields with an unambiguous sensible default; ids/numbers are never
# defaulted.
_PARAM_DEFAULTS: dict[str, Any] = {
    "loan_purpose": "exhibition",
    "entry_reason": "gift_offer",
}

# Computed at instantiation time (lowest priority — overridden by context/args).
# e.g. a required report_date defaults to today rather than asking the model to
# invent one.
_DYNAMIC_DEFAULTS: dict[str, Callable[[], Any]] = {
    "report_date": lambda: date.today().isoformat(),
}


def get_template(template_id: str) -> PlanTemplate | None:
    return _BY_ID.get(template_id)


def list_templates(
    nav_item: str | None = None,
    *,
    context_param: str | None = None,
    no_context: bool = False,
) -> list[PlanTemplate]:
    """All catalog templates, filtered for the surface they're shown on:

    - ``nav_item``: a workspace list surface (e.g. ``acquisitions``).
    - ``context_param``: an entity-detail surface — only templates that take
      this page-context id (e.g. ``object_id`` on a collection-object page), so
      they always run with the id already in hand.
    - ``no_context``: the central surface — only templates needing NO page
      context, so they're runnable from a bare form rather than being a
      guaranteed missing-param 422.

    Filters compose; stable order."""
    out = list(CATALOG)
    if nav_item is not None:
        out = [t for t in out if t.nav_item == nav_item]
    if context_param is not None:
        out = [t for t in out if context_param in t.context_params]
    if no_context:
        out = [t for t in out if not t.context_params]
    return out


def match_template(
    goal: str,
    page_context: dict | None = None,
    provided: dict | None = None,
) -> PlanTemplate | None:
    """Trigger-phrase match a goal to a template. Returns the first template
    whose phrase appears in the goal AND whose required params can be resolved —
    from page context OR from ``provided`` (params the caller extracted from the
    request, e.g. an object number / acquisition method the user named in chat);
    otherwise None (the caller falls back to free-form planning). Considering
    ``provided`` is what lets a conversational "acquire 2026.1 by purchase" match
    the acquisition journey, not just a click from a page that already has the id.
    Deterministic and conservative by design."""
    text = (goal or "").lower()
    for template in CATALOG:
        if not any(p in text for p in template.trigger_phrases):
            continue
        params = resolve_params(template, page_context or {}, provided or {})
        if params is not None:
            return template
    return None


def resolve_params(
    template: PlanTemplate,
    page_context: dict | None,
    provided: dict | None,
) -> dict | None:
    """Build the param map (explicit args override page context override
    defaults). Returns None if any REQUIRED param can't be resolved — so a
    template never instantiates with a fabricated/missing id."""
    page_context = page_context or {}
    provided = provided or {}

    params: dict[str, Any] = dict(_PARAM_DEFAULTS)
    for key, fn in _DYNAMIC_DEFAULTS.items():
        params.setdefault(key, fn())
    for key in template.context_params:
        if page_context.get(key) is not None:
            params[key] = page_context[key]
    params.update({k: v for k, v in provided.items() if v is not None})

    for key in template.required_params:
        if params.get(key) is None:
            return None
    return params


def instantiate(template: PlanTemplate, params: dict) -> list[dict]:
    """Render the template to step dicts in PlanService._validate_steps shape.

    Resolves StepRef placeholders against step labels: a step's plan index is
    its position here. Unresolved (None) args are dropped so optional params
    don't become NULLs. Raises KeyError on a StepRef to an unknown label (an
    authoring bug, caught by the catalog tests)."""
    # Drop conditional steps whose `when` param is falsy, THEN number — so a
    # dropped step shifts no indices and label refs stay correct.
    kept = [st for st in template.steps if not st.when or params.get(st.when)]
    label_to_idx = {st.label: idx for idx, st in enumerate(kept) if st.label}

    def fill(value):
        if isinstance(value, Param):
            return params.get(value.name)
        if isinstance(value, StepRef):
            if value.label not in label_to_idx:
                raise KeyError(
                    f"{template.template_id}: StepRef to unknown label "
                    f"{value.label!r}"
                )
            idx = label_to_idx[value.label]
            if value.field is None:
                return idx  # await from_step → the referenced step's index
            return {"$from_step": idx, "field": value.field}  # runtime threading
        return value

    steps: list[dict] = []
    for st in kept:
        args = {k: fill(v) for k, v in st.args.items()}
        args = {k: v for k, v in args.items() if v is not None}
        wait_for = None
        if st.wait_for:
            wait_for = {k: fill(v) for k, v in st.wait_for.items()}
        step: dict[str, Any] = {"description": st.description, "kind": st.kind}
        if st.tool:
            step["tool"] = st.tool
        if st.persona:
            step["persona"] = st.persona
        if args:
            step["args"] = args
        if wait_for:
            step["wait_for"] = wait_for
        if st.branch:
            step["branch"] = st.branch
        if st.phase:
            step["phase"] = st.phase
        steps.append(step)
    return steps
