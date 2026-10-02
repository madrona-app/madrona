"""Tool execution must isolate DB failures (savepoint), so one bad tool query
doesn't abort the whole request transaction and crash the chat.

Regression for the incident where a reference-search dimension error aborted the
transaction → every later statement failed with InFailedSqlTransaction → the
Guide chat died with "Internal error".
"""

from sqlalchemy import text

from app.services.agent_tools import AgentContext, get_tool_registry


def test_tool_db_error_does_not_poison_session(db_session, demo_tenant, monkeypatch):
    reg = get_tool_registry()
    # lookup_reference is registered and allowed for the staff persona.
    td = reg._tools["lookup_reference"]

    def boom(_args, ctx):
        # Trigger a DB error that aborts the transaction at the psycopg level.
        ctx.db_session.execute(text("SELECT * FROM table_that_does_not_exist"))
        return {"ok": True}

    monkeypatch.setattr(td, "handler", boom)

    ctx = AgentContext(
        organization_id=demo_tenant.organization_id,
        user_id=None,
        persona="staff",
        db_session=db_session,
    )

    res = reg.execute("lookup_reference", {}, ctx)

    # The tool failure is reported, not raised.
    assert "error" in res.result_for_prompt

    # Crucially, the session is still usable — the savepoint rolled back the
    # failed query instead of poisoning the outer transaction.
    assert db_session.execute(text("SELECT 1")).scalar() == 1
