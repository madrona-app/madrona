#!/bin/bash

# Test script for ORG1 implementation
# Tests organization switcher, routing, and API integration

set -e

echo "🧪 Testing ORG1: Organization UI & Switcher"
echo "=========================================="
echo ""

BASE_URL="http://localhost:8000"
ORG_ID="3553c9e6-1b1f-4602-927d-37714a80f7a4"

# Test 1: Organizations API
echo "✅ Test 1: Organizations API endpoint"
ORGS=$(curl -s "$BASE_URL/api/organizations")
if echo "$ORGS" | grep -q "organization_id"; then
    echo "   ✓ API returns organizations"
    echo "   Found: $(echo "$ORGS" | python3 -c "import sys, json; data = json.load(sys.stdin); print(len(data), 'organization(s)')")"
else
    echo "   ✗ Failed to get organizations"
    exit 1
fi
echo ""

# Test 2: Current User API
echo "✅ Test 2: Current User API (/api/me)"
USER=$(curl -s "$BASE_URL/api/me")
if echo "$USER" | grep -q "user_id"; then
    echo "   ✓ API returns user data"
    echo "   User: $(echo "$USER" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('email', 'unknown'))")"
    echo "   Orgs: $(echo "$USER" | python3 -c "import sys, json; data = json.load(sys.stdin); print(len(data.get('organizations', [])), 'organization(s)')")"
else
    echo "   ✗ Failed to get user data"
    exit 1
fi
echo ""

# Test 3: Organization-scoped Runs API
echo "✅ Test 3: Organization-scoped Runs API"
RUNS=$(curl -s "$BASE_URL/api/organizations/$ORG_ID/runs?limit=5")
if echo "$RUNS" | grep -q "runs"; then
    echo "   ✓ Runs API accepts organization_id in path"
    echo "   Found: $(echo "$RUNS" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('count', 0), 'run(s)')")"
else
    echo "   ✗ Failed to get runs"
    exit 1
fi
echo ""

# Test 4: Organization-scoped Routes API
echo "✅ Test 4: Organization-scoped Routes API"
ROUTES=$(curl -s "$BASE_URL/api/routes?organization_id=$ORG_ID")
if echo "$ROUTES" | grep -q "organization_id"; then
    echo "   ✓ Routes API accepts organization_id parameter"
    echo "   Found: $(echo "$ROUTES" | python3 -c "import sys, json; data = json.load(sys.stdin); print(len(data), 'route(s)')")"
else
    echo "   ✗ Failed to get routes"
    exit 1
fi
echo ""

# Test 5: Connector Instances API
echo "✅ Test 5: Connector Instances API"
INSTANCES=$(curl -s "$BASE_URL/api/connector-instances?organization_id=$ORG_ID")
if echo "$INSTANCES" | python3 -c "import sys, json; json.load(sys.stdin); sys.exit(0)" 2>/dev/null; then
    echo "   ✓ Connector instances API responds"
    echo "   Found: $(echo "$INSTANCES" | python3 -c "import sys, json; data = json.load(sys.stdin); print(len(data) if isinstance(data, list) else 'N/A', 'instance(s)')")"
else
    echo "   ✗ Failed to get connector instances"
    exit 1
fi
echo ""

# Test 6: Frontend build
echo "✅ Test 6: Frontend build"
if [ -f "frontend/dist/index.html" ]; then
    echo "   ✓ Frontend build artifacts exist"
else
    echo "   ⚠  No build artifacts found (may need to run: cd frontend && npm run build)"
fi
echo ""

echo "=========================================="
echo "✅ All API tests passed!"
echo ""
echo "📝 Manual testing checklist:"
echo "   1. Open http://localhost:5173/"
echo "   2. Verify redirect to /organizations/$ORG_ID/flow"
echo "   3. Check that Organization Switcher appears in header"
echo "   4. Click on Organization Switcher - verify dropdown works"
echo "   5. Navigate to different pages - verify org ID stays in URL"
echo "   6. Check localStorage for 'madrona.active_org_id'"
echo "   7. Verify all labels say 'Organization' not 'Tenant'"
echo ""
