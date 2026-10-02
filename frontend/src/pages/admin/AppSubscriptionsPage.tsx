import { useState, useEffect } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { AppWindow, Building2, Check, X, Search, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';
import { getDefaultLandingPath } from '../../hooks/useActiveProduct';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

interface Application {
  application_id: string;
  key: string;
  display_name: string;
  description: string | null;
  icon: string | null;
  status: 'active' | 'coming_soon' | 'deprecated';
  default_enabled: boolean;
  requires_contract: boolean;
  sort_order: number;
}

interface OrgApplication {
  application_id: string;
  key: string;
  display_name: string;
  status: string;
  enabled: boolean;
  enabled_at: string | null;
  enabled_by: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
}

interface Organization {
  organization_id: string;
  name: string;
  slug: string;
}

interface OrgWithApps extends Organization {
  applications: OrgApplication[];
}

export default function AppSubscriptionsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user, refreshMe, activeOrganizationId, applications: authApplications } = useAuth();
  const queryClient = useQueryClient();

  const [applications, setApplications] = useState<Application[]>([]);
  const [organizations, setOrganizations] = useState<OrgWithApps[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [toggling, setToggling] = useState<string | null>(null); // org_id:app_key

  // Check for platform.admin permission
  const hasPlatformAdmin = user?.permissions?.includes('platform.admin');

  useEffect(() => {
    if (hasPlatformAdmin) {
      loadData();
    }
  }, [hasPlatformAdmin]);

  // Redirect if not authorized
  if (!hasPlatformAdmin) {
    return <Navigate to={orgId ? getDefaultLandingPath(orgId, authApplications) : '/'} replace />;
  }

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch applications
      const appsResponse = await apiFetch<{ applications: Application[] }>(
        '/platform/applications'
      );
      setApplications(appsResponse.applications);

      // Fetch all organizations (platform admin endpoint)
      const orgsResponse = await apiFetch<{ organizations: Organization[] }>(
        '/platform/organizations'
      );

      // Fetch app subscriptions for each org
      const orgsWithApps: OrgWithApps[] = await Promise.all(
        orgsResponse.organizations.map(async (org) => {
          try {
            const orgAppsResponse = await apiFetch<{ applications: OrgApplication[] }>(
              `/platform/organizations/${org.organization_id}/applications`
            );
            return {
              ...org,
              applications: orgAppsResponse.applications,
            };
          } catch {
            return {
              ...org,
              applications: [],
            };
          }
        })
      );

      setOrganizations(orgsWithApps);
    } catch (err) {
      logger.error('Failed to load data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const toggleApp = async (org: OrgWithApps, appKey: string, currentlyEnabled: boolean) => {
    const toggleKey = `${org.organization_id}:${appKey}`;
    setToggling(toggleKey);

    try {
      if (currentlyEnabled) {
        // Disable
        await apiFetch(`/platform/organizations/${org.organization_id}/applications/${appKey}`, {
          method: 'DELETE',
        });
      } else {
        // Enable
        await apiFetch(`/platform/organizations/${org.organization_id}/applications`, {
          method: 'POST',
          body: JSON.stringify({ application_key: appKey }),
        });
      }

      // Update local state
      setOrganizations(prev =>
        prev.map(o => {
          if (o.organization_id !== org.organization_id) return o;
          return {
            ...o,
            applications: o.applications.map(a => {
              if (a.key !== appKey) return a;
              return { ...a, enabled: !currentlyEnabled };
            }),
          };
        })
      );

      // Refresh auth context to update ProductSwitcher immediately
      // This is especially important when modifying the current user's active org
      if (org.organization_id === activeOrganizationId) {
        await refreshMe();
      }

      // Invalidate any related queries
      queryClient.invalidateQueries({ queryKey: ['organization-applications'] });
    } catch (err) {
      logger.error('Failed to toggle app:', err);
      setError(err instanceof Error ? err.message : 'Failed to toggle app');
    } finally {
      setToggling(null);
    }
  };

  const filteredOrgs = organizations.filter(org =>
    org.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    org.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeApps = applications.filter(a => a.status === 'active');

  const getAppStatus = (org: OrgWithApps, appKey: string): boolean => {
    const app = org.applications.find(a => a.key === appKey);
    return app?.enabled ?? false;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="px-2 py-0.5 text-xs rounded-full bg-semantic-success/10 text-semantic-success">Active</span>;
      case 'coming_soon':
        return <span className="px-2 py-0.5 text-xs rounded-full bg-semantic-warning/10 text-semantic-warning">Coming Soon</span>;
      case 'deprecated':
        return <span className="px-2 py-0.5 text-xs rounded-full bg-semantic-error/10 text-semantic-error">Deprecated</span>;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <MadronaLoader />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <AppWindow className="w-8 h-8 text-forest" />
          <h1 className="text-2xl font-semibold text-ink">App Subscriptions</h1>
        </div>
        <p className="text-ink/70">
          Manage which applications each organization has access to.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error">
          {error}
        </div>
      )}

      {/* Applications Legend */}
      <div className="mb-6 p-4 bg-parchment rounded-lg border border-lichen">
        <h2 className="text-sm font-medium text-ink mb-3">Available Applications</h2>
        <div className="flex flex-wrap gap-4">
          {applications.map(app => (
            <div key={app.key} className="flex items-center gap-2">
              <span className="font-medium text-ink">{app.display_name}</span>
              {getStatusBadge(app.status)}
            </div>
          ))}
        </div>
      </div>

      {/* Search and Refresh */}
      <div className="mb-6 flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
          <input
            type="text"
            placeholder="Search organizations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
          />
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 text-ink/70 hover:text-ink border border-lichen rounded-lg hover:bg-lichen/20 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Organizations Table */}
      <div className="bg-parchment rounded-lg border border-lichen overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-parchment border-b border-lichen">
              <th className="text-left px-4 py-3 text-sm font-medium text-ink">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Organization
                </div>
              </th>
              {activeApps.map(app => (
                <th key={app.key} className="text-center px-4 py-3 text-sm font-medium text-ink w-32">
                  {app.display_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredOrgs.length === 0 ? (
              <tr>
                <td colSpan={activeApps.length + 1} className="px-4 py-8 text-center text-ink/50">
                  {searchTerm ? 'No organizations match your search' : 'No organizations found'}
                </td>
              </tr>
            ) : (
              filteredOrgs.map((org, idx) => (
                <tr
                  key={org.organization_id}
                  className={`border-b border-lichen last:border-b-0 ${idx % 2 === 0 ? 'bg-parchment' : 'bg-parchment/50'}`}
                >
                  <td className="px-4 py-3">
                    <div>
                      <div className="font-medium text-ink">{org.name}</div>
                      <div className="text-sm text-ink/50">{org.slug}</div>
                    </div>
                  </td>
                  {activeApps.map(app => {
                    const isEnabled = getAppStatus(org, app.key);
                    const isToggling = toggling === `${org.organization_id}:${app.key}`;

                    return (
                      <td key={app.key} className="text-center px-4 py-3">
                        <button
                          onClick={() => toggleApp(org, app.key, isEnabled)}
                          disabled={isToggling}
                          className={`inline-flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
                            isEnabled
                              ? 'bg-semantic-success/10 text-semantic-success hover:bg-semantic-success'
                              : 'bg-stone text-archive hover:bg-lichen'
                          } ${isToggling ? 'opacity-50 cursor-wait' : ''}`}
                          title={isEnabled ? `Disable ${app.display_name}` : `Enable ${app.display_name}`}
                        >
                          {isToggling ? (
                            <MadronaLoader variant="dots" />
                          ) : isEnabled ? (
                            <Check className="w-5 h-5" />
                          ) : (
                            <X className="w-5 h-5" />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="mt-4 text-sm text-ink/50">
        Showing {filteredOrgs.length} of {organizations.length} organizations
      </div>
    </div>
  );
}
