import React, { useState, useEffect } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import {
  Building2,
  Users,
  HardDrive,
  AppWindow,
  Calendar,
  Search,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Settings,
  Plus,
  X,
  User,
  Check,
  AlertCircle,
  Package,
  Send,
  Pencil,
  Trash2,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { useAuth } from '../../hooks/useAuth';
import { getDefaultLandingPath } from '../../hooks/useActiveProduct';
import { logger } from '../../lib/logger';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateShort } from '@/lib/formatters';

// Types for organization list
interface StorageInfo {
  media_bytes?: number;
  db_bytes?: number;
  search_bytes?: number;
  total_used_bytes?: number;
  used_gb: number;
  limit_gb: number | null;
  usage_percent: number;
  metered_at?: string | null;
}

interface AppInfo {
  key: string;
  display_name: string;
  contract_start_date: string | null;
  contract_end_date: string | null;
}

interface OrganizationInfo {
  organization_id: string;
  name: string;
  slug: string;
  created_at: string | null;
  user_count: number;
  storage: StorageInfo;
  apps: AppInfo[];
  contract_end_date: string | null;
  status: 'active' | 'expired' | 'inactive';
}

// Types for provisioning
interface Application {
  application_id: string;
  key: string;
  display_name: string;
  description: string | null;
  status: 'active' | 'coming_soon' | 'deprecated';
}

interface ProvisionResult {
  organization_id: string;
  organization_slug: string;
  admin_user_id: string;
  enabled_applications: string[];
  welcome_email_sent: boolean;
}

export default function OrganizationsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { user, applications: authApplications } = useAuth();

  // List state
  const [organizations, setOrganizations] = useState<OrganizationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Slide-over state
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Edit state
  const [editingOrg, setEditingOrg] = useState<OrganizationInfo | null>(null);
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editStatus, setEditStatus] = useState('active');
  const [_editIsDemo, setEditIsDemo] = useState(false);
  const [_editInstitutionType, setEditInstitutionType] = useState('');
  const [_editTimezone, setEditTimezone] = useState('UTC');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete state
  const [deletingOrg, setDeletingOrg] = useState<OrganizationInfo | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Provision form state
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [contractStart, setContractStart] = useState('');
  const [contractEnd, setContractEnd] = useState('');
  const [annualValue, setAnnualValue] = useState('');
  const [onboardingDatetime, setOnboardingDatetime] = useState('');
  const [csmName, setCsmName] = useState('');
  const [csmEmail, setCsmEmail] = useState('');

  // App selection state
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedApps, setSelectedApps] = useState<string[]>([]);

  // Sandbox toggle — when on, the saga additionally seeds reference data,
  // Met / Smithsonian / Rijks collections, and (Phase 2/3) procedure +
  // media. The endpoint queues the work to Celery and returns 202; we
  // navigate the admin to the job-detail page to watch progress.
  const [withDemoData, setWithDemoData] = useState(false);

  // Provision UI state
  const [appsLoading, setAppsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionResult | null>(null);

  // Check for platform.admin permission
  const hasPlatformAdmin = user?.permissions?.includes('platform.admin');

  useEffect(() => {
    if (hasPlatformAdmin) {
      loadOrganizations();
    }
  }, [hasPlatformAdmin]);

  // Load applications when slide-over opens
  useEffect(() => {
    if (isCreateOpen && applications.length === 0) {
      loadApplications();
    }
  }, [isCreateOpen]);

  // Redirect if not authorized
  if (!hasPlatformAdmin) {
    return <Navigate to={orgId ? getDefaultLandingPath(orgId, authApplications) : '/'} replace />;
  }

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiFetch<{ organizations: OrganizationInfo[] }>(
        '/platform/organizations',
        { expectKeys: ['organizations'] },
      );

      setOrganizations(response.organizations || []);
    } catch (err) {
      logger.error('Failed to load organizations:', err);
      setError(err instanceof Error ? err.message : 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  };

  const loadApplications = async () => {
    try {
      setAppsLoading(true);
      const response = await apiFetch<{ applications: Application[] }>(
        '/platform/applications',
        { expectKeys: ['applications'] },
      );

      const activeApps = (response.applications || []).filter(a => a.status === 'active');
      setApplications(activeApps);
    } catch (err) {
      logger.error('Failed to load applications:', err);
      setProvisionError(err instanceof Error ? err.message : 'Failed to load applications');
    } finally {
      setAppsLoading(false);
    }
  };

  const filteredOrgs = organizations.filter(org => {
    const matchesSearch =
      org.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      org.slug.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = !statusFilter || org.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-semantic-success/10 text-semantic-success">
            Active
          </span>
        );
      case 'expired':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-semantic-error/10 text-semantic-error">
            Expired
          </span>
        );
      case 'inactive':
        return (
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-stone text-archive">
            Inactive
          </span>
        );
      default:
        return null;
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const formatStorage = (storage: StorageInfo): string => {
    const formatSize = (gb: number): string => {
      if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
      return `${gb} GB`;
    };
    if (storage.limit_gb) {
      return `${formatSize(storage.used_gb)} / ${formatSize(storage.limit_gb)}`;
    }
    return formatSize(storage.used_gb);
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '-';
    return formatDateShort(dateStr);
  };

  const formatApps = (apps: AppInfo[]): string => {
    if (apps.length === 0) return 'None';
    return apps.map(a => a.display_name).join(', ');
  };

  const handleRowClick = (orgId: string) => {
    setExpandedRow(expandedRow === orgId ? null : orgId);
  };

  const navigateToUsers = (organizationId: string) => {
    navigate(`/organizations/${organizationId}/admin/users`);
  };

  const navigateToSubscriptions = (organizationId: string) => {
    navigate(`/organizations/${organizationId}/admin/app-subscriptions`);
  };

  // Provision form handlers
  const toggleApp = (appKey: string) => {
    setSelectedApps(prev =>
      prev.includes(appKey) ? prev.filter(k => k !== appKey) : [...prev, appKey]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvisionError(null);
    setSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        organization: {
          name: orgName,
          ...(orgSlug && { slug: orgSlug }),
        },
        applications: selectedApps.map(key => ({ key })),
        admin: {
          email: adminEmail,
          name: adminName,
        },
        ...(withDemoData && { with_demo_data: true }),
      };

      if (contractStart || contractEnd || annualValue) {
        payload.contract = {
          ...(contractStart && { start_date: contractStart }),
          ...(contractEnd && { end_date: contractEnd }),
          ...(annualValue && { annual_value: parseInt(annualValue, 10) }),
        };
      }

      if (onboardingDatetime || csmName || csmEmail) {
        payload.onboarding = {
          ...(onboardingDatetime && { scheduled_datetime: onboardingDatetime }),
          ...(csmName && { csm_name: csmName }),
          ...(csmEmail && { csm_email: csmEmail }),
        };
      }

      // Sandbox provisioning runs the saga in Celery and returns 202
      // with a job_id; navigate to the live progress page. Regular
      // enterprise provisioning runs sync and returns the populated
      // ProvisionResult, same as before.
      if (withDemoData) {
        const queued = await apiFetch<{ job_id: string; organization_slug: string }>(
          '/platform/provision',
          { method: 'POST', body: JSON.stringify(payload) },
        );
        // Admin app uses basename `/admin`, so this resolves to
        // `/admin/provision-jobs/<id>`. The earlier path included a
        // useless `${orgId}` from useParams (admin route doesn't supply
        // one), which produced /admin/organizations/undefined/...
        navigate(`/provision-jobs/${queued.job_id}`);
        return;
      }

      const response = await apiFetch<ProvisionResult>('/platform/provision', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setResult(response);
      // Refresh the organizations list
      loadOrganizations();
    } catch (err) {
      logger.error('Provisioning failed:', err);
      setProvisionError(err instanceof Error ? err.message : 'Provisioning failed');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setOrgName('');
    setOrgSlug('');
    setAdminEmail('');
    setAdminName('');
    setContractStart('');
    setContractEnd('');
    setAnnualValue('');
    setOnboardingDatetime('');
    setCsmName('');
    setCsmEmail('');
    setSelectedApps([]);
    setWithDemoData(false);
    setResult(null);
    setProvisionError(null);
  };

  const openEditSlideOver = (org: OrganizationInfo) => {
    setEditingOrg(org);
    setEditName(org.name);
    setEditSlug(org.slug);
    setEditStatus(org.status);
    setEditIsDemo(false); // Not in list response, default to false
    setEditInstitutionType('');
    setEditTimezone('UTC');
    setEditError(null);
  };

  const closeEditSlideOver = () => {
    setEditingOrg(null);
    setEditError(null);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrg) return;

    setEditSubmitting(true);
    setEditError(null);

    try {
      const payload: Record<string, unknown> = {};
      if (editName !== editingOrg.name) payload.name = editName;
      if (editSlug !== editingOrg.slug) payload.slug = editSlug;
      if (editStatus !== editingOrg.status) payload.status = editStatus;

      if (Object.keys(payload).length === 0) {
        closeEditSlideOver();
        return;
      }

      await apiFetch(`/platform/organizations/${editingOrg.organization_id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      closeEditSlideOver();
      loadOrganizations();
    } catch (err) {
      logger.error('Failed to update organization:', err);
      setEditError(err instanceof Error ? err.message : 'Failed to update organization');
    } finally {
      setEditSubmitting(false);
    }
  };

  const openDeleteModal = (org: OrganizationInfo) => {
    setDeletingOrg(org);
    setDeleteConfirmName('');
    setDeleteError(null);
  };

  const closeDeleteModal = () => {
    setDeletingOrg(null);
    setDeleteConfirmName('');
    setDeleteError(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingOrg) return;

    setDeleteSubmitting(true);
    setDeleteError(null);

    try {
      await apiFetch(`/platform/organizations/${deletingOrg.organization_id}?confirm=true`, {
        method: 'DELETE',
      });

      closeDeleteModal();
      setExpandedRow(null);
      loadOrganizations();
    } catch (err) {
      logger.error('Failed to delete organization:', err);
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete organization');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const closeSlideOver = () => {
    setIsCreateOpen(false);
    resetForm();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <MadronaLoader />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Building2 className="w-8 h-8 text-forest" />
            <h1 className="text-2xl font-semibold text-ink">Organizations</h1>
          </div>
          <p className="text-ink/70">
            View and manage all organizations on the platform.
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Organization
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
          <input
            type="text"
            placeholder="Search by name or slug..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="inactive">Inactive</option>
        </select>

        <button
          onClick={loadOrganizations}
          className="flex items-center gap-2 px-4 py-2 text-ink/70 hover:text-ink border border-lichen rounded-lg hover:bg-lichen/20 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="p-4 bg-parchment rounded-lg border border-lichen">
          <div className="text-sm text-ink/70">Total Organizations</div>
          <div className="text-2xl font-semibold text-ink">{organizations.length}</div>
        </div>
        <div className="p-4 bg-semantic-success/10 rounded-lg border border-semantic-success/30">
          <div className="text-sm text-semantic-success">Active</div>
          <div className="text-2xl font-semibold text-semantic-success">
            {organizations.filter(o => o.status === 'active').length}
          </div>
        </div>
        <div className="p-4 bg-semantic-error/10 rounded-lg border border-semantic-error/30">
          <div className="text-sm text-semantic-error">Expired</div>
          <div className="text-2xl font-semibold text-semantic-error">
            {organizations.filter(o => o.status === 'expired').length}
          </div>
        </div>
      </div>

      {/* Organizations Table */}
      <div className="bg-parchment rounded-lg border border-lichen overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-parchment border-b border-lichen">
              <th className="w-8"></th>
              <th className="text-left px-4 py-3 text-sm font-medium text-ink">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Organization
                </div>
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-ink">
                <div className="flex items-center justify-center gap-2">
                  <Users className="w-4 h-4" />
                  Users
                </div>
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-ink">
                <div className="flex items-center justify-center gap-2">
                  <HardDrive className="w-4 h-4" />
                  Storage
                </div>
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-ink">
                <div className="flex items-center gap-2">
                  <AppWindow className="w-4 h-4" />
                  Apps
                </div>
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-ink">
                <div className="flex items-center justify-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Contract End
                </div>
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-ink">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredOrgs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink/50">
                  {searchTerm || statusFilter
                    ? 'No organizations match your filters'
                    : 'No organizations found'}
                </td>
              </tr>
            ) : (
              filteredOrgs.map((org, idx) => (
                <React.Fragment key={org.organization_id}>
                  <tr
                    className={`border-b border-lichen last:border-b-0 cursor-pointer hover:bg-lichen/30 transition-colors ${
                      idx % 2 === 0 ? 'bg-parchment' : 'bg-parchment/50'
                    } ${expandedRow === org.organization_id ? 'bg-lichen/20' : ''}`}
                    onClick={() => handleRowClick(org.organization_id)}
                  >
                    <td className="pl-4 py-3">
                      {expandedRow === org.organization_id ? (
                        <ChevronDown className="w-4 h-4 text-ink/50" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-ink/50" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <div className="font-medium text-ink">{org.name}</div>
                        <div className="text-sm text-ink/50">{org.slug}</div>
                      </div>
                    </td>
                    <td className="text-center px-4 py-3 text-ink">
                      {org.user_count}
                    </td>
                    <td className="text-center px-4 py-3">
                      <div className="text-ink text-sm">{formatStorage(org.storage)}</div>
                      {org.storage.limit_gb && org.storage.usage_percent > 0 && (
                        <div className="mt-1 w-full bg-stone rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${
                              org.storage.usage_percent > 90
                                ? 'bg-semantic-error'
                                : org.storage.usage_percent > 75
                                ? 'bg-semantic-warning'
                                : 'bg-semantic-success'
                            }`}
                            style={{ width: `${Math.min(org.storage.usage_percent, 100)}%` }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink max-w-[200px] truncate">
                      {formatApps(org.apps)}
                    </td>
                    <td className="text-center px-4 py-3 text-sm text-ink">
                      {formatDate(org.contract_end_date)}
                    </td>
                    <td className="text-center px-4 py-3">
                      {getStatusBadge(org.status)}
                    </td>
                  </tr>
                  {/* Expanded Row Details */}
                  {expandedRow === org.organization_id && (
                    <tr className="bg-lichen/10 border-b border-lichen">
                      <td colSpan={7} className="px-8 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* Details Section */}
                          <div>
                            <h4 className="text-sm font-medium text-ink mb-3">Organization Details</h4>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-ink/70">Organization ID:</span>
                                <span className="text-ink font-mono text-xs">{org.organization_id}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-ink/70">Created:</span>
                                <span className="text-ink">{formatDate(org.created_at)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-ink/70">Storage Used:</span>
                                <span className="text-ink">{formatStorage(org.storage)}{org.storage.limit_gb ? ` (${org.storage.usage_percent}%)` : ''}</span>
                              </div>
                              {org.storage.media_bytes != null && (
                                <div className="flex justify-between">
                                  <span className="text-ink/70">Media (S3):</span>
                                  <span className="text-ink">{formatBytes(org.storage.media_bytes)}</span>
                                </div>
                              )}
                              {org.storage.db_bytes != null && org.storage.db_bytes > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-ink/70">Database:</span>
                                  <span className="text-ink">{formatBytes(org.storage.db_bytes)}</span>
                                </div>
                              )}
                              {org.storage.search_bytes != null && org.storage.search_bytes > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-ink/70">Search Index:</span>
                                  <span className="text-ink">{formatBytes(org.storage.search_bytes)}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Apps Section */}
                          <div>
                            <h4 className="text-sm font-medium text-ink mb-3">Enabled Applications</h4>
                            {org.apps.length === 0 ? (
                              <p className="text-sm text-ink/50">No applications enabled</p>
                            ) : (
                              <div className="space-y-2">
                                {org.apps.map(app => (
                                  <div
                                    key={app.key}
                                    className="flex items-center justify-between text-sm p-2 bg-parchment rounded border border-lichen"
                                  >
                                    <div>
                                      <span className="font-medium text-ink">{app.display_name}</span>
                                    </div>
                                    {app.contract_end_date && (
                                      <span className="text-xs text-ink/50">
                                        Ends: {formatDate(app.contract_end_date)}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="mt-4 pt-4 border-t border-lichen flex gap-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditSlideOver(org);
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-forest hover:text-forest-dark border border-forest/30 rounded hover:bg-forest/5 transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                            Edit
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateToUsers(org.organization_id);
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-forest hover:text-forest-dark border border-forest/30 rounded hover:bg-forest/5 transition-colors"
                          >
                            <Users className="w-4 h-4" />
                            View Users
                            <ExternalLink className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateToSubscriptions(org.organization_id);
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-forest hover:text-forest-dark border border-forest/30 rounded hover:bg-forest/5 transition-colors"
                          >
                            <Settings className="w-4 h-4" />
                            Edit Subscription
                            <ExternalLink className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openDeleteModal(org);
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-semantic-error hover:text-semantic-error/80 border border-semantic-error/30 rounded hover:bg-semantic-error/5 transition-colors ml-auto"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="mt-4 text-sm text-ink/50">
        Showing {filteredOrgs.length} of {organizations.length} organizations
      </div>

      {/* Create Organization Slide-over */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={closeSlideOver} />
          <div className="absolute inset-y-0 right-0 max-w-2xl w-full bg-parchment border-l border-lichen flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Building2 className="w-6 h-6 text-forest" />
                <h2 className="text-lg font-semibold text-ink">Create Organization</h2>
              </div>
              <button
                onClick={closeSlideOver}
                className="p-2 text-ink/50 hover:text-ink hover:bg-lichen/30 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {appsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <MadronaLoader />
                </div>
              ) : result ? (
                /* Success state */
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-semantic-success/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Check className="w-8 h-8 text-semantic-success" />
                  </div>

                  <h3 className="text-xl font-semibold text-ink mb-2">Organization Created</h3>
                  <p className="text-ink/70 mb-6">
                    {result.organization_slug} has been created successfully.
                  </p>

                  <div className="bg-parchment rounded-lg p-4 mb-6 text-left">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-ink/50">Organization ID</span>
                        <p className="font-mono text-ink">{result.organization_id}</p>
                      </div>
                      <div>
                        <span className="text-ink/50">Slug</span>
                        <p className="font-medium text-ink">{result.organization_slug}</p>
                      </div>
                      <div>
                        <span className="text-ink/50">Admin User ID</span>
                        <p className="font-mono text-ink">{result.admin_user_id}</p>
                      </div>
                      <div>
                        <span className="text-ink/50">Applications</span>
                        <p className="font-medium text-ink">{result.enabled_applications.join(', ')}</p>
                      </div>
                    </div>
                  </div>

                  <div className={`flex items-center justify-center gap-2 mb-6 ${result.welcome_email_sent ? 'text-semantic-success' : 'text-semantic-warning'}`}>
                    <Send className="w-4 h-4" />
                    <span className="text-sm">
                      {result.welcome_email_sent
                        ? 'Welcome email sent successfully'
                        : 'Welcome email could not be sent'}
                    </span>
                  </div>

                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={resetForm}
                      className="px-6 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90 transition-colors"
                    >
                      Create Another
                    </button>
                    <button
                      onClick={closeSlideOver}
                      className="px-6 py-2 text-ink/70 hover:text-ink border border-lichen rounded-lg transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                /* Form */
                <form onSubmit={handleSubmit} className="space-y-6">
                  {provisionError && (
                    <div className="p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-semantic-error flex-shrink-0 mt-0.5" />
                      <div className="text-semantic-error">{provisionError}</div>
                    </div>
                  )}

                  {/* Organization Section */}
                  <div className="bg-parchment/50 rounded-lg border border-lichen p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Building2 className="w-5 h-5 text-forest" />
                      <h3 className="text-base font-medium text-ink">Organization</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-ink mb-1">
                          Organization Name <span className="text-semantic-error">*</span>
                        </label>
                        <input
                          type="text"
                          value={orgName}
                          onChange={(e) => setOrgName(e.target.value)}
                          placeholder="Metropolitan Museum of Art"
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ink mb-1">
                          Slug <span className="text-ink/50 text-xs">(auto-generated if empty)</span>
                        </label>
                        <input
                          type="text"
                          value={orgSlug}
                          onChange={(e) => setOrgSlug(e.target.value)}
                          placeholder="met-museum"
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Applications Section */}
                  <div className="bg-parchment/50 rounded-lg border border-lichen p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Package className="w-5 h-5 text-forest" />
                      <h3 className="text-base font-medium text-ink">Products</h3>
                    </div>

                    <div className="space-y-3">
                      {applications.map((app) => {
                        const isSelected = selectedApps.includes(app.key);

                        return (
                          <div
                            key={app.key}
                            className={`border rounded-lg p-3 transition-colors ${
                              isSelected ? 'border-forest bg-forest/5' : 'border-lichen bg-parchment'
                            }`}
                          >
                            <label className="flex items-center gap-3 cursor-pointer">
                              <Checkbox
                                checked={isSelected}
                                onChange={() => toggleApp(app.key)}
                              />
                              <div>
                                <span className="font-medium text-ink text-sm">{app.display_name}</span>
                                {app.description && (
                                  <p className="text-xs text-ink/60">{app.description}</p>
                                )}
                              </div>
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Contract Section */}
                  <div className="bg-parchment/50 rounded-lg border border-lichen p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Calendar className="w-5 h-5 text-forest" />
                      <h3 className="text-base font-medium text-ink">Contract</h3>
                      <span className="text-xs text-ink/50">(optional)</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-ink mb-1">Start Date</label>
                        <input
                          type="date"
                          value={contractStart}
                          onChange={(e) => setContractStart(e.target.value)}
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ink mb-1">End Date</label>
                        <input
                          type="date"
                          value={contractEnd}
                          onChange={(e) => setContractEnd(e.target.value)}
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ink mb-1">Annual Value ($)</label>
                        <input
                          type="number"
                          value={annualValue}
                          onChange={(e) => setAnnualValue(e.target.value)}
                          placeholder="43000"
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Admin Section */}
                  <div className="bg-parchment/50 rounded-lg border border-lichen p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <User className="w-5 h-5 text-forest" />
                      <h3 className="text-base font-medium text-ink">Primary Admin</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-ink mb-1">
                          Name <span className="text-semantic-error">*</span>
                        </label>
                        <input
                          type="text"
                          value={adminName}
                          onChange={(e) => setAdminName(e.target.value)}
                          placeholder="Jane Smith"
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ink mb-1">
                          Email <span className="text-semantic-error">*</span>
                        </label>
                        <input
                          type="email"
                          value={adminEmail}
                          onChange={(e) => setAdminEmail(e.target.value)}
                          placeholder="jane.smith@museum.org"
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Sandbox Demo Data Section */}
                  <div className="bg-parchment/50 rounded-lg border border-lichen p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <Checkbox
                        checked={withDemoData}
                        onChange={() => setWithDemoData(!withDemoData)}
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Sparkles className="w-4 h-4 text-copper" />
                          <span className="text-base font-medium text-ink">
                            Include sandbox demo data
                          </span>
                        </div>
                        <p className="text-sm text-ink/70 leading-relaxed">
                          Populates the new org with ~75 Met Museum collection
                          objects (CC0), Smithsonian + Rijksmuseum objects (when
                          API keys are configured), 5 departments, 20 storage
                          locations, and 15 contacts. Marks the organization as
                          a demo. Provisioning runs in the background and can
                          take 5–15 minutes; you'll be redirected to a live
                          progress page.
                        </p>
                      </div>
                    </label>
                  </div>

                  {/* Onboarding Section */}
                  <div className="bg-parchment/50 rounded-lg border border-lichen p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Calendar className="w-5 h-5 text-forest" />
                      <h3 className="text-base font-medium text-ink">Onboarding</h3>
                      <span className="text-xs text-ink/50">(optional)</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-ink mb-1">Scheduled Call</label>
                        <input
                          type="datetime-local"
                          value={onboardingDatetime}
                          onChange={(e) => setOnboardingDatetime(e.target.value)}
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ink mb-1">CSM Name</label>
                        <input
                          type="text"
                          value={csmName}
                          onChange={(e) => setCsmName(e.target.value)}
                          placeholder="Alex Johnson"
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ink mb-1">CSM Email</label>
                        <input
                          type="email"
                          value={csmEmail}
                          onChange={(e) => setCsmEmail(e.target.value)}
                          placeholder="alex@example.com"
                          className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Submit */}
                  <div className="flex items-center justify-end gap-4 pt-4">
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-4 py-2 text-ink/70 hover:text-ink transition-colors"
                    >
                      Reset
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || !orgName || !adminEmail || !adminName}
                      className="px-6 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          Create & Send Welcome Email
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Organization Slide-over */}
      {editingOrg && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={closeEditSlideOver} />
          <div className="absolute inset-y-0 right-0 max-w-lg w-full bg-parchment border-l border-lichen flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Pencil className="w-5 h-5 text-forest" />
                <h2 className="text-lg font-semibold text-ink">Edit Organization</h2>
              </div>
              <button
                onClick={closeEditSlideOver}
                className="p-2 text-ink/50 hover:text-ink hover:bg-lichen/30 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleEditSubmit} className="flex-1 overflow-y-auto p-6">
              {editError && (
                <div className="mb-4 p-4 bg-semantic-error/10 border border-semantic-error/20 rounded-lg flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-semantic-error flex-shrink-0 mt-0.5" />
                  <div className="text-semantic-error">{editError}</div>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Organization Name <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink mb-1">
                    Slug <span className="text-semantic-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={editSlug}
                    onChange={(e) => setEditSlug(e.target.value)}
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink mb-1">Status</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-forest"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 mt-8 pt-4 border-t border-lichen">
                <button
                  type="button"
                  onClick={closeEditSlideOver}
                  className="px-4 py-2 text-ink/70 hover:text-ink border border-lichen rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting || !editName.trim() || !editSlug.trim()}
                  className="px-6 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {editSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-ink/30" onClick={closeDeleteModal} />
          <div className="relative bg-parchment rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-semantic-error/10 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-semantic-error" />
              </div>
              <h3 className="text-lg font-semibold text-ink">Delete Organization</h3>
            </div>

            <p className="text-ink/70 mb-2">
              This will permanently delete <strong className="text-ink">{deletingOrg.name}</strong> and
              all associated data including:
            </p>
            <ul className="text-sm text-ink/70 mb-4 ml-4 list-disc space-y-1">
              <li>All users and memberships</li>
              <li>All application subscriptions</li>
              <li>All collections, records, and files</li>
            </ul>

            {deleteError && (
              <div className="mb-4 p-3 bg-semantic-error/10 border border-semantic-error/20 rounded-lg text-sm text-semantic-error">
                {deleteError}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-ink mb-1">
                Type <span className="font-mono text-semantic-error">{deletingOrg.name}</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                placeholder={deletingOrg.name}
                className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-error/30 focus-visible:ring-offset-2 focus-visible:border-semantic-error"
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={closeDeleteModal}
                className="px-4 py-2 text-ink/70 hover:text-ink border border-lichen rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleteSubmitting || deleteConfirmName !== deletingOrg.name}
                className="px-6 py-2 bg-semantic-error text-parchment rounded-lg hover:bg-semantic-error/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {deleteSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete Organization
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
