"""
Row Level Security context for standalone SQLAlchemy sessions.

Provides set_rls_context_for_session() for use with FastAPI's get_db()
dependency, independent of Flask-SQLAlchemy's db.session.

RLS context is applied with SET LOCAL (set_config(..., is_local=true)), which
PostgreSQL clears on every COMMIT/ROLLBACK. To keep tenant isolation in place
across commits within a single request/task — without re-establishing context
by hand at every call site (the class of bug behind 58549a39) — we stash the
computed config on session.info and re-apply it on every transaction start via
an `after_begin` listener (register_rls_session_hooks()).
"""

import logging
from uuid import UUID

from sqlalchemy import event, text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Key under which the resolved set_config key->value map is stashed on
# session.info so the after_begin hook can re-apply it on later transactions.
_RLS_INFO_KEY = "rls_config"

_hooks_registered = False



def _encode_dept_ids(dept_ids: list[str]) -> str:
    """Serialise department ids for the app.current_dept_ids GUC.

    Plain comma-separated, NOT a '{...}' array literal. current_dept_ids()
    parses this with `string_to_array(NULLIF(setting, ''), ',')::uuid[]`, so
    brace-wrapping made the first and last elements '{uuid' and 'uuid}', the
    cast raised, and the function's `EXCEPTION WHEN OTHERS THEN RETURN NULL`
    swallowed it. Every department policy ends `OR current_dept_ids() IS NULL`,
    so that NULL meant *no department restriction* — a user in two or more
    departments silently read and wrote every department's records.

    A single department happened to work, because Postgres accepts the
    '{uuid}' form when casting one element, which is why this never showed up
    against a one-department fixture.

    An empty list yields '' -> NULL, preserving "this org does not use
    departments".
    """
    return ",".join(dept_ids)


def _apply_rls_config(executor, config: dict[str, str]) -> None:
    """Run SET LOCAL (set_config is_local=true) for each key->value pair.

    `executor` is anything with .execute(text, params) — a Session (initial
    apply) or a Connection (the after_begin re-apply). No DB reads here, so it
    is cheap and safe to run on every transaction begin.
    """
    for key, val in config.items():
        executor.execute(
            text("SELECT set_config(:k, :v, true)"), {"k": key, "v": val}
        )


def set_rls_context_for_session(
    session: Session,
    organization_id: str | None,
    user_id: str | None = None,
) -> None:
    """
    Set PostgreSQL RLS context for the given SQLAlchemy session.

    Applies SET LOCAL context for the current transaction AND stashes it on
    session.info so it is automatically re-applied after every commit (see
    module docstring + register_rls_session_hooks).

    Args:
        session: A plain SQLAlchemy Session (not Flask-SQLAlchemy db.session)
        organization_id: The organization UUID string, or None to clear context
        user_id: The user UUID string, used to set department context
    """
    # Skip RLS context for non-PostgreSQL databases (e.g., SQLite in tests)
    try:
        dialect = session.bind.dialect.name if session.bind else ""
    except Exception:
        return
    if dialect != "postgresql":
        return

    config: dict[str, str] = {}

    # User context (independent of org so user-scoped policies like
    # organization_memberships work during /me bootstrap, before active org).
    if user_id:
        try:
            config["app.current_user_id"] = str(UUID(str(user_id)))
        except (ValueError, TypeError):
            logger.warning("Invalid user_id format: %s", user_id)
            config["app.current_user_id"] = ""

    if organization_id:
        try:
            config["app.current_org_id"] = str(UUID(str(organization_id)))
        except (ValueError, TypeError):
            logger.warning("Invalid organization_id format: %s", organization_id)
            config["app.current_org_id"] = ""
    else:
        config["app.current_org_id"] = ""
        # Mirror the user_id clear so the SET LOCAL slate is fully reset when a
        # caller passes neither org nor user.
        if not user_id:
            config["app.current_user_id"] = ""

    # Apply user + org NOW: the department lookups below are themselves
    # RLS-scoped and need this context live in the current transaction.
    _apply_rls_config(session, config)

    # Department context (requires both org and user, and the org/user context
    # applied above). These are DB reads, so we resolve them once here and stash
    # the *values* — the after_begin re-apply never re-queries.
    if organization_id and user_id:
        try:
            validated_user = str(UUID(str(user_id)))
            validated_org = str(UUID(str(organization_id)))

            from app.models.departments import DepartmentMembership
            dept_memberships = (
                session.query(DepartmentMembership.department_id)
                .filter(
                    DepartmentMembership.user_id == UUID(validated_user),
                    DepartmentMembership.organization_id == UUID(validated_org),
                )
                .all()
            )
            dept_ids = [str(dm.department_id) for dm in dept_memberships]
            config["app.current_dept_ids"] = _encode_dept_ids(dept_ids)

            # view_all_departments bypass. Inline the permission check to avoid
            # the rbac_service Flask dependency.
            from app.models.core import (
                OrganizationMembership,
                Role,
                RolePermission,
                Permission as PermissionModel,
            )
            has_bypass = (
                session.query(PermissionModel.permission_id)
                .join(RolePermission, RolePermission.permission_id == PermissionModel.permission_id)
                .join(Role, Role.role_id == RolePermission.role_id)
                .join(OrganizationMembership, OrganizationMembership.role_id == Role.role_id)
                .filter(
                    OrganizationMembership.user_id == UUID(validated_user),
                    OrganizationMembership.organization_id == UUID(validated_org),
                    PermissionModel.permission_key == 'collections.view_all_departments',
                )
                .first()
            ) is not None
            config["app.dept_bypass"] = "true" if has_bypass else "false"

            _apply_rls_config(
                session,
                {
                    "app.current_dept_ids": config["app.current_dept_ids"],
                    "app.dept_bypass": config["app.dept_bypass"],
                },
            )
        except (ValueError, TypeError) as e:
            logger.warning("Error setting department RLS context: %s", e)

    # Stash for re-application on every subsequent transaction (post-commit).
    # When context is fully cleared, drop the stash so the after_begin hook
    # no-ops and later transactions run with no context (secure default).
    has_context = bool(config.get("app.current_org_id")) or bool(config.get("app.current_user_id"))
    if has_context:
        session.info[_RLS_INFO_KEY] = config
    else:
        session.info.pop(_RLS_INFO_KEY, None)


def _reapply_rls_on_begin(session, transaction, connection) -> None:
    """after_begin listener: re-apply stashed RLS context on a new transaction.

    SET LOCAL context is cleared by the commit that ended the previous
    transaction; this restores it for the new one so org isolation survives
    mid-request commits without per-call-site re-establishment.
    """
    config = session.info.get(_RLS_INFO_KEY)
    if not config:
        return
    try:
        _apply_rls_config(connection, config)
    except Exception as e:  # never let context re-apply break a transaction
        logger.warning("Failed to re-apply RLS context on begin: %s", e)


def register_rls_session_hooks() -> None:
    """Register the after_begin RLS re-apply listener (idempotent).

    Called from the session-factory setup so it is in place before any session
    is used. Global on Session, so it covers every standalone session; sessions
    with no stashed context (admin/BYPASSRLS, unauthenticated) no-op.
    """
    global _hooks_registered
    if _hooks_registered:
        return
    event.listen(Session, "after_begin", _reapply_rls_on_begin)
    _hooks_registered = True
