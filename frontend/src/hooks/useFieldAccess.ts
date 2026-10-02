import { useMemo, useCallback } from 'react';
import { useAuth } from './useAuth';

/**
 * Hook that reads `_restricted_fields` from an API response
 * and provides helpers to check if specific fields are restricted.
 *
 * Platform admins bypass all field restrictions (unless simulating a lower role).
 */
export function useFieldAccess(restrictedFields: string[] | undefined) {
  const { isPlatformAdmin, roleOverride } = useAuth();
  const bypassAll = isPlatformAdmin && !roleOverride;

  const restrictedSet = useMemo(
    () => new Set(restrictedFields ?? []),
    [restrictedFields]
  );

  const isRestricted = useCallback(
    (fieldPath: string) => {
      if (bypassAll) return false;
      return restrictedSet.has(fieldPath);
    },
    [restrictedSet, bypassAll]
  );

  return { isRestricted, hasRestrictions: bypassAll ? false : restrictedSet.size > 0 };
}
