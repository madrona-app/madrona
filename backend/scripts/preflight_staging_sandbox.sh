#!/usr/bin/env bash
#
# preflight_staging_sandbox.sh — sandbox-provisioning smoke test for a deployment.
#
# Provisions a throwaway organization, retrieves the invitation token,
# walks the activation flow, then deletes the org, so a broken
# provisioning flow surfaces in under 90 seconds.
#
# Usage:
#   PREFLIGHT_EMAIL_DOMAIN=<domain you control> \
#     ./backend/scripts/preflight_staging_sandbox.sh <API_BASE_URL> <PLATFORM_ADMIN_TOKEN>
#
# Example:
#   PREFLIGHT_EMAIL_DOMAIN=museum.example ./backend/scripts/preflight_staging_sandbox.sh \
#     https://madrona.museum.example \
#     "$(pbpaste)"
#
# Exit codes:
#   0  success — provisioning, activation, and cleanup all worked
#   1  bad arguments
#   2  provisioning failed
#   3  invitation token not found
#   4  /verify endpoint failed
#   5  /activate endpoint failed
#   6  cleanup (DELETE org) failed
#
# The script never touches an existing org. It sends a real invitation
# to preflight+<ts>@$PREFLIGHT_EMAIL_DOMAIN, so that domain must be one you
# control — there is deliberately no default.

set -euo pipefail

API_BASE="${1:-}"
TOKEN="${2:-}"

if [[ -z "$API_BASE" || -z "$TOKEN" ]]; then
  echo "Usage: $0 <API_BASE_URL> <PLATFORM_ADMIN_TOKEN>" >&2
  exit 1
fi

TS="$(date -u +%Y%m%d-%H%M%S)"
SLUG="preflight-${TS}"
ADMIN_EMAIL="preflight+${TS}@${PREFLIGHT_EMAIL_DOMAIN:?set PREFLIGHT_EMAIL_DOMAIN to a domain you control}"
ORG_NAME="Preflight Smoke Test, Inc."
PASSWORD="PreflightP@ss-${TS}"

# Need a JSON helper. Prefer jq; fall back to python3 for environments
# without jq installed.
if command -v jq >/dev/null 2>&1; then
  json() { jq -r "$1"; }
else
  json() {
    python3 -c "import json,sys; d=json.load(sys.stdin); path='$1'.lstrip('.'); \
parts=path.split('.') if path else []; v=d
for p in parts: v=v[p] if isinstance(v,dict) else v[int(p)]
print(v if isinstance(v,(str,int,float,bool)) else json.dumps(v))"
  }
fi

# Bootstrap a CSRF token + cookie before any state-changing request.
# /api/* state-changing routes go through CSRFMiddleware which checks
# X-CSRF-Token against the csrf_token cookie. Without this the
# preflight POST to /api/platform/provision 403s with
# `{"error":{"code":"csrf_error","message":"CSRF token missing"}}`.
COOKIE_JAR=$(mktemp -t preflight-cookies.XXXXXX)
trap "rm -f $COOKIE_JAR" EXIT

CSRF_TOKEN=$(
  curl -sS -c "$COOKIE_JAR" "${API_BASE%/}/api/auth/csrf" \
  | (jq -r '.csrf_token' 2>/dev/null \
     || python3 -c "import json,sys; print(json.load(sys.stdin).get('csrf_token',''))")
)
if [[ -z "$CSRF_TOKEN" || "$CSRF_TOKEN" == "null" ]]; then
  echo "✗ could not fetch CSRF token from $API_BASE/api/auth/csrf" >&2
  exit 1
fi

curl_json() {
  # $1=method, $2=path, $3 (optional)=body
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" \
      -H "Authorization: Bearer $TOKEN" \
      -H "X-CSRF-Token: $CSRF_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body" \
      "${API_BASE%/}${path}"
  else
    curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" \
      -H "Authorization: Bearer $TOKEN" \
      -H "X-CSRF-Token: $CSRF_TOKEN" \
      "${API_BASE%/}${path}"
  fi
}

curl_public() {
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" \
      -H "X-CSRF-Token: $CSRF_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body" \
      "${API_BASE%/}${path}"
  else
    curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" \
      "${API_BASE%/}${path}"
  fi
}

cleanup() {
  local org_id="${1:-}"
  if [[ -n "$org_id" ]]; then
    echo "  ↪ cleaning up org $org_id"
    curl_json DELETE "/api/platform/organizations/${org_id}" \
      >/dev/null || true
  fi
}

echo "▶ Preflight starting"
echo "  API:   $API_BASE"
echo "  Slug:  $SLUG"
echo "  Email: $ADMIN_EMAIL"

# --- 1. Provision -----------------------------------------------------------

PROVISION_BODY=$(cat <<EOF
{
  "organization": {"name": "$ORG_NAME", "slug": "$SLUG"},
  "admin":        {"email": "$ADMIN_EMAIL", "name": "Preflight Smoke"},
  "applications": [{"key": "collections"}, {"key": "media"}],
  "with_demo_data": false
}
EOF
)

echo "▶ POST /api/platform/provision"
PROVISION_RESP="$(curl_json POST /api/platform/provision "$PROVISION_BODY")"

JOB_ID="$(echo "$PROVISION_RESP" | json '.job_id' 2>/dev/null || true)"
ORG_ID="$(echo "$PROVISION_RESP" | json '.organization_id' 2>/dev/null || true)"

if [[ -z "$JOB_ID" || "$JOB_ID" == "null" ]]; then
  echo "✗ provisioning failed — no job_id in response:" >&2
  echo "$PROVISION_RESP" >&2
  exit 2
fi

echo "  job_id=$JOB_ID  org_id=$ORG_ID"

# --- 2. Poll until completed -----------------------------------------------

echo "▶ polling /api/platform/provision/$JOB_ID"
DEADLINE=$(( $(date +%s) + 120 ))
JOB_STATUS=""
while (( $(date +%s) < DEADLINE )); do
  JOB_RESP="$(curl_json GET /api/platform/provision/$JOB_ID)"
  JOB_STATUS="$(echo "$JOB_RESP" | json '.status' 2>/dev/null || echo "")"
  if [[ "$JOB_STATUS" == "completed" || "$JOB_STATUS" == "failed" ]]; then
    break
  fi
  sleep 2
done

if [[ "$JOB_STATUS" != "completed" ]]; then
  echo "✗ provisioning did not complete (status=$JOB_STATUS)" >&2
  echo "$JOB_RESP" >&2
  cleanup "$ORG_ID"
  exit 2
fi
echo "  status=$JOB_STATUS"

# --- 3. Extract invitation token --------------------------------------------

TOKEN_FROM_JOB="$(echo "$JOB_RESP" | json '.steps.create_admin_user.result.invitation_token' 2>/dev/null || true)"
if [[ -z "$TOKEN_FROM_JOB" || "$TOKEN_FROM_JOB" == "null" ]]; then
  echo "✗ no invitation_token in create_admin_user step result (bug #3 regression?)" >&2
  echo "$JOB_RESP" >&2
  cleanup "$ORG_ID"
  exit 3
fi
echo "  invitation_token present"

# --- 4. Verify --------------------------------------------------------------

echo "▶ GET /api/invitations/$TOKEN_FROM_JOB/verify"
VERIFY_RESP="$(curl_public GET "/api/invitations/$TOKEN_FROM_JOB/verify")"
VERIFY_OK="$(echo "$VERIFY_RESP" | json '.valid' 2>/dev/null || echo "")"
if [[ "$VERIFY_OK" != "True" && "$VERIFY_OK" != "true" ]]; then
  echo "✗ verify failed (bug #6 regression?):" >&2
  echo "$VERIFY_RESP" >&2
  cleanup "$ORG_ID"
  exit 4
fi

VERIFY_EMAIL="$(echo "$VERIFY_RESP" | json '.email' 2>/dev/null || true)"
if [[ "$VERIFY_EMAIL" != "$ADMIN_EMAIL" ]]; then
  echo "✗ verify returned wrong email: $VERIFY_EMAIL (expected $ADMIN_EMAIL)" >&2
  cleanup "$ORG_ID"
  exit 4
fi
echo "  verify OK"

# --- 5. Activate ------------------------------------------------------------

ACTIVATE_BODY=$(cat <<EOF
{"token": "$TOKEN_FROM_JOB", "password": "$PASSWORD"}
EOF
)
echo "▶ POST /api/auth/activate"
ACTIVATE_RESP="$(curl_public POST /api/auth/activate "$ACTIVATE_BODY")"
# /api/auth/activate returns a flat session object — no nested `.user`.
# Proof of a successful activation is the access_token it mints.
ACTIVATED_TOKEN="$(echo "$ACTIVATE_RESP" | json '.access_token' 2>/dev/null || echo "")"
if [[ -z "$ACTIVATED_TOKEN" || "$ACTIVATED_TOKEN" == "null" ]]; then
  echo "✗ activate failed:" >&2
  echo "$ACTIVATE_RESP" >&2
  cleanup "$ORG_ID"
  exit 5
fi
echo "  activate OK"

# --- 6. Cleanup -------------------------------------------------------------

echo "▶ DELETE /api/platform/organizations/$ORG_ID"
DELETE_RESP="$(curl_json DELETE "/api/platform/organizations/$ORG_ID")"
DELETE_MSG="$(echo "$DELETE_RESP" | json '.message' 2>/dev/null || echo "")"
if [[ -z "$DELETE_MSG" ]]; then
  echo "✗ delete failed:" >&2
  echo "$DELETE_RESP" >&2
  exit 6
fi
echo "  cleanup OK"

echo "✓ Preflight passed — provisioning + activation flow is green."
