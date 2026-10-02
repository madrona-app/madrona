#!/usr/bin/env python3
"""Debug update detection."""

from datetime import datetime, timezone

from app.database import get_session
from app.models import Organization, Run, Dataset, EntityCurrent, EntityField, ChangeEvent
from app.services.canonical_store import batch_upsert_entities
from app.schemas.canonical import compute_canonical_hash

with get_session() as session:
    org = session.query(Organization).filter(Organization.status == 'active').first()
    print(f'Using organization: {org.name}')

    # Clean up any existing test data first
    existing_dataset = session.query(Dataset).filter(
        Dataset.organization_id == org.organization_id,
        Dataset.key == 'debug_updates'
    ).first()

    if existing_dataset:
        print(f'Cleaning up existing dataset: {existing_dataset.dataset_id}')
        # Delete related data
        session.query(ChangeEvent).filter(
            ChangeEvent.dataset_id == existing_dataset.dataset_id
        ).delete()
        session.query(EntityField).filter(
            EntityField.entity_key.like('debug:%')
        ).delete()
        session.query(EntityCurrent).filter(
            EntityCurrent.dataset_id == existing_dataset.dataset_id
        ).delete()
        session.query(Run).filter(
            Run.dataset_id == existing_dataset.dataset_id
        ).delete()
        session.query(Dataset).filter(
            Dataset.dataset_id == existing_dataset.dataset_id
        ).delete()
        session.commit()
        print('Cleaned up existing test data')

    # Create dataset
    dataset = Dataset(
        organization_id=org.organization_id,
        name='Debug Update Test',
        key='debug_updates',
        source_type='artwork',
    )
    session.add(dataset)
    session.flush()
    print(f'Created dataset: {dataset.dataset_id}')

    # Run 1 - initial
    run1 = Run(
        organization_id=org.organization_id,
        dataset_id=dataset.dataset_id,
        status='running',
        triggered_by='manual',
        parameters={},
        processed_count=0, created_count=0, updated_count=0, skipped_count=0, failed_count=0,
    )
    session.add(run1)
    session.flush()

    initial_payload = {
        'id': 'test001',
        'type': 'Object',
        'label': 'Original Title',
        'description': 'Original description',
        'properties': {'color': 'blue'},
    }
    initial_hash = compute_canonical_hash(initial_payload)
    print(f'Initial payload label: {initial_payload["label"]}')
    print(f'Initial hash: {initial_hash}')

    initial_records = [{
        'entity_key': 'debug:test001',
        'source_system': 'debug',
        'source_id': 'test001',
        'payload': initial_payload,
    }]

    counts1 = batch_upsert_entities(
        session=session,
        organization_id=org.organization_id,
        run_id=run1.run_id,
        pipeline_id=None,
        canonical_records=initial_records,
        dataset_id=dataset.dataset_id,
    )
    run1.status = 'success'
    run1.created_count = counts1['created']
    session.commit()
    print(f'Run 1: {counts1}')

    # Check stored entity
    entity = session.query(EntityCurrent).filter(
        EntityCurrent.entity_key == 'debug:test001'
    ).first()
    print(f'Stored label: {entity.payload.get("label")}')
    print(f'Stored hash: {entity.payload_hash}')

    # Run 2 - update
    run2 = Run(
        organization_id=org.organization_id,
        dataset_id=dataset.dataset_id,
        status='running',
        triggered_by='manual',
        parameters={},
        processed_count=0, created_count=0, updated_count=0, skipped_count=0, failed_count=0,
    )
    session.add(run2)
    session.flush()

    updated_payload = {
        'id': 'test001',
        'type': 'Object',
        'label': 'UPDATED Title',
        'description': 'UPDATED description',
        'properties': {'color': 'red'},
    }
    updated_hash = compute_canonical_hash(updated_payload)
    print(f'Updated payload label: {updated_payload["label"]}')
    print(f'Updated hash: {updated_hash}')
    print(f'Hashes different: {initial_hash != updated_hash}')

    updated_records = [{
        'entity_key': 'debug:test001',
        'source_system': 'debug',
        'source_id': 'test001',
        'payload': updated_payload,
    }]

    # Before upsert - check what hash will be compared
    from app.services.canonical_store import validate_and_finalize_payload, compute_payload_hash
    finalized, _, _ = validate_and_finalize_payload(
        canonical_record=updated_records[0],
        source_system='debug',
        source_id='test001',
        dataset_id=str(dataset.dataset_id),
    )
    new_hash = compute_payload_hash(finalized)
    print(f'New finalized hash: {new_hash}')
    print(f'Hash comparison: stored={entity.payload_hash} vs new={new_hash}')
    print(f'Will detect as changed: {entity.payload_hash != new_hash}')

    counts2 = batch_upsert_entities(
        session=session,
        organization_id=org.organization_id,
        run_id=run2.run_id,
        pipeline_id=None,
        canonical_records=updated_records,
        dataset_id=dataset.dataset_id,
    )
    run2.status = 'success'
    run2.updated_count = counts2['updated']
    run2.skipped_count = counts2['noop']
    session.commit()
    print(f'Run 2: {counts2}')

    # Check entity after update
    session.refresh(entity)
    print(f'Final label: {entity.payload.get("label")}')
    print(f'Final hash: {entity.payload_hash}')

    # Check for update events
    from app.models import ChangeEvent
    events = session.query(ChangeEvent).filter(
        ChangeEvent.entity_key == 'debug:test001'
    ).all()
    print(f'Change events: {len(events)}')
    for e in events:
        print(f'  {e.change_type}: {e.changed_fields}')
