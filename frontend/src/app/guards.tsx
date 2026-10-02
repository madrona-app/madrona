import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { QueryBoundary } from '../components/QueryBoundary';
import { MadronaLoader } from '../components/ui/MadronaLoader';
import { useAccessibleModal, getModalAriaProps } from '../hooks/useAccessibleModal';

// NOTE: LayoutWrapper lives in ./LayoutWrapper and is lazy-imported by
// routeConfig. Keeping it out of this file is what stops the authed shell
// graph (AppShell, sidebar, chat, etc.) from being hoisted into the shared
// chunk between main and admin entries. Do not re-add AppShell imports here.

// Hide the initial HTML loader
export const hideInitialLoader = () => {
  const loader = document.getElementById('initial-loader');
  if (loader) {
    loader.classList.add('fade-out');
    setTimeout(() => loader.remove(), 300);
  }
};

/** Minimal loading skeleton shown while lazy-loaded pages are fetched. */
export function PageLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <MadronaLoader label="Loading…" />
    </div>
  );
}

/** Route-group error boundary — isolates crashes to a single app section. */
export function RouteGroupBoundary({ name }: { name: string }) {
  return (
    <QueryBoundary sectionName={name}>
      <Outlet />
    </QueryBoundary>
  );
}

/**
 * Route guard that checks app subscription access before rendering child routes.
 * If the user's org doesn't have the app enabled, shows a blocking dialog
 * instead of rendering the page — the user may have other apps they can use.
 */
export function AppAccessGuard({ name, appKey }: { name: string; appKey: string }) {
  const { hasAppAccess, activeOrganizationId } = useAuth();
  const navigate = useNavigate();

  const hasAccess = hasAppAccess(appKey);

  const handleGoBack = () => {
    if (activeOrganizationId) {
      navigate(`/organizations/${activeOrganizationId}/home`, { replace: true });
    } else {
      navigate('/', { replace: true });
    }
  };

  if (!hasAccess) {
    return <AppAccessBlockedDialog appName={name} onGoBack={handleGoBack} />;
  }

  return (
    <QueryBoundary sectionName={name}>
      <Outlet />
    </QueryBoundary>
  );
}

function AppAccessBlockedDialog({
  appName,
  onGoBack,
}: {
  appName: string;
  onGoBack: () => void;
}) {
  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen: true,
    onClose: onGoBack,
    titlePrefix: 'app-access-blocked',
  });

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/40"
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        className="bg-parchment rounded-lg max-w-[460px] w-[90%] shadow-xl"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-lichen">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-semantic-warning/10 flex items-center justify-center">
              <Lock size={20} className="text-semantic-warning" />
            </div>
            <h2
              id={titleId}
              className="m-0 text-lg font-semibold text-ink font-serif"
            >
              {appName} is not available
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p
            id={descriptionId}
            className="m-0 text-sm text-archive leading-relaxed font-serif"
          >
            The {appName} application is turned off for your organization.
            An administrator can turn it back on under Admin → Applications;
            nothing has been deleted.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
          <button
            onClick={onGoBack}
            className="px-4 py-2 border-none rounded-sm text-sm font-serif text-parchment bg-bark hover:bg-bark/90 cursor-pointer transition-colors"
          >
            Go home
          </button>
        </div>
      </div>
    </div>
  );
}

/** 404 catch-all page for unmatched routes. */
export function NotFoundPage() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const homeHref = orgId ? `/organizations/${orgId}/home` : '/';
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <h1 className="text-2xl font-semibold text-ink mb-2">Page not found</h1>
      <p className="text-archive mb-6">The page you're looking for doesn't exist or has been moved.</p>
      <div className="flex gap-3">
        <button onClick={() => navigate(-1)} className="btn-secondary">
          Go back
        </button>
        <Link to={homeHref} className="btn-primary">Go home</Link>
      </div>
    </div>
  );
}

