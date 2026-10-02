#!/bin/bash
#
# Demo script for Madrona v1 end-to-end pipeline
#
# This script demonstrates:
# 1. Creating a run (optional)
# 2. Executing the run (extract → canonical → publish)
# 3. Handling failures with republish
# 4. Showing the final Sheet URL
#
# Usage:
#   ./demo_run_pipeline.sh <run_id>
#   ./demo_run_pipeline.sh --route-id <route_id>
#
# Prerequisites:
# - Backend running (flask run or gunicorn)
# - Database seeded with tenant, connectors, and route
# - (If using run_id) Run record exists with status='pending' or 'queued'

set -e  # Exit on error

# Configuration
API_BASE="${API_BASE:-http://localhost:8000/api}"

# Parse arguments
if [ "$1" = "--route-id" ]; then
    if [ -z "$2" ]; then
        echo "Usage: $0 --route-id <route_id>"
        exit 1
    fi
    
    ROUTE_ID="$2"
    RUN_ID=""
    CREATE_RUN=true
elif [ -n "$1" ]; then
    RUN_ID="$1"
    CREATE_RUN=false
else
    echo "Usage: $0 <run_id>"
    echo "       $0 --route-id <route_id>"
    echo ""
    echo "Examples:"
    echo "  $0 123e4567-e89b-12d3-a456-426614174000"
    echo "  $0 --route-id 456e7890-e89b-12d3-a456-426614174111"
    exit 1
fi

echo "========================================="
echo "Madrona v1 Pipeline Demo"
echo "========================================="
echo ""
echo "API Base: $API_BASE"
echo ""

# Step 0: Create run if needed
if [ "$CREATE_RUN" = true ]; then
    echo "Step 0: Creating run..."
    echo "  POST $API_BASE/runs"
    echo "  {\"route_id\": \"$ROUTE_ID\"}"
    echo ""
    
    CREATE_RESPONSE=$(curl -s -X POST "$API_BASE/runs" \
        -H "Content-Type: application/json" \
        -d "{\"route_id\": \"$ROUTE_ID\"}")
    
    RUN_ID=$(echo "$CREATE_RESPONSE" | jq -r '.run_id // "error"')
    
    if [ "$RUN_ID" = "error" ] || [ -z "$RUN_ID" ]; then
        echo "❌ Failed to create run!"
        echo ""
        echo "Response:"
        echo "$CREATE_RESPONSE" | jq '.'
        exit 1
    fi
    
    echo "Response:"
    echo "$CREATE_RESPONSE" | jq '.'
    echo ""
    echo "✅ Run created: $RUN_ID"
    echo ""
fi

echo "Run ID: $RUN_ID"
echo ""

# Step 1: Execute the run
echo "Step 1: Executing run..."
echo "  POST $API_BASE/runs/$RUN_ID/execute"
echo ""

EXECUTE_RESPONSE=$(curl -s -X POST "$API_BASE/runs/$RUN_ID/execute")
EXECUTE_STATUS=$(echo "$EXECUTE_RESPONSE" | jq -r '.status // "error"')

echo "Response:"
echo "$EXECUTE_RESPONSE" | jq '.'
echo ""

# Step 2: Check if we need to republish
if [ "$EXECUTE_STATUS" = "failed_publish" ]; then
    echo "========================================="
    echo "Publish failed! Retrying with republish..."
    echo "========================================="
    echo ""
    echo "Step 2: Republishing (skips extraction, retries Sheets only)..."
    echo "  POST $API_BASE/runs/$RUN_ID/republish"
    echo ""
    
    REPUBLISH_RESPONSE=$(curl -s -X POST "$API_BASE/runs/$RUN_ID/republish")
    REPUBLISH_STATUS=$(echo "$REPUBLISH_RESPONSE" | jq -r '.status // "error"')
    
    echo "Response:"
    echo "$REPUBLISH_RESPONSE" | jq '.'
    echo ""
    
    FINAL_STATUS="$REPUBLISH_STATUS"
    SHEET_URL=$(echo "$REPUBLISH_RESPONSE" | jq -r '.sheet_url // "N/A"')
elif [ "$EXECUTE_STATUS" = "success" ]; then
    FINAL_STATUS="success"
    SHEET_URL=$(echo "$EXECUTE_RESPONSE" | jq -r '.sheet_url // "N/A"')
else
    FINAL_STATUS="$EXECUTE_STATUS"
    SHEET_URL="N/A"
fi

# Step 3: Show summary
echo "========================================="
echo "Run Complete"
echo "========================================="
echo ""
echo "Final Status: $FINAL_STATUS"
echo "Sheet URL: $SHEET_URL"
echo ""

if [ "$FINAL_STATUS" = "success" ]; then
    echo "✅ Demo completed successfully!"
    echo ""
    echo "View the results in Google Sheets:"
    echo "$SHEET_URL"
    exit 0
else
    echo "❌ Demo failed with status: $FINAL_STATUS"
    echo ""
    echo "Check the response above for error details."
    exit 1
fi
