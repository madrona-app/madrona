/**
 * Collection object exports for the staff interface.
 *
 * - CSV / Excel: POST /organizations/{org}/collections/export
 *   (backend app/fastapi_app/routers/collections_export.py)
 * - JSON-LD, many objects: POST /organizations/{org}/collections/export/jsonld
 * - JSON-LD, one object: GET /organizations/{org}/collections/objects/{id}/jsonld
 *   (backend app/fastapi_app/routers/lod_exports.py)
 *
 * All three are synchronous (no job queue): the response is the file.
 * Exports are capped at 10,000 objects by the backend.
 */
import { apiFetch } from './_utils';
import type { CollectionsSearchFilters } from '../schemas/entities';

/** Maximum objects in one export (backend MAX_EXPORT_ROWS). */
export const MAX_EXPORT_OBJECTS = 10_000;

/** Page size for JSON-LD bulk export (backend maximum). */
const JSONLD_PAGE_SIZE = 1000;

/** Which objects to export. Omit everything to export all objects. */
export type ObjectExportScope =
  | { kind: 'all' }
  | { kind: 'search'; query?: string; filters?: CollectionsSearchFilters }
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'selection'; objectIds: string[] };

export type ObjectExportFormat = 'csv' | 'excel' | 'jsonld';

function scopeBody(scope: ObjectExportScope): Record<string, unknown> {
  switch (scope.kind) {
    case 'all':
      return {};
    case 'search': {
      const search: Record<string, unknown> = {};
      if (scope.query) search.query = { q: scope.query };
      if (scope.filters && Object.keys(scope.filters).length > 0) search.filters = scope.filters;
      // No query and no filters is the whole collection: no scope needed.
      return Object.keys(search).length > 0 ? { search } : {};
    }
    case 'workspace':
      return { workspace_id: scope.workspaceId };
    case 'selection':
      return { object_ids: scope.objectIds };
  }
}

export interface ExportFile {
  blob: Blob;
  filename: string;
}

function datedName(base: string, ext: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${base}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.${ext}`;
}

/** Export collection objects as CSV or Excel. */
export async function exportCollectionObjectsTable(
  organizationId: string,
  format: 'csv' | 'excel',
  scope: ObjectExportScope,
): Promise<ExportFile> {
  const result = await apiFetch<Blob | string>(
    `/organizations/${organizationId}/collections/export`,
    {
      method: 'POST',
      body: JSON.stringify({ record_type: 'collection_objects', format, ...scopeBody(scope) }),
    },
  );
  const type =
    format === 'csv'
      ? 'text/csv'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const blob = result instanceof Blob ? result : new Blob([result], { type });
  return { blob, filename: datedName('collection-objects', format === 'csv' ? 'csv' : 'xlsx') };
}

interface JsonLdCollection {
  hasPart?: unknown[];
  numberOfItems?: number;
  totalItems?: number;
  [key: string]: unknown;
}

function parseJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/**
 * Export many objects as one JSON-LD Collection document. Requests pages of
 * 1,000 and merges them, up to the 10,000-object cap.
 */
export async function exportCollectionObjectsJsonLd(
  organizationId: string,
  scope: ObjectExportScope,
  onProgress?: (done: number, total: number | null) => void,
): Promise<ExportFile> {
  const body = scopeBody(scope);
  const parts: unknown[] = [];
  let first: JsonLdCollection | null = null;
  let offset = 0;
  // Unscoped exports have no totalItems; keep paging until a short page.
  for (;;) {
    const page = parseJson<JsonLdCollection>(
      await apiFetch(`/organizations/${organizationId}/collections/export/jsonld`, {
        method: 'POST',
        body: JSON.stringify({ ...body, limit: JSONLD_PAGE_SIZE, offset }),
      }),
    );
    if (!first) first = page;
    const items = page.hasPart ?? [];
    parts.push(...items);
    const total = typeof page.totalItems === 'number' ? page.totalItems : null;
    onProgress?.(parts.length, total);
    offset += JSONLD_PAGE_SIZE;
    if (items.length < JSONLD_PAGE_SIZE) break;
    if (total !== null && parts.length >= total) break;
    if (parts.length >= MAX_EXPORT_OBJECTS) break;
  }
  const doc = { ...(first ?? {}), hasPart: parts, numberOfItems: parts.length };
  delete (doc as JsonLdCollection).view;
  delete (doc as JsonLdCollection).totalItems;
  return {
    blob: new Blob([JSON.stringify(doc, null, 2)], { type: 'application/ld+json' }),
    filename: datedName('collection-objects', 'jsonld'),
  };
}

/** Export one object as JSON-LD. */
export async function exportObjectJsonLd(
  organizationId: string,
  objectId: string,
  objectNumber?: string | null,
): Promise<ExportFile> {
  const data = parseJson<unknown>(
    await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/jsonld`),
  );
  const safe = (objectNumber || objectId).replace(/[^A-Za-z0-9._-]+/g, '_');
  return {
    blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/ld+json' }),
    filename: `object-${safe}.jsonld`,
  };
}
