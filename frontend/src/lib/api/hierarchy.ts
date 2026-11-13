/** Archival hierarchy (collection > series > box > folder > item) API. */
import { apiFetch } from './_utils';

export interface HierarchyNode {
  object_id: string;
  object_number: string | null;
  title: string;
  catalog_level: string | null;
  level_label: string | null;
  date: string | null;
  parent_object_id: string | null;
  sibling_order: number | null;
  child_count: number | null;
}

export interface HierarchyResponse {
  ancestors: HierarchyNode[];
  node: HierarchyNode;
  children: HierarchyNode[];
  children_total: number;
  limit: number;
  offset: number;
  levels: { value: string; label: string }[];
}

const base = (orgId: string, objectId: string) => `/organizations/${orgId}/collections/objects/${objectId}`;

export function getHierarchy(orgId: string, objectId: string, offset = 0, limit = 100) {
  return apiFetch<HierarchyResponse>(`${base(orgId, objectId)}/hierarchy?limit=${limit}&offset=${offset}`);
}

export function moveRecord(orgId: string, objectId: string, direction: 'up' | 'down') {
  return apiFetch<{ object_id: string; position: number; of: number }>(`${base(orgId, objectId)}/move`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
  });
}

export function setParent(orgId: string, objectId: string, parentId: string | null) {
  return apiFetch<HierarchyNode>(`${base(orgId, objectId)}/parent`, {
    method: 'PUT',
    body: JSON.stringify({ parent_object_id: parentId }),
  });
}

export function createChildRecord(
  orgId: string,
  parentId: string,
  body: { object_number: string; title: string; catalog_level: string },
) {
  return apiFetch<{ object_id: string }>(`/organizations/${orgId}/collections/objects`, {
    method: 'POST',
    body: JSON.stringify({
      object_number: body.object_number,
      object_name: body.title,
      catalog_level: body.catalog_level,
      parent_object_id: parentId,
      titles: [{ title: body.title, is_preferred: true }],
    }),
  });
}

/** Fetch the EAD3 finding aid (same auth as every API call) and save it. */
export async function downloadEad(orgId: string, objectId: string, filename: string) {
  const xml = await apiFetch<string>(`${base(orgId, objectId)}/ead`);
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** The usual next level down, for "add a record inside this one". */
export function nextLevel(level: string | null): string {
  const order = ['collection', 'series', 'subseries', 'box', 'folder', 'item'];
  if (level === 'subcollection') return 'series';
  if (level === 'file') return 'item';
  const i = order.indexOf(level ?? '');
  return i >= 0 && i < order.length - 1 ? order[i + 1] : 'item';
}
