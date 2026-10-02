"""
Script to populate database with multi-organization demo data.
Run with: python -m scripts.populate_multi_org_data
"""

from app.database import get_session
from app.models import Organization, User, ConnectorInstance, IntegrationRoute, Run, EntityCurrent, Dataset, OrganizationMembership, ConnectorDefinition
from datetime import datetime, timedelta
import random

def populate_data():
    with get_session() as session:
        print("Starting multi-org data population...")
        
        # Note: Not clearing existing data to preserve user sessions
        # If you want to clear data, use: psql -d madrona -c "TRUNCATE organizations CASCADE;"
        
        # Create organizations
        orgs = []
        org_data = [
            {
                'name': 'Smithsonian Institution',
                'slug': 'smithsonian'
            },
            {
                'name': 'Metropolitan Museum of Art',
                'slug': 'met-museum'
            },
            {
                'name': 'British Museum',
                'slug': 'british-museum'
            },
            {
                'name': 'Louvre Museum',
                'slug': 'louvre'
            }
        ]
        
        print(f"Creating {len(org_data)} organizations...")
        for org_info in org_data:
            # Check if org already exists
            existing = session.query(Organization).filter_by(slug=org_info['slug']).first()
            if existing:
                print(f"  - {org_info['name']} already exists, skipping...")
                orgs.append(existing)
                continue
                
            org = Organization(
                name=org_info['name'],
                slug=org_info['slug']
            )
            session.add(org)
            orgs.append(org)
        
        session.commit()
        print(f"✓ Created {len(orgs)} organizations")
        
        # Create users for each organization
        users = []
        for org in orgs:
            email = f"admin@{org.slug}.org"
            existing_user = session.query(User).filter_by(email=email).first()
            if existing_user:
                print(f"  - User {email} already exists, skipping...")
                users.append(existing_user)
                continue
                
            user = User(
                email=email,
                password_hash="$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5W5g3zZ9QO.h2"  # password: "demo123"
            )
            session.add(user)
            users.append(user)
        
        session.commit()
        print(f"✓ Created {len(users)} users")
        
        # Get available connector definitions
        connector_defs = session.query(ConnectorDefinition).filter_by(is_enabled=True).all()
        if not connector_defs:
            print("❌ No connector definitions found. Please seed connector definitions first.")
            return
        
        print(f"Found {len(connector_defs)} connector definitions")
        connector_def_ids = [cd.connector_definition_id for cd in connector_defs]
        
        # Create connector instances and routes for each organization
        statuses = ['active', 'success', 'warning', 'failed']
        
        total_routes = 0
        total_runs = 0
        total_entities = 0
        
        for org in orgs:
            print(f"\nPopulating data for {org.name}...")
            
            # Create 2-3 connector instances per org
            num_connectors = random.randint(2, 3)
            connectors = []
            
            for i in range(num_connectors):
                connector = ConnectorInstance(
                    organization_id=org.organization_id,
                    connector_definition_id=random.choice(connector_def_ids),
                    name=f"{org.name} Connector {i+1}",
                    config={}
                )
                session.add(connector)
                connectors.append(connector)
            
            session.commit()
            print(f"  ✓ Created {len(connectors)} connector instances")
            
            # Create 2-4 routes per organization
            num_routes = random.randint(2, 4)
            
            for i in range(num_routes):
                # Pick source and destination connectors
                source = random.choice(connectors)
                dest = random.choice([c for c in connectors if c.connector_instance_id != source.connector_instance_id]) if len(connectors) > 1 else source
                
                # Create a dataset for this route
                dataset = Dataset(
                    organization_id=org.organization_id,
                    name=f"{org.name} Dataset {i+1}",
                    key=f"dataset_{org.slug}_{i}",
                    description=f"Collection data for {org.name}"
                )
                session.add(dataset)
                session.commit()
                
                route = IntegrationRoute(
                    organization_id=org.organization_id,
                    name=f"{org.name} Sync Route {i+1}",
                    source_connector_instance_id=source.connector_instance_id,
                    destination_connector_instance_id=dest.connector_instance_id,
                    dataset_id=dataset.dataset_id,
                    status='active',
                    config={}
                )
                session.add(route)
                session.commit()
                total_routes += 1
                
                # Create 5-15 runs per route
                num_runs = random.randint(5, 15)
                
                for j in range(num_runs):
                    # Calculate time (more recent runs first)
                    days_ago = j * 0.5  # Runs spread over time
                    started_at = datetime.utcnow() - timedelta(days=days_ago)
                    
                    # Most runs are completed, some are running or failed
                    if j == 0:  # Most recent run
                        status = random.choice(['success', 'running', 'failed'])
                    else:
                        status = random.choices(
                            ['queued', 'success', 'warning', 'failed'],
                            weights=[5, 80, 5, 10],  # mostly success
                            k=1
                        )[0]
                    
                    # Generate realistic counts
                    processed_count = random.randint(50, 500)
                    created_count = random.randint(5, 50)
                    updated_count = random.randint(10, 100)
                    skipped_count = processed_count - created_count - updated_count
                    failed_count = random.randint(0, 5) if status == 'failed' else 0
                    
                    finished_at = started_at + timedelta(minutes=random.randint(2, 30)) if status in ['success', 'warning', 'failed'] else None
                    duration_ms = int((finished_at - started_at).total_seconds() * 1000) if finished_at else None
                    
                    run = Run(
                        organization_id=org.organization_id,
                        pipeline_id=route.pipeline_id,
                        dataset_id=dataset.dataset_id,
                        source_connector_instance_id=source.connector_instance_id,
                        target_connector_instance_id=dest.connector_instance_id,
                        status=status,
                        started_at=started_at,
                        finished_at=finished_at,
                        duration_ms=duration_ms,
                        triggered_by='scheduled',
                        parameters={},
                        processed_count=processed_count,
                        created_count=created_count,
                        updated_count=updated_count,
                        skipped_count=skipped_count,
                        failed_count=failed_count,
                        error='Connection timeout' if status == 'failed' else None,
                        error_stage='fetch' if status == 'failed' else None
                    )
                    session.add(run)
                    total_runs += 1
                
                session.commit()
                print(f"  ✓ Created route '{route.name}' with {num_runs} runs")
                
                # Create some entities for each route
                num_entities = random.randint(10, 30)
                
                for k in range(num_entities):
                    entity = EntityCurrent(
                        organization_id=org.organization_id,
                        integration_pipeline_id=route.pipeline_id,
                        dataset_id=dataset.dataset_id,
                        source_id=f"ext_{org.slug}_{i}_{k}",
                        entity_type='artwork',
                        data={
                            'title': f'Artwork {k+1}',
                            'artist': f'Artist {random.randint(1, 20)}',
                            'year': random.randint(1800, 2023),
                            'medium': random.choice(['Oil on canvas', 'Bronze', 'Watercolor', 'Digital'])
                        }
                    )
                    session.add(entity)
                    total_entities += 1
                
                session.commit()
        
        print(f"\n" + "="*60)
        print("✅ Multi-org data population complete!")
        print("="*60)
        print(f"Organizations: {len(orgs)}")
        print(f"Users:         {len(users)}")
        print(f"Routes:        {total_routes}")
        print(f"Runs:          {total_runs}")
        print(f"Entities:      {total_entities}")
        print()
        print("Organizations created:")
        for org in orgs:
            print(f"  • {org.name} (ID: {org.organization_id})")
        print()
        print("You can now test the multi-org feature by switching between organizations!")

if __name__ == '__main__':
    populate_data()
