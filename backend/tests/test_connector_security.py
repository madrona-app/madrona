"""
Tests for Prompt 7 security policy: No Python-in-DB for connectors.

Verifies that:
1. Connector loader rejects inline code in implementation_key
2. ConnectorDefinition model validates implementation_key format
3. Database insert/update triggers validation

Run with: pytest tests/test_connector_security.py -v
"""

import pytest

from app.connectors.loader import load_connector_class, ConnectorLoadError
from app.models import ConnectorDefinition


class TestConnectorLoaderSecurityGuardrails:
    """Test that connector loader rejects inline code patterns."""

    def test_reject_inline_code_with_newline(self):
        """Reject implementation_key containing newlines (multi-line code)."""
        inline_code = "class Foo:\n    pass"
        
        with pytest.raises(ConnectorLoadError, match="contains ''"):
            load_connector_class(inline_code)

    def test_reject_inline_code_with_def(self):
        """Reject implementation_key containing 'def ' (function definition)."""
        inline_code = "def extract(): pass"
        
        with pytest.raises(ConnectorLoadError, match="contains 'def'"):
            load_connector_class(inline_code)

    def test_reject_inline_code_with_class(self):
        """Reject implementation_key containing 'class ' (class definition)."""
        inline_code = "class MyConnector: pass"
        
        with pytest.raises(ConnectorLoadError, match="contains 'class'"):
            load_connector_class(inline_code)

    def test_reject_inline_code_with_import(self):
        """Reject implementation_key containing 'import ' statement."""
        inline_code = "import sys; sys.exit()"
        
        with pytest.raises(ConnectorLoadError, match="contains 'import'"):
            load_connector_class(inline_code)

    def test_reject_inline_code_with_exec(self):
        """Reject implementation_key containing 'exec(' call."""
        inline_code = "exec('print(1)')"
        
        with pytest.raises(ConnectorLoadError, match="contains 'exec\\('"):
            load_connector_class(inline_code)

    def test_reject_inline_code_with_eval(self):
        """Reject implementation_key containing 'eval(' call."""
        inline_code = "eval('1+1')"
        
        with pytest.raises(ConnectorLoadError, match="contains 'eval\\('"):
            load_connector_class(inline_code)

    def test_reject_inline_code_with_lambda(self):
        """Reject implementation_key containing 'lambda ' expression."""
        inline_code = "lambda x: x + 1"
        
        with pytest.raises(ConnectorLoadError, match="contains 'lambda'"):
            load_connector_class(inline_code)

    def test_accept_valid_import_path(self):
        """Accept valid module:class format."""
        # This will fail with ModuleNotFoundError or AttributeError, not security error
        with pytest.raises(ConnectorLoadError, match="(Module not found|Failed to import)"):
            load_connector_class("app.connectors.nonexistent:FakeConnector")

    def test_accept_valid_stub_connector(self):
        """Accept and load valid stub connector."""
        connector_class = load_connector_class("app.connectors.stub:StubSourceConnector")
        assert connector_class.__name__ == "StubSourceConnector"


class TestConnectorDefinitionModelValidation:
    """Test that ConnectorDefinition model validates implementation_key."""

    def test_validate_implementation_key_success(self):
        """Valid implementation_key passes validation."""
        definition = ConnectorDefinition(
            key="test",
            display_name="Test",
            direction="source",
            implementation_key="app.connectors.stub:StubSourceConnector",
            capabilities={},
            config_schema={"type": "object"},
        )
        
        # Should not raise
        definition.validate_implementation_key()

    def test_validate_implementation_key_rejects_empty(self):
        """Empty implementation_key is rejected."""
        definition = ConnectorDefinition(
            key="test",
            display_name="Test",
            direction="source",
            implementation_key="",
            capabilities={},
            config_schema={"type": "object"},
        )
        
        with pytest.raises(ValueError, match="cannot be empty"):
            definition.validate_implementation_key()

    def test_validate_implementation_key_rejects_no_colon(self):
        """implementation_key without colon is rejected."""
        definition = ConnectorDefinition(
            key="test",
            display_name="Test",
            direction="source",
            implementation_key="app.connectors.stub",
            capabilities={},
            config_schema={"type": "object"},
        )
        
        with pytest.raises(ValueError, match="exactly one colon"):
            definition.validate_implementation_key()

    def test_validate_implementation_key_rejects_multiple_colons(self):
        """implementation_key with multiple colons is rejected."""
        definition = ConnectorDefinition(
            key="test",
            display_name="Test",
            direction="source",
            implementation_key="app:connectors:stub:StubSourceConnector",
            capabilities={},
            config_schema={"type": "object"},
        )
        
        with pytest.raises(ValueError, match="exactly one colon"):
            definition.validate_implementation_key()

    def test_validate_implementation_key_rejects_inline_code(self):
        """implementation_key with inline code is rejected."""
        definition = ConnectorDefinition(
            key="test",
            display_name="Test",
            direction="source",
            implementation_key="class MyConnector: pass",
            capabilities={},
            config_schema={"type": "object"},
        )
        
        with pytest.raises(ValueError, match="contains 'class'"):
            definition.validate_implementation_key()

    def test_validate_implementation_key_rejects_exec(self):
        """implementation_key with exec is rejected."""
        definition = ConnectorDefinition(
            key="test",
            display_name="Test",
            direction="source",
            implementation_key="exec('print(1)'):Connector",
            capabilities={},
            config_schema={"type": "object"},
        )
        
        with pytest.raises(ValueError, match="contains 'exec\\('"):
            definition.validate_implementation_key()


@pytest.mark.postgres
class TestConnectorDefinitionDatabaseValidation:
    """Test that database insert/update triggers validation (requires PostgreSQL)."""

    def test_database_insert_rejects_invalid_implementation_key(self, db_session):
        """Database insert should fail for invalid implementation_key."""
        definition = ConnectorDefinition(
            key="test-invalid",
            display_name="Test Invalid",
            direction="source",
            implementation_key="class Malicious: pass",
            capabilities={},
            config_schema={"type": "object"},
        )
        
        db_session.add(definition)
        
        with pytest.raises(ValueError, match="contains 'class'"):
            db_session.commit()

    def test_database_insert_accepts_valid_implementation_key(self, db_session):
        """Database insert should succeed for valid implementation_key."""
        definition = ConnectorDefinition(
            key="test-valid",
            display_name="Test Valid",
            direction="source",
            implementation_key="app.connectors.stub:StubSourceConnector",
            capabilities={},
            config_schema={"type": "object"},
        )
        
        db_session.add(definition)
        db_session.commit()  # Should not raise
        
        assert definition.connector_definition_id is not None

    def test_database_update_rejects_invalid_implementation_key(self, db_session):
        """Database update should fail when changing to invalid implementation_key."""
        # Create valid definition
        definition = ConnectorDefinition(
            key="test-update",
            display_name="Test Update",
            direction="source",
            implementation_key="app.connectors.stub:StubSourceConnector",
            capabilities={},
            config_schema={"type": "object"},
        )
        
        db_session.add(definition)
        db_session.commit()
        
        # Try to update to invalid value
        definition.implementation_key = "exec('bad code'):Connector"
        
        with pytest.raises(ValueError, match="contains 'exec\\('"):
            db_session.commit()
