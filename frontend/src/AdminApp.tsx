import React from 'react';
import { BrowserRouter, Routes, Route, Outlet, NavLink } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './hooks/useAuth';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NotFoundPage } from './app/guards';
import { QueryBoundary } from './components/QueryBoundary';
import {
  BarChart3,
  Building2,
  HardDrive,
  MessageSquare,
  Package,

  ScrollText,
  Sparkles,
  Users,
  LayoutDashboard,
  LogOut,
  Settings,
  Server,
} from 'lucide-react';

// Admin pages
import {
  AppSubscriptionsPage,
  BulkUserImportPage,
  GuideAnalyticsPage,
  LogsPage,
  OrganizationsPage,
  OrganizationUsersPage,
  ProvisioningJobDetailPage,
  ProvisioningJobsListPage,
  ServerManagementPage,

  SystemPromptsPage,
} from './pages/admin';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Hide the initial HTML loader
const hideInitialLoader = () => {
  const loader = document.getElementById('initial-loader');
  if (loader) {
    loader.classList.add('fade-out');
    setTimeout(() => loader.remove(), 300);
  }
};

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/organizations', icon: Building2, label: 'Organizations' },
  { to: '/provision-jobs', icon: Sparkles, label: 'Provisioning Jobs' },
  { to: '/subscriptions', icon: Package, label: 'App Subscriptions' },

  { to: '/logs', icon: ScrollText, label: 'Audit Logs' },
  { to: '/bulk-import', icon: Users, label: 'Bulk Import' },
  { to: '/guide-analytics', icon: BarChart3, label: 'Guide Analytics' },
  { to: '/system-prompts', icon: MessageSquare, label: 'System Prompts' },
  { to: '/server', icon: Server, label: 'Server Management' },
];

function AdminLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen bg-forest">
      <a href="#admin-main" className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-4 focus-visible:left-4 focus-visible:z-50 focus-visible:px-4 focus-visible:py-2 focus-visible:bg-parchment focus-visible:text-ink focus-visible:rounded focus-visible:shadow-lg">Skip to main content</a>
      {/* Sidebar */}
      <aside className="w-64 flex flex-col border-r border-forest" aria-label="Admin navigation">
        <div className="p-4 border-b border-forest">
          <h1 className="text-xl font-bold text-parchment">Madrona Admin</h1>
          <p className="text-sm text-archive">Internal Tools</p>
        </div>

        <nav className="flex-1 p-2 overflow-y-auto" aria-label="Admin tools">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg mb-1 transition-colors ${
                  isActive
                    ? 'bg-forest text-parchment'
                    : 'text-stone hover:bg-forest hover:text-parchment'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-forest">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-forest flex items-center justify-center text-sm font-medium text-parchment">
              {user?.name?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-parchment truncate">{user?.name}</p>
              <p className="text-xs text-archive truncate">{user?.email}</p>
            </div>
            <button
              onClick={() => logout()}
              className="p-2 text-archive hover:text-parchment rounded-lg hover:bg-forest"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main id="admin-main" className="flex-1 overflow-auto app-canvas-bg">
        <QueryBoundary sectionName="Admin">
          <Outlet />
        </QueryBoundary>
      </main>
    </div>
  );
}

function OrgDetailWrapper() {
  return (
    <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div className="px-4 py-6 sm:px-0">
        <Outlet />
      </div>
    </div>
  );
}

function AdminDashboard() {
  const { data: stats } = useQuery({
    queryKey: ['admin-dashboard-stats'],
    queryFn: async () => {
      const res = await fetch('/api/admin/dashboard-stats', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },
  });

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-lg font-semibold text-ink">Dashboard</h1>
        <p className="text-archive">Platform overview and key metrics</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Organizations"
          value={stats?.organizations ?? '-'}
          description="Active tenants"
          icon={Building2}
        />
        <StatCard
          title="Total Storage"
          value={stats?.storage ?? '-'}
          description="Across all orgs"
          icon={HardDrive}
        />
        <StatCard
          title="Platform Users"
          value={stats?.users ?? '-'}
          description="All organizations"
          icon={Users}
        />
      </div>

      <div className="bg-parchment rounded-lg border border-lichen p-6">
        <h2 className="text-lg font-semibold text-ink mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickAction to="/organizations" icon={Building2} label="Manage Orgs" />

          <QuickAction to="/logs" icon={ScrollText} label="View Logs" />
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, description, icon: Icon }: {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="bg-parchment rounded-lg border border-lichen p-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-lichen flex items-center justify-center">
          <Icon size={24} className="text-accessible-gray" />
        </div>
        <div>
          <p className="text-sm text-archive">{title}</p>
          <p className="text-2xl font-semibold text-ink">{value}</p>
          {description && (
            <p className="text-xs text-archive mt-1">{description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickAction({ to, icon: Icon, label }: {
  to: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      className="flex flex-col items-center gap-2 p-4 rounded-lg border border-lichen hover:border-stone hover:bg-stone/30 transition-colors"
    >
      <Icon size={24} className="text-accessible-gray" />
      <span className="text-sm text-ink">{label}</span>
    </NavLink>
  );
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, isPlatformAdmin } = useAuth();

  React.useEffect(() => {
    if (!isLoading) {
      hideInitialLoader();
    }
  }, [isLoading]);

  if (isLoading) {
    return null; // HTML loader handles this
  }

  if (!isAuthenticated) {
    // Redirect to main app sign-in. The admin app is a second entry of the
    // same build served from the same origin (/admin), so the path is
    // relative — a VITE_MAIN_APP_URL absolute base isn't needed and its
    // localhost fallback leaked into deployed builds. `redirect` (a path,
    // not a URL) is the param SignInPage validates via safeRedirect — the
    // same convention nginx uses for gated paths.
    const returnPath = window.location.pathname + window.location.search + window.location.hash;
    window.location.href = `/sign-in?redirect=${encodeURIComponent(returnPath)}`;
    return null;
  }

  if (!isPlatformAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-lichen">
        <div className="text-center max-w-md mx-4">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-semantic-error/10 flex items-center justify-center">
            <Settings size={32} className="text-semantic-error" />
          </div>
          <h1 className="text-2xl font-bold text-ink mb-2">Access Denied</h1>
          <p className="text-accessible-gray mb-4">
            This application is restricted to platform administrators.
          </p>
          <a
            href="/"
            className="text-bark hover:text-copper-dark"
          >
            Return to main application
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function AdminApp() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <BrowserRouter basename="/admin">
                <Routes>
                  <Route
                    element={
                      <RequireAdmin>
                        <AdminLayout />
                      </RequireAdmin>
                    }
                  >
                    <Route index element={<AdminDashboard />} />
                    <Route path="organizations" element={<OrganizationsPage />} />
                    <Route path="provision-jobs" element={<ProvisioningJobsListPage />} />
                    <Route path="provision-jobs/:jobId" element={<ProvisioningJobDetailPage />} />
                    <Route path="organizations/:orgId/admin/*" element={<OrgDetailWrapper />}>
                      <Route path="users" element={<OrganizationUsersPage />} />
                      <Route path="app-subscriptions" element={<AppSubscriptionsPage />} />
                    </Route>
                    <Route path="subscriptions" element={<AppSubscriptionsPage />} />
                    <Route path="logs" element={<LogsPage />} />
                    <Route path="bulk-import" element={<BulkUserImportPage />} />
                    <Route path="guide-analytics" element={<GuideAnalyticsPage />} />
                    <Route path="system-prompts" element={<SystemPromptsPage />} />
                    <Route path="server" element={<ServerManagementPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Routes>
              </BrowserRouter>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default AdminApp;
