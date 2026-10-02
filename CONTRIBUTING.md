# Contributing to Madrona

Thanks for considering it. Madrona is collections software for museums,
archives and galleries, and the people who know what it should do are usually
the people using it — so bug reports and "this doesn't match how we actually
work" are as valuable here as patches.

## Before a large change

Open an issue first. Not as a formality: this is a multi-tenant application
with row-level security as its isolation boundary, and some changes that look
local are not. A short conversation ahead of the work saves you from building
something that has to be unpicked.

Small fixes — a typo, a clear bug, a failing edge case — just send them.

## Developer Certificate of Origin

Every commit must be signed off. Add `-s` to your commit:

```bash
git commit -s -m "fix: object exit blocked on a signed form that was present"
```

That appends a line:

```
Signed-off-by: Your Name <your.email@example.org>
```

It certifies the [Developer Certificate of Origin](DCO) — that you wrote the
patch, or have the right to submit it under the project's licence. It is a
statement about provenance, not an assignment: **you keep your copyright.**

This matters more than the ceremony suggests. Madrona is Apache-2.0 and the
copyright currently sits in one place. Contributions with clear provenance keep
it possible to answer licensing questions later without tracking down every
person who ever sent a patch. Projects that skipped this step are stuck with
whatever they chose years ago.

If you forgot the sign-off, `git commit --amend -s` on the last commit, or
`git rebase --signoff HEAD~N` for several, then force-push your branch.

## Setting up

The README's Quick Start gets you a running stack. In short:

```bash
cp .env.example .env          # then set a real SECRET_KEY, as the README says
docker compose up -d --build
docker compose exec backend python -m seeds.bootstrap_admin \
  --email you@example.org --password '<a strong password>' \
  --org-name "Your Museum" --platform-admin
```

## Tests

Both suites must pass. The backend is PostgreSQL-only — there is no SQLite
tier, because a flattened schema cannot model the schemas, JSONB or row-level
security this application depends on.

```bash
cd backend && TEST_DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/madrona_test pytest
cd frontend && pnpm test:coverage
```

Two things worth knowing, both learned the hard way:

**Run `pnpm build`, not just the tests.** Vitest resolves a missing named
export to `undefined`, so a test can assert broken behaviour and pass while the
production bundle fails to link. The build is the only thing that catches it.

**Run the backend suite the way CI does** (`pytest -n auto`) if you touch test
fixtures. Under xdist each worker gets its own database, and a test that builds
its own engine from `TEST_DATABASE_URL` will silently talk to a different
database than the one the fixtures prepared.

## Style

Match the surrounding code rather than a style guide — including comment
density. Comments here tend to explain *why*, especially where the obvious
approach was tried and failed; that context is worth preserving.

`CONVENTIONS.md` covers the engineering conventions. Pre-commit hooks handle
formatting.

## Commit messages

Say what changed and why it needed changing. If a fix is subtle, the message is
where the next person finds out what you knew. Conventional-commit prefixes
(`fix:`, `feat:`, `docs:`, `chore:`, `test:`) are used but not enforced.

## Security

Do not open a public issue for a vulnerability. [SECURITY.md](SECURITY.md) has
the reporting route.

## Licence and name

Contributions are under [Apache-2.0](LICENSE). The name is separate — see
[TRADEMARK.md](TRADEMARK.md). You can fork, modify and sell services around
Madrona; you just cannot call your product Madrona.
