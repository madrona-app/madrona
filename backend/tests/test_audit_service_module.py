"""Unit tests for app/services/audit.py — log_audit_event, audit_log decorator,
and the audit_create/update/delete convenience wrappers.

This module is pure-function: it builds a structured log payload and emits it
through the project logger. We patch the logger to capture payloads instead of
matching against log output.
"""

from unittest.mock import patch

import pytest

from app import context as ctx
from app.services.audit import (
    _redact_sensitive_fields,
    audit_create,
    audit_delete,
    audit_log,
    audit_update,
    log_audit_event,
)


@pytest.fixture
def mock_logger():
    with patch("app.services.audit.logger") as mock:
        yield mock


@pytest.fixture(autouse=True)
def _reset_context():
    """Each test gets fresh ContextVar defaults."""
    tokens = [
        ctx.request_user_id.set(None),
        ctx.request_remote_addr.set(None),
        ctx.request_user_agent.set(None),
        ctx.current_org_id.set(None),
    ]
    yield
    for var, token in zip(
        [ctx.request_user_id, ctx.request_remote_addr, ctx.request_user_agent, ctx.current_org_id],
        tokens,
    ):
        var.reset(token)


class TestLogAuditEvent:
    def test_minimal_event_emits_action_and_resource(self, mock_logger):
        log_audit_event(action="create", resource_type="object")
        mock_logger.info.assert_called_once()
        name, kwargs = mock_logger.info.call_args
        assert name[0] == "audit_event"
        assert kwargs["action"] == "create"
        assert kwargs["resource_type"] == "object"
        assert kwargs["success"] is True
        assert "timestamp" in kwargs

    def test_resource_id_is_stringified(self, mock_logger):
        log_audit_event(action="delete", resource_type="object", resource_id=12345)
        kwargs = mock_logger.info.call_args.kwargs
        assert kwargs["resource_id"] == "12345"

    def test_omits_resource_id_when_none(self, mock_logger):
        log_audit_event(action="read", resource_type="object", resource_id=None)
        kwargs = mock_logger.info.call_args.kwargs
        assert "resource_id" not in kwargs

    def test_includes_details(self, mock_logger):
        log_audit_event(
            action="update",
            resource_type="object",
            details={"field": "title", "old": "a", "new": "b"},
        )
        kwargs = mock_logger.info.call_args.kwargs
        assert kwargs["details"] == {"field": "title", "old": "a", "new": "b"}

    def test_omits_details_when_none(self, mock_logger):
        log_audit_event(action="read", resource_type="object", details=None)
        kwargs = mock_logger.info.call_args.kwargs
        assert "details" not in kwargs

    def test_failure_event_records_error_message(self, mock_logger):
        log_audit_event(
            action="delete",
            resource_type="object",
            success=False,
            error_message="permission denied",
        )
        kwargs = mock_logger.info.call_args.kwargs
        assert kwargs["success"] is False
        assert kwargs["error_message"] == "permission denied"

    def test_includes_remote_addr_and_user_agent_when_set(self, mock_logger):
        ctx.request_remote_addr.set("10.0.0.1")
        ctx.request_user_agent.set("MyAgent/1.0")
        log_audit_event(action="read", resource_type="object")
        kwargs = mock_logger.info.call_args.kwargs
        assert kwargs["ip_address"] == "10.0.0.1"
        assert kwargs["user_agent"] == "MyAgent/1.0"

    def test_user_agent_truncated_to_200_chars(self, mock_logger):
        ctx.request_remote_addr.set("10.0.0.1")
        ctx.request_user_agent.set("X" * 500)
        log_audit_event(action="read", resource_type="object")
        kwargs = mock_logger.info.call_args.kwargs
        assert kwargs["user_agent"] == "X" * 200

    def test_user_agent_falls_back_to_unknown_when_missing(self, mock_logger):
        ctx.request_remote_addr.set("10.0.0.1")
        # user_agent not set
        log_audit_event(action="read", resource_type="object")
        kwargs = mock_logger.info.call_args.kwargs
        assert kwargs["user_agent"] == "unknown"

    def test_includes_user_id_and_org_id_when_set(self, mock_logger):
        ctx.request_user_id.set("u-1")
        ctx.current_org_id.set("o-1")
        log_audit_event(action="read", resource_type="object")
        kwargs = mock_logger.info.call_args.kwargs
        assert kwargs["user_id"] == "u-1"
        assert kwargs["org_id"] == "o-1"

    def test_omits_user_and_org_when_unset(self, mock_logger):
        log_audit_event(action="read", resource_type="object")
        kwargs = mock_logger.info.call_args.kwargs
        assert "user_id" not in kwargs
        assert "org_id" not in kwargs


class TestAuditLogDecorator:
    def test_logs_success_with_resource_id_from_kwargs(self, mock_logger):
        @audit_log(action="delete", resource_type="object", resource_id_param="object_id")
        def delete_object(object_id: str) -> dict:
            return {"deleted": True}

        result = delete_object(object_id="obj-1")
        assert result == {"deleted": True}
        kwargs = mock_logger.info.call_args.kwargs
        assert kwargs["action"] == "delete"
        assert kwargs["resource_type"] == "object"
        assert kwargs["resource_id"] == "obj-1"
        assert kwargs["success"] is True

    def test_extracts_resource_id_from_result(self, mock_logger):
        @audit_log(
            action="create",
            resource_type="object",
            resource_id_from_result=lambda r: r["id"],
        )
        def create_object() -> dict:
            return {"id": "new-1"}

        create_object()
        kwargs = mock_logger.info.call_args.kwargs
        assert kwargs["resource_id"] == "new-1"

    def test_resource_id_from_result_extractor_failure_swallowed(self, mock_logger):
        @audit_log(
            action="create",
            resource_type="object",
            resource_id_from_result=lambda r: r["nonexistent"],
        )
        def create_object() -> dict:
            return {"id": "x"}

        create_object()  # should not raise
        kwargs = mock_logger.info.call_args.kwargs
        assert "resource_id" not in kwargs or kwargs["resource_id"] is None or kwargs["resource_id"] == "None"

    def test_logs_failure_and_reraises(self, mock_logger):
        @audit_log(action="delete", resource_type="object")
        def boom():
            raise ValueError("nope")

        with pytest.raises(ValueError, match="nope"):
            boom()
        kwargs = mock_logger.info.call_args.kwargs
        assert kwargs["success"] is False
        assert kwargs["error_message"] == "nope"

    def test_preserves_function_name_via_wraps(self, mock_logger):
        @audit_log(action="x", resource_type="y")
        def my_func():
            return 1

        assert my_func.__name__ == "my_func"


class TestConvenienceDecorators:
    def test_audit_create_logs_create_action(self, mock_logger):
        @audit_create("widget", resource_id_from_result=lambda r: r["id"])
        def make():
            return {"id": "w-1"}

        make()
        kwargs = mock_logger.info.call_args.kwargs
        assert kwargs["action"] == "create"
        assert kwargs["resource_type"] == "widget"
        assert kwargs["resource_id"] == "w-1"

    def test_audit_update_uses_id_param(self, mock_logger):
        @audit_update("widget", resource_id_param="widget_id")
        def update(widget_id: str):
            return {}

        update(widget_id="w-7")
        kwargs = mock_logger.info.call_args.kwargs
        assert kwargs["action"] == "update"
        assert kwargs["resource_id"] == "w-7"

    def test_audit_delete_uses_default_id_param(self, mock_logger):
        @audit_delete("widget")
        def delete(id: str):
            return {}

        delete(id="w-9")
        kwargs = mock_logger.info.call_args.kwargs
        assert kwargs["action"] == "delete"
        assert kwargs["resource_id"] == "w-9"


class TestRedactSensitiveFields:
    def test_redacts_top_level_password(self):
        result = _redact_sensitive_fields({"password": "hunter2", "name": "Alice"})
        assert result == {"password": "[REDACTED]", "name": "Alice"}

    def test_redacts_case_insensitively(self):
        result = _redact_sensitive_fields({"PASSWORD": "x", "Api_Key": "y"})
        assert result["PASSWORD"] == "[REDACTED]"
        assert result["Api_Key"] == "[REDACTED]"

    def test_redacts_substring_matches(self):
        result = _redact_sensitive_fields(
            {"access_token": "x", "user_credentials": "y", "private_key_pem": "z"},
        )
        assert result["access_token"] == "[REDACTED]"
        assert result["user_credentials"] == "[REDACTED]"
        assert result["private_key_pem"] == "[REDACTED]"

    def test_preserves_non_sensitive_fields(self):
        result = _redact_sensitive_fields(
            {"name": "Alice", "email": "a@b.com", "age": 30},
        )
        assert result == {"name": "Alice", "email": "a@b.com", "age": 30}

    def test_redacts_nested_dict(self):
        result = _redact_sensitive_fields(
            {"user": {"name": "Alice", "password": "x"}, "ip": "10.0.0.1"},
        )
        assert result["user"]["password"] == "[REDACTED]"
        assert result["user"]["name"] == "Alice"
        assert result["ip"] == "10.0.0.1"

    def test_redacts_dicts_inside_lists(self):
        result = _redact_sensitive_fields(
            {"users": [{"name": "Alice", "secret": "s1"}, {"name": "Bob", "secret": "s2"}]},
        )
        assert result["users"][0]["secret"] == "[REDACTED]"
        assert result["users"][1]["secret"] == "[REDACTED]"
        assert result["users"][0]["name"] == "Alice"

    def test_leaves_non_dict_list_items_alone(self):
        result = _redact_sensitive_fields({"tags": ["a", "b", "c"]})
        assert result == {"tags": ["a", "b", "c"]}

    def test_handles_empty_dict(self):
        assert _redact_sensitive_fields({}) == {}

    def test_credit_card_redacted(self):
        result = _redact_sensitive_fields({"credit_card": "4111-1111-1111-1111"})
        assert result["credit_card"] == "[REDACTED]"

    def test_ssn_redacted(self):
        result = _redact_sensitive_fields({"ssn": "123-45-6789"})
        assert result["ssn"] == "[REDACTED]"
