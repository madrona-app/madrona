/**
 * Organization search settings.
 *
 * Backend: routers/collections_search_settings.py and
 * services/deaccession_visibility.py. While hide_deaccessioned is on (the
 * default), staff search leaves deaccessioned records out unless asked for
 * them, and the public portal never shows them.
 */
import { z } from 'zod';
import { apiFetch, validate } from './_utils';

const DeaccessionedSearchSchema = z.object({ hide_deaccessioned: z.boolean() });

function path(organizationId: string): string {
  return `/organizations/${organizationId}/collections/settings/deaccessioned-search`;
}

export async function getHideDeaccessioned(organizationId: string): Promise<boolean> {
  const data = await apiFetch(path(organizationId));
  return validate(DeaccessionedSearchSchema, data).hide_deaccessioned;
}

export async function setHideDeaccessioned(organizationId: string, hide: boolean): Promise<boolean> {
  const data = await apiFetch(path(organizationId), {
    method: 'PUT',
    body: JSON.stringify({ hide_deaccessioned: hide }),
  });
  return validate(DeaccessionedSearchSchema, data).hide_deaccessioned;
}

export const hideDeaccessionedQueryKey = (organizationId: string | undefined) => [
  'search-settings', 'hide-deaccessioned', organizationId,
];
