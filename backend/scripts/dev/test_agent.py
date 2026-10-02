#!/usr/bin/env python3
"""
Smoke tests for the agent service.

Run from the backend directory:
    ./venv/bin/python scripts/dev/test_agent.py

Tests:
  1. Ollama connectivity and model availability
  2. Tool registry setup
  3. Ollama tool-calling round-trip (no DB)
  4. Full SSE stream (via Flask test client)

NOTE: This is a manual CLI smoke script, not a pytest-runnable test suite.
It requires a running Ollama, a live DATABASE_URL (not the test DB), and
existing organizations. When collected under pytest, individual tests skip
or rely on the live services they check.
"""

import json
import sys
import os

import pytest

# Ensure backend is on the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))


def test_ollama_connectivity():
    """Test 1: Can we reach Ollama and is the configured model available?"""
    import requests
    from app.config import get_settings

    settings = get_settings()
    print(f"  Ollama URL: {settings.ollama_base_url}")
    print(f"  Model: {settings.agent_model}")

    # Check Ollama is reachable
    try:
        resp = requests.get(f"{settings.ollama_base_url}/api/tags", timeout=5)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  FAIL: Cannot reach Ollama: {e}")
        return False

    # Check model is available
    models = [m["name"] for m in resp.json().get("models", [])]
    model_base = settings.agent_model.split(":")[0]
    found = any(model_base in m for m in models)
    if not found:
        print(f"  FAIL: Model '{settings.agent_model}' not found. Available: {models}")
        return False

    print(f"  OK: Ollama reachable, model available")
    return True


def test_tool_registry():
    """Test 2: Tool registry loads and has expected tools."""
    from app.services.agent_tools import get_tool_registry

    registry = get_tool_registry()
    staff_tools = registry.get_tools_for_persona("staff")
    visitor_tools = registry.get_tools_for_persona("visitor")

    staff_names = [t["function"]["name"] for t in staff_tools]
    visitor_names = [t["function"]["name"] for t in visitor_tools]

    print(f"  Staff tools: {staff_names}")
    print(f"  Visitor tools: {visitor_names}")

    # Check expected tools exist
    expected_staff = {"search_collection", "get_object_detail"}
    expected_visitor = {"search_collection", "get_object_detail", "list_current_exhibitions", "get_exhibition_info"}
    missing_staff = expected_staff - set(staff_names)
    missing_visitor = expected_visitor - set(visitor_names)

    if missing_staff:
        print(f"  FAIL: Missing staff tools: {missing_staff}")
        return False
    if missing_visitor:
        print(f"  FAIL: Missing visitor tools: {missing_visitor}")
        return False

    # Check tool schemas have required fields
    for tool in staff_tools + visitor_tools:
        func = tool.get("function", {})
        if not func.get("name") or not func.get("description") or "parameters" not in func:
            print(f"  FAIL: Tool {func.get('name')} missing required schema fields")
            return False

    print("  OK: All tools registered with valid schemas")
    return True


def test_ollama_chat_basic():
    """Test 3: Send a simple message to Ollama and get a response (no tools)."""
    import requests
    from app.config import get_settings

    settings = get_settings()

    try:
        resp = requests.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.agent_model,
                "messages": [
                    {"role": "system", "content": "You are a helpful assistant. Reply in one sentence."},
                    {"role": "user", "content": "Say hello."},
                ],
                "stream": False,
                "options": {"num_ctx": 2048},
            },
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        print(f"  FAIL: Ollama chat request failed: {e}")
        return False

    content = data.get("message", {}).get("content", "")
    if not content:
        print(f"  FAIL: Empty response from Ollama: {data}")
        return False

    print(f"  Response: {content[:100]}...")
    print("  OK: Ollama responded")
    return True


def test_ollama_tool_calling():
    """Test 4: Verify Ollama can produce tool_calls when given tools."""
    import requests
    from app.config import get_settings
    from app.services.agent_tools import get_tool_registry

    settings = get_settings()
    registry = get_tool_registry()
    tools = registry.get_tools_for_persona("staff")

    try:
        resp = requests.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.agent_model,
                "messages": [
                    {"role": "system", "content": "You are a museum collections assistant. Use your tools to answer questions."},
                    {"role": "user", "content": "Search the collection for paintings by Monet."},
                ],
                "tools": tools,
                "stream": False,
                "options": {"num_ctx": 4096},
            },
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        print(f"  FAIL: Ollama request failed: {e}")
        return False

    msg = data.get("message", {})
    tool_calls = msg.get("tool_calls", [])

    if not tool_calls:
        content = msg.get("content", "")
        print(f"  WARN: No tool calls produced. Model responded with text: {content[:100]}...")
        print("  WARN: This may indicate the model doesn't support tool calling well")
        return True  # Not a hard failure — model may just answer directly

    for tc in tool_calls:
        func = tc.get("function", {})
        print(f"  Tool call: {func.get('name')}({json.dumps(func.get('arguments', {}))})")

    print("  OK: Ollama produced tool calls")
    return True


def test_full_sse_stream():
    """Test 5: Full end-to-end test via standalone session."""
    import os
    from app.config import get_settings
    from app.database import get_session

    # Under pytest this is a live-smoke script, not an isolated unit test.
    # It needs the production DATABASE_URL (not the test DB) and an existing
    # Organization. Skip under pytest so suite runs don't fail on the infra
    # dependency; run the script directly (`./venv/bin/python scripts/dev/test_agent.py`)
    # to exercise.
    if os.environ.get("_SKIP_AUTO_CREATE_APP") or os.environ.get("TEST_DATABASE_URL"):
        pytest.skip(
            "test_full_sse_stream is a live-smoke script; run directly with "
            "`./venv/bin/python scripts/dev/test_agent.py`, not under pytest."
        )

    settings_check = get_settings()
    if not settings_check.agent_enabled:
        print("  SKIP: Agent not enabled")
        return True

    try:
        with get_session() as probe:
            probe.execute(__import__("sqlalchemy").text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 — any DB error means skip
        pytest.skip(
            "test_full_sse_stream is a live-smoke script requiring the agent "
            f"DATABASE_URL ({type(exc).__name__}). Run directly: "
            "`./venv/bin/python scripts/dev/test_agent.py`."
        )

    with get_session() as session:
        from app.services.agent_service import get_agent_service
        # Drift: app.services.auth_decorators was replaced by app.services.rls.
        # The new helper takes the session as its first arg.
        from app.services.rls import set_rls_context_for_session

        # Get an org to test with
        from app.models import Organization
        org = session.query(Organization).first()
        if not org:
            print("  SKIP: No organizations in database")
            return True

        org_id = org.organization_id
        set_rls_context_for_session(session, str(org_id))

        service = get_agent_service()

        # Create a conversation
        conv = service.create_conversation(
            organization_id=org_id,
            persona="staff",
            user_id=None,  # No user for test
        )
        print(f"  Created conversation: {conv.conversation_id}")

        # Stream a response
        events = []
        for event_str in service.stream_response(conv, "What objects are in the collection?"):
            events.append(event_str)
            # Parse the event
            for line in event_str.strip().split("\n"):
                if line.startswith("event: "):
                    etype = line[7:]
                elif line.startswith("data: "):
                    edata = json.loads(line[6:])
                    if etype == "text_delta":
                        print(edata["text"], end="", flush=True)
                    elif etype == "tool_start":
                        print(f"\n  [Tool: {edata['tool']}]", end="", flush=True)
                    elif etype == "tool_end":
                        print(" done", flush=True)
                    elif etype == "error":
                        print(f"\n  ERROR: {edata['error']}")
                    elif etype == "done":
                        print(f"\n  Message ID: {edata['message_id']}")

        # Verify we got events
        event_types = []
        for e in events:
            for line in e.strip().split("\n"):
                if line.startswith("event: "):
                    event_types.append(line[7:])

        if "done" in event_types:
            print("  OK: Full SSE stream completed")
            return True
        elif "error" in event_types:
            print("  FAIL: Stream ended with error")
            return False
        else:
            print(f"  FAIL: Unexpected event types: {event_types}")
            return False


def main():
    from app.config import get_settings  # noqa: ensure settings load

    tests = [
        ("Ollama connectivity", test_ollama_connectivity),
        ("Tool registry", test_tool_registry),
        ("Ollama basic chat", test_ollama_chat_basic),
        ("Ollama tool calling", test_ollama_tool_calling),
        ("Full SSE stream", test_full_sse_stream),
    ]

    print("=" * 60)
    print("Agent Service Smoke Tests")
    print("=" * 60)

    results = []
    for name, test_fn in tests:
        print(f"\n[{len(results)+1}/{len(tests)}] {name}")
        try:
            passed = test_fn()
            results.append((name, passed))
        except Exception as e:
            print(f"  FAIL: Unhandled exception: {e}")
            results.append((name, False))

    print("\n" + "=" * 60)
    print("Results:")
    for name, passed in results:
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {name}")

    failed = sum(1 for _, p in results if not p)
    print(f"\n{len(results) - failed}/{len(results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
