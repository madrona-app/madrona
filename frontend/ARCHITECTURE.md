# Frontend Architecture

Madrona's frontend is a React 19 SPA built with Vite, using TypeScript throughout. It manages data pipelines that sync external sources into a canonical store.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 + TypeScript |
| Build | Vite |
| Routing | react-router-dom v7 |
| State/Data | TanStack Query (react-query) |
| Styling | Tailwind CSS |
| Icons | Lucide React, React Icons |
| Pipeline Visualization | React Flow |
| Drag & Drop | @dnd-kit |
| Validation | Zod |
| Real-time | Socket.IO client |

## Directory Structure

```
src/
├── App.tsx              # Route definitions and providers
├── main.tsx             # Entry point
├── index.css            # Tailwind + global styles
│
├── pages/               # Route-level components (one per route)
├── components/          # Reusable UI components
│   └── roles/           # Role management DnD components
│
├── contexts/            # React contexts for global state
├── hooks/               # Custom React hooks
├── lib/                 # Utilities, API client, helpers
├── types/               # TypeScript type definitions
│
├── mapping-engine/      # Standalone DSL for data transformations
└── test/                # Test utilities and fixtures
```

## Key Concepts

### Organization-Scoped Routes
All authenticated routes are scoped to an organization:
```
/organizations/:orgId/flow          # Pipeline visualization
/organizations/:orgId/runs          # Run history
/organizations/:orgId/datasets      # Dataset browser
/organizations/:orgId/search        # Entity search
/organizations/:orgId/setup/*       # Configuration pages
/organizations/:orgId/admin/*       # Admin pages
```

### Data Flow
1. **Connectors** link to external systems (databases, APIs, spreadsheets)
2. **Pipelines** define how data flows from sources into the canonical store
3. **Datasets** organize canonical entities by type
4. **Entities** are the normalized records in the canonical store
5. **Runs** are pipeline executions that sync data

## Contexts (`src/contexts/`)

| Context | Purpose |
|---------|---------|
| `AuthContext` | User authentication, permissions, active organization |
| `OrgContext` | Current organization data and switching |
| `WebSocketContext` | Real-time updates via Socket.IO |
| `TourContext` | Guided tour state (react-joyride) |
| `ToastContext` | Toast notifications |
| `ThemeContext` | Theme preferences |

## Hooks (`src/hooks/`)

| Hook | Purpose |
|------|---------|
| `useAuth` | Access auth context (user, permissions, logout) |
| `usePermissions` | Check user permissions (`hasPermission('runs.execute')`) |
| `useFlowData` | Pipeline visualization data for React Flow |
| `useFlowPreferences` | User's flow view preferences |
| `useSearch` | OpenSearch-powered entity search |
| `useRunUpdates` | WebSocket subscription for run status |
| `useTimezone` | Timezone formatting utilities |
| `useBreakpoint` | Responsive breakpoint detection |

## API Layer (`src/lib/`)

| File | Purpose |
|------|---------|
| `apiClient.ts` | Fetch wrapper with auth, CSRF, error handling |
| `api.ts` | Typed API functions (`getRuns`, `createPipeline`, etc.) |
| `schemas.ts` | Zod schemas for API responses |

### API Client Pattern
```typescript
// All API calls go through apiFetch which handles:
// - CSRF tokens
// - Credentials (HttpOnly cookies)
// - Error normalization
const data = await apiFetch('/organizations/{orgId}/runs');
```

### Type-Safe API Functions
```typescript
// api.ts exports typed functions that validate responses
const runs = await getRuns({ organization_id: orgId, status: 'running' });
// Returns validated PaginatedRuns type
```

## Component Patterns

### Page Components (`src/pages/`)
- One file per route
- Handle data fetching with `useQuery`
- Manage page-level state
- Compose smaller components

### Feature Components (`src/components/`)
- Reusable across pages
- Props-driven, minimal internal state
- Colocated with feature (e.g., `roles/RoleColumn.tsx`)

### Node Components (React Flow)
Pipeline visualization uses custom node types:
- `ConnectorSourceNode` - Source connector in flow
- `ConnectorDestinationNode` - Destination connector
- `DatasetNode` - Dataset representation
- `MadronaContainerNode` - The canonical store
- `MergeNode` - Data merge point

## State Management

**No Redux/Zustand** - state is managed via:

1. **TanStack Query** - Server state (API data, caching, refetching)
2. **React Context** - Global client state (auth, org, theme)
3. **Component State** - Local UI state (modals, forms, selections)
4. **URL State** - Filters, pagination via query params

### Query Key Conventions
```typescript
// Query keys follow [resource, scope, id, params] pattern
['runs', orgId]
['runs', orgId, runId]
['runs', orgId, { status: 'running', limit: 10 }]
```

## Permissions

Permissions are checked via the `usePermissions` hook:
```typescript
const { hasPermission } = usePermissions();
if (hasPermission('org.manage_members')) {
  // Show admin UI
}
```

Common permissions:
- `org.manage_members` - User/role management
- `runs.execute` - Trigger pipeline runs
- `pipelines.edit` - Modify pipeline configuration
- `platform.admin` - Platform-level administration

## Guided Tours

Tours use react-joyride, configured in `lib/tourSteps.ts`:
1. Add tour ID to `TOUR_IDS`
2. Define steps array with targets (`[data-tour="..."]`)
3. Add path mapping in `getTourIdFromPath`
4. Include `<GuidedTour tourId={...} />` in page component

## Mapping Engine (`src/mapping-engine/`)

Standalone TypeScript DSL for data transformations. Used by the backend for source-to-canonical mapping. Has its own documentation:
- `DSL_CONVENTIONS.md` - DSL syntax and patterns
- `HELPERS_README.md` - Helper function reference
- `FINALIZATION_API.md` - Output finalization

## Testing

```bash
npm test           # Run vitest
npm run test:ui    # Vitest UI
```

Tests are colocated or in `src/test/`. Uses:
- Vitest as test runner
- @testing-library/react for component tests
- happy-dom for DOM simulation

## Development

```bash
npm run dev        # Start dev server (default: localhost:5173)
npm run build      # Production build
npm run lint       # ESLint
npm run preview    # Preview production build
```

Environment variables (via `.env`):
- `VITE_API_BASE_URL` - Backend API URL
- `VITE_WS_URL` - WebSocket server URL

## Adding a New Feature

1. **New page**: Create in `pages/`, add route in `App.tsx`
2. **New API endpoint**: Add typed function in `lib/api.ts`
3. **New global state**: Create context in `contexts/`, wrap in `App.tsx`
4. **New permission**: Check with `usePermissions` hook
5. **New tour**: Add to `lib/tourSteps.ts`, include `GuidedTour` component
