# Madrona Frontend

React 19 + TypeScript 5.9 single-page application built with Vite.

## Tech Stack

- **Framework:** React 19 with React Router v7
- **Build:** Vite 7.3 (dual-entry: main app + admin dashboard)
- **Language:** TypeScript 5.9 (strict mode)
- **Styling:** Tailwind CSS 3.4 with custom institutional palette
- **State:** TanStack Query 5 (server), React Context (client), Zustand (uploads)
- **Icons:** Lucide React
- **Testing:** Vitest + Playwright + @testing-library/react

## Getting Started

```bash
# Install dependencies
pnpm install

# Start dev server (port 5173)
pnpm dev

# Or use the project-wide dev server manager from project root:
# ./dev-servers.sh start
```

## Scripts

```bash
pnpm dev          # Start Vite dev server with HMR
pnpm build        # Production build
pnpm preview      # Preview production build
pnpm test         # Run unit tests (Vitest)
pnpm test:e2e     # Run end-to-end tests (Playwright)
pnpm test:coverage # Run tests with coverage report
```

## Project Structure

```
frontend/src/
├── app/               # Route config, lazy page imports
├── components/        # Reusable UI components (~336 files)
│   ├── workspace/     # EditableField, WorkspaceSection, etc.
│   ├── collections/   # Collection-specific components
│   ├── dam/           # Digital asset management
│   ├── exhibit/       # Exhibition components
│   └── navigation/    # Sidebar, breadcrumbs, etc.
├── contexts/          # React contexts (Auth, Org, Theme, Toast, etc.)
├── hooks/             # Custom hooks (~35 files)
├── lib/               # Utilities, API client, config
├── pages/             # Route-level page components (~150 pages)
│   ├── collections/   # Collection object workspaces
│   ├── admin/         # Platform & org administration
│   └── ...            # discover, exhibit, guide, media, reports, etc.
├── test/              # Test files, fixtures, setup
└── types/             # Shared TypeScript type definitions
```

## Design System

Madrona uses a custom institutional color palette defined in `tailwind.config.js`. **Never use generic Tailwind colors** (green-500, blue-500, etc.). See `/CONVENTIONS.md` for the full palette and button classes.

Key tokens: `ink` (text), `parchment` (bg), `forest` (headers), `bark` (CTAs), `lichen` (borders), `archive` (muted text).

## Code Splitting

All pages are lazy-loaded via `React.lazy()` with direct file imports (no barrel imports) to preserve effective code splitting. See `src/app/lazyPages.ts`.

## Testing

- **Unit tests** in `src/test/` — Vitest with jsdom, @testing-library/react
- **E2E tests** in `e2e/` — Playwright browser tests
- **a11y tests** — vitest-axe integration via `src/test/a11y.ts`
- Coverage thresholds enforced in `vitest.config.ts`
