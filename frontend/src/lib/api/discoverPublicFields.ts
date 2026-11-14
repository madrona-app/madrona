/**
 * Which standard object fields the public portal and public APIs publish.
 *
 * Backend: routers/collections_discover_public_fields.py and
 * services/public_object_fields.py (the allowlist). Locked fields are always
 * public; fields outside the allowlist are refused with a 422.
 */
import { z } from 'zod';
import { apiFetch, validate } from './_utils';

const PublicFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  group: z.string(),
  description: z.string(),
  default_public: z.boolean(),
  locked: z.boolean(),
  public: z.boolean(),
});
export type PublicField = z.infer<typeof PublicFieldSchema>;

const PublicFieldSettingsSchema = z.object({
  groups: z.array(z.object({ key: z.string(), label: z.string() })),
  fields: z.array(PublicFieldSchema),
  public_fields: z.array(z.string()),
  default_fields: z.array(z.string()),
  is_default: z.boolean(),
  never_public: z.array(z.object({ key: z.string(), label: z.string(), reason: z.string() })),
  additional_fields: z.array(z.object({ key: z.string(), label: z.string(), is_public: z.boolean() })),
});
export type PublicFieldSettings = z.infer<typeof PublicFieldSettingsSchema>;

function path(organizationId: string): string {
  return `/organizations/${organizationId}/collections/discover/public-fields`;
}

export async function getPublicFieldSettings(organizationId: string): Promise<PublicFieldSettings> {
  const data = await apiFetch(path(organizationId));
  return validate(PublicFieldSettingsSchema, data);
}

export async function savePublicFields(organizationId: string, publicFields: string[]): Promise<PublicFieldSettings> {
  const data = await apiFetch(path(organizationId), {
    method: 'PUT',
    body: JSON.stringify({ public_fields: publicFields }),
  });
  return validate(PublicFieldSettingsSchema, data);
}
