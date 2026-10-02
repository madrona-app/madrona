#!/usr/bin/env python
"""Execute pending runs manually."""

from app.database import get_session
from app.models import Run
from app.services.pipeline import execute_run

def main():
    with get_session() as session:
        # Get all pending runs
        runs = session.query(Run).filter(Run.status == 'pending').order_by(Run.created_at).all()
        
        print(f"Found {len(runs)} pending runs\n")
        
        for run in runs:
            print(f"Executing run {run.run_id}...")
            try:
                result = execute_run(session, run.run_id)
                
                # Refresh to see final status
                session.refresh(run)
                
                if run.status == 'succeeded':
                    print(f"  ✓ Success: {run.status}")
                    if run.processed_count:
                        print(f"    Processed: {run.processed_count} records")
                    if run.created_count:
                        print(f"    Created: {run.created_count} records")
                else:
                    print(f"  ✗ Failed: {run.status}")
                    if run.error:
                        print(f"    Error: {run.error[:100]}")
                        
            except Exception as e:
                print(f"  ✗ Error: {e}")
            
            print()

if __name__ == "__main__":
    main()
