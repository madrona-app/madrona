# Madrona Backend

Python 3.12 backend using FastAPI, SQLAlchemy 2.0, and Alembic.

## Prerequisites

- Python 3.12+
- PostgreSQL 16+
- Redis (for Celery task queue)

## Local Development Setup

```bash
# Create virtual environment
python3.12 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
cp .env.example .env
# Edit .env with your local configuration

# Run database migrations
./venv/bin/python -m alembic upgrade head

# Start development server
python run_dev.py
# Or use the project-wide dev server manager from project root:
# ./dev-servers.sh start
```

## Running with Docker

```bash
# From project root
docker-compose up backend
```

## Project Structure

```
backend/
├── app/
│   ├── fastapi_app/
│   │   ├── routers/         # API route handlers (~97 modules)
│   │   ├── serializers/     # Response serialization
│   │   ├── schemas/         # Pydantic request/response models
│   │   ├── middleware/       # CORS, CSRF, rate limiting, security headers
│   │   └── dependencies/    # Auth, DB session, permission checks
│   ├── models/              # SQLAlchemy 2.0 models (~257 models)
│   ├── connectors/          # Source/target data connectors
│   ├── services/            # Business logic (~171 service modules)
│   ├── celery_app.py        # Celery worker + beat config
│   ├── asgi.py              # FastAPI app factory
│   └── config.py            # Configuration
├── migrations/              # Alembic migrations (~313 revisions)
├── requirements.txt
└── Dockerfile
```

## API Documentation

Interactive API docs are available at `/api/_docs` (Swagger UI) when the server
is running. The OpenAPI schema is at `/api/openapi.json`.

The underscore is not a typo: `/api/docs` is a real endpoint of this API — the
page documentation routes in `app/fastapi_app/routers/reports_misc.py` — so
Swagger is mounted one path over to avoid shadowing it. See `app/asgi.py`.

`/api/openapi.json` is generated from the running application and is the only
OpenAPI document this project has. There is no checked-in spec file to keep in
step with it.

## Database Migrations

Migrations use [Alembic](https://alembic.sqlalchemy.org/) and run as the
DB **owner** role (which has `BYPASSRLS`).  The runtime app uses a separate
restricted role subject to Row-Level Security.

### Environment variables

| Variable | Used by | Role |
|---|---|---|
| `ALEMBIC_DATABASE_URL` | Alembic migrations & seeds | DB owner (`BYPASSRLS`) |
| `DATABASE_URL` | FastAPI app / Celery workers | App role (`NOBYPASSRLS`, RLS-enforced) |

In local dev both can point to the same superuser URL.  In staging/prod they
**must** differ — `ALEMBIC_DATABASE_URL` connects as the owner, `DATABASE_URL`
connects as the restricted app role.

### Common commands

```bash
# Run all pending migrations (always use venv python)
cd backend && ./venv/bin/python -m alembic upgrade head

# Create a new auto-generated migration
cd backend && ./venv/bin/python -m alembic revision --autogenerate -m "description_here"

# Check migration lint rules
make lint-migrations
```

### Writing data migrations

Migrations that **INSERT / UPDATE / DELETE** rows in org-scoped tables
(any table with an `organization_id` column protected by RLS) must:

1. Set `organization_id` explicitly on every row.
2. Add the marker comment `# MADRONA_MIGRATION_STRATEGY: owner` in the file
   so the lint check (`make lint-migrations`) passes.
3. **Never** use `SET LOCAL row_security = off` — this is a legacy pattern.

The migration template (`migrations/script.py.mako`) includes guidance
comments as a reminder.

## Architecture Notes

- FastAPI on ASGI, served by Uvicorn in every environment — `entrypoint.sh`
  execs `uvicorn app.asgi:application --workers ${UVICORN_WORKERS:-4}`, and
  that is the container's ENTRYPOINT, so dev and production run the same
  server. Gunicorn is not used and is not a dependency.
- All logs to stdout/stderr via structlog
- Environment variable configuration
- Celery + Redis for background tasks (5 named queues: default, ai, media, reports, search)
- Sentry integration for error tracking (optional, DSN-gated)
- Row-Level Security enforced per-session via PostgreSQL RLS policies
