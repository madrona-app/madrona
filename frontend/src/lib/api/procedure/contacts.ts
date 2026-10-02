/**
 * Contacts API
 */
import { apiFetch, buildQueryString } from '../_utils';
import type {
  Contact,
  PaginatedContacts,
} from '../../schemas';

export async function getContacts(
  organizationId: string,
  params?: {
    q?: string;
    limit?: number;
    offset?: number;
    search?: string;
    contact_type?: string;
    is_active?: boolean;
  }
): Promise<PaginatedContacts> {
  const mappedParams: Record<string, unknown> = { ...params };
  if (params?.contact_type) {
    mappedParams.constituent_type = params.contact_type;
    delete mappedParams.contact_type;
  }
  if (params?.search) {
    mappedParams.q = params.search;
    delete mappedParams.search;
  }
  const query = buildQueryString(mappedParams);
  const data = await apiFetch(`/organizations/${organizationId}/collections/constituents${query}`);
  const constituents = data.items || [];
  return {
    contacts: constituents.map(_mapConstituentToContact),
    total: data.total ?? constituents.length,
    limit: data.limit ?? 50,
    offset: data.offset ?? 0,
  } as PaginatedContacts;
}

export async function getContact(
  organizationId: string,
  contactId: string
): Promise<Contact> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/constituents/${contactId}`);
  return _mapConstituentToContact(data);
}

/** Map a constituent API response to the Contact shape expected by procedure pages. */
function _mapConstituentToContact(c: Record<string, unknown>): Contact {
  return {
    contact_id: (c.constituent_id ?? c.contact_id) as string,
    organization_id: c.organization_id as string,
    contact_type: (c.constituent_type ?? c.contact_type ?? 'person') as Contact['contact_type'],
    name: (c.name ?? '') as string,
    title: (c.title ?? null) as string | null,
    first_name: (c.first_name ?? null) as string | null,
    last_name: (c.last_name ?? null) as string | null,
    role: (c.role ?? null) as string | null,
    organization_name: (c.organization_name ?? null) as string | null,
    department: (c.department ?? null) as string | null,
    email: (c.email ?? null) as string | null,
    phone: (c.phone ?? null) as string | null,
    phone_secondary: (c.phone_secondary ?? null) as string | null,
    website: (c.website ?? null) as string | null,
    address: (c.address ?? null) as Contact['address'],
    notes: (c.notes ?? null) as string | null,
    is_active: (c.is_active ?? true) as boolean,
    created_at: (c.created_at ?? '') as string,
    updated_at: (c.updated_at ?? null) as string | null,
  };
}

export async function createContact(
  organizationId: string,
  contact: Partial<Contact>
): Promise<Contact> {
  // Map contact_type -> constituent_type for the constituents API
  const body: Record<string, unknown> = { ...contact };
  if (contact.contact_type) {
    body.constituent_type = contact.contact_type;
    delete body.contact_type;
  }
  const data = await apiFetch(`/organizations/${organizationId}/collections/constituents`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return _mapConstituentToContact(data);
}

export async function updateContact(
  organizationId: string,
  contactId: string,
  updates: Partial<Contact>
): Promise<Contact> {
  const body: Record<string, unknown> = { ...updates };
  if (updates.contact_type) {
    body.constituent_type = updates.contact_type;
    delete body.contact_type;
  }
  const data = await apiFetch(`/organizations/${organizationId}/collections/constituents/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return _mapConstituentToContact(data);
}

export async function deleteContact(
  organizationId: string,
  contactId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/constituents/${contactId}`, {
    method: 'DELETE',
  });
}
