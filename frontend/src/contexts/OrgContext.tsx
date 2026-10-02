import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { OrgContext } from './orgContextTypes';
import type { OrganizationMembership } from './orgContextTypes';
import { logger } from '../lib/logger';

// Re-export types for convenience
export type { OrganizationMembership, OrgContextValue } from './orgContextTypes';

const STORAGE_KEY = 'madrona.active_org_id';

export const OrgProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeOrganizationId, setActiveOrgId] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationMembership[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Get user data from AuthContext
  const auth = useAuth();

  const refreshOrganizations = useCallback(() => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Get organizations from auth context
      if (!auth.user) {
        setOrganizations([]);
        setActiveOrgId(null);
        setIsLoading(false);
        return;
      }
      
      // Map to OrganizationMembership format
      const memberships: OrganizationMembership[] = auth.user.organizations.map(org => ({
        organization_id: org.organization_id,
        organization_name: org.name,
        organization_slug: org.slug,
        organization_timezone: org.timezone || 'UTC',
        role: org.role,
      }));
      
      setOrganizations(memberships);
      
      // Initialize active organization
      if (memberships.length > 0) {
        // Prefer auth active_organization_id
        if (auth.user.active_organization_id) {
          setActiveOrgId(auth.user.active_organization_id);
          localStorage.setItem(STORAGE_KEY, auth.user.active_organization_id);
        } else {
          // Try to restore from localStorage
          const savedOrgId = localStorage.getItem(STORAGE_KEY);
          const savedOrgExists = savedOrgId && memberships.some(m => m.organization_id === savedOrgId);
          
          if (savedOrgExists) {
            setActiveOrgId(savedOrgId);
          } else {
            // Default to first organization
            const firstOrgId = memberships[0].organization_id;
            setActiveOrgId(firstOrgId);
            localStorage.setItem(STORAGE_KEY, firstOrgId);
          }
        }
      } else {
        logger.warn('[OrgContext] No organizations found');
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to load organizations');
      setError(error);
      logger.error('[OrgContext] Error loading organizations:', err);
    } finally {
      setIsLoading(false);
    }
  }, [auth.user]);

  const setActiveOrganizationId = useCallback(async (orgId: string) => {
    setActiveOrgId(orgId);
    localStorage.setItem(STORAGE_KEY, orgId);
    
    // Update active organization in auth context
    try {
      await auth.setActiveOrganization(orgId);
    } catch (err) {
      logger.error('[OrgContext] Failed to update active organization:', err);
    }
  }, [auth]);

  // Refresh when auth.user changes
  useEffect(() => {
    if (!auth.isLoading) {
      refreshOrganizations();
    }
  }, [auth.user, auth.isLoading, refreshOrganizations]);

  const activeOrganization = organizations.find(
    org => org.organization_id === activeOrganizationId
  ) || null;

  return (
    <OrgContext.Provider
      value={{
        activeOrganizationId,
        activeOrganization,
        organizations,
        setActiveOrganizationId,
        refreshOrganizations,
        isLoading,
        error,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}
