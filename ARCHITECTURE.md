# Madrona — architecture

This repo holds the **backend** and the **frontend** for Madrona.

This doc exists so contributors know which directory their next file belongs
in. The short version: one backend, several apps a tenant can enable, and a
persona system that decides what the AI Guide may do inside each request.

## Apps

An organization enables the apps it needs. Collections, Media, Content and
Bridge are the record-keeping apps; Guide is the AI layer that runs across
them, and Discover is the public-facing surface.

An organization with the Collections app gets the full staff Guide, which can
act over collection data. An organization without it still gets a Guide — it
answers from uploaded documents and the shared reference corpus, but it has no
collections to reach into. That difference is a configuration, not a separate
product, and it is expressed entirely through the persona system below.

## The partition: persona, not service boundary

Audiences are partitioned **inside each request**, not at the network. The same
`/api/guide/chat/*` endpoint serves all of them. `guide_chat.py` picks a
persona from the request context:

```python
# backend/app/fastapi_app/routers/guide_chat.py
persona = "staff" if guide_ctx.is_platform else "guide"
```

The persona determines what the model can do — its tool allowlist, its system
prompt, its delegation rights, its citation requirements. Persona policies live
in `backend/app/services/agent_persona.py`.

| Persona | Audience | Tools | Can delegate |
|---|---|---|---|
| `guide` | Organizations without the Collections app | `_GUIDE_TOOLS` — 5 RAG-only tools (`lookup_reference`, `lookup_museum_info`, `lookup_vocabulary_term`, `web_search`, `fetch_webpage`) | No |
| `staff` | Staff in an organization with Collections | `_STAFF_TOOLS` — full collection-aware set + draft creators + delegation | **Yes** |
| `visitor` | Public widget and visitor-guide viewers | `_VISITOR_TOOLS` — narrowest (museum info + web only) | No |
| `planner` | Internal (delegation target) | empty — produces plans, does not execute | No |
| `registrar` / `loans_registrar` / `conservator` / `rights_specialist` / `curator` | Internal (delegation target) | Per-specialist subset of `_STAFF_TOOLS` | No (recursion guard) |

**A non-staff persona cannot reach staff features.** Tool allowlists and
`can_delegate=False` enforce this in the agent service, not in the UI.
Multi-agent orchestration, draft creation, procedure workflows and collection
lookups are all gated to `staff`. The same endpoint serves every audience; the
persona switch is the entire difference.

That is the partition mechanism, and it is stronger than a service boundary
would be: capability is enforced at the LLM-call layer rather than at HTTP
routing, so it cannot be bypassed by reaching a different URL.

## Where new code goes

When you write **backend** code, ask which audience it serves:

| Audience | Lives in |
|---|---|
| Guide only | `app/fastapi_app/routers/guide_*.py`, `app/services/guide_*.py`, `app/tasks/guide_*.py` — document ingest, usage accounting, widget access. |
| Collections and the other record apps | `app/fastapi_app/routers/agent.py` (staff chat surface), `routers/agent_plans.py` / `agent_drafts.py` (orchestration), plus the collection / media / content / procedure routers. |
| Shared | `app/services/embedding_service.py`, `app/services/agent_service.py`, `app/services/agent_tools/`, models, auth, RLS, alembic migrations. |

Frontend code lives in `frontend/` — there is no second frontend repo.

## What is shared

- **Auth** — Cognito user pool, refresh-token cookie, CSRF middleware,
  `require_auth` / `require_guide_app` dependencies.
- **Org model** — `organizations`, `organization_memberships`,
  `organization_applications`. What an organization can do is determined by
  which applications are enabled; `is_platform` on the guide context means
  "does this org have the Collections app".
- **Agent runtime** — `agent_service.stream_response`, the tool registry (with
  savepoint isolation per tool call), SSE streaming, the citation validator.
  Persona is the dial.
- **Embedding service** — Voyage (`embedding_service.py`); one vector space for
  Guide retrieval and collections semantic search.
- **Retrieval corpus** — the `reference_chunks` table, holding Madrona's own
  workflow playbooks (global) and each organization's uploaded documents
  (org-scoped), queried through `lookup_reference`. Madrona ships no
  third-party standards corpus: it is Apache-2.0 and cannot grant redistribution
  rights those publishers withhold.
- **Database and migrations** — one Postgres, one alembic history.

## Why one backend

Splitting the Guide into its own service was considered and rejected.

- The data model is shared. `User`, `Organization`, `Application`,
  `Conversation`, `Message`, `ReferenceChunk`, `GuideDocument` are the same
  tables either way. Two services against one database is a coordination
  problem; two services against two databases makes a single user with
  memberships in both impossible without a federation layer.
- The agent runtime is shared. Splitting it either duplicates
  `agent_service.py`, the tool registry, the embedding service and the citation
  validator, or carves out a library that becomes a third thing to
  release-coordinate against.
- The persona partition is already stronger than a service boundary. Tool
  allowlists and `can_delegate` are enforced at the LLM-call layer; that does
  not get stricter by splitting, and splitting does not make it bypassable.

Divergence is handled by addition rather than subtraction: a table used by only
one code path still lives in the same database.

## Deployment

- **Backend and frontend** — the frontend is built into the backend image and
  served by nginx alongside the API.
- **Visitor widget** — served with permissive CORS so a museum's own site can
  embed it. CORS origins are configured in `app/config.py` →
  `cors_allowed_origins`.

## Related docs

- `CONVENTIONS.md` — UI design system, workspace page patterns, tooling conventions
