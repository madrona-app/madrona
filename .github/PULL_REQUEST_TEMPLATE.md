## What this changes

<!-- What behaviour is different after this, and why it needed changing. -->

## How it was verified

<!-- What you ran, and what it said. "Tests pass" on its own is not much use —
     the suite has mocked whole libraries before and stayed green while the
     build failed. -->

- [ ] `cd backend && pytest` (PostgreSQL; `TEST_DATABASE_URL` set)
- [ ] `cd frontend && pnpm test:coverage`
- [ ] `cd frontend && pnpm build` — the bundle links, which the tests do not prove
- [ ] Checked in a running app, if it changes anything a user sees

## Checklist

- [ ] Commits are signed off (`git commit -s`) — see [DCO](../DCO)
- [ ] Touches row-level security, tenancy or permissions? Say so explicitly here
- [ ] Schema change? Migration included and applied against a real database
