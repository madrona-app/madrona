import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { MadronaLoader } from './ui/MadronaLoader';

interface RequireAuthProps {
  children: React.ReactNode;
}

/**
 * RequireAuth - Route guard component
 *
 * Protects routes by requiring authentication.
 * - If loading: shows loading spinner
 * - If not authenticated: redirects to /sign-in
 * - If authenticated: renders children
 */
export function RequireAuth({ children }: RequireAuthProps): React.ReactElement {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone">
        <MadronaLoader variant="dots" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to sign-in, but save the location they were trying to go to
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
