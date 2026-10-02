# API Module Structure

This directory is intended for domain-specific API modules that will be split from `api.ts`.

## Current Status

The API functions currently reside in the monolithic `../api.ts` file.
Future refactoring will incrementally move functions into domain-specific modules here.

## Planned Domain Modules

| Module | Description |
|--------|-------------|
| `collections.ts` | Collection objects, locations, movements, vocabulary |
| `media.ts` | Media uploads, derivatives, object media links |
| `procedure.ts` | Collections procedures (contacts, conditions, loans, etc.) |
| `flow.ts` | Runs, pipelines, connectors, datasets |
| `admin.ts` | Organizations, users, roles, settings |
| `search.ts` | Entity search, autocomplete |
| `relationships.ts` | Relationship definitions and entity relationships |
| `workspaces.ts` | Workspaces and workspace tasks |
| `reports.ts` | Reports |
| `exhibit.ts` | Exhibitions, venues, floor plans |

## Planned Usage Pattern

```typescript
// Domain-specific imports (future)
import { getCollectionObjects } from '@/lib/api/collections';

// Current pattern (api.ts)
import { getCollectionObjects } from '@/lib/api';
```

## Migration Guidelines

When splitting functions:
1. Move related functions to domain module
2. Add proper TypeScript types and schema imports
3. Export from domain module
4. Re-export from `api.ts` for backwards compatibility
5. Update imports in components incrementally
