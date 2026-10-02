"""
Tests for agent form guidance: form registry, get_record_summary tool,
and context injection for non-object entity types.
"""

import pytest
from decimal import Decimal
from datetime import date
from unittest.mock import MagicMock, patch, PropertyMock
from uuid import uuid4, UUID

from app.services.agent_tools import AgentContext
from app.services.agent_tools.form_registry import (
    FORM_REGISTRY,
    FormDefinition,
    FieldMeta,
    StatusRequirement,
    get_entity_model_map,
)
from app.services.agent_tools.staff_tools import (
    get_record_summary,
    _resolve_entity,
    _format_field_value,
)


# ============================================================================
# FORM REGISTRY TESTS
# ============================================================================


class TestFormRegistryCompleteness:
    """Verify the registry covers all expected entity types."""

    EXPECTED_ENTITY_TYPES = {
        "object_entry",
        "acquisition",
        "loan_in",
        "loan_out",
        "condition_report",
        "conservation",
        "object_exit",
        "movement",
        "collection_object",
        "deaccession",
        "use_request",
        "valuation",
        "incident_report",
        "right",
        "reproduction_request",
    }

    def test_all_entity_types_present(self):
        """Every expected entity type has a FormDefinition."""
        missing = self.EXPECTED_ENTITY_TYPES - set(FORM_REGISTRY.keys())
        assert missing == set(), f"Missing entity types: {missing}"

    def test_no_extra_entity_types(self):
        """No unexpected entity types in the registry."""
        extra = set(FORM_REGISTRY.keys()) - self.EXPECTED_ENTITY_TYPES
        assert extra == set(), f"Unexpected entity types: {extra}"

    def test_entity_model_map_matches_registry(self):
        """Every registry entry has a corresponding model mapping."""
        model_map = get_entity_model_map()
        for entity_type in FORM_REGISTRY:
            assert entity_type in model_map, (
                f"Entity type '{entity_type}' in FORM_REGISTRY but not in model map"
            )

    def test_model_map_no_extras(self):
        """Model map doesn't reference types absent from registry."""
        model_map = get_entity_model_map()
        for entity_type in model_map:
            assert entity_type in FORM_REGISTRY, (
                f"Entity type '{entity_type}' in model map but not in FORM_REGISTRY"
            )


class TestFormDefinitionStructure:
    """Validate FormDefinition structure for every entity type."""

    @pytest.mark.parametrize("entity_type", list(FORM_REGISTRY.keys()))
    def test_has_required_attributes(self, entity_type):
        """Each FormDefinition has all required attributes populated."""
        form_def = FORM_REGISTRY[entity_type]
        assert isinstance(form_def, FormDefinition)
        assert form_def.entity_type == entity_type
        assert form_def.entity_label  # Non-empty
        assert form_def.procedure  # Non-empty
        assert isinstance(form_def.statuses, list)
        assert isinstance(form_def.status_labels, dict)
        assert isinstance(form_def.fields, list)
        assert len(form_def.fields) > 0, f"{entity_type} has no fields"

    @pytest.mark.parametrize("entity_type", list(FORM_REGISTRY.keys()))
    def test_status_labels_cover_statuses(self, entity_type):
        """Every status has a human-readable label."""
        form_def = FORM_REGISTRY[entity_type]
        for status in form_def.statuses:
            assert status in form_def.status_labels, (
                f"{entity_type}: status '{status}' missing from status_labels"
            )

    @pytest.mark.parametrize("entity_type", list(FORM_REGISTRY.keys()))
    def test_fields_have_valid_types(self, entity_type):
        """All fields have a recognized field_type."""
        valid_types = {"text", "date", "boolean", "currency", "integer", "contact", "enum", "json"}
        form_def = FORM_REGISTRY[entity_type]
        for field in form_def.fields:
            assert field.field_type in valid_types, (
                f"{entity_type}.{field.name}: unknown field_type '{field.field_type}'"
            )

    @pytest.mark.parametrize("entity_type", list(FORM_REGISTRY.keys()))
    def test_fields_have_sections(self, entity_type):
        """Every field belongs to a section."""
        form_def = FORM_REGISTRY[entity_type]
        for field in form_def.fields:
            assert field.section, f"{entity_type}.{field.name}: empty section"

    @pytest.mark.parametrize("entity_type", list(FORM_REGISTRY.keys()))
    def test_enum_fields_have_values(self, entity_type):
        """Enum fields must define their enum_values list."""
        form_def = FORM_REGISTRY[entity_type]
        for field in form_def.fields:
            if field.field_type == "enum":
                assert field.enum_values and len(field.enum_values) > 0, (
                    f"{entity_type}.{field.name}: enum field has no enum_values"
                )

    @pytest.mark.parametrize("entity_type", list(FORM_REGISTRY.keys()))
    def test_has_at_least_one_required_field(self, entity_type):
        """Each entity should have at least one required field."""
        form_def = FORM_REGISTRY[entity_type]
        required = [f for f in form_def.fields if f.required]
        assert len(required) > 0, f"{entity_type} has no required fields"


class TestEntityModelMap:
    """Validate model map entries."""

    def test_model_classes_are_importable(self):
        """All model classes in the map can be imported."""
        model_map = get_entity_model_map()
        for entity_type, (model_cls, pk_field, number_field) in model_map.items():
            assert model_cls is not None, f"{entity_type}: model class is None"
            assert pk_field, f"{entity_type}: pk_field is empty"
            # number_field can be None (e.g. Valuation, ObjectRight)

    def test_pk_fields_are_strings(self):
        """Primary key field names are non-empty strings."""
        model_map = get_entity_model_map()
        for entity_type, (_, pk_field, _) in model_map.items():
            assert isinstance(pk_field, str) and len(pk_field) > 0

    def test_known_number_fields(self):
        """Spot-check well-known number field mappings."""
        model_map = get_entity_model_map()
        assert model_map["object_entry"][2] == "entry_number"
        assert model_map["loan_in"][2] == "loan_number"
        assert model_map["collection_object"][2] == "object_number"
        assert model_map["movement"][2] == "movement_reference_number"

    def test_none_number_fields(self):
        """Valuation and ObjectRight have None number_field (no natural identifier)."""
        model_map = get_entity_model_map()
        assert model_map["valuation"][2] is None
        assert model_map["right"][2] is None


# ============================================================================
# RESOLVE ENTITY TESTS
# ============================================================================


class TestResolveEntity:
    """Test _resolve_entity helper."""

    def _make_ctx(self, entity_type=None, entity_id=None):
        return AgentContext(
            organization_id=uuid4(),
            user_id=uuid4(),
            persona="staff",
            db_session=MagicMock(),
            context_entity_type=entity_type,
            context_entity_id=entity_id,
        )

    def test_explicit_args(self):
        """Explicit entity_type and entity_id override context."""
        ctx = self._make_ctx(entity_type="loan_in", entity_id=uuid4())
        eid = uuid4()
        result = _resolve_entity({"entity_type": "object_entry", "entity_id": str(eid)}, ctx)
        assert result == ("object_entry", eid)

    def test_falls_back_to_context(self):
        """Falls back to context entity when args are empty."""
        ctx_id = uuid4()
        ctx = self._make_ctx(entity_type="loan_in", entity_id=ctx_id)
        result = _resolve_entity({}, ctx)
        assert result == ("loan_in", ctx_id)

    def test_no_context_returns_error(self):
        """Returns error when no args and no context."""
        ctx = self._make_ctx()
        result = _resolve_entity({}, ctx)
        assert isinstance(result, dict)
        assert "error" in result

    def test_invalid_uuid_returns_error(self):
        """Returns error for invalid UUID format."""
        ctx = self._make_ctx(entity_type="loan_in")
        result = _resolve_entity({"entity_id": "not-a-uuid"}, ctx)
        assert isinstance(result, dict)
        assert "error" in result


# ============================================================================
# FORMAT FIELD VALUE TESTS
# ============================================================================


class TestFormatFieldValue:
    """Test _format_field_value helper."""

    def test_none_returns_none(self):
        assert _format_field_value(None, None) is None

    def test_empty_string_returns_none(self):
        assert _format_field_value("", None) is None
        assert _format_field_value("  ", None) is None

    def test_boolean_true(self):
        assert _format_field_value(True, None) == "Yes"

    def test_boolean_false(self):
        assert _format_field_value(False, None) == "No"

    def test_string_value(self):
        assert _format_field_value("hello", None) == "hello"

    def test_empty_list_returns_none(self):
        assert _format_field_value([], None) is None

    def test_empty_dict_returns_none(self):
        assert _format_field_value({}, None) is None

    def test_nonempty_list(self):
        result = _format_field_value(["a", "b"], None)
        assert result is not None

    def test_decimal(self):
        result = _format_field_value(Decimal("1500.00"), None)
        assert result == "1500.00"

    def test_date(self):
        result = _format_field_value(date(2024, 3, 15), None)
        assert "2024" in result


# ============================================================================
# GET RECORD SUMMARY TOOL TESTS
# ============================================================================


class TestGetRecordSummary:
    """Test the get_record_summary tool handler."""

    def _make_ctx(self, entity_type=None, entity_id=None):
        return AgentContext(
            organization_id=uuid4(),
            user_id=uuid4(),
            persona="staff",
            db_session=MagicMock(),
            context_entity_type=entity_type,
            context_entity_id=entity_id,
        )

    def test_unknown_entity_type(self):
        """Returns error for unknown entity type."""
        ctx = self._make_ctx(entity_type="unknown_thing", entity_id=uuid4())
        result = get_record_summary({}, ctx)
        assert "error" in result
        assert "unknown" in result["error"].lower() or "Unknown" in result["error"]

    def test_no_entity_context(self):
        """Returns error when no entity context is available."""
        ctx = self._make_ctx()
        result = get_record_summary({}, ctx)
        assert "error" in result

    @patch("app.services.agent_tools.form_registry.get_entity_model_map")
    def test_record_not_found(self, mock_model_map):
        """Returns error when the record doesn't exist in DB."""
        entity_id = uuid4()
        ctx = self._make_ctx(entity_type="loan_in", entity_id=entity_id)

        mock_model_cls = MagicMock()
        mock_model_cls.organization_id = "org_id"
        mock_model_map.return_value = {
            "loan_in": (mock_model_cls, "loan_in_id", "loan_number"),
        }

        # Query returns None
        ctx.db_session.query.return_value.filter.return_value.first.return_value = None

        result = get_record_summary({}, ctx)
        assert "error" in result
        assert "not found" in result["error"].lower()

    @patch("app.services.agent_tools.form_registry.get_entity_model_map")
    def test_successful_summary(self, mock_model_map):
        """Returns a structured summary for a valid record."""
        entity_id = uuid4()
        org_id = uuid4()
        ctx = AgentContext(
            organization_id=org_id,
            user_id=uuid4(),
            persona="staff",
            db_session=MagicMock(),
            context_entity_type="object_entry",
            context_entity_id=entity_id,
        )

        # Create a mock entity with the fields from the object_entry registry
        mock_entity = MagicMock()
        mock_entity.entry_number = "ENT-2024-001"
        mock_entity.entry_date = date(2024, 3, 15)
        mock_entity.reason = "loan_consideration"
        mock_entity.status = "pending"
        mock_entity.depositor_id = None  # Empty required field
        mock_entity.objects_description = "A painting"
        mock_entity.objects_count = 1
        mock_entity.terms_accepted = False
        # Set all other fields to None via default MagicMock behavior

        mock_model_cls = MagicMock()
        mock_model_map.return_value = {
            "object_entry": (mock_model_cls, "entry_id", "entry_number"),
        }

        ctx.db_session.query.return_value.filter.return_value.first.return_value = mock_entity

        result = get_record_summary({}, ctx)

        assert result["entity_type"] == "object_entry"
        assert result["entity_label"] == "Object Entry"
        assert result["record_identifier"] == "ENT-2024-001"
        assert result["current_status"] == "pending"
        assert result["current_status_label"] == "Pending"
        assert "sections" in result
        assert "completion" in result
        assert result["completion"]["total"] > 0
        assert result["completion"]["filled"] > 0
        assert "percentage" in result["completion"]

    @patch("app.services.agent_tools.form_registry.get_entity_model_map")
    def test_next_status_calculated(self, mock_model_map):
        """Next status requirements are calculated from current status."""
        entity_id = uuid4()
        ctx = self._make_ctx(entity_type="loan_in", entity_id=entity_id)

        mock_entity = MagicMock()
        mock_entity.loan_number = "LOAN-2024-001"
        mock_entity.status = "requested"
        # All required fields for 'approved' are missing
        mock_entity.lender_id = None
        mock_entity.loan_purpose = None
        mock_entity.request_date = None
        mock_entity.loan_start_date = None
        mock_entity.loan_end_date = None
        mock_entity.insurance_value = None

        mock_model_cls = MagicMock()
        mock_model_map.return_value = {
            "loan_in": (mock_model_cls, "loan_in_id", "loan_number"),
        }
        ctx.db_session.query.return_value.filter.return_value.first.return_value = mock_entity

        result = get_record_summary({}, ctx)

        # Next status after "requested" is "pending_approval"
        assert "next_status" in result
        assert result["next_status"]["target"] == "pending_approval"

    @patch("app.services.agent_tools.staff_tools._resolve_contact_name")
    @patch("app.services.agent_tools.form_registry.get_entity_model_map")
    def test_contact_fk_resolved(self, mock_model_map, mock_resolve_contact):
        """Contact FK fields are resolved to display names."""
        entity_id = uuid4()
        contact_id = uuid4()
        ctx = self._make_ctx(entity_type="loan_in", entity_id=entity_id)

        mock_entity = MagicMock()
        mock_entity.loan_number = "LOAN-2024-001"
        mock_entity.status = "requested"
        mock_entity.lender_id = contact_id

        mock_model_cls = MagicMock()
        mock_model_map.return_value = {
            "loan_in": (mock_model_cls, "loan_in_id", "loan_number"),
        }
        ctx.db_session.query.return_value.filter.return_value.first.return_value = mock_entity
        mock_resolve_contact.return_value = "British Museum"

        result = get_record_summary({}, ctx)

        # Find the lender field in sections
        lender_field = None
        for section in result["sections"]:
            for field in section["fields"]:
                if field["name"] == "lender_id":
                    lender_field = field
                    break
        assert lender_field is not None
        assert lender_field["value"] == "British Museum"
        assert lender_field["filled"] is True

    @patch("app.services.agent_tools.form_registry.get_entity_model_map")
    def test_explicit_entity_type_overrides_context(self, mock_model_map):
        """Explicit entity_type arg overrides context."""
        entity_id = uuid4()
        # Context says loan_in, but args say object_entry
        ctx = self._make_ctx(entity_type="loan_in", entity_id=entity_id)

        mock_entity = MagicMock()
        mock_entity.entry_number = "ENT-001"
        mock_entity.status = "pending"

        mock_model_cls = MagicMock()
        mock_model_map.return_value = {
            "object_entry": (mock_model_cls, "entry_id", "entry_number"),
        }
        ctx.db_session.query.return_value.filter.return_value.first.return_value = mock_entity

        result = get_record_summary(
            {"entity_type": "object_entry", "entity_id": str(entity_id)}, ctx
        )
        assert result["entity_type"] == "object_entry"

    @patch("app.services.agent_tools.form_registry.get_entity_model_map")
    def test_completion_percentage(self, mock_model_map):
        """Completion percentage is calculated correctly."""
        entity_id = uuid4()
        ctx = self._make_ctx(entity_type="object_entry", entity_id=entity_id)

        mock_entity = MagicMock()
        mock_entity.entry_number = "ENT-001"
        mock_entity.entry_date = date(2024, 1, 1)
        mock_entity.reason = "identification"
        mock_entity.status = "pending"
        # Leave most fields as MagicMock (truthy) so they count as filled

        mock_model_cls = MagicMock()
        mock_model_map.return_value = {
            "object_entry": (mock_model_cls, "entry_id", "entry_number"),
        }
        ctx.db_session.query.return_value.filter.return_value.first.return_value = mock_entity

        result = get_record_summary({}, ctx)
        assert result["completion"]["percentage"] >= 0
        assert result["completion"]["percentage"] <= 100


# ============================================================================
# TOOL REGISTRATION TESTS
# ============================================================================


class TestGetRecordSummaryRegistration:
    """Verify get_record_summary is properly registered."""

    def test_registered_as_staff_tool(self):
        """get_record_summary is registered and available for staff persona."""
        from app.services.agent_tools import get_tool_registry

        registry = get_tool_registry()
        staff_tools = registry.get_tools_for_persona("staff")
        tool_names = {t["function"]["name"] for t in staff_tools}
        assert "get_record_summary" in tool_names

    def test_not_available_for_visitor(self):
        """get_record_summary is not available for visitor persona."""
        from app.services.agent_tools import get_tool_registry

        registry = get_tool_registry()
        visitor_tools = registry.get_tools_for_persona("visitor")
        tool_names = {t["function"]["name"] for t in visitor_tools}
        assert "get_record_summary" not in tool_names

    def test_schema_has_optional_params(self):
        """Tool schema defines entity_type and entity_id as optional."""
        from app.services.agent_tools import get_tool_registry

        registry = get_tool_registry()
        tool = registry._tools.get("get_record_summary")
        assert tool is not None
        params = tool.parameters
        assert "entity_type" in params["properties"]
        assert "entity_id" in params["properties"]
        # Both should be optional (not in 'required')
        assert "required" not in params or "entity_type" not in params.get("required", [])


# ============================================================================
# SYSTEM PROMPT TESTS
# ============================================================================


class TestSystemPromptUpdate:
    """Verify system prompt includes data-entry guidance."""

    def test_staff_prompt_mentions_get_record_summary(self):
        from app.services.agent_tools.system_prompts import STAFF_SYSTEM_PROMPT

        assert "get_record_summary" in STAFF_SYSTEM_PROMPT

    def test_staff_prompt_has_data_entry_section(self):
        from app.services.agent_tools.system_prompts import STAFF_SYSTEM_PROMPT

        assert "When helping with data entry:" in STAFF_SYSTEM_PROMPT

    def test_staff_prompt_never_enter_data(self):
        """Prompt tells the agent not to fill data for the user."""
        from app.services.agent_tools.system_prompts import STAFF_SYSTEM_PROMPT

        assert "Never enter data for the user" in STAFF_SYSTEM_PROMPT

    def test_visitor_prompt_unchanged(self):
        """Visitor prompt should not mention get_record_summary."""
        from app.services.agent_tools.system_prompts import VISITOR_SYSTEM_PROMPT

        assert "get_record_summary" not in VISITOR_SYSTEM_PROMPT
