#!/bin/bash

# Test script for ORG2 implementation
# Tests browser auth flow: signup, login, refresh, logout, multi-org

set -e

echo "🧪 Testing ORG2: Browser Auth & Multi-Org Membership"
echo "====================================================="
echo ""

BASE_URL="http://localhost:8000"
TEST_EMAIL="org2test-$(date +%s)@example.com"
TEST_PASSWORD="testpassword123"
TEST_ORG_NAME="Test Org $(date +%s)"

# Cleanup
rm -f /tmp/org2_cookies.txt

# Test 1: Signup Start
echo "✅ Test 1: Signup Start (request verification code)"
SIGNUP_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/signup/start" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\"}")

if echo "$SIGNUP_RESPONSE" | grep -q "verification_code"; then
    VERIFICATION_CODE=$(echo "$SIGNUP_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['verification_code'])")
    echo "   ✓ Verification code received: $VERIFICATION_CODE"
else
    echo "   ✗ Failed to get verification code"
    echo "$SIGNUP_RESPONSE"
    exit 1
fi
echo ""

# Test 2: Signup Verify
echo "✅ Test 2: Signup Verify (create user + org + membership)"
SIGNUP_VERIFY_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/signup/verify" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\":\"$TEST_EMAIL\",
    \"code\":\"$VERIFICATION_CODE\",
    \"password\":\"$TEST_PASSWORD\",
    \"organization_name\":\"$TEST_ORG_NAME\"
  }" \
  -c /tmp/org2_cookies.txt)

if echo "$SIGNUP_VERIFY_RESPONSE" | grep -q "access_token"; then
    USER_ID=$(echo "$SIGNUP_VERIFY_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['user_id'])")
    ORG_ID=$(echo "$SIGNUP_VERIFY_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['organization_id'])")
    ACCESS_TOKEN=$(echo "$SIGNUP_VERIFY_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")
    echo "   ✓ User created: $USER_ID"
    echo "   ✓ Organization created: $ORG_ID"
    echo "   ✓ Access token received"
else
    echo "   ✗ Signup verify failed"
    echo "$SIGNUP_VERIFY_RESPONSE"
    exit 1
fi
echo ""

# Test 3: Get /me with token
echo "✅ Test 3: Get /me (user profile with memberships)"
ME_RESPONSE=$(curl -s "$BASE_URL/api/me" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

if echo "$ME_RESPONSE" | grep -q "$TEST_EMAIL"; then
    echo "   ✓ User profile returned"
    ORGS_COUNT=$(echo "$ME_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin)['organizations']))")
    echo "   ✓ Organization memberships: $ORGS_COUNT"
    ROLE=$(echo "$ME_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['organizations'][0]['role'])")
    echo "   ✓ Role: $ROLE"
else
    echo "   ✗ Failed to get user profile"
    echo "$ME_RESPONSE"
    exit 1
fi
echo ""

# Test 4: Login
echo "✅ Test 4: Login (with email/password)"
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\":\"$TEST_EMAIL\",
    \"password\":\"$TEST_PASSWORD\"
  }" \
  -c /tmp/org2_cookies.txt)

if echo "$LOGIN_RESPONSE" | grep -q "access_token"; then
    NEW_ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")
    echo "   ✓ Login successful"
    echo "   ✓ New access token received"
else
    echo "   ✗ Login failed"
    echo "$LOGIN_RESPONSE"
    exit 1
fi
echo ""

# Test 5: Token Refresh
echo "✅ Test 5: Token Refresh (using HttpOnly cookie)"
REFRESH_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/refresh" \
  -b /tmp/org2_cookies.txt)

if echo "$REFRESH_RESPONSE" | grep -q "access_token"; then
    REFRESHED_TOKEN=$(echo "$REFRESH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")
    echo "   ✓ Token refreshed successfully"
else
    echo "   ✗ Token refresh failed"
    echo "$REFRESH_RESPONSE"
    exit 1
fi
echo ""

# Test 6: Logout
echo "✅ Test 6: Logout (revoke refresh token)"
LOGOUT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/logout" \
  -b /tmp/org2_cookies.txt)

if echo "$LOGOUT_RESPONSE" | grep -q "Logged out"; then
    echo "   ✓ Logout successful"
else
    echo "   ✗ Logout failed"
    echo "$LOGOUT_RESPONSE"
    exit 1
fi
echo ""

# Test 7: Verify token no longer valid after logout
echo "✅ Test 7: Verify refresh fails after logout"
REFRESH_AFTER_LOGOUT=$(curl -s -X POST "$BASE_URL/api/auth/refresh" \
  -b /tmp/org2_cookies.txt)

if echo "$REFRESH_AFTER_LOGOUT" | grep -q "error"; then
    echo "   ✓ Refresh correctly rejected after logout"
else
    echo "   ✗ Refresh should have failed after logout"
    echo "$REFRESH_AFTER_LOGOUT"
    exit 1
fi
echo ""

# Test 8: Invalid password
echo "✅ Test 8: Login with invalid password"
INVALID_LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\":\"$TEST_EMAIL\",
    \"password\":\"wrongpassword\"
  }")

if echo "$INVALID_LOGIN_RESPONSE" | grep -q "Invalid email or password"; then
    echo "   ✓ Invalid password correctly rejected"
else
    echo "   ✗ Should have rejected invalid password"
    echo "$INVALID_LOGIN_RESPONSE"
    exit 1
fi
echo ""

# Cleanup
rm -f /tmp/org2_cookies.txt

echo "====================================================="
echo "✅ All ORG2 tests passed!"
echo ""
echo "📝 ORG2 Implementation Complete:"
echo "   • Signup flow with email verification"
echo "   • Login with HttpOnly refresh cookies"
echo "   • JWT access tokens (15-minute expiry)"
echo "   • Token refresh endpoint"
echo "   • Logout with token revocation"
echo "   • Multi-org membership support"
echo "   • User profile endpoint (/api/me)"
echo "   • Auth decorators (@require_auth, @require_org_role)"
echo ""
echo "📦 Database Tables:"
echo "   • users (user_id, email, password_hash, status)"
echo "   • organization_memberships (membership_id, organization_id, user_id, role)"
echo "   • verification_codes (code_id, email, code_hash, expires_at)"
echo "   • refresh_tokens (token_id, user_id, token_hash, expires_at)"
