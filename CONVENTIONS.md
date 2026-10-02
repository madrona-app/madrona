# Madrona — Engineering Conventions

Conventions this codebase actually follows, with the reasoning where the
reasoning is not obvious. Most of these are enforced by lint rules or tests;
where they are not, they are still what reviewers will expect.

If you change a convention here, change it in the code and the enforcing rule
too — a convention documented in only one of the three places is worse than
none.

## Tooling

### Database Migrations (Alembic)

```bash
cd backend && ./venv/bin/python -m alembic upgrade head
cd backend && ./venv/bin/python -m alembic revision --autogenerate -m "description_here"
```

- Use `./venv/bin/python -m alembic`, not `alembic` directly — a bare `alembic`
  picks up whatever is on PATH rather than the project's pinned version.
- The virtualenv is `venv`, not `.venv`.

### Database roles and row-level security

The app runs a **two-role split**, and local development mirrors deployment so
row-level security is enforced while you work:
- `DATABASE_URL` → **`madrona_app`** (NOBYPASSRLS) — app runtime. RLS is ENFORCED.
- `ALEMBIC_DATABASE_URL` → **`madrona`** (owner, BYPASSRLS) — migrations + `admin_db_session`.

Never point the app at the owner role. It bypasses RLS and hides cross-tenant
bugs that then surface only once deployed. Roles/grants are provisioned by
`docker/postgres/init-db.sh` on first `docker compose up`. Cross-org
platform-admin handlers must use `_admin_db_dep` (owner), not `get_db`.

### Dev Servers

`./dev-servers.sh` at project root:
- `start` / `stop` / `status` / `api restart`
- Backend has hot-reload — no restart needed after code changes

### Frontend

- Package manager: **pnpm** (not npm)
- Icons: **lucide-react** (not @heroicons/react)
- Modals: native pattern with `useAccessibleModal` hook (not @headlessui/react)
- Type imports: `import type { X }` for type-only imports (Vite requirement)

---

## UI Design System

**Do not use generic Tailwind colors** (green-500, blue-500, amber-500, gray-*).
Use the Madrona palette below — the `no-generic-tailwind-colors` lint rule fails
the build otherwise.

### Colors

**Single source of truth: the `:root` block in `frontend/src/index.css`.** The
hexes below mirror those CSS variables — change a color there first, then update
this table. Never hardcode a hex in a component.

| Role | Token | Hex |
|------|-------|-----|
| Primary text | `ink` | #1C1C1A |
| Primary bg | `parchment` | #F7F4ED |
| Card bg (warm) | `parchment-warm` | #FCFAF4 |
| Borders, panels | `lichen` | #E6E4DF |
| Secondary bg | `stone` | #D9D6CE |
| Severity / high-density green | `moss` | #487252 |
| Muted text | `archive` | #63645E |
| WCAG gray text | `accessible-gray` | #545452 |
| Headers, nav | `forest` | #2B3A34 |
| CTAs, links | `bark` | #B0533A |
| Cool accent — info / selected / active (#14) | `azurite` | #3E5C76 |
| Hover only (<=5%) | `copper` | #B05A37 |
| AI/Studio accent (forest sidebar only) | `studio` | #DD9A72 |
| Success | `semantic-success` | #377046 |
| Warning | `semantic-warning` | #7E5E28 |
| Error | `semantic-error` | #9E3535 |
| Info | `semantic-info` | #4E6A86 |

### Button Classes

- `btn-primary` — bark bg, parchment text, copper hover
- `btn-secondary` — forest outline, fills on hover
- `btn-tertiary` — minimal, text only
- `btn-danger` — semantic-error bg

### Usability Conventions

- Focus: `focus-visible:ring-2 ring-bark/30 ring-offset-2` (not `focus:`)
- Text: `text-ink` / `text-archive` (muted) / `text-accessible-gray` (7:1) / `text-bark hover:text-copper-dark` (links — copper-dark is 6.56:1; plain `text-copper` is 4.38:1 and FAILS AA as text, reserve it for fills/icons)
- On dark backgrounds: `text-parchment`, not `text-white`
- Borders: `border-lichen` / empty: `border-dashed border-lichen`
- Hover: `hover:bg-stone` or `hover:bg-bark/10`
- Status: `bg-semantic-{level}/10 text-semantic-{level}`

---

## Workspace Page Patterns

Reference implementations: `ObjectEntryWorkspacePage.tsx`, `LoanInWorkspacePage.tsx`

### Structure Checklist

1. **Section Groups** — `PAGE_SECTION_GROUPS: SectionGroup[]` with id/label/icon/defaultExpanded/sections
2. **Section-to-Group Mapping** — `SECTION_GROUPS: Record<string, string>`
3. **Section IDs from config** — do not hand-maintain `sectionIds` arrays. Derive from `ALL_SECTION_IDS` (exported from types/constants) or extract from `PAGE_SECTION_GROUPS` at runtime. Use `ALL_SECTION_IDS` as the base, then filter conditionally (e.g. hide `nagpra` based on object type). This prevents nav/card drift.
4. **Card Ordering** — `getSectionOrder()` callback, groupOrder MUST match SECTION_GROUPS order
5. **Flex container** — `<div className="flex flex-col gap-4">`, not `space-y-4`,
   because CSS `order` needs a flex parent to take effect
6. **Section Group Dividers** — every nav group needs `<SectionGroupDivider>`, guarded by `useNewLayout`
7. **Record linkers** — use `RecordLinker` (a slide-over), not `ObjectSearchDialog`
8. **Contact Selectors** — `ContactSelectorSlideOver`, store `*_id` field only
9. **Right Rail** — media pages only. Actions go in header ellipsis `ActionMenu`
10. **Click-to-Edit** — `raisedSectionId` state + `handleEnterEditMode` via `onSectionNavigate`
11. **Tasks** — `CreateTaskSlideOver` wired through callbacks

### Workflow Render Order

For status-driven procedure pages, render in this exact order:
1. `WorkflowIndicator`
2. `ProcedureRequirementsCard` (merge formData + linkedData)
3. Alerts
4. `StatusBar`
5. `ReadOnlyBanner`
6. Sections with group dividers

Each procedure needs `procedure{Name}Requirements.ts` exporting: STATUS_ORDER, REQUIREMENT_GROUPS, computeCompliance(), canTransitionTo()

### Superseded — do not use in new code

- `ProcedureWorkflowGuide` (removed)
- Generic Tailwind colors (use Madrona palette above)
- `text-white` (use `text-parchment`)
- `ObjectSearchDialog` (use `RecordLinker`)
- `isEditing={false}` on `WorkspaceSection` — always pass `isEditing={isEditing}` so all cards match border styling
- `bg-bark/[0.02]` page-level edit tint — removed; section accordions handle edit-mode styling via their own borders
