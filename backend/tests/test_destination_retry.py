"""
Tests for retrying a single destination publish step without re-running extraction.

Key tests:
1. Successful retry updates destination step to "success"
2. Failed retry updates destination step to "failed" with error
3. Retry does NOT create new change_events (idempotency)
4. Retry only affects single destination (other destinations unchanged)
5. Retry validates destination belongs to run's pipeline
6. Retry fails gracefully for non-existent run
"""

import pytest
from uuid import uuid4
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.models import (
    Run,
    Pipeline,
    PipelineDestination,
    PipelineSource,
    ConnectorInstance,
    ConnectorDefinition,
    RunDestinationStep,
    ChangeEvent,
    EntityCurrent,
    Organization,
    Dataset,
)
from app.services.pipeline import retry_destination_publish, PipelineError


@pytest.fixture
def retry_scenario(db_session, demo_tenant):
    """
    Create a complete run scenario with:
    - 1 source connector
    - 2 destination connectors
    - 1 completed run with change events
    - Destination 1: success
    - Destination 2: failed (ready for retry)
    """
    org_id = demo_tenant.organization_id

    # Create source connector
    source_def = ConnectorDefinition(
        key="retry_source_def",
        display_name="Retry Source",
        direction="source",
        implementation_key="test.source:RetrySource",
        capabilities={},
        config_schema={},
        is_enabled=True,
    )
    db_session.add(source_def)
    db_session.flush()

    source_instance = ConnectorInstance(
        organization_id=org_id,
        connector_definition_id=source_def.connector_definition_id,
        name="Retry Source Instance",
        status="active",
        config={},
    )
    db_session.add(source_instance)
    db_session.flush()

    # Create destination connector definition
    dest_def = ConnectorDefinition(
        key="retry_dest_def",
        display_name="Retry Target",
        direction="target",
        implementation_key="test.target:RetryTarget",
        capabilities={},
        config_schema={},
        is_enabled=True,
    )
    db_session.add(dest_def)
    db_session.flush()

    # Create two destination instances
    dest1_instance = ConnectorInstance(
        organization_id=org_id,
        connector_definition_id=dest_def.connector_definition_id,
        name="Destination 1",
        status="active",
        config={"spreadsheet_id": "dest1_sheet"},
    )
    dest2_instance = ConnectorInstance(
        organization_id=org_id,
        connector_definition_id=dest_def.connector_definition_id,
        name="Destination 2",
        status="active",
        config={"spreadsheet_id": "dest2_sheet"},
    )
    db_session.add_all([dest1_instance, dest2_instance])
    db_session.flush()

    # Create pipeline
    pipeline = Pipeline(
        organization_id=org_id,
        status="active",
    )
    db_session.add(pipeline)
    db_session.flush()

    # Add source
    pipeline_source = PipelineSource(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=source_instance.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=0,
    )
    db_session.add(pipeline_source)

    # Add two destinations
    dest1 = PipelineDestination(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=dest1_instance.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=0,
    )
    dest2 = PipelineDestination(
        pipeline_id=pipeline.pipeline_id,
        connector_instance_id=dest2_instance.connector_instance_id,
        enabled=True,
        parameters={},
        ordering=1,
    )
    db_session.add_all([dest1, dest2])
    db_session.flush()

    # Create run
    run = Run(
        organization_id=org_id,
        pipeline_id=pipeline.pipeline_id,
        status="success",
        triggered_by="manual",
        parameters={},
        started_at=datetime.now(timezone.utc),
        finished_at=datetime.now(timezone.utc),
        published_at=datetime.now(timezone.utc),
    )
    db_session.add(run)
    db_session.flush()

    # Create destination steps
    dest1_step = RunDestinationStep(
        run_id=run.run_id,
        pipeline_destination_id=dest1.destination_id,
        status="success",
        counts={"published_entities": 50, "published_changes": 10},
        started_at=datetime.now(timezone.utc),
        finished_at=datetime.now(timezone.utc),
    )
    dest2_step = RunDestinationStep(
        run_id=run.run_id,
        pipeline_destination_id=dest2.destination_id,
        status="failed",
        error="Network timeout",
        counts={},
        started_at=datetime.now(timezone.utc),
        finished_at=datetime.now(timezone.utc),
    )
    db_session.add_all([dest1_step, dest2_step])
    db_session.flush()

    # Create change events (immutable record from original run)
    for i in range(5):
        change = ChangeEvent(
            organization_id=org_id,
            run_id=run.run_id,
            entity_key=f"test:src:{i}",
            entity_type="record",
            change_type="created",
        )
        db_session.add(change)

    # Create current entities
    dataset = Dataset(
        organization_id=org_id,
        name="Retry Dataset",
        key="retry_dataset",
    )
    db_session.add(dataset)
    db_session.flush()

    for i in range(10):
        entity = EntityCurrent(
            organization_id=org_id,
            entity_key=f"test:src:{i}",
            entity_type="record",
            source_system="test",
            source_id=str(i),
            payload={"id": i, "name": f"Entity {i}"},
            payload_hash=f"hash_{i}",
            sources={},
            extracted_at=datetime.now(timezone.utc),
            last_seen_at=datetime.now(timezone.utc),
        )
        db_session.add(entity)

    db_session.commit()

    return {
        "run_id": run.run_id,
        "pipeline_id": pipeline.pipeline_id,
        "organization_id": org_id,
        "dest1_id": dest1.destination_id,
        "dest2_id": dest2.destination_id,
        "dest1_step_id": dest1_step.step_id,
        "dest2_step_id": dest2_step.step_id,
        "dest1_instance_id": dest1_instance.connector_instance_id,
        "dest2_instance_id": dest2_instance.connector_instance_id,
        "dest_def_id": dest_def.connector_definition_id,
    }


class TestRetryDestinationPublish:
    """Tests for retry_destination_publish service function."""

    def test_retry_success_updates_step(self, db_session, retry_scenario):
        """Successful retry updates destination step to 'success'."""
        scenario = retry_scenario

        with patch("app.services.pipeline.load_connector_from_db_record") as mock_load:
            mock_connector = MagicMock()
            mock_connector.publish_records.return_value = None
            mock_connector.publish_change_log.return_value = None
            mock_connector.get_target_url.return_value = "https://sheets.google.com/dest2_retry"
            mock_load.return_value = mock_connector

            result = retry_destination_publish(
                session=db_session,
                run_id=scenario["run_id"],
                pipeline_destination_id=scenario["dest2_id"],
            )

        assert result["status"] == "success"
        assert result["error"] is None
        assert result["counts"]["published_entities"] == 10
        assert result["counts"]["published_changes"] == 5
        assert result["target_url"] == "https://sheets.google.com/dest2_retry"

        # Verify step updated in DB
        step = db_session.query(RunDestinationStep).filter_by(
            step_id=scenario["dest2_step_id"]
        ).first()
        assert step.status == "success"
        assert step.error is None
        assert step.finished_at is not None

    def test_retry_failure_updates_step_with_error(self, db_session, retry_scenario):
        """Failed retry updates destination step to 'failed' with error."""
        scenario = retry_scenario

        with patch("app.services.pipeline.load_connector_from_db_record") as mock_load:
            mock_connector = MagicMock()
            mock_connector.publish_records.side_effect = Exception("API rate limit exceeded")
            mock_load.return_value = mock_connector

            result = retry_destination_publish(
                session=db_session,
                run_id=scenario["run_id"],
                pipeline_destination_id=scenario["dest2_id"],
            )

        assert result["status"] == "failed"
        assert "API rate limit exceeded" in result["error"]
        assert result["target_url"] is None

        # Verify step updated in DB
        step = db_session.query(RunDestinationStep).filter_by(
            step_id=scenario["dest2_step_id"]
        ).first()
        assert step.status == "failed"
        assert "API rate limit exceeded" in step.error

    def test_retry_does_not_create_new_change_events(self, db_session, retry_scenario):
        """Retry replays existing events without creating new ones."""
        scenario = retry_scenario

        initial_count = db_session.query(ChangeEvent).filter_by(
            run_id=scenario["run_id"]
        ).count()
        assert initial_count == 5

        with patch("app.services.pipeline.load_connector_from_db_record") as mock_load:
            mock_connector = MagicMock()
            mock_connector.publish_records.return_value = None
            mock_connector.publish_change_log.return_value = None
            mock_connector.get_target_url.return_value = "https://sheets.google.com/dest2"
            mock_load.return_value = mock_connector

            retry_destination_publish(
                session=db_session,
                run_id=scenario["run_id"],
                pipeline_destination_id=scenario["dest2_id"],
            )

        final_count = db_session.query(ChangeEvent).filter_by(
            run_id=scenario["run_id"]
        ).count()
        assert final_count == initial_count

    def test_retry_only_affects_single_destination(self, db_session, retry_scenario):
        """Retry only affects the targeted destination; others are unchanged."""
        scenario = retry_scenario

        # Capture dest1 state before retry
        dest1_before = db_session.query(RunDestinationStep).filter_by(
            step_id=scenario["dest1_step_id"]
        ).first()
        dest1_initial_status = dest1_before.status
        dest1_initial_finished_at = dest1_before.finished_at

        with patch("app.services.pipeline.load_connector_from_db_record") as mock_load:
            mock_connector = MagicMock()
            mock_connector.publish_records.return_value = None
            mock_connector.publish_change_log.return_value = None
            mock_connector.get_target_url.return_value = "https://sheets.google.com/dest2"
            mock_load.return_value = mock_connector

            retry_destination_publish(
                session=db_session,
                run_id=scenario["run_id"],
                pipeline_destination_id=scenario["dest2_id"],
            )

        # Verify dest1 unchanged
        dest1_after = db_session.query(RunDestinationStep).filter_by(
            step_id=scenario["dest1_step_id"]
        ).first()
        assert dest1_after.status == dest1_initial_status
        assert dest1_after.finished_at == dest1_initial_finished_at

        # Verify dest2 changed
        dest2_after = db_session.query(RunDestinationStep).filter_by(
            step_id=scenario["dest2_step_id"]
        ).first()
        assert dest2_after.status == "success"
        assert dest2_after.error is None

    def test_retry_validates_destination_belongs_to_pipeline(
        self, db_session, retry_scenario
    ):
        """Retry rejects a destination that does not belong to the run's pipeline."""
        scenario = retry_scenario
        wrong_dest_id = uuid4()

        with pytest.raises(PipelineError, match="not found"):
            retry_destination_publish(
                session=db_session,
                run_id=scenario["run_id"],
                pipeline_destination_id=wrong_dest_id,
            )

    def test_retry_run_not_found(self, db_session):
        """Retry fails gracefully if run does not exist."""
        with pytest.raises(PipelineError, match="not found"):
            retry_destination_publish(
                session=db_session,
                run_id=uuid4(),
                pipeline_destination_id=uuid4(),
            )

    def test_retry_run_without_pipeline(self, db_session, demo_tenant):
        """Retry fails gracefully if run has no pipeline_id."""
        run = Run(
            organization_id=demo_tenant.organization_id,
            pipeline_id=None,
            status="success",
            triggered_by="manual",
            parameters={},
            started_at=datetime.now(timezone.utc),
        )
        db_session.add(run)
        db_session.commit()

        with pytest.raises(PipelineError, match="has no pipeline_id"):
            retry_destination_publish(
                session=db_session,
                run_id=run.run_id,
                pipeline_destination_id=uuid4(),
            )

    def test_retry_idempotent_multiple_calls(self, db_session, retry_scenario):
        """Running retry twice produces the same result (idempotent)."""
        scenario = retry_scenario

        with patch("app.services.pipeline.load_connector_from_db_record") as mock_load:
            mock_connector = MagicMock()
            mock_connector.publish_records.return_value = None
            mock_connector.publish_change_log.return_value = None
            mock_connector.get_target_url.return_value = "https://sheets.google.com/dest2"
            mock_load.return_value = mock_connector

            result1 = retry_destination_publish(
                session=db_session,
                run_id=scenario["run_id"],
                pipeline_destination_id=scenario["dest2_id"],
            )

            result2 = retry_destination_publish(
                session=db_session,
                run_id=scenario["run_id"],
                pipeline_destination_id=scenario["dest2_id"],
            )

        assert result1["status"] == result2["status"]
        assert result1["counts"] == result2["counts"]

        # Change event count still unchanged
        final_count = db_session.query(ChangeEvent).filter_by(
            run_id=scenario["run_id"]
        ).count()
        assert final_count == 5
