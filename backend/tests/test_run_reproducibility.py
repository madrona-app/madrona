"""
Tests for run reproducibility metadata.

Verifies that run records include version and implementation metadata
for code reproducibility tracking.
"""

import pytest
from unittest.mock import patch
from uuid import UUID

from app.utils.version import get_app_version, get_git_sha, get_version_info
from app.models import Run, Pipeline, ConnectorInstance, ConnectorDefinition, Organization
from app import __version__


class TestVersionUtils:
    """Tests for version utility functions."""

    def test_get_app_version(self):
        """get_app_version returns the app __version__ string."""
        version = get_app_version()
        assert version == __version__
        assert isinstance(version, str)
        assert len(version) > 0

    def test_get_git_sha_with_git(self):
        """get_git_sha returns a 7-character hex SHA when git is available."""
        sha = get_git_sha()
        # SHA may be None if not in a git repo
        if sha is not None:
            assert isinstance(sha, str)
            assert len(sha) == 7
            assert all(c in "0123456789abcdef" for c in sha.lower())

    def test_get_git_sha_without_git(self):
        """get_git_sha returns None when git is not available."""
        with patch("subprocess.run", side_effect=FileNotFoundError):
            sha = get_git_sha()
            assert sha is None

    def test_get_version_info_structure(self):
        """get_version_info returns dict with app_version and optionally git_sha."""
        info = get_version_info()

        assert isinstance(info, dict)
        assert "app_version" in info
        assert info["app_version"] == __version__

        # git_sha is optional
        if "git_sha" in info:
            assert isinstance(info["git_sha"], str)
            assert len(info["git_sha"]) == 7


class TestRunReproducibilityMetadata:
    """Tests for run reproducibility metadata in database."""

    def test_run_metadata_stored_in_parameters(self, db_session):
        """Metadata is correctly stored in run.parameters._metadata."""
        org = Organization(
            name="Repro Test Org",
            slug="repro-test-org",
            is_demo=False,
            status="active",
        )
        db_session.add(org)
        db_session.flush()

        connector_def = ConnectorDefinition(
            key="repro_test_connector",
            display_name="Repro Test Connector",
            direction="source",
            implementation_key="app.connectors.test:TestConnector",
            capabilities={},
            config_schema={},
            is_enabled=True,
        )
        db_session.add(connector_def)
        db_session.flush()

        source = ConnectorInstance(
            organization_id=org.organization_id,
            connector_definition_id=connector_def.connector_definition_id,
            name="Repro Source",
            status="active",
            config={"api_key": "test"},
        )
        db_session.add(source)
        db_session.flush()

        pipeline = Pipeline(
            organization_id=org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        # Create run with metadata (simulating what the API/worker does)
        parameters = {
            "test": "value",
            "_metadata": {
                **get_version_info(),
                "source_implementation_key": connector_def.implementation_key,
            },
        }

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            source_connector_instance_id=source.connector_instance_id,
            status="pending",
            triggered_by="test",
            parameters=parameters,
        )
        db_session.add(run)
        db_session.commit()

        # Verify metadata is stored
        assert "_metadata" in run.parameters
        metadata = run.parameters["_metadata"]

        assert "app_version" in metadata
        assert metadata["app_version"] == __version__

        assert "source_implementation_key" in metadata
        assert metadata["source_implementation_key"] == "app.connectors.test:TestConnector"

        # Verify user parameters are preserved
        assert run.parameters["test"] == "value"

    def test_metadata_preserves_user_parameters(self, db_session):
        """Metadata does not overwrite user parameters."""
        org = Organization(
            name="Repro Preserve Org",
            slug="repro-preserve-org",
            is_demo=False,
            status="active",
        )
        db_session.add(org)
        db_session.flush()

        pipeline = Pipeline(
            organization_id=org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        # Create run with custom parameters and metadata
        custom_params = {
            "limit": 100,
            "force_full_sync": True,
            "custom_field": "custom_value",
            "_metadata": {
                **get_version_info(),
            },
        }

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            status="pending",
            triggered_by="test",
            parameters=custom_params,
        )
        db_session.add(run)
        db_session.commit()

        # Verify all user parameters are preserved
        assert run.parameters["limit"] == 100
        assert run.parameters["force_full_sync"] is True
        assert run.parameters["custom_field"] == "custom_value"

        # Verify metadata is added separately
        assert "_metadata" in run.parameters
        assert "app_version" in run.parameters["_metadata"]

    def test_run_without_source_implementation_key(self, db_session):
        """Run metadata works without source_implementation_key."""
        org = Organization(
            name="Repro NoSource Org",
            slug="repro-nosource-org",
            is_demo=False,
            status="active",
        )
        db_session.add(org)
        db_session.flush()

        pipeline = Pipeline(
            organization_id=org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        # Create run with metadata but no source_implementation_key
        parameters = {"_metadata": get_version_info()}

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            status="pending",
            triggered_by="test",
            parameters=parameters,
        )
        db_session.add(run)
        db_session.commit()

        # Metadata should still include app_version
        assert "_metadata" in run.parameters
        assert "app_version" in run.parameters["_metadata"]

        # But source_implementation_key should not be present
        assert "source_implementation_key" not in run.parameters["_metadata"]
