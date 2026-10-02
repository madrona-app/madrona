<img src="docs/assets/banner.svg" alt="Madrona" width="360" height="118">

Madrona is a platform of partner apps for museums and cultural institutions. It provides procedure-driven collection management, digital asset management, a public website CMS, an AI-powered guide for staff and visitors, and a data integration layer for connecting external systems.

Organizations subscribe to individual apps and manage users with role-based access control. The platform is multi-tenant with PostgreSQL row-level security enforcing data isolation.

## Architecture

- **Backend**: Python 3.12, FastAPI, SQLAlchemy 2, Alembic, Celery
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS (custom Madrona design system)
- **Database**: PostgreSQL 16 with RLS, OpenSearch 2.19
- **Cache / Queue**: Redis (session cache, Celery broker)
- **Auth**: AWS Cognito (SSO/SAML), JWT + HttpOnly refresh cookies, RBAC with role inheritance
- **Storage**: S3-compatible (SeaweedFS by default); optional tus resumable uploads, off unless TUS_ENABLED
- **AI**: Anthropic Claude API, Ollama (local/RunPod serverless)
- **Infra**: Docker Compose, nginx, Uvicorn (ASGI, multi-worker)

## Applications

### Collections

Procedure-compliant collection management:

- **Cataloging** — Objects with titles, measurements, inscriptions, materials, classifications, and links to people and organizations
- **Transactions** — Object entries, acquisitions, loans in/out, exhibitions, object exits, deaccessions
- **Care & conservation** — Condition reports, conservation treatments, incident reports, valuations, insurance
- **Rights** — Reproduction rights, use requests, rights holders
- **Governance** — Collections reviews, audit campaigns, documentation plans, emergency plans
- **Locations** — Hierarchical location tree, movement tracking, object parts
- **Inventory** — Barcode labels, scanning, location reconciliation
- **Shipments** — Logistics, crates, transit legs

### Media

Digital asset management with IIIF support:

- Media library with folder organization and tagging
- AI-powered auto-tagging (CLIP), transcription (Whisper), OCR
- IIIF Image API and Presentation API 3.0
- Linked Open Data export (JSON-LD, Schema.org)
- Publishing workflows, rights management, download requests
- Lightboxes, workspaces, preservation tracking

### Guide

AI assistant with two deployment tiers:

- Staff conversations (schema-aware, collections context)
- Visitor conversations (public, anonymous, rate-limited)
- Database-backed system prompts (per-org customizable)
- MCP server for AI clients (Claude Desktop, Cursor, etc.)

### Bridge

Data integration pipelines:

- Source/target connectors (APIs, CSV, databases)
- Dataset management with schema evolution
- Pipeline execution with change detection
- Entity reconciliation and canonical store
- OpenSearch indexing

### Content

Public-facing CMS:

- Pages, blog posts, categories, menus
- Content blocks with rich text (Tiptap)
- Public discovery (filterable object/exhibition browse)
- SEO with server-side rendering support

### Discover

Public collection browser — share your collection with the world through a
customizable public website:

- Filterable public object and exhibition browse
- Per-organization theming and domain
- Opt-in per record, so nothing is published by accident

## Quick Start

### Prerequisites

- Docker and Docker Compose (for the quickstart above)
- Python 3.12+
- Node.js 20.19+ with pnpm (Vite 7 requires it)
- PostgreSQL 16
- Redis
- OpenSearch (optional, falls back to database search)
- Ollama (optional, for local AI)

### Local Development

```bash
# Backend
cd backend
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
./venv/bin/python -m alembic upgrade head

# Frontend
cd frontend
pnpm install

# Start all services
./dev-servers.sh start

# Check status
./dev-servers.sh status
```

Services started by `dev-servers.sh`:

| Service | Port | Notes |
|---------|------|-------|
| API (FastAPI/uvicorn) | 8000 | Hot-reload enabled |
| Vite (frontend) | 5174 | HMR enabled |
| Redis | 6379 | |
| OpenSearch | 9200 | Optional |
| Celery worker | — | Queues: default, ai, media, reports, search |
| Ollama | 11434 | Optional |

```bash
# Other commands
./dev-servers.sh stop
./dev-servers.sh logs
./dev-servers.sh api restart
```

### Docker

Copy the example environment file at the **repository root** — compose reads
only the root `.env`. (`backend/.env.example` is for running the backend
directly, outside Docker; compose never reads it.)

```bash
cp .env.example .env
```

Generate a `SECRET_KEY` and put it in `.env`. This step is not optional: the
shipped placeholder is rejected at startup, because booting with a key
published in this repository would mean anyone could forge a session.

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

```bash
docker compose up -d --build
```

Then open **http://localhost**. A fresh install has no account in it, so
you'll be sent to a setup page to create your organization and the first
administrator. That account is the instance operator: it gets platform-admin
and every application enabled.

The page is only available until the first organization exists — after that it
refuses, and the sign-in page is the way in.

There is a CLI equivalent for scripted installs, and for recovering an instance
whose admin password has been lost (it resets the password if the account
already exists):

```bash
docker compose exec backend python -m seeds.bootstrap_admin \
  --email you@example.org --password '<a strong password>' \
  --org-name "Your Museum" --platform-admin
```

#### Load the demo collection (optional)

To look around with real content instead of an empty install, load the sample
collection into your organization:

```bash
docker compose exec backend python -m seeds.seed_demo_collection
```

It adds about 150 cataloged objects with images, drawn from Met, Smithsonian
and Rijksmuseum open-access records, plus the reference data around them
(locations, contacts, vocabularies) and worked procedures: acquisitions,
loans, exhibitions, conservation and condition reports. Everything comes from
fixtures in this repository, so it needs no API keys and no network.

- It goes into the first organization it finds. Pass `--org-slug <slug>` to
  choose one.
- It takes a few minutes.
- It is **not idempotent**: running it twice adds every record twice. Load it
  into an organization you can throw away, not one holding your own data.

For development with hot reload:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## Environment Configuration

Key variables (see `.env.example` at the repository root for the full list):

| Variable | Required | Description |
|----------|----------|-------------|
| `SECRET_KEY` | Yes | JWT signing key |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | No | Redis connection string (defaults to the compose service) |
| `ANTHROPIC_API_KEY` | No | Claude API for Guide and AI features |
| `AWS_ACCESS_KEY_ID` | No | S3 media storage |
| `COGNITO_USER_POOL_ID` | No | AWS Cognito SSO |
| `OPENSEARCH_HOSTS` | No | Full-text search (falls back to ILIKE) |
| `SENTRY_DSN` | No | Error tracking |

## Authentication

Two providers, selected by `AUTH_PROVIDER`:

| Value | Behaviour |
|---|---|
| `local` | Passwords verified against a local bcrypt hash. No MFA — the endpoints return 501 and role-based MFA enforcement is skipped. |
| `cognito` | AWS Cognito, including TOTP MFA and the self-service recovery flow. |
| `auto` (default) | `cognito` when the Cognito variables are set, otherwise `local`. |

Self-hosters running the local provider own their own perimeter: put the
deployment behind an identity-aware proxy or VPN if you need a second factor.
MFA is not available without an identity provider.

## Project Structure

```
madrona/
├── backend/
│   ├── app/
│   │   ├── fastapi_app/
│   │   │   ├── routers/         # 103 route modules
│   │   │   ├── schemas/         # Pydantic request/response models
│   │   │   ├── dependencies/    # Auth, DB session injection
│   │   │   └── middleware/      # CSRF, rate limit, security headers
│   │   ├── models/              # 43 SQLAlchemy model files
│   │   ├── services/            # Business logic, AI, search
│   │   ├── serializers/         # JSON-LD, IIIF, URI resolution
│   │   ├── search/              # OpenSearch indexing and query
│   │   ├── tasks/               # Celery background jobs
│   │   └── config.py
│   ├── migrations/              # 46 Alembic migrations: consolidated baseline + changes since
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── components/          # Shared UI components
│   │   ├── pages/               # Route pages (admin, collections, media)
│   │   ├── lib/                 # API client, hooks, utilities
│   │   └── app/                 # Router config, guards, layout
│   ├── src/test/                # Vitest unit tests
│   └── tests/e2e/               # Playwright E2E
├── shared/                      # Cross-cutting generated artifacts (nav catalog)
├── docs/                        # README assets
├── docker/                      # PostgreSQL, OpenSearch configs
├── dev-servers.sh               # Local service orchestration
├── docker-compose.yml           # Production compose
├── docker-compose.dev.yml       # Development override
├── docker-compose.staging.yml   # Staging override
└── CONVENTIONS.md               # Engineering conventions
```

## Testing

The backend suite is PostgreSQL-only — `TEST_DATABASE_URL` is required and
`pytest` exits immediately without it. There is no SQLite tier; the adapter
that provided one was removed because it flattened schemas and diverged from
production behaviour.

```bash
cd backend
source venv/bin/activate
TEST_DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/madrona_test pytest
```

`tests/postgres/` is one subdirectory among many, holding the structural
guards (RLS coverage, schema round-trips) alongside ordinary API tests. It is
not a separate integration tier — the whole suite needs Postgres.

```bash
cd frontend
pnpm test              # Vitest
pnpm test:coverage     # with coverage thresholds enforced
pnpm test:e2e          # Playwright; starts its own Vite server
```

## Database Migrations

The backend container applies migrations on boot, so a normal deployment needs
none of these commands. They are here for development.

```bash
cd backend

# Apply migrations
./venv/bin/python -m alembic upgrade head

# Generate a new migration
./venv/bin/python -m alembic revision --autogenerate -m "description_here"
```

## Upgrading an existing install

Back up the database first — migrations run automatically when the backend
starts and are not reversible. [UPGRADING.md](UPGRADING.md) has the procedure;
[CHANGELOG.md](CHANGELOG.md) has what changed.

```bash
export MADRONA_VERSION=v1.0.0
docker compose -f docker-compose.yml -f docker-compose.release.yml pull
docker compose -f docker-compose.yml -f docker-compose.release.yml up -d
```

Pin to a tag in production. `main` carries unreleased work.

## Key Design Decisions

- **Multi-tenant via RLS**: Every authenticated request sets `app.current_organization_id` on the PostgreSQL session. Row-level security policies filter data at the database layer.
- **Museum procedures**: Transaction workflows (loans, acquisitions, entries, etc.) with status-driven validation and approval gates.
- **IIIF-native media**: All media serves IIIF Image API and Presentation API manifests. Linked Open Data export uses Schema.org JSON-LD.
- **Workspace pages**: Entity detail pages follow a consistent pattern with section groups, click-to-edit, and record linkers. See `CONVENTIONS.md` for the checklist.
- **Role inheritance**: Roles form an inheritance chain (viewer < publisher < curator < registrar < admin). Permissions are OR-resolved across the chain.
- **HttpOnly auth**: Access tokens are short-lived JWTs (15 min). Refresh tokens are HttpOnly cookies hashed in the database. No tokens in localStorage.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for third-party
attributions.

The code is free; the name is not. You can fork, modify, host and sell services
around Madrona without asking. You cannot call your product Madrona — but you
can say it is powered by, built on, or compatible with it. See
[TRADEMARK.md](TRADEMARK.md), which exists to tell you where that line is rather
than to make you guess.
