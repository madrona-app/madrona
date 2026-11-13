import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';

/**
 * Object fields an organization can switch to strict vocabulary validation.
 * Keys match backend/app/services/vocabulary_validation.py.
 */
export type StrictVocabularyField =
  | 'object_type'
  | 'materials'
  | 'techniques'
  | 'subjects'
  | 'creators'
  | 'depicted_activities'
  | 'depicted_concepts'
  | 'associated_concepts';

export interface VocabularyValidationField {
  key: StrictVocabularyField;
  label: string;
  description: string;
  strict: boolean;
}

export const vocabularyValidationQueryKey = (orgId: string | undefined | null) =>
  ['vocabulary-validation', orgId] as const;

export function fetchVocabularyValidation(orgId: string): Promise<{ fields: VocabularyValidationField[] }> {
  return apiFetch(`/organizations/${orgId}/settings/vocabulary-validation`);
}

/**
 * Per-field strict vocabulary settings for an organization.
 * Readable by anyone who can view collections.
 */
export function useVocabularyValidation(orgId: string | undefined | null, enabled = true) {
  return useQuery({
    queryKey: vocabularyValidationQueryKey(orgId),
    queryFn: () => fetchVocabularyValidation(orgId as string),
    enabled: !!orgId && enabled,
    staleTime: 60_000,
  });
}

/** Whether a single field is strict (false while loading or on error). */
export function useIsStrictVocabularyField(
  orgId: string | undefined | null,
  field: StrictVocabularyField | undefined,
): boolean {
  const { data } = useVocabularyValidation(orgId, !!field);
  if (!field || !data) return false;
  return data.fields.some((f) => f.key === field && f.strict);
}
