import React, { Suspense, useSyncExternalStore } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AppShell } from '../components/AppShell';
import { QueryBoundary } from '../components/QueryBoundary';
import { uploadStore } from '../contexts/uploadStore';
import { UploadProgressDrawer } from '../components/dam/UploadProgressDrawer';
import { PageLoadingFallback, hideInitialLoader } from './guards';

/**
 * Gate the upload drawer so it's only in the tree when there's actually
 * something to show. Subscribes directly to uploads.length (a stable
 * primitive, cheap for useSyncExternalStore) and returns null until an
 * upload starts. Previously the drawer mounted on every authed page and
 * did its empty-state early-return — still running useContext, useState,
 * and re-rendering on every state change. Now: zero mount until needed.
 */
function UploadDrawerGate() {
  const count = useSyncExternalStore(
    uploadStore.subscribe,
    () => uploadStore.getState().uploads.length,
    () => 0,
  );
  if (count === 0) return null;
  return <UploadProgressDrawer />;
}

/**
 * Authenticated layout shell.
 *
 * Extracted from guards.tsx and imported LAZILY from routeConfig.tsx so the
 * heavy transitive graph — AppShell, AppSidebar, MobileNavDrawer, navigation
 * chrome, contexts — stays off the main entry chunk. Without this split, a
 * static import from routeConfig.tsx made guards.tsx a shared chunk between
 * the main and admin entries, forcing both boots to download ~800 kB of
 * authed layout code, including on the sign-in page and the admin app
 * which doesn't even use LayoutWrapper.
 *
 * The top-level <Suspense> in routeConfig's <AppRoutes> catches suspension
 * while this chunk downloads on first navigation into an authed route.
 */
export function LayoutWrapper() {
  const auth = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      navigate('/sign-in', { replace: true });
    }
  }, [auth.isAuthenticated, auth.isLoading, navigate]);

  // Hide initial loader once auth check is complete
  React.useEffect(() => {
    if (!auth.isLoading) {
      hideInitialLoader();
    }
  }, [auth.isLoading]);

  if (auth.isLoading) return null;
  if (!auth.isAuthenticated) return null;

  return (
    <>
      <AppShell>
        <QueryBoundary sectionName="page">
          <Suspense fallback={<PageLoadingFallback />}>
            <Outlet />
          </Suspense>
        </QueryBoundary>
      </AppShell>
      {/* Drawer mounts only when uploads.length > 0 — until then the gate
          returns null and the whole upload UI is absent from the tree. */}
      <UploadDrawerGate />
    </>
  );
}

export default LayoutWrapper;
