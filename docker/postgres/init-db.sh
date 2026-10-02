#!/bin/bash
set -e

# This script runs inside the PostgreSQL container on first initdb.
# The base image (pgvector/pgvector) already creates POSTGRES_USER, POSTGRES_PASSWORD,
# and POSTGRES_DB. We add extensions, schemas, the app role, and grants.
#
# Environment variables (passed from docker run):
#   POSTGRES_USER     — owner role (already created by base image)
#   POSTGRES_DB       — database name (already created by base image)
#   DB_APP_USERNAME   — runtime app role (subject to RLS)
#   DB_APP_PASSWORD   — runtime app role password

echo "=== Madrona DB init: configuring extensions, schemas, and roles ==="

# Defaults so a bare `docker run` (no DB_APP_* passed) still initializes a
# usable cluster instead of failing with `CREATE USER  WITH PASSWORD ''`.
# Compose supplies real values; these only cover ad-hoc/test containers.
: "${DB_APP_USERNAME:=madrona_app}"
: "${DB_APP_PASSWORD:=madrona_app_test}"
echo "  app role: ${DB_APP_USERNAME}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL

    -- Grant BYPASSRLS to owner (for migrations and seed scripts)
    ALTER ROLE ${POSTGRES_USER} BYPASSRLS;

    -- Extensions
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS postgis;
    -- Trigram search. The migration creates this too; doing it here as well
    -- means a fresh container has it before the first migration runs.
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    -- Create app runtime role (subject to RLS, DML only)
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_APP_USERNAME}') THEN
        CREATE USER ${DB_APP_USERNAME} WITH PASSWORD '${DB_APP_PASSWORD}';
      END IF;
    END
    \$\$;
    ALTER ROLE ${DB_APP_USERNAME} NOBYPASSRLS;
    GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${DB_APP_USERNAME};

    -- Application schemas. These five are every schema that holds a table;
    -- keep this list in step with _MADRONA_SCHEMAS in the consolidated
    -- migration and _SCHEMAS in backend/tests/conftest.py.
    --
    -- dam, exhibit and reporting were created here too and never held a
    -- single table: exhibit's models live in collections
    -- (collections.exhibitions, collections.venues, collections.floor_plans),
    -- the DAM surface is served out of media, and every report table is in
    -- reports. Dropped rather than left as a standing invitation to look in
    -- the wrong place.
    CREATE SCHEMA IF NOT EXISTS collections;
    CREATE SCHEMA IF NOT EXISTS media;
    CREATE SCHEMA IF NOT EXISTS flow;
    CREATE SCHEMA IF NOT EXISTS content;
    CREATE SCHEMA IF NOT EXISTS reports;

    -- Grant permissions on all schemas
    DO \$\$
    DECLARE
      s text;
    BEGIN
      -- Must match the CREATE SCHEMA list above. It did not: dam, exhibit and
      -- reporting were dropped from the creates and left here, so the first
      -- ALTER SCHEMA on a schema that no longer exists aborted the init script
      -- and Postgres exited 3. Every fresh database failed to come up, and
      -- only a cold boot showed it — an existing volume skips initdb entirely.
      -- backend/tests/test_schema_lists_agree.py now pins the two together.
      FOREACH s IN ARRAY ARRAY['public','collections','media','flow','content','reports']
      LOOP
        EXECUTE format('ALTER SCHEMA %I OWNER TO ${POSTGRES_USER}', s);
        EXECUTE format('GRANT ALL ON SCHEMA %I TO ${POSTGRES_USER}', s);
        EXECUTE format('GRANT USAGE ON SCHEMA %I TO ${DB_APP_USERNAME}', s);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO ${DB_APP_USERNAME}', s);
        EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO ${DB_APP_USERNAME}', s);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${DB_APP_USERNAME}', s);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO ${DB_APP_USERNAME}', s);
      END LOOP;
    END
    \$\$;

EOSQL

echo "=== Madrona DB init complete ==="
