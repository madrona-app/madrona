# Upgrading Madrona

Madrona applies database migrations **automatically when the backend container
starts**. That makes upgrading simple and makes backing up first
non-negotiable: by the time the container is healthy, your schema has already
changed, and there is no supported way back.

```
back up  →  pull the new version  →  start  →  verify
```

## Before you start

**Back up the database.** This is the only step that cannot be undone later.

```bash
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-madrona}" -Fc "${POSTGRES_DB:-madrona}" \
  > madrona-$(date +%Y%m%d-%H%M).dump
```

Keep it somewhere that is not the server you are upgrading.

**Back up your uploaded files** if you use the bundled object store rather
than S3. They live in the `seaweedfs_data` volume:

```bash
docker run --rm -v madrona_seaweedfs_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/madrona-media-$(date +%Y%m%d-%H%M).tar.gz -C /data .
```

You do **not** need to back up OpenSearch. It is a derived index and can be
rebuilt from the database; a fresh instance will be empty until you reindex.

**Read the release notes** for the version you are moving to, and for any
version you are skipping over. Skipping releases is supported — migrations run
in order — but the notes are where breaking changes are called out.

## Upgrading

### Running published images (recommended)

```bash
export MADRONA_VERSION=v1.1.0

docker compose -f docker-compose.yml -f docker-compose.release.yml pull
docker compose -f docker-compose.yml -f docker-compose.release.yml up -d
```

Do not pass `--build`. The base compose file still carries `build:` stanzas, so
`--build` would compile from your working tree and ignore the version you
just pulled.

### Building from source

```bash
git fetch --tags
git checkout v1.1.0
docker compose up -d --build
```

Check out a **tag**, not `main`. `main` carries unreleased work that has not
been through a release's verification.

## What happens on start

The backend entrypoint, before serving traffic:

1. `alembic upgrade head` — applies every migration your database has not seen.
2. Re-seeds row-level security policies and app-role grants. Both are
   idempotent, and they run on every boot on purpose: RLS is what keeps one
   organization's records invisible to another, and it is re-asserted rather
   than assumed.

The container will not report healthy until this finishes. On a large database
a migration can take minutes; watch it rather than guessing:

```bash
docker compose logs -f backend
```

## Verifying

```bash
# Schema is at the newest revision
docker compose exec backend python -m alembic current

# API is up
curl -fsS http://localhost/health && echo OK
```

Then sign in and open a collection object. If search results are empty after an
upgrade, reindex — the search index schema can change between versions, and
OpenSearch data is not carried forward by a migration. Reindexing is per
organization, over the API:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost/api/organizations/$ORG_ID/collections/search/reindex
```

The entity index has a separate CLI:

```bash
docker compose exec backend python scripts/search_admin.py reindex
```

## If something goes wrong

**Migrations are not reversible in practice.** Alembic downgrades exist for some
revisions and are not tested as an upgrade path; treat them as a development
tool, not a recovery plan. To go back:

```bash
docker compose down
docker volume rm madrona_postgres_data
docker compose up -d postgres      # recreates an empty volume
docker compose exec -T postgres \
  pg_restore -U "${POSTGRES_USER:-madrona}" -d "${POSTGRES_DB:-madrona}" --clean \
  < madrona-YYYYMMDD-HHMM.dump
```

Then start the previous version's images.

This is why the backup is first and why it is not optional.

## Version policy

[Semantic Versioning](https://semver.org/spec/v2.0.0.html). A major version is
the only place a breaking change lands, and the release notes say so plainly
when one does.

What that promise covers — the surface you can build against:

- **The REST API.** Endpoints are not removed or given incompatible responses
  in a minor version.
- **Database migrations.** `alembic upgrade head` carries your data forward
  from any earlier 1.x.
- **The container and compose contract.** Service names, ports, volumes.
- **Environment variables.** An existing variable does not change meaning;
  new ones get defaults that preserve current behaviour.

What it does not cover, so that ordinary work does not force a major bump:

- Python modules under `app.*`. Import them at your own risk — they are
  internal, and refactoring them is not a breaking change.
- The database schema as seen directly. Read it through the API; migrations
  reshape tables freely.
- Anything marked experimental in the release notes.

Pin to a tag in production and upgrade deliberately. `latest` is a convenience
for evaluation, not a deployment strategy.
