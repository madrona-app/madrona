"""Add test connectors and routes to database"""
import uuid
from app.database import get_session
from app.models import ConnectorInstance, IntegrationRoute, Organization, ConnectorDefinition, Dataset
from sqlalchemy import select

with get_session() as session:
    # Get first org
    org = session.execute(select(Organization)).scalars().first()
    org_id = org.organization_id
    print(f'Organization: {org_id}')

    # Get connector definitions
    connector_defs = session.execute(select(ConnectorDefinition)).scalars().all()
    print(f'Connector definitions: {[cd.display_name for cd in connector_defs]}')
    source_def = connector_defs[0]
    dest_def = connector_defs[1] if len(connector_defs) > 1 else connector_defs[0]

    # Get first dataset or create one
    dataset = session.execute(select(Dataset).where(Dataset.organization_id == org_id)).scalar_one_or_none()
    if not dataset:
        dataset = Dataset(
            dataset_id=str(uuid.uuid4()),
            organization_id=org_id,
            name='Objects',
            entity_count=0
        )
        session.add(dataset)
        session.flush()
        
    dataset_id = dataset.dataset_id

    # Create connectors
    conn_a = ConnectorInstance(
        connector_instance_id=str(uuid.uuid4()),
        organization_id=org_id,
        connector_definition_id=source_def.connector_definition_id,
        name='Connector A',
        config={}
    )
    session.add(conn_a)

    conn_b = ConnectorInstance(
        connector_instance_id=str(uuid.uuid4()),
        organization_id=org_id,
        connector_definition_id=dest_def.connector_definition_id,
        name='Connector B',
        config={}
    )
    session.add(conn_b)

    conn_1 = ConnectorInstance(
        connector_instance_id=str(uuid.uuid4()),
        organization_id=org_id,
        connector_definition_id=source_def.connector_definition_id,
        name='Connector 1',
        config={}
    )
    session.add(conn_1)

    conn_2 = ConnectorInstance(
        connector_instance_id=str(uuid.uuid4()),
        organization_id=org_id,
        connector_definition_id=dest_def.connector_definition_id,
        name='Connector 2',
        config={}
    )
    session.add(conn_2)

    session.flush()

    # Create routes
    route_ab = IntegrationRoute(
        pipeline_id=str(uuid.uuid4()),
        organization_id=org_id,
        name='Route A to B',
        source_connector_instance_id=conn_a.connector_instance_id,
        target_connector_instance_id=conn_b.connector_instance_id,
        dataset_id=dataset_id,
        status='active'
    )
    session.add(route_ab)

    route_12 = IntegrationRoute(
        pipeline_id=str(uuid.uuid4()),
        organization_id=org_id,
        name='Route 1 to 2',
        source_connector_instance_id=conn_1.connector_instance_id,
        target_connector_instance_id=conn_2.connector_instance_id,
        dataset_id=dataset_id,
        status='active'
    )
    session.add(route_12)

    session.commit()
    print(f'Created 4 connectors and 2 routes successfully')
    print(f'  Connector A -> Connector B (via dataset {dataset_id})')
    print(f'  Connector 1 -> Connector 2 (via dataset {dataset_id})')
