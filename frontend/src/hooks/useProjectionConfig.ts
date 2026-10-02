/**
 * Hook for fetching and caching organization projection configuration.
 *
 * This hook provides access to the org-level display field configuration
 * that controls how entity titles, subtitles, thumbnails, and snippets
 * are resolved across the application.
 *
 * Usage:
 *   const { config, isLoading } = useProjectionConfig();
 *   const displayFields = resolveDisplayFields(entity.payload, 'entity_detail', null, config);
 */

import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '../contexts/useOrganization';
import { getProjectionProfiles } from '../lib/api';
import type { ProjectionConfig } from '../lib/api';
import { getDefaultProjectionConfig } from '../lib/projectionResolver';

interface UseProjectionConfigResult {
  /** The effective projection config (org config or defaults) */
  config: ProjectionConfig;
  /** Whether the config is still loading */
  isLoading: boolean;
  /** Whether the org is using default config (no customization) */
  isDefault: boolean;
  /** Any error that occurred during fetch */
  error: Error | null;
}

/**
 * Fetch and cache the org-level projection configuration.
 *
 * Returns the org's custom config if set, otherwise returns system defaults.
 * The config is cached per organization and automatically invalidated when
 * the org changes.
 *
 * @param orgId - Optional org ID override (uses active org if not provided)
 * @returns Projection config and loading state
 */
export function useProjectionConfig(orgId?: string): UseProjectionConfigResult {
  const { activeOrganizationId } = useOrganization();
  const organizationId = orgId || activeOrganizationId;

  const {
    data,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['projection-profiles', organizationId],
    queryFn: () => getProjectionProfiles(organizationId!),
    enabled: !!organizationId,
    // Cache for 5 minutes - projection config rarely changes
    staleTime: 5 * 60 * 1000,
    // Keep in cache for 30 minutes
    gcTime: 30 * 60 * 1000,
  });

  // Return defaults while loading or if no org
  if (!organizationId || isLoading || error || !data) {
    return {
      config: getDefaultProjectionConfig(),
      isLoading: isLoading && !!organizationId,
      isDefault: true,
      error: error as Error | null,
    };
  }

  return {
    config: data.config,
    isLoading: false,
    isDefault: data.is_default,
    error: null,
  };
}

/**
 * Get the profile for a specific scope from the projection config.
 *
 * @param config - The projection config
 * @param scope - The scope to get (entity_detail, entities_list, search)
 * @returns The scope profile with paths for each role
 */
export function getScopeProfile(
  config: ProjectionConfig,
  scope: 'entity_detail' | 'entities_list' | 'search'
) {
  return config.profiles[scope];
}
