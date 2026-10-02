import React, { createContext, useState, useEffect, useCallback } from 'react';
import { apiFetch, fetchCsrfToken, ApiError, getRoleOverride, setRoleOverride as setApiRoleOverride } from '../lib/apiClient';
import { setSentryUser, clearSentryUser } from '../lib/sentry';
import { logger } from '../lib/logger';

// Types
export interface Organization {
  organization_id: string;
  name: string;
  slug: string;
  timezone: string;
  role: 'admin' | 'member' | 'owner';
  role_label: string;  // Display label from backend (e.g., "Data Engineer")
}

export interface Application {
  key: string;           // e.g., "bridge", "collections"
  display_name: string;  // e.g., "Bridge", "Collections"
  description?: string;
  icon?: string;         // Lucide icon name
  status: 'active' | 'coming_soon' | 'deprecated';
  enabled: boolean;      // Whether the org has access to this app
}

export interface DepartmentMembership {
  membership_id: string;
  department_id: string;
  department_name: string;
  department_code: string;
  department_color: string | null;
  role: string;
  is_primary: boolean;
}

export interface MfaFactors {
  totp: boolean;
  sms: boolean;
  email: boolean;
  preferred: 'totp' | 'sms' | 'email' | null;
}

export interface User {
  user_id: string;
  email: string;
  name: string;
  timezone?: string;
  locale?: string | null;  // BCP 47 locale tag (e.g. "fr-FR"); null = browser default
  avatar_url?: string | null;  // URL to user's profile picture
  active_organization_id: string | null;
  permissions: string[];  // User's permissions in active org (e.g., ["data.view", "runs.execute"])
  role_label: string | null;  // Display label for role in active org
  is_platform_admin?: boolean;  // Whether user has platform admin privileges
  role_override?: string | null;  // Active role override key (platform admin only)
  applications: Application[];  // Applications available to the org
  // Deployment capability (not per-org): false when AGENT_ENABLED is off,
  // in which case Guide is absent from `applications` too and the app
  // shows no Ask-Guide affordance at all.
  agent_enabled?: boolean;
  // Org setting: whether "Test Role" is permitted here. False means the
  // server ignores X-Role-Override, so the UI must not offer it.
  role_testing_enabled?: boolean;
  organizations: Organization[];
  department_memberships?: DepartmentMembership[];
  primary_department_id?: string | null;
  mfa_factors?: MfaFactors | null;  // Enrolled MFA factors; null if Cognito lookup failed
  mfa_available?: boolean;          // false under local password auth: no MFA provider
  ai_tagging_enabled?: boolean;     // deployment can auto-tag media
  transcription_enabled?: boolean;  // deployment can transcribe audio/video
}

export interface AuthContextValue {
  // State
  user: User | null;
  memberships: Organization[];
  applications: Application[];
  activeOrganizationId: string | null;
  isPlatformAdmin: boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: Error | null;

  // Role override (platform admin only)
  roleOverride: string | null;
  setRoleOverride: (role: string | null) => Promise<void>;

  // Helper methods
  hasAppAccess: (appKey: string) => boolean;

  // Actions
  refreshMe: () => Promise<void>;
  setActiveOrganization: (orgId: string) => Promise<void>;
  logout: () => Promise<void>;
}

// Create context
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Provider props
interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * AuthProvider - Manages authentication state with HttpOnly cookies
 * 
 * Features:
 * - Fetches user data on mount via GET /me
 * - Handles 401 responses (user not authenticated)
 * - Stores CSRF token in memory (not localStorage)
 * - Does NOT store tokens in localStorage (HttpOnly cookies only)
 * - All requests use credentials: include
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * GET /me to fetch current user and organization memberships
   */
  const refreshMe = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch CSRF token first (will be stored in memory)
      try {
        await fetchCsrfToken();
      } catch (csrfError) {
        logger.warn('[AuthContext] Failed to fetch CSRF token:', csrfError);
        // Continue anyway - CSRF is optional for GET requests
      }

      // Fetch current user (credentials included automatically)
      const userData = await apiFetch<User>('/me');
      setUser(userData);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Not authenticated - this is normal, not an error
        setUser(null);
        setError(null); // Clear any previous errors
      } else {
        // Other errors (network, server errors, etc.)
        logger.error('[AuthContext] Error fetching auth data:', err);
        const error = err instanceof Error ? err : new Error('Failed to load auth data');
        setError(error);
        setUser(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Set role override for platform admin permission testing.
   * Updates the API client header and re-fetches /me to get new permissions.
   */
  const setRoleOverride = useCallback(async (role: string | null) => {
    setApiRoleOverride(role);
    await refreshMe();
  }, [refreshMe]);

  /**
   * POST /me/active-organization to set active organization, then refresh
   */
  const setActiveOrganization = useCallback(async (orgId: string) => {
    try {
      await apiFetch('/me/active-organization', {
        method: 'POST',
        body: JSON.stringify({ organization_id: orgId }),
      });

      // Refresh user data to get updated active_organization_id
      await refreshMe();
    } catch (err) {
      logger.error('[AuthContext] Error setting active organization:', err);
      throw err;
    }
  }, [refreshMe]);

  /**
   * Logout user and clear session
   */
  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
      setUser(null);
    } catch (err) {
      logger.error('[AuthContext] Logout error:', err);
      // Clear user even if logout request fails
      setUser(null);
    }
  }, []);

  // Fetch auth data on app boot
  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  // Sync Sentry user context with auth state
  useEffect(() => {
    if (user) {
      setSentryUser(user.user_id, user.active_organization_id || undefined);
    } else {
      clearSentryUser();
    }
  }, [user]);

  /**
   * Check if the current organization has access to a specific application.
   *
   * Returns true if:
   * - No applications data available (pre-migration, default to allow)
   * - App is found and enabled with 'active' status
   */
  const hasAppAccess = useCallback((appKey: string): boolean => {
    // If no applications data, default to true (pre-migration compatibility)
    if (!user?.applications || user.applications.length === 0) {
      return true;
    }
    const app = user.applications.find(a => a.key === appKey);
    // If app not found in list, default to true (app might not be registered yet)
    if (!app) return true;
    return app.enabled === true && app.status === 'active';
  }, [user?.applications]);

  const value: AuthContextValue = {
    user,
    memberships: user?.organizations || [],
    applications: user?.applications || [],
    activeOrganizationId: user?.active_organization_id || null,
    isPlatformAdmin: user?.is_platform_admin || false,
    roleOverride: user ? (user.role_override || null) : getRoleOverride(),
    setRoleOverride,
    isLoading,
    isAuthenticated: !!user,
    error,
    hasAppAccess,
    refreshMe,
    setActiveOrganization,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
