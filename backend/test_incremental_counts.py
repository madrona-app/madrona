"""
Test script to verify incremental count updates during run execution.

Run this after logging into the web UI to use your existing session cookie.

NOTE: This is a manual CLI integration script, NOT a pytest-runnable test.
It requires a live dev server on localhost:8000, CLI args (org_id, pipeline_id),
and a TEST_COOKIE env var. When pytest collects it, we skip automatically.
"""
import time
import sys
import os
from datetime import datetime

import pytest

# Configuration
BASE_URL = "http://localhost:8000"


@pytest.mark.skip(
    reason=(
        "Manual CLI integration script, not a pytest-runnable test. "
        "Requires live dev server on localhost:8000 plus CLI args and TEST_COOKIE. "
        "Run directly: `python test_incremental_counts.py <org_id> <pipeline_id>`"
    )
)
def test_with_existing_data():
    """Test using existing data - reads org_id and pipeline_id from command line"""
    if len(sys.argv) < 3:
        print("Usage: python test_incremental_counts.py <org_id> <pipeline_id>")
        print("\nGet these from the web UI:")
        print("  1. Go to Organizations > Setup > Routes")
        print("  2. Copy the organization ID from URL")
        print("  3. Copy a route ID from the routes list")
        sys.exit(1)
    
    org_id = sys.argv[1]
    pipeline_id = sys.argv[2]
    
    # Import here after we know we have args
    import requests
    
    # Create session
    session = requests.Session()
    
    # Try to get cookie from environment or use test cookie
    cookie_header = os.environ.get('TEST_COOKIE', '')
    if cookie_header:
        # Parse cookie header
        for cookie in cookie_header.split(';'):
            cookie = cookie.strip()
            if '=' in cookie:
                name, value = cookie.split('=', 1)
                session.cookies.set(name, value)
    
    print(f"Testing with org_id={org_id}, pipeline_id={pipeline_id}")
    
    # Try to create a run
    response = session.post(
        f"{BASE_URL}/api/organizations/{org_id}/routes/{pipeline_id}/runs"
    )
    
    if response.status_code == 401:
        print("\n❌ Not authenticated. Please:")
        print("  1. Open http://localhost:5173 in your browser")
        print("  2. Log in to the application")
        print("  3. Open browser DevTools > Network tab")
        print("  4. Copy the 'Cookie' header from any API request")
        print("  5. Set it as an environment variable:")
        print('     export TEST_COOKIE="session=..."')
        print("  6. Run this script again")
        sys.exit(1)
    
    if response.status_code != 201:
        print(f"❌ Failed to create run: {response.status_code} - {response.text}")
        sys.exit(1)
    
    run = response.json()
    run_id = run["run_id"]
    print(f"✓ Created run: {run_id}")
    
    # Execute the run
    response = session.post(
        f"{BASE_URL}/api/organizations/{org_id}/runs/{run_id}/execute"
    )
    if response.status_code != 200:
        print(f"❌ Failed to execute run: {response.status_code} - {response.text}")
        sys.exit(1)
    print("✓ Run execution started")
    
    return session, org_id, run_id

def get_run_status(session, org_id, run_id):
    """Get current run status and counts"""
    response = session.get(f"{BASE_URL}/api/organizations/{org_id}/runs/{run_id}")
    if response.status_code != 200:
        return None
    return response.json()

def monitor_run(session, org_id, run_id, max_duration=120):
    """Monitor run and track count updates"""
    print(f"\n📊 Monitoring run {run_id}...")
    print("=" * 80)
    
    start_time = time.time()
    count_updates = []
    last_counts = {"processed": 0, "created": 0, "updated": 0, "skipped": 0}
    
    while time.time() - start_time < max_duration:
        run = get_run_status(session, org_id, run_id)
        if not run:
            print("⚠️  Failed to get run status")
            time.sleep(1)
            continue
        
        status = run.get("status")
        counts = run.get("counts", {})
        current_counts = {
            "processed": counts.get("processed", 0),
            "created": counts.get("created", 0),
            "updated": counts.get("updated", 0),
            "skipped": counts.get("skipped", 0),
        }
        
        # Check if counts changed
        if current_counts != last_counts:
            timestamp = time.time() - start_time
            count_updates.append({
                "timestamp": timestamp,
                "status": status,
                "counts": current_counts.copy()
            })
            
            print(f"[{timestamp:6.2f}s] Status: {status:10s} | "
                  f"Processed: {current_counts['processed']:5d} | "
                  f"Created: {current_counts['created']:4d} | "
                  f"Updated: {current_counts['updated']:4d} | "
                  f"Skipped: {current_counts['skipped']:4d}")
            
            last_counts = current_counts
        
        # Check if run is complete
        if status in ["success", "failed", "error"]:
            print("=" * 80)
            print(f"✓ Run completed with status: {status}")
            break
        
        time.sleep(0.5)  # Poll every 500ms
    
    return count_updates, last_counts

def analyze_results(count_updates, final_counts):
    """Analyze if counts updated incrementally"""
    print(f"\n📈 Analysis:")
    print("=" * 80)
    
    if len(count_updates) == 0:
        print("❌ FAIL: No count updates detected")
        return False
    
    print(f"✓ Total count updates: {len(count_updates)}")
    
    # Check if we had multiple updates before completion
    if len(count_updates) < 2:
        print("❌ FAIL: Only one count update (all at end)")
        return False
    
    # Check if counts increased gradually
    incremental = True
    for i in range(1, len(count_updates)):
        prev = count_updates[i-1]["counts"]["processed"]
        curr = count_updates[i]["counts"]["processed"]
        if curr <= prev and curr < final_counts["processed"]:
            incremental = False
    
    if incremental and len(count_updates) > 2:
        print("✓ PASS: Counts updated incrementally during processing")
        print(f"  • First update at {count_updates[0]['timestamp']:.2f}s: "
              f"{count_updates[0]['counts']['processed']} processed")
        print(f"  • Last update at {count_updates[-1]['timestamp']:.2f}s: "
              f"{count_updates[-1]['counts']['processed']} processed")
        return True
    else:
        print("❌ FAIL: Counts did not update incrementally")
        if len(count_updates) == 2:
            print("  • Only 2 updates detected (likely start and end)")
        return False

def main():
    """Main test execution"""
    print("🧪 Testing Incremental Count Updates")
    print("=" * 80)
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    try:
        import requests
        
        # Get session and IDs
        session, org_id, run_id = test_with_existing_data()
        
        # Monitor execution
        count_updates, final_counts = monitor_run(session, org_id, run_id)
        
        # Analyze results
        success = analyze_results(count_updates, final_counts)
        
        print()
        print("=" * 80)
        if success:
            print("🎉 TEST PASSED: Incremental count updates working correctly")
        else:
            print("❌ TEST FAILED: Counts not updating incrementally")
        print("=" * 80)
        
        return 0 if success else 1
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    exit(main())
