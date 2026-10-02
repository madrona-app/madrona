import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from '../contexts/AuthContext';

/**
 * Hook to access auth context
 * 
 * @returns Auth context value with user, isLoading, and auth methods
 * @throws Error if used outside AuthProvider
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  
  return context;
}

/**
 * Hook to require authentication
 * 
 * Use this in components that require the user to be authenticated.
 * Returns user if authenticated, undefined if loading, null if not authenticated.
 * 
 * @returns User object or null/undefined
 */
export function useRequireAuth() {
  const { user, isLoading, isAuthenticated } = useAuth();
  
  if (isLoading) {
    return { user: undefined, isLoading: true, isAuthenticated: false };
  }
  
  if (!isAuthenticated) {
    return { user: null, isLoading: false, isAuthenticated: false };
  }
  
  return { user, isLoading: false, isAuthenticated: true };
}
