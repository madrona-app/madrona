import { apiFetch } from '../apiClient';

export type GuideVerbosity = 'terse' | 'normal' | 'detailed';

/** A user's own (private) personalization for the Guide assistant. */
export interface GuidePreferences {
  instructions: string;
  verbosity: GuideVerbosity | null;
}

export function getGuidePreferences(): Promise<GuidePreferences> {
  return apiFetch<GuidePreferences>('/guide/preferences');
}

export function updateGuidePreferences(
  body: GuidePreferences,
): Promise<GuidePreferences> {
  return apiFetch<GuidePreferences>('/guide/preferences', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
