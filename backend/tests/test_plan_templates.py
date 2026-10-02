"""§1E plan-template catalog: matching, param resolution, instantiation.

Pure (no DB) — the catalog produces step dicts in PlanService._validate_steps
shape, which the integration tests then run through the real executor.
"""

import pytest

from app.services.agent_plan_service import _validate_steps
from app.services.agent_tools.plan_templates.catalog import (
    CATALOG,
    get_template,
    instantiate,
    match_template,
    resolve_params,
)
from app.services.drafts.factory.registry import build_payload_schemas

# Representative params (must satisfy each template's required_params with valid
# enum/format values). Adding a template REQUIRES adding its sample here, or
# test_template_args_validate_against_payload_schema fails loudly — that is the
# point: it forces every cataloged template to be exercised against the real,
# extra='forbid' payload schemas, not just the structural validator.
_SAMPLE_PARAMS: dict[str, dict] = {
    "loan_in_reception": {
        "object_id": "00000000-0000-0000-0000-000000000001",
        "lender_name": "Tate",
        "loan_purpose": "exhibition",
    },
    "acquisition_accession": {
        "acquisition_method": "gift",
        "source_name": "Jane Donor",
        "object_number": "2026.1",
    },
    # requires_consent=True so the conditional consent step is also exercised.
    "media_publish_clearance": {
        "media_id": "00000000-0000-0000-0000-000000000002",
        "requires_consent": True,
        "subject_name": "Jane Subject",
        "rights_statement": "https://rightsstatements.org/vocab/InC/1.0/",
    },
    "loan_out_dispatch": {
        "object_id": "00000000-0000-0000-0000-000000000003",
        "loan_purpose": "exhibition",
        "borrower_name": "Tate",
        "exit_method": "fine-art shipper",
    },
    "deaccession_disposal": {
        "object_id": "00000000-0000-0000-0000-000000000004",
        "reason": "duplicate",
        "reason_detail": "Second impression of the same print.",
    },
    "conservation_treatment": {
        "object_id": "00000000-0000-0000-0000-000000000005",
        "treatment_type": "cleaning",
        "proposal_summary": "Surface clean and re-house.",
    },
    "use_reproduction": {
        "use_type": "reproduction",
        "requester_name": "A. Scholar",
        "use_purpose": "Catalog illustration",
        "reproduction_type": "scan",
    },
}

# A valid value to stand in for a {"$from_step": ...} threading placeholder when
# validating a step's args against its payload schema — the real id is resolved
# at runtime from a prior step, so the literal placeholder dict is replaced with
# a representative value of the right type (entity ids are UUIDs).
_PLACEHOLDER_SUBSTITUTE = "00000000-0000-0000-0000-0000000000aa"


def _strip_step_refs(args: dict) -> dict:
    """Replace runtime {"$from_step": ...} threading placeholders with a sample
    value so the rest of the (literal) args can be schema-validated."""
    out = {}
    for k, v in args.items():
        out[k] = _PLACEHOLDER_SUBSTITUTE if isinstance(v, dict) and "$from_step" in v else v
    return out


def test_trigger_phrase_match_requires_resolvable_params():
    # Loan-In needs object_id — matches only when it's in context.
    assert match_template("help me receive an incoming loan", {}) is None
    t = match_template("help me receive an incoming loan", {"object_id": "abc"})
    assert t is not None and t.template_id == "loan_in_reception"


def test_no_match_returns_none():
    assert match_template("what's the weather", {"object_id": "abc"}) is None


def test_match_template_honours_caller_provided_params():
    # acquisition needs object_number — absent from page context, a bare chat
    # goal can't match (this is why the conversational journey never fired)...
    assert match_template("please start a new acquisition", {}) is None
    # ...but when the caller passes params it extracted from the request, the
    # journey matches — the conversational trigger.
    t = match_template(
        "please start a new acquisition",
        {},
        {"acquisition_method": "purchase", "object_number": "2026.Test.2"},
    )
    assert t is not None and t.template_id == "acquisition_accession"


def test_resolve_params_none_when_required_missing():
    tmpl = get_template("acquisition_accession")
    # acquisition_method AND object_number are required (object_number can't be
    # fabricated), neither has a default / context source.
    assert resolve_params(tmpl, {}, {}) is None
    assert resolve_params(tmpl, {}, {"acquisition_method": "gift"}) is None
    assert resolve_params(
        tmpl, {}, {"acquisition_method": "gift", "object_number": "2026.1"}
    ) is not None


def test_instantiate_fills_params_and_drops_unset():
    tmpl = get_template("loan_in_reception")
    params = resolve_params(tmpl, {"object_id": "obj-1"}, {"lender_name": "Tate"})
    steps = instantiate(tmpl, params)
    # propose → draft_approval await (signed agreement) → arrival condition report.
    assert [s["kind"] for s in steps] == ["tool_call", "await", "tool_call"]
    assert [s.get("tool") for s in steps if s["kind"] == "tool_call"] == [
        "propose_loan_in_draft", "propose_condition_report_draft",
    ]
    # The await parks on the loan draft (the prior step, idx 0).
    assert steps[1]["wait_for"] == {"kind": "draft_approval", "from_step": 0}
    # Persona-scoped tool_call steps.
    assert steps[0]["persona"] == "loans_registrar"
    assert steps[2]["persona"] == "conservator"
    # Params filled; a date default was supplied; literal report_type kept.
    assert steps[0]["args"]["lender_name"] == "Tate"
    assert steps[2]["args"]["object_id"] == "obj-1"  # existing object, no threading
    assert steps[2]["args"]["report_type"] == "loan_in"
    assert steps[2]["args"]["report_date"]  # dynamic default (today)


def test_acquisition_chain_threads_object_id():
    """The accession chain awaits the catalog record's approval, then threads
    its applied_entity_id into the intake condition report."""
    tmpl = get_template("acquisition_accession")
    params = resolve_params(
        tmpl, {}, {"acquisition_method": "gift", "object_number": "2026.5"}
    )
    steps = instantiate(tmpl, params)
    # A curator delegate (provenance/significance review) sits between the
    # proposal draft and the board sign-off.
    assert [s["kind"] for s in steps] == [
        "tool_call", "delegate", "await", "tool_call", "tool_call", "await", "tool_call",
    ]
    assert steps[1]["persona"] == "curator"
    # Acquisition sign-off awaits the acquisition draft (idx 0); catalog
    # sign-off awaits the collection_object draft (idx 4).
    assert steps[2]["wait_for"] == {"kind": "draft_approval", "from_step": 0}
    assert steps[5]["wait_for"] == {"kind": "draft_approval", "from_step": 4}
    # The condition report's object_id is threaded from the catalog-approval
    # await (idx 5), which carries applied_entity_id in on resume.
    assert steps[6]["args"]["object_id"] == {
        "$from_step": 5, "field": "applied_entity_id",
    }


def test_branching_template_instantiates_to_valid_steps():
    """A template can author a decision + branch-tagged steps; instantiate emits
    them and the executor's validator accepts the result."""
    from app.services.agent_tools.plan_templates.catalog import (
        Param, PlanStepTemplate, PlanTemplate,
    )

    tmpl = PlanTemplate(
        template_id="_test_intake_triage",
        title="Intake triage",
        goal="Log an arrival and decide keep or return",
        trigger_phrases=("log an arrival",),
        required_params=(),
        steps=(
            PlanStepTemplate(
                description="Keep or return?", kind="decision",
                args={"options": [{"key": "keep", "label": "Keep"},
                                  {"key": "return", "label": "Return"}]},
            ),
            PlanStepTemplate(
                description="Catalog", kind="tool_call", branch="keep",
                tool="propose_collection_object_draft", persona="registrar",
                args={"object_number": Param("object_number")},
            ),
            PlanStepTemplate(
                description="Object exit", kind="tool_call", branch="return",
                tool="propose_object_exit_draft", persona="registrar",
                args={"exit_reason": "enquiry_return"},
            ),
        ),
    )
    steps = instantiate(tmpl, {"object_number": "2026.7"})
    assert [s["kind"] for s in steps] == ["decision", "tool_call", "tool_call"]
    assert steps[1]["branch"] == "keep" and steps[2]["branch"] == "return"
    assert steps[0]["args"]["options"][0]["key"] == "keep"
    _, err = _validate_steps(steps)
    assert err is None, err


def test_every_template_instantiates_to_valid_steps():
    """The structural guarantee: every cataloged template, given its required
    params, renders to steps that pass the executor's validator."""
    for tmpl in CATALOG:
        params = resolve_params(tmpl, {}, _SAMPLE_PARAMS[tmpl.template_id])
        assert params is not None, tmpl.template_id
        steps, err = _validate_steps(instantiate(tmpl, params))
        assert err is None, f"{tmpl.template_id}: {err}"
        assert len(steps) == len(tmpl.steps)


@pytest.mark.parametrize("tmpl", CATALOG, ids=lambda t: t.template_id)
def test_template_args_validate_against_payload_schema(tmpl):
    """Semantic guarantee the structural validator can't give: every
    tool_call step's args must validate against that entity's real
    (extra='forbid') draft payload schema — so a wrong field name, a stale
    enum value, or a missing required field is caught here, not at runtime
    when the plan actually proposes the draft."""
    schemas = build_payload_schemas()
    sample = _SAMPLE_PARAMS.get(tmpl.template_id)
    assert sample is not None, (
        f"{tmpl.template_id}: add an entry to _SAMPLE_PARAMS so its steps are "
        f"validated against the payload schemas"
    )
    params = resolve_params(tmpl, {}, sample)
    assert params is not None, tmpl.template_id
    for step in instantiate(tmpl, params):
        if step["kind"] != "tool_call":
            continue
        entity = step["tool"].replace("propose_", "").replace("_draft", "")
        model = schemas.get(entity)
        assert model is not None, f"{tmpl.template_id}: no schema for {entity!r}"
        # Raises ValidationError (failing the test) on any arg drift. Runtime
        # threading placeholders are swapped for a representative value first.
        model.model_validate(_strip_step_refs(step.get("args", {})))
