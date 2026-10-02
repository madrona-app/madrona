import { useContext } from 'react';
import { OrgContext } from './orgContextTypes';
import type { OrgContextValue } from './orgContextTypes';

/**
 * Hook to access organization context.
 * Must be used within an OrgProvider.
 */
export function useOrganization(): OrgContextValue {
  const context = useContext(OrgContext);
  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrgProvider');
  }
  return context;
}
