import React from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getDefaultLandingPath } from '../hooks/useActiveProduct';
import { useOrganization } from '../contexts/useOrganization';
import { MadronaLoader } from '../components/ui/MadronaLoader';

// Redirect from /organizations/:orgId to the best enabled product
export function OrgDefaultRedirect() {
  const { orgId } = useParams<{ orgId: string }>();
  const { applications } = useAuth();
  return <Navigate to={getDefaultLandingPath(orgId!, applications)} replace />;
}

// Helper components to redirect to org-scoped routes
export function RedirectToOrg() {
  const { activeOrganizationId, isLoading, error } = useOrganization();
  const auth = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    // Redirect to sign-in if not authenticated
    if (!auth.isLoading && !auth.isAuthenticated) {
      navigate('/sign-in', { replace: true });
      return;
    }

    // Redirect to first enabled product if authenticated and org is loaded
    if (!auth.isLoading && !isLoading && activeOrganizationId) {
      navigate(getDefaultLandingPath(activeOrganizationId, auth.applications), { replace: true });
    }
  }, [auth.isAuthenticated, auth.isLoading, auth.applications, activeOrganizationId, isLoading, navigate, error]);

  if (auth.isLoading || isLoading) {
    return <MadronaLoader />;
  }

  if (!auth.isAuthenticated) {
    return null; // Will redirect via useEffect
  }

  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', color: 'var(--color-semantic-error)', marginBottom: '8px' }}>Error loading organizations</div>
          <div style={{ fontSize: '14px', color: 'var(--color-archive)' }}>{error.message}</div>
        </div>
      </div>
    );
  }

  if (!activeOrganizationId) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', color: 'var(--color-semantic-error)' }}>No organizations found</div>
        </div>
      </div>
    );
  }

  return null;
}

export function RedirectToOrgRuns() {
  const { activeOrganizationId, isLoading } = useOrganization();
  const auth = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      navigate('/sign-in', { replace: true });
      return;
    }

    if (!auth.isLoading && !isLoading && activeOrganizationId) {
      navigate(`/organizations/${activeOrganizationId}/runs`, { replace: true });
    }
  }, [auth.isAuthenticated, auth.isLoading, activeOrganizationId, isLoading, navigate]);

  if (auth.isLoading || isLoading) return <MadronaLoader />;
  if (!auth.isAuthenticated) return null;
  if (!activeOrganizationId) return <div role="alert" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-semantic-error)' }}>No organizations found</div>;
  return null;
}

export function RedirectToOrgSearch() {
  const { activeOrganizationId, isLoading } = useOrganization();
  const auth = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      navigate('/sign-in', { replace: true });
      return;
    }

    if (!auth.isLoading && !isLoading && activeOrganizationId) {
      navigate(`/organizations/${activeOrganizationId}/search`, { replace: true });
    }
  }, [auth.isAuthenticated, auth.isLoading, activeOrganizationId, isLoading, navigate]);

  if (auth.isLoading || isLoading) return <MadronaLoader />;
  if (!auth.isAuthenticated) return null;
  if (!activeOrganizationId) return <div role="alert" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-semantic-error)' }}>No organizations found</div>;
  return null;
}

// Redirect helpers for legacy global /work routes -> product-scoped work
export function getWorkProductSegment(): string {
  try {
    const lastProduct = localStorage.getItem('madrona_last_active_product');
    if (lastProduct === 'media') return 'media';
  } catch { /* ignore */ }
  return 'collections';
}

export function RedirectGlobalWork() {
  const { orgId } = useParams<{ orgId: string }>();
  const segment = getWorkProductSegment();
  return <Navigate to={`/organizations/${orgId}/${segment}/work`} replace />;
}

export function RedirectGlobalWorkWorkspaces() {
  const { orgId } = useParams<{ orgId: string }>();
  const segment = getWorkProductSegment();
  return <Navigate to={`/organizations/${orgId}/${segment}/work/workspaces`} replace />;
}

export function RedirectGlobalWorkWorkspaceDetail() {
  const { orgId, workspaceId } = useParams<{ orgId: string; workspaceId: string }>();
  const segment = getWorkProductSegment();
  return <Navigate to={`/organizations/${orgId}/${segment}/work/workspaces/${workspaceId}`} replace />;
}

export function RedirectGlobalWorkWorkspaceEdit() {
  const { orgId, workspaceId } = useParams<{ orgId: string; workspaceId: string }>();
  const segment = getWorkProductSegment();
  return <Navigate to={`/organizations/${orgId}/${segment}/work/workspaces/${workspaceId}/edit`} replace />;
}
