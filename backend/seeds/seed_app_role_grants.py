"""
Grant database privileges to the app runtime role (madrona_app).

The runtime role is NOBYPASSRLS and only holds DML privileges — it can't
create tables, so it depends on the owner role granting it access to
everything alembic + seeds create.

This is the AWS/RDS-on-EC2 equivalent of what docker/postgres/init-db.sh does
on first initdb for local Docker. Running it on every deploy keeps the
runtime role self-healing across:

  - Fresh DB provisioning (no prior grants)
  - The deploy-staging fallback that runs Base.metadata.create_all + alembic
    stamp head, which skips the grant migration (20260213_0100) entirely
  - New schemas or tables added between the init script and head

Required env:
    DATABASE_URL — must point to the owner role (BYPASSRLS). Callers should
                   set this to $ALEMBIC_DATABASE_URL, as the other seeds do.

Optional env:
    DB_APP_USERNAME — app role name (default: madrona_app)

Run with:
    python -m seeds.seed_app_role_grants
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, text

from app.config import Settings


def seed_app_role_grants() -> None:
    app_role = os.environ.get("DB_APP_USERNAME", "madrona_app")

    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())

    with engine.begin() as conn:
        owner = conn.execute(text("SELECT current_user")).scalar_one()
        dbname = conn.execute(text("SELECT current_database()")).scalar_one()

        app_exists = conn.execute(
            text("SELECT 1 FROM pg_roles WHERE rolname = :r"),
            {"r": app_role},
        ).scalar()
        if not app_exists:
            raise SystemExit(
                f"FATAL: role '{app_role}' does not exist. Create it "
                f"(password lives in the db-password secret, key 'app_password') "
                f"before re-running."
            )

        schemas = [
            row[0]
            for row in conn.execute(
                text(
                    "SELECT nspname FROM pg_namespace "
                    "WHERE nspname NOT LIKE 'pg_%' "
                    "  AND nspname <> 'information_schema' "
                    "ORDER BY nspname"
                )
            ).all()
        ]

        print(f"Owner: {owner}  App role: {app_role}  Database: {dbname}")
        print(f"Schemas: {schemas}")

        conn.execute(
            text(f'GRANT CONNECT ON DATABASE "{dbname}" TO {app_role}')
        )

        for schema in schemas:
            conn.execute(
                text(f'GRANT USAGE ON SCHEMA "{schema}" TO {app_role}')
            )
            conn.execute(
                text(
                    f'GRANT SELECT, INSERT, UPDATE, DELETE '
                    f'ON ALL TABLES IN SCHEMA "{schema}" TO {app_role}'
                )
            )
            conn.execute(
                text(
                    f'GRANT USAGE, SELECT '
                    f'ON ALL SEQUENCES IN SCHEMA "{schema}" TO {app_role}'
                )
            )
            # Default privileges apply to objects *created by the owner* going
            # forward, so future migrations inherit these grants automatically.
            conn.execute(
                text(
                    f'ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA "{schema}" '
                    f'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {app_role}'
                )
            )
            conn.execute(
                text(
                    f'ALTER DEFAULT PRIVILEGES FOR ROLE {owner} IN SCHEMA "{schema}" '
                    f'GRANT USAGE, SELECT ON SEQUENCES TO {app_role}'
                )
            )
            print(f"  granted on schema {schema}")

        # Audit trails are append-only for the application role.
        #
        # The blanket grant above hands madrona_app UPDATE and DELETE on every
        # table, and the RLS policies on these three are "ALL", so anything
        # holding the app credential could rewrite or erase the record of what
        # it did. No application code path updates or deletes an audit row —
        # the four audit routes are all GET — so revoking is safe and makes the
        # trail's immutability a property of the database rather than of every
        # future handler remembering.
        #
        # INSERT stays: the entity-audit listener writes through this role.
        # The owner (BYPASSRLS) retains full rights for retention tooling.
        for audit_table in (
            "public.audit_logs",
            "public.entity_audit_events",
            "public.entity_audit_field_diffs",
        ):
            exists = conn.execute(
                text("SELECT to_regclass(:t)"), {"t": audit_table}
            ).scalar()
            if not exists:
                print(f"  audit table {audit_table} absent, skipped")
                continue
            conn.execute(
                text(f"REVOKE UPDATE, DELETE ON {audit_table} FROM {app_role}")
            )
            print(f"  revoked UPDATE/DELETE on {audit_table}")

    # Verify in a fresh connection so we see committed state.
    with engine.connect() as conn:
        print("\nVerification:")
        for schema in schemas:
            usage = conn.execute(
                text("SELECT has_schema_privilege(:r, :s, 'USAGE')"),
                {"r": app_role, "s": schema},
            ).scalar()
            print(f"  {schema:<14} usage={usage}")


if __name__ == "__main__":
    seed_app_role_grants()
