import { apiFetch, buildQueryString } from './_utils';
import type { FormLayoutDelta } from '../layout/resolveLayout';

/** A saved per-user layout variant (mirrors backend LayoutOverrideOut). */
export interface LayoutOverride {
  id: string;
  surface_key: string;
  object_type: string | null;
  name: string;
  delta: FormLayoutDelta;
  base_version: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LayoutSectionCatalogItem {
  id: string;
  label: string;
  group?: string | null;
  required?: boolean;
}

export async function listLayoutOverrides(
  params: { surfaceKey?: string; objectType?: string } = {}
): Promise<LayoutOverride[]> {
  const query = buildQueryString({
    surface_key: params.surfaceKey,
    object_type: params.objectType,
  });
  return apiFetch<LayoutOverride[]>(`/layout-overrides${query}`);
}

export async function createLayoutOverride(body: {
  surface_key: string;
  object_type?: string | null;
  name: string;
  delta: FormLayoutDelta;
  base_version?: string | null;
  make_active?: boolean;
}): Promise<LayoutOverride> {
  return apiFetch<LayoutOverride>('/layout-overrides', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateLayoutOverride(
  id: string,
  body: { name?: string; delta?: FormLayoutDelta }
): Promise<LayoutOverride> {
  return apiFetch<LayoutOverride>(`/layout-overrides/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function activateLayoutOverride(id: string): Promise<LayoutOverride> {
  return apiFetch<LayoutOverride>(`/layout-overrides/${id}/activate`, {
    method: 'POST',
  });
}

export async function deleteLayoutOverride(id: string): Promise<void> {
  await apiFetch<void>(`/layout-overrides/${id}`, { method: 'DELETE' });
}

/** Switch a surface back to the default layout (clears the active variant). */
export async function deactivateLayoutOverride(body: {
  surface_key: string;
  object_type?: string | null;
}): Promise<void> {
  await apiFetch<void>('/layout-overrides/deactivate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** AI-draft a delta from a natural-language instruction (preview, not saved). */
export async function suggestLayoutOverride(body: {
  surface_key: string;
  instruction: string;
  sections: LayoutSectionCatalogItem[];
}): Promise<FormLayoutDelta> {
  return apiFetch<FormLayoutDelta>('/layout-overrides/suggest', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
