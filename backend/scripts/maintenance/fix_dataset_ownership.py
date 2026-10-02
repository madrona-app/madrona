"""Fix dataset ownership - only Smithsonian should own Objects dataset"""
import uuid
from app.database import get_session
from app.models import ConnectorInstance, IntegrationRoute, Dataset
from sqlalchemy import select

with get_session() as session:
    # Find the Smithsonian connector
    smithsonian = session.execute(
        select(ConnectorInstance).where(ConnectorInstance.name.ilike('%smithsonian%'))
    ).scalar_one_or_none()
    
    if not smithsonian:
        print('Error: Smithsonian connector not found')
        exit(1)
    
    print(f'Found Smithsonian connector: {smithsonian.connector_instance_id}')
    
    # Find the Objects dataset
    objects_dataset = session.execute(
        select(Dataset).where(Dataset.name == 'Objects')
    ).scalar_one_or_none()
    
    if not objects_dataset:
        print('Error: Objects dataset not found')
        exit(1)
    
    print(f'Found Objects dataset: {objects_dataset.dataset_id}')
    org_id = objects_dataset.organization_id
    
    # Find routes for Connector A and Connector 1
    conn_a = session.execute(
        select(ConnectorInstance).where(ConnectorInstance.name == 'Connector A')
    ).scalar_one_or_none()
    
    conn_1 = session.execute(
        select(ConnectorInstance).where(ConnectorInstance.name == 'Connector 1')
    ).scalar_one_or_none()
    
    if not conn_a or not conn_1:
        print('Warning: Test connectors A or 1 not found, skipping route updates')
    else:
        # Create separate datasets for test routes
        dataset_ab = Dataset(
            dataset_id=str(uuid.uuid4()),
            organization_id=org_id,
            name='Test Dataset AB',
            key='test_dataset_ab',
            description='Test dataset for connector A to B route'
        )
        session.add(dataset_ab)
        
        dataset_12 = Dataset(
            dataset_id=str(uuid.uuid4()),
            organization_id=org_id,
            name='Test Dataset 12',
            key='test_dataset_12',
            description='Test dataset for connector 1 to 2 route'
        )
        session.add(dataset_12)
        session.flush()
        
        # Update routes to use their own datasets
        route_ab = session.execute(
            select(IntegrationRoute).where(
                IntegrationRoute.source_connector_instance_id == conn_a.connector_instance_id
            )
        ).scalar_one_or_none()
        
        route_12 = session.execute(
            select(IntegrationRoute).where(
                IntegrationRoute.source_connector_instance_id == conn_1.connector_instance_id
            )
        ).scalar_one_or_none()
        
        if route_ab:
            route_ab.dataset_id = dataset_ab.dataset_id
            print(f'Updated Route A-B to use dataset: {dataset_ab.name}')
        
        if route_12:
            route_12.dataset_id = dataset_12.dataset_id
            print(f'Updated Route 1-2 to use dataset: {dataset_12.name}')
    
    # Ensure Smithsonian route exists and points to Objects dataset
    smithsonian_route = session.execute(
        select(IntegrationRoute).where(
            IntegrationRoute.source_connector_instance_id == smithsonian.connector_instance_id
        )
    ).scalar_one_or_none()
    
    if not smithsonian_route:
        # Find a destination connector (use any available)
        dest_connector = session.execute(
            select(ConnectorInstance).where(
                ConnectorInstance.connector_instance_id != smithsonian.connector_instance_id
            )
        ).scalars().first()
        
        if dest_connector:
            smithsonian_route = IntegrationRoute(
                pipeline_id=str(uuid.uuid4()),
                organization_id=org_id,
                name='Smithsonian to Canonical',
                source_connector_instance_id=smithsonian.connector_instance_id,
                target_connector_instance_id=dest_connector.connector_instance_id,
                dataset_id=objects_dataset.dataset_id,
                status='active'
            )
            session.add(smithsonian_route)
            print(f'Created Smithsonian route to Objects dataset')
        else:
            print('Warning: No destination connector found for Smithsonian route')
    else:
        smithsonian_route.dataset_id = objects_dataset.dataset_id
        print(f'Updated Smithsonian route to use Objects dataset')
    
    session.commit()
    print('\nDataset ownership fixed successfully')
    print(f'Objects dataset is now exclusively owned by Smithsonian connector')
