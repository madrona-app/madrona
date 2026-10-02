"""
This conftest used to define postgres-only fixtures (postgres_engine,
postgres_session, test_tenant, test_run, test_route) because the main
conftest was SQLite-only. With the SQLite adaptation ripped out, the
root conftest now provides every fixture tests under this subtree need,
so there's nothing to declare here.

Kept as a marker so pytest's conftest discovery doesn't silently miss
a move, and so the @pytest.mark.postgres convention still has a home
directory it's associated with (the marker itself is now a no-op; see
the root conftest's pytest_configure).
"""
