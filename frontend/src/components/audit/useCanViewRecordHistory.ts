import { useContext } from 'react';
import { AuthContext } from '../../contexts/AuthContext';
import { RECORD_HISTORY_UI, historyPermissionsFor } from './recordHistoryRegistry';

/** True when the history API will answer this user for the record type. */
export function useCanViewRecordHistory(entityType: string): boolean {
  // Same rule as usePermissions().hasAllPermissions (platform admins pass
  // unless simulating a role), read from the context directly so a list
  // rendered outside the auth provider (embedded previews, isolated tests)
  // simply shows no History control instead of throwing.
  const auth = useContext(AuthContext);
  if (!auth) return false;
  if (auth.isPlatformAdmin && !auth.roleOverride) return true;
  const held = auth.user?.permissions ?? [];
  return historyPermissionsFor(entityType).every((p) => held.includes(p));
}

export function recordTypeLabel(entityType: string): string {
  return RECORD_HISTORY_UI[entityType]?.label ?? entityType.replace(/_/g, ' ');
}
