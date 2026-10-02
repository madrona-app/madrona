"""The BYPASSRLS owner session, as a FastAPI dependency.

Some writes have no valid RLS context to run under: provisioning creates an
organization that is not yet in anybody's membership graph, and first-run
install creates the very first organization. `current_org_id` cannot satisfy a
tenant policy for a tenant that does not exist yet, so these paths need the
owner connection — the same one migrations use.

It lives here rather than in a router because two routers need it, and because
making it a dependency is what lets the integration-test conftest override it
(`app.dependency_overrides`) to route those writes through the test connection
so savepoint-based isolation still works.
"""

from __future__ import annotations


def admin_db_dep():
    """Yield a session on the BYPASSRLS owner connection."""
    from app.tasks.rls_helpers import admin_db_session
    with admin_db_session() as session:
        yield session
