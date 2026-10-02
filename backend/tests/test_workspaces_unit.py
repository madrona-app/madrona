"""
Unit tests for Workspaces functionality.

These tests do not require a database and test pure configuration
and business logic for workspace bulk actions.
"""

import pytest


class TestSupportedBulkActions:
    """Test bulk action configuration."""

    def test_supported_actions_structure(self, app):
        """Verify SUPPORTED_BULK_ACTIONS has correct structure for key actions."""
        if True:  # Flask app_context is a no-op under FastAPI
            from app.fastapi_app.routers.workspaces import SUPPORTED_BULK_ACTIONS

            expected_actions = [
                "record_movement",
                "create_condition_report",
                "report_incident",
            ]

            for action_key in expected_actions:
                assert action_key in SUPPORTED_BULK_ACTIONS, (
                    f"Missing expected action: {action_key}"
                )
                action = SUPPORTED_BULK_ACTIONS[action_key]
                assert "label" in action
                assert "description" in action
                assert "permission" in action
                assert "required_params" in action
                assert isinstance(action["required_params"], list)
                assert "optional_params" in action

    def test_record_movement_config(self, app):
        """Test record_movement action configuration."""
        if True:  # Flask app_context is a no-op under FastAPI
            from app.fastapi_app.routers.workspaces import SUPPORTED_BULK_ACTIONS
            from app.permissions import Permission

            action = SUPPORTED_BULK_ACTIONS["record_movement"]
            assert action["permission"] == Permission.MOVEMENTS_CREATE
            assert "to_location_id" in action["required_params"]
            assert "reason" in action["required_params"]

    def test_create_condition_report_config(self, app):
        """Test create_condition_report action configuration."""
        if True:  # Flask app_context is a no-op under FastAPI
            from app.fastapi_app.routers.workspaces import SUPPORTED_BULK_ACTIONS
            from app.permissions import Permission

            action = SUPPORTED_BULK_ACTIONS["create_condition_report"]
            assert action["permission"] == Permission.CONDITION_REPORTS_CREATE
            assert "report_type" in action["required_params"]

    def test_report_incident_config(self, app):
        """Test report_incident action configuration."""
        if True:  # Flask app_context is a no-op under FastAPI
            from app.fastapi_app.routers.workspaces import SUPPORTED_BULK_ACTIONS
            from app.permissions import Permission

            action = SUPPORTED_BULK_ACTIONS["report_incident"]
            assert action["permission"] == Permission.INCIDENTS_CREATE
            assert "incident_type" in action["required_params"]
            assert "incident_description" in action["required_params"]

    def test_all_actions_have_categories(self, app):
        """Every bulk action should have a category for UI grouping."""
        if True:  # Flask app_context is a no-op under FastAPI
            from app.fastapi_app.routers.workspaces import SUPPORTED_BULK_ACTIONS

            for action_key, action_config in SUPPORTED_BULK_ACTIONS.items():
                assert "category" in action_config, (
                    f"Action '{action_key}' missing 'category' field"
                )

    def test_all_action_permissions_are_valid(self, app):
        """Every bulk action permission should be a valid Permission enum value."""
        if True:  # Flask app_context is a no-op under FastAPI
            from app.fastapi_app.routers.workspaces import SUPPORTED_BULK_ACTIONS
            from app.permissions import Permission

            for action_key, action_config in SUPPORTED_BULK_ACTIONS.items():
                perm = action_config["permission"]
                assert isinstance(perm, Permission), (
                    f"Action '{action_key}' permission is not a Permission enum: {perm}"
                )
