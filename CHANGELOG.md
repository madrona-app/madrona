# Changelog

Notable changes to Madrona. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Breaking changes land only in a major version and are called out under
**Breaking**; [UPGRADING.md](UPGRADING.md#version-policy) says exactly which
surfaces that promise covers.

Upgrading an existing install: see [UPGRADING.md](UPGRADING.md). Back up your
database first; migrations run on boot and are not reversible.

## [1.0.0] — 2026-09-25

First public release. Madrona has been in use for some time; this is the point
it becomes software other people can run, and the version says so — 1.0 is a
statement about the product, not about how long the repository has been open.

The entries below record the work done in the run-up to opening the source.
Nobody is upgrading *from* anything, so read them as provenance rather than as
changes you need to act on.

### Added
- Published container images and a release workflow, so an install can run a
  version rather than a working tree (`docker-compose.release.yml`).
- `UPGRADING.md`, and this changelog.

### Changed
- **Every paginated list endpoint returns the same envelope.** All 82 of them
  now answer with `items` and `total`; before, the list arrived under 49
  different key names (`runs`, `objects`, `events`, `condition_reports`,
  `place_authorities`, …) and the count was variously `total`, `total_count` or
  absent. Seven endpoints returned the same list *twice* — once as `items` and
  once under a legacy name their own source called deprecated.

  This is the kind of change that is only free once. The REST API is the first
  thing UPGRADING.md's compatibility promise covers, so after 1.0.0 is
  published, renaming a response key is a major version. It was done now
  because now is the last moment it costs nothing.

  Endpoints that paginate by cursor keep `next_cursor`/`has_more` and have no
  `total`; page-based endpoints keep `page`. Only the names of the list and the
  count were unified, not each endpoint's pagination mechanism.
- A redundant `count` field (the length of the returned page, already available
  as `items.length`) was dropped from the nine endpoints that sent it.
- `GET /organizations/{id}/sla/events` took `limit` and `offset` but never
  reported a total, so a caller could page through it without knowing how far
  it went. It now returns `total` like every sibling.
- **Maps use OpenFreeMap by default.** Basemaps came from CARTO, which no
  longer serves its Positron and Dark Matter tiles anonymously — an install
  without a CARTO key got tiles with "API KEY REQUIRED" printed across them.
  The first replacement was OpenStreetMap's own `tile.openstreetmap.org`, which
  was the wrong answer twice over: the OSMF tile usage policy asks each
  application to identify itself with a `User-Agent` that a browser cannot set,
  those servers are donation-funded infrastructure for osm.org itself, and the
  tiles are light-only, so the dark map theme silently rendered light.

  OpenFreeMap needs no account or key, sets no usage limits, permits commercial
  use, and has a genuine dark style — so the dark theme renders dark for the
  first time. CARTO is still used when `VITE_CARTO_API_KEY` is set.

  Any theme can be repointed with `VITE_MAP_STYLE_LIGHT`, `VITE_MAP_STYLE_DARK`
  or `VITE_MAP_STYLE_STANDARD` — at a self-hosted OpenFreeMap instance, a
  Protomaps PMTiles file, or anything else that serves a MapLibre style
  document. An institution whose network may not reach a third party needs
  configuration for that, not a fork. These are compiled into the frontend
  bundle, so docker-compose passes them to the frontend image as build args and
  changing one needs that image rebuilt.

### Fixed
- **Six backend settings documented in `.env.example` never reached the API
  container.** compose declares no `env_file`, so every setting is listed per
  service, and a name that is not listed is inert with no error to say so.
  `AWS_REGION` was set for the workers and not the API, so the two signed S3
  URLs for different regions, which real S3 rejects. `MEDIA_CDN_URL` and `SMITHSONIAN_API_KEY` were in no service
  at all, so a configured CDN was ignored on the public discover pages.
  `MEDIACONVERT_ROLE_ARN` was worker-only, so the API reported video
  transcoding unavailable on a stack configured to do it. `SECURITY_CONTACT`
  and `AI_TAGGING_ENABLED` were likewise unreachable.
- **The agent nav catalog was missing from every container.** It lived at
  repository-root `shared/nav_catalog.json` and was resolved four directories
  up from its own module — the repository root in a checkout, but `/` in the
  image. The backend build context is `./backend`, so the file was never copied
  in and `load_nav_catalog()` raised `FileNotFoundError` for every agent
  navigation and playbook call in any Docker deployment, published image
  included. It now lives in the backend package beside the module that reads
  it, so the same path resolves in a checkout and in the image, and it ships
  without a bind mount. It is still generated from the frontend's
  `navigationConfig.ts` by the same snapshot test, which now writes it there.
- `WORKER_POLL_INTERVAL` and `WORKER_MAX_RETRIES` were documented and read by
  nothing: the poll interval was a literal at the only call site and the retry
  policy is a fixed exponential backoff. They are removed, and the surviving
  `WORKER_POLL_INTERVAL_SECONDS` is now actually read by the worker.
- The pipeline worker mounted the whole `backend/` directory over `/app`,
  shadowing the image with host source and pulling any `backend/.env` into the
  container — the hazard the backend service's own volume comment warns about.
- `/.well-known/security.txt` carried a hardcoded `Expires` of 2027-02-07,
  after which RFC 9116 says a consumer should ignore the file. It is computed a
  year ahead of the request.
- **Frontend configuration set in `.env` had no effect on a container
  deployment.** Vite compiles `VITE_*` values into the bundle, `.dockerignore`
  keeps `.env` out of the image, and the frontend Dockerfile declared no build
  args — so `VITE_API_BASE_URL`, `VITE_TUS_ENDPOINT` and the Sentry settings
  were documented knobs wired to nothing, failing silently because each one has
  a working default. All ten names the frontend reads now pass through as build
  args, and a test asserts the chain — source reads it, Dockerfile declares and
  exports it, compose passes it — so a new variable cannot be half-wired again.
  Changing any of them needs `docker compose build frontend`.
- Exhibition exports (elevation PDF, installation spec, object checklist)
  returned 500 for every exhibition. The shared loader queried a column that
  does not exist; floor plans reach an exhibition through a join table.
- Public discover search returned 500 instead of an empty page when the
  collections index had never been provisioned.
- Reindexing before provisioning let OpenSearch auto-create an index named
  after the write alias, which permanently broke alias creation and every
  subsequent search.
- Audio uploads: the module raised `NameError` on import wherever the optional
  `mutagen` dependency was absent, which is every default install.
- The dev API, the Vite proxy and the websocket URL disagreed about which port
  the backend listens on; all now use 8000.

### Removed
- The reports module — saved report definitions, schedules and their email
  delivery. It was routed but unreachable: no navigation entry and no link
  anywhere in the application. On-demand reports and document generation are
  unaffected.
- Three database schemas that never held a table (`dam`, `exhibit`,
  `reporting`). Existing databases keep them, empty; new ones do not get them.
