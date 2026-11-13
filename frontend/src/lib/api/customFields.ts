/** User-defined fields on object records. */
import { apiFetch } from './_utils';

export type CustomFieldType = 'text' | 'long_text' | 'number' | 'date' | 'boolean' | 'select' | 'multi_select' | 'url';

export interface CustomFieldDefinition {
  field_id: string;
  key: string;
  label: string;
  help_text: string | null;
  field_type: CustomFieldType;
  options: string[];
  is_required: boolean;
  is_searchable: boolean;
  is_public: boolean;
  section: string | null;
  sort_order: number;
  is_active: boolean;
  view_roles: string[];
  edit_roles: string[];
  can_edit?: boolean;
}

export type CustomFieldValues = Record<string, string | number | boolean | string[] | null>;

export const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  date: 'Date',
  boolean: 'Yes or no',
  select: 'One choice from a list',
  multi_select: 'Several choices from a list',
  url: 'Web address',
};

const base = (orgId: string) => `/organizations/${orgId}/collections/settings/custom-fields`;

export async function listCustomFields(orgId: string, includeInactive = false): Promise<CustomFieldDefinition[]> {
  const data = await apiFetch<{ items: CustomFieldDefinition[] }>(`${base(orgId)}?include_inactive=${includeInactive}`);
  return data.items;
}

export function createCustomField(orgId: string, body: Partial<CustomFieldDefinition>) {
  return apiFetch<CustomFieldDefinition>(base(orgId), { method: 'POST', body: JSON.stringify(body) });
}

export function updateCustomField(orgId: string, fieldId: string, body: Partial<CustomFieldDefinition>) {
  return apiFetch<CustomFieldDefinition>(`${base(orgId)}/${fieldId}`, { method: 'PUT', body: JSON.stringify(body) });
}

export function deactivateCustomField(orgId: string, fieldId: string) {
  return apiFetch<{ deactivated: boolean }>(`${base(orgId)}/${fieldId}`, { method: 'DELETE' });
}

export function saveObjectCustomFields(orgId: string, objectId: string, values: CustomFieldValues) {
  return apiFetch<{ custom_fields: CustomFieldValues }>(`/organizations/${orgId}/collections/objects/${objectId}`, {
    method: 'PUT',
    body: JSON.stringify({ custom_fields: values }),
  });
}
