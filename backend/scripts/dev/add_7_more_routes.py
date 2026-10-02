#!/usr/bin/env python3
"""
Add 7 complete test routes for scalability testing of the Overview page.

Each route consists of:
- Source ConnectorInstance
- Dataset
- Destination ConnectorInstance  
- IntegrationRoute linking them together

Run with: PYTHONPATH=. python3 add_7_more_routes.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app.models import Organization, ConnectorInstance, Dataset, IntegrationRoute, ConnectorDefinition
from uuid import uuid4

def add_test_routes():
    # Instantiate settings and use sync engine
    from app.config import Settings
    cfg = Settings()
    engine = create_engine(str(cfg.database_url).replace('postgresql+asyncpg://', 'postgresql://psycopg2://'))
    
    with Session(engine) as session:
        # List all organizations to find the right one
        result = session.execute(select(Organization))
        orgs = result.scalars().all()
        print("Available organizations:")
        for o in orgs:
            print(f"  - {o.name} (id: {o.organization_id})")
        
        # Find Smithsonian org (try both names)
        result = session.execute(
            select(Organization).where(
                (Organization.name == "Smithsonian") | 
                (Organization.name == "Smithsonian Institution")
            )
        )
        org = result.scalar_one_or_none()
        
        if not org:
            print("\nSmithsonian organization not found!")
            print("Using first organization...")
            org = orgs[0] if orgs else None
            if not org:
                print("No organizations found!")
                return
        
        # Get a connector definition (we'll use the first one available)
        result = session.execute(select(ConnectorDefinition).limit(1))
        connector_def = result.scalar_one_or_none()
        
        if not connector_def:
            print("No connector definitions found!")
            return
        
        print(f"\n✓ Found org: {org.name} ({org.organization_id})")
        print(f"✓ Using connector definition: {connector_def.display_name}")
        
        # Create 7 complete routes
        for i in range(1, 8):
            print(f"\n--- Creating test route {i} ---")
            
            # Create source connector
            source = ConnectorInstance(
                connector_instance_id=uuid4(),
                name=f"Test Source {i}",
                organization_id=org.organization_id,
                connector_definition_id=connector_def.connector_definition_id,
                status="active",
                config={}
            )
            session.add(source)
            
            # Create dataset
            dataset = Dataset(
                dataset_id=uuid4(),
                name=f"Test Dataset {i}",
                key=f"test_dataset_{i}",
                organization_id=org.organization_id
            )
            session.add(dataset)
            
            # Create destination connector
            destination = ConnectorInstance(
                connector_instance_id=uuid4(),
                name=f"Test Destination {i}",
                organization_id=org.organization_id,
                connector_definition_id=connector_def.connector_definition_id,
                status="active",
                config={}
            )
            session.add(destination)
            
            session.flush()  # Ensure IDs are assigned
            
            # Create integration route
            route = IntegrationRoute(
                pipeline_id=uuid4(),
                name=f"Test Route {i}",
                organization_id=org.organization_id,
                source_connector_instance_id=source.connector_instance_id,
                target_connector_instance_id=destination.connector_instance_id,
                dataset_id=dataset.dataset_id,
                status="active"
            )
            session.add(route)
            
            print(f"  ✓ {source.name} → {dataset.name} → {destination.name}")
        
        session.commit()
        print("\n✅ All 7 test routes created successfully!")
        print("\nRefresh your Overview page to see the scaled layout with 10 datasets total.")

if __name__ == "__main__":
    add_test_routes()
