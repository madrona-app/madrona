#!/usr/bin/env python3
"""
Smoke test for onboarding flow.

Calls health + provisioning endpoints to verify the stack is operational.
Safe-guarded: requires CONFIRM_SMOKE=1 env var to run against a live environment.

Usage:
    cd backend
    CONFIRM_SMOKE=1 API_BASE_URL=https://madrona.example.org PLATFORM_ADMIN_TOKEN=<jwt> \
        ./venv/bin/python -m scripts.ops.smoke_onboarding

Environment variables:
    CONFIRM_SMOKE        — must be "1" to proceed
    API_BASE_URL         — base URL of the API (default: http://localhost:5001)
    PLATFORM_ADMIN_TOKEN — valid JWT for a platform admin user (required for provision)
    SMOKE_ORG_NAME       — org name for test provision (default: "Smoke Test Org")
    DRY_RUN              — set to "true" to use validate-only mode (no side effects)
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

API_BASE = os.environ.get("API_BASE_URL", "http://localhost:5001").rstrip("/")
TOKEN = os.environ.get("PLATFORM_ADMIN_TOKEN", "")
ORG_NAME = os.environ.get("SMOKE_ORG_NAME", "Smoke Test Org")
DRY_RUN = os.environ.get("DRY_RUN", "").lower() == "true"

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"

results = []


def _request(method, path, json_body=None, headers=None):
    """Make an HTTP request and return (status, body_dict)."""
    url = f"{API_BASE}{path}"
    data = json.dumps(json_body).encode() if json_body else None
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)

    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode())
            return resp.status, body
    except urllib.error.HTTPError as e:
        body = json.loads(e.read().decode()) if e.fp else {}
        return e.code, body
    except Exception as e:
        return 0, {"error": str(e)}


def check(name, passed, detail=""):
    status = f"{GREEN}PASS{RESET}" if passed else f"{RED}FAIL{RESET}"
    msg = f"  [{status}] {name}"
    if detail:
        msg += f" — {detail}"
    print(msg)
    results.append(passed)


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def check_health():
    """Verify /health returns 200."""
    status, body = _request("GET", "/health")
    check("GET /health", status == 200, f"status={status}")


def check_provision_validate():
    """Verify POST /provision?mode=validate returns normalized values."""
    if not TOKEN:
        check("POST /provision?mode=validate", False, "PLATFORM_ADMIN_TOKEN not set")
        return

    payload = {
        "organization": {"name": ORG_NAME},
        "admin": {"email": "smoke-test@example.com", "name": "Smoke Tester"},
        "applications": [{"key": "collections"}],
    }

    status, body = _request(
        "POST",
        "/api/platform/provision?mode=validate",
        json_body=payload,
        headers={"Authorization": f"Bearer {TOKEN}"},
    )

    passed = status == 200 and body.get("valid") is True
    detail = f"status={status}"
    if body.get("warnings"):
        detail += f", warnings={body['warnings']}"
    check("POST /provision?mode=validate", passed, detail)


def check_provision_or_skip():
    """If DRY_RUN=false, provision an org; otherwise report validate-only result."""
    if DRY_RUN:
        print(f"  [{YELLOW}SKIP{RESET}] POST /provision (DRY_RUN=true, validate-only used above)")
        return

    if not TOKEN:
        check("POST /provision (full)", False, "PLATFORM_ADMIN_TOKEN not set")
        return

    slug = f"smoke-{int(time.time())}"
    payload = {
        "organization": {"name": ORG_NAME, "slug": slug},
        "admin": {"email": f"smoke-{int(time.time())}@example.com", "name": "Smoke Tester"},
        "applications": [{"key": "collections"}],
    }

    status, body = _request(
        "POST",
        "/api/platform/provision",
        json_body=payload,
        headers={"Authorization": f"Bearer {TOKEN}"},
    )

    job_id = body.get("job_id")
    passed = status in (200, 201) and job_id
    check("POST /provision (full)", passed, f"status={status}, job_id={job_id}")

    if job_id:
        check_job_status(job_id)


def check_job_status(job_id):
    """Verify GET /provision/<job_id> returns completed status."""
    status, body = _request(
        "GET",
        f"/api/platform/provision/{job_id}",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )

    passed = status == 200 and body.get("status") == "completed"
    check(
        f"GET /provision/{job_id[:8]}...",
        passed,
        f"status={status}, job_status={body.get('status')}",
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if os.environ.get("CONFIRM_SMOKE") != "1":
        print(f"{RED}Aborted: set CONFIRM_SMOKE=1 to run this smoke test.{RESET}")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  Onboarding Smoke Test — {API_BASE}")
    print(f"  Mode: {'validate-only (DRY_RUN)' if DRY_RUN else 'full provisioning'}")
    print(f"{'='*60}\n")

    check_health()
    check_provision_validate()
    check_provision_or_skip()

    print(f"\n{'='*60}")
    passed = sum(results)
    total = len(results)
    if all(results):
        print(f"  {GREEN}All {total} checks passed.{RESET}")
    else:
        print(f"  {RED}{total - passed}/{total} checks FAILED.{RESET}")
    print(f"{'='*60}\n")

    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
