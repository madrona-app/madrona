#!/bin/bash
set -e

echo "=== Madrona Backend Entrypoint ==="

# Wait for PostgreSQL using the connection URL the container actually has
# (POSTGRES_* env vars are not passed to app containers).
# pg_isready speaks libpq URLs — strip any SQLAlchemy driver suffix
# (postgresql+psycopg:// -> postgresql://).
WAIT_DB_URL=$(printf '%s' "${ALEMBIC_DATABASE_URL:-$DATABASE_URL}" | sed 's|^postgresql+[a-z0-9]*:|postgresql:|')
echo "Waiting for PostgreSQL..."
until pg_isready -d "$WAIT_DB_URL" -q 2>/dev/null; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 2
done
echo "PostgreSQL is up!"

# Wait for Redis via REDIS_URL (carries the password). redis-cli is not in
# the image; use the Python client that the app itself depends on.
echo "Waiting for Redis..."
until python -c "import os, redis; redis.Redis.from_url(os.environ['REDIS_URL'], socket_connect_timeout=2).ping()" 2>/dev/null; do
  echo "Redis is unavailable - sleeping"
  sleep 2
done
echo "Redis is up!"

# Worker/auxiliary mode: when args are given (e.g. the celery-worker service
# passes its own command), exec them directly. Migrations and seeds are the
# API container's job — running them twice concurrently is a race.
if [ "$#" -gt 0 ]; then
  echo "Args supplied — exec: $*"
  exec "$@"
fi

# Run database migrations
echo "Running database migrations..."
alembic upgrade head

# Seed RLS policies and app role grants. The consolidated schema migration
# intentionally excludes RLS (see its module docstring); the policies live in
# seeds/seed_rls_policies.py and must run after alembic on every boot to keep
# tenant isolation in place. Both seeds are idempotent and must run as the
# owner role (ALEMBIC_DATABASE_URL) because they run DDL and ALTER TABLE.
if [ -n "$ALEMBIC_DATABASE_URL" ]; then
  echo "Seeding RLS policies..."
  DATABASE_URL="$ALEMBIC_DATABASE_URL" python -m seeds.seed_rls_policies
  echo "Seeding app role grants..."
  DATABASE_URL="$ALEMBIC_DATABASE_URL" python -m seeds.seed_app_role_grants
else
  # Single-role setup (no separate owner). Fall back to the existing DATABASE_URL.
  echo "Seeding RLS policies (single-role)..."
  python -m seeds.seed_rls_policies
  echo "Seeding app role grants (single-role)..."
  python -m seeds.seed_app_role_grants
fi

# Core bootstrap seeds — all idempotent, all safe to run on every boot.
# A fresh database is unusable without them (no roles, no applications, no
# lookup values). Heavyweight/optional seeds (demo data, e2e fixtures,
# reference corpus) stay manual. Disable with SEED_CORE_ON_BOOT=false.
if [ "${SEED_CORE_ON_BOOT:-true}" = "true" ]; then
  echo "Seeding core bootstrap data..."
  for seed in seed_roles_and_permissions seed_applications seed_lookup_data               seed_document_templates seed_exhibit_defaults seed_role_profiles               seed_page_docs database_connector_definitions               loc_connector_definition smithsonian_connector_definition; do
    echo "  - $seed"
    # Seeds write global (non-org) rows; run as the owner role (BYPASSRLS),
    # matching how the deploy pipeline has always invoked them.
    DATABASE_URL="${ALEMBIC_DATABASE_URL:-$DATABASE_URL}" python -m "seeds.$seed"       || echo "    (seed $seed failed — continuing; rerun manually)"
  done
fi

# First-run guidance. A fresh install has no users and no organization, and
# the only public signup route creates a Guide-only workspace — so an
# operator who just ran `docker compose up` would land on a sign-in page
# with no way past it. Tell them exactly what to run.
USER_COUNT=$(DATABASE_URL="${ALEMBIC_DATABASE_URL:-$DATABASE_URL}" python - <<'PYCHECK' 2>/dev/null || echo "?"
import os
from sqlalchemy import create_engine, text
url = os.environ["DATABASE_URL"]
with create_engine(url).connect() as c:
    print(c.execute(text("SELECT count(*) FROM users")).scalar())
PYCHECK
)
if [ "$USER_COUNT" = "0" ]; then
  echo ""
  echo "=============================================================="
  echo " No accounts yet. Create the first administrator:"
  echo ""
  echo "   docker compose exec backend python -m seeds.bootstrap_admin \\"
  echo "     --email you@example.org --password 'choose-a-strong-one'"
  echo ""
  echo " That enables every application for the organization. To load a"
  echo " sample collection to look around, afterwards run:"
  echo ""
  echo "   docker compose exec backend python -m seeds.seed_demo_collection"
  echo "=============================================================="
  echo ""
fi

echo "Starting application with uvicorn..."
# --proxy-headers: trust X-Forwarded-{Proto,For,Host} from the reverse proxy so
# request.url, RedirectResponse, etc. emit the correct external scheme/host.
# UVICORN_FORWARDED_ALLOW_IPS should be the proxy CIDR; "*" is acceptable when
# the listening port is not exposed outside the trusted network.
exec uvicorn app.asgi:application \
    --host 0.0.0.0 \
    --port "${UVICORN_PORT:-8000}" \
    --workers "${UVICORN_WORKERS:-4}" \
    --log-level "${UVICORN_LOG_LEVEL:-info}" \
    --proxy-headers \
    --forwarded-allow-ips "${UVICORN_FORWARDED_ALLOW_IPS:-*}"
