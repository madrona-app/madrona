#!/usr/bin/env python3
"""
Remove the 7 test routes created by add_7_more_routes.py

This script deletes:
- All IntegrationRoutes with name "Test Route X"
- All ConnectorInstances with name "Test Source X" or "Test Destination X"
- All Datasets with name "Test Dataset X"

Run with: PYTHONPATH=. python3 remove_test_routes.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, select, delete
from sqlalchemy.orm import Session
from app.models import ConnectorInstance, Dataset, IntegrationRoute

def remove_test_routes():
    from app.config import Settings
    cfg = Settings()
    engine = create_engine(str(cfg.database_url).replace('postgresql+asyncpg://', 'postgresql://psycopg2://'))
    
    with Session(engine) as session:
        # Delete routes
        result = session.execute(
            delete(IntegrationRoute).where(IntegrationRoute.name.like('Test Route %'))
        )
        routes_deleted = result.rowcount
        
        # Delete connector instances
        result = session.execute(
            delete(ConnectorInstance).where(
                (ConnectorInstance.name.like('Test Source %')) |
                (ConnectorInstance.name.like('Test Destination %'))
            )
        )
        connectors_deleted = result.rowcount
        
        # Delete datasets
        result = session.execute(
            delete(Dataset).where(Dataset.name.like('Test Dataset %'))
        )
        datasets_deleted = result.rowcount
        
        session.commit()
        
        print(f"✅ Removed {routes_deleted} routes")
        print(f"✅ Removed {connectors_deleted} connectors")
        print(f"✅ Removed {datasets_deleted} datasets")
        print("\nRefresh your Overview page to see the restored layout.")

if __name__ == "__main__":
    remove_test_routes()
