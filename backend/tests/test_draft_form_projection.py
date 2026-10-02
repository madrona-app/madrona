"""Projecting a draft payload into editable form-field descriptors."""

from app.services.drafts.form_projection import draft_form_schema
from app.services.drafts.references import reference_kind


def _by_name(schema):
    return {f["name"]: f for f in schema["fields"]}


def test_unknown_entity_returns_none():
    assert draft_form_schema("not_a_real_entity") is None


def test_registry_backed_entity_has_labels_enums_sections():
    schema = draft_form_schema("acquisition")
    assert schema["entity_label"] == "Acquisition"
    f = _by_name(schema)
    # Enum field with options + a human label + a real section (from the registry).
    assert f["acquisition_method"]["type"] == "enum"
    assert "purchase" in f["acquisition_method"]["enum_values"]
    assert f["acquisition_method"]["label"] == "Acquisition method"
    assert f["acquisition_method"]["section"] != "Details"
    # legal_status is editable but no longer required/defaulted (trust fix).
    assert "legal_status" in f


def test_alias_entity_resolves_to_registry():
    # conservation_treatment (draft) → "conservation" (form registry).
    schema = draft_form_schema("conservation_treatment")
    assert schema["entity_label"] == "Conservation Treatment"
    f = _by_name(schema)
    assert f["treatment_type"]["type"] == "enum"
    assert f["proposal_summary"]["type"] == "textarea"  # long-text heuristic


def test_fallback_entity_derives_from_pydantic():
    # media_rights isn't in the form registry → fields derived from the schema.
    schema = draft_form_schema("media_rights")
    f = _by_name(schema)
    # Enum is recovered from the Pydantic Literal even without a registry entry.
    assert f["rights_type"]["type"] == "enum"
    assert f["rights_type"]["enum_values"]
    # Required reflects the payload schema.
    assert f["media_id"]["required"] is True


def test_every_draft_entity_projects():
    from app.services.drafts.factory.registry import ENTITY_DRAFT_SPECS
    for spec in ENTITY_DRAFT_SPECS:
        schema = draft_form_schema(spec.entity_type)
        assert schema is not None, spec.entity_type
        assert schema["fields"], spec.entity_type
        for fld in schema["fields"]:
            assert fld["type"] in {
                "text", "textarea", "enum", "date", "number", "boolean", "json",
                "reference",
            }, (spec.entity_type, fld)


def test_reference_fields_are_tagged_with_a_kind():
    # *_id references render as pickers, not text — and carry the kind to search.
    f = _by_name(draft_form_schema("condition_report"))
    assert f["object_id"]["type"] == "reference"
    assert f["object_id"]["reference_kind"] == "object"
    assert f["examiner_id"]["reference_kind"] == "constituent"  # repointed to constituents
    g = _by_name(draft_form_schema("loan_out"))
    assert g["venue_id"]["reference_kind"] == "constituent"
    h = _by_name(draft_form_schema("movement"))
    assert h["to_location_id"]["reference_kind"] == "location"
    # Unknown *_id fields stay plain text (no wrong picker).
    if "entry_id" in g:
        assert g["entry_id"]["type"] != "reference"


def test_reference_kind_known_and_unknown():
    assert reference_kind("object_id") == "object"
    assert reference_kind("examiner_id") == "constituent"
    assert reference_kind("venue_id") == "constituent"
    assert reference_kind("to_location_id") == "location"
    assert reference_kind("entry_id") is None  # unknown → not a reference
    assert reference_kind("whatever", "constituent") == "constituent"  # registry wins


def test_tool_schema_nudges_reference_fields():
    # Phase C: the propose_*_draft tool tells the specialist to pass a real id.
    from app.services.drafts.factory.registry import ENTITY_DRAFT_SPECS
    from app.services.drafts.factory.generator import build_tool_parameters
    spec = next(s for s in ENTITY_DRAFT_SPECS if s.entity_type == "condition_report")
    props = build_tool_parameters(spec)["properties"]
    desc = props["examiner_id"]["description"].lower()
    assert "search" in desc and "id" in desc
    # A non-reference field gets no such hint.
    assert "references an existing" not in props["report_type"].get("description", "").lower()
