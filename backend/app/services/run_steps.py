"""
Run step management utilities.

Phase 1.2: Utilities for creating and managing per-source/per-destination
execution steps within runs.
"""
import uuid
from sqlalchemy.orm import Session

from app.models import Run, RunSourceStep, RunDestinationStep, Pipeline
from app.database import current_session


def create_run_steps(run: Run) -> None:
    """
    Create step tracking rows for all enabled sources and destinations.

    Called automatically when a run is created. Creates one RunSourceStep
    for each enabled pipeline_source and one RunDestinationStep for each
    enabled pipeline_destination.

    Args:
        run: The run to create steps for

    Note:
        - Only creates steps for enabled sources/destinations
        - Steps are created in pending status
        - Caller is responsible for committing the transaction
    """
    if not run.pipeline_id:
        # No pipeline means no sources/destinations to track
        return

    # Get the pipeline with sources and destinations
    pipeline = current_session().query(Pipeline).filter_by(pipeline_id=run.pipeline_id).first()
    if not pipeline:
        return

    # Create steps for each enabled source
    for source in pipeline.sources:
        if source.enabled:
            step = RunSourceStep(
                step_id=uuid.uuid4(),
                run_id=run.run_id,
                pipeline_source_id=source.source_id,
                status="pending",
                counts={},
            )
            current_session().add(step)

    # Create steps for each enabled destination
    for destination in pipeline.destinations:
        if destination.enabled:
            step = RunDestinationStep(
                step_id=uuid.uuid4(),
                run_id=run.run_id,
                pipeline_destination_id=destination.destination_id,
                status="pending",
                counts={},
            )
            current_session().add(step)
