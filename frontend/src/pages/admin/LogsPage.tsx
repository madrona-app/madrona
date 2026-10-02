import React, { useState, useEffect, useCallback } from 'react';
import Checkbox from '../../components/Checkbox';
import { useParams, Navigate } from 'react-router-dom';
import {
  FileText,
  User,
  Calendar,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Download,
  Building2,
  UserPlus,
  AppWindow,
  ArrowUpDown,
  Key,
  FileSignature,
  RefreshCw,
  Activity,
  Mail,
  AlertTriangle,
  ShieldAlert,
  TrendingUp,
  Users,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import {
  getEmailEvents,
  getEmailStats,
  getUsersByEmailStatus,
  updateUserEmailStatus,
  bulkDeleteEmailEvents,
  type EmailEvent,
  type EmailEventStats,
  type UserEmailStatus
} from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { getDefaultLandingPath } from '../../hooks/useActiveProduct';
import ConfirmDialog from '../../components/ConfirmDialog';
import { logger } from '../../lib/logger';
import { useToast } from '../../contexts/ToastContext';
import { formatDateTime, formatNumber as fmtNumber } from '@/lib/formatters';

// ============================================================================
// Types
// ============================================================================

// User Activity (Audit Logs) types
interface AuditLog {
  audit_log_id: string;
  organization_id: string;
  organization_name?: string | null;
  acting_user_id: string;
  acting_user_email?: string | null;
  target_user_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

interface AuditLogsResponse {
  items: AuditLog[];
  total: number;
  page: {
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

// Provisioning types
interface ProvisioningLog {
  id: string;
  action: string;
  performed_by: string | null;
  performer_name: string | null;
  performer_email: string | null;
  organization_id: string | null;
  organization_name: string | null;
  organization_slug: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

interface ProvisioningLogsResponse {
  items: ProvisioningLog[];
  total: number;
  page: {
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

interface ProvisioningStats {
  total_events: number;
  events_today: number;
  events_this_week: number;
  by_action: Record<string, number>;
  by_day: Array<{ date: string; count: number }>;
}

// Action type configuration for provisioning
const PROVISIONING_ACTION_CONFIG: Record<string, { label: string; color: string; icon: typeof Building2 }> = {
  org_created: { label: 'Org Created', color: 'bg-semantic-success/10 text-semantic-success', icon: Building2 },
  user_added: { label: 'User Added', color: 'bg-semantic-info/10 text-semantic-info', icon: UserPlus },
  user_bulk_imported: { label: 'Bulk Import', color: 'bg-bark/10 text-bark', icon: UserPlus },
  app_enabled: { label: 'App Enabled', color: 'bg-semantic-success/10 text-semantic-success', icon: AppWindow },
  app_disabled: { label: 'App Disabled', color: 'bg-semantic-warning/10 text-semantic-warning', icon: AppWindow },
  tier_changed: { label: 'Tier Changed', color: 'bg-semantic-info/10 text-semantic-info', icon: ArrowUpDown },
  sso_configured: { label: 'SSO Configured', color: 'bg-semantic-info text-semantic-info', icon: Key },
  contract_created: { label: 'Contract Created', color: 'bg-semantic-success text-semantic-success', icon: FileSignature },
  contract_renewed: { label: 'Contract Renewed', color: 'bg-semantic-success text-semantic-success', icon: RefreshCw },
};

type LogTab = 'user-activity' | 'provisioning' | 'email';

// Cache for user names
const userNameCache: Record<string, string> = {};

export default function LogsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user, isPlatformAdmin, applications } = useAuth();
  const { showToast: _showToast } = useToast();

  // Tab state - default to user-activity always
  const [activeTab, setActiveTab] = useState<LogTab>('user-activity');

  // Check permissions
  const hasPlatformAdmin = isPlatformAdmin;
  const hasViewAuditLogs = user?.permissions?.includes('org.view_audit_logs');

  // Redirect if not authorized to see any logs
  if (!hasPlatformAdmin && !hasViewAuditLogs) {
    return <Navigate to={orgId ? getDefaultLandingPath(orgId, applications) : '/'} replace />;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <FileText className="w-8 h-8 text-forest" />
          <h1 className="text-2xl font-semibold text-ink">Logs</h1>
        </div>
        <p className="text-ink/70">
          View activity and audit logs across the platform
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-lichen mb-6">
        <nav className="-mb-px flex space-x-8">
          {(hasViewAuditLogs || hasPlatformAdmin) && (
            <button
              onClick={() => setActiveTab('user-activity')}
              className={`${
                activeTab === 'user-activity'
                  ? 'border-forest text-forest'
                  : 'border-transparent text-ink/60 hover:text-ink hover:border-lichen'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2`}
            >
              <User className="w-4 h-4" />
              User Activity
            </button>
          )}
          {hasPlatformAdmin && (
            <>
              <button
                onClick={() => setActiveTab('provisioning')}
                className={`${
                  activeTab === 'provisioning'
                    ? 'border-forest text-forest'
                    : 'border-transparent text-ink/60 hover:text-ink hover:border-lichen'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2`}
              >
                <Building2 className="w-4 h-4" />
                Provisioning
              </button>
              <button
                onClick={() => setActiveTab('email')}
                className={`${
                  activeTab === 'email'
                    ? 'border-forest text-forest'
                    : 'border-transparent text-ink/60 hover:text-ink hover:border-lichen'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2`}
              >
                <Mail className="w-4 h-4" />
                Email Events
              </button>
            </>
          )}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'user-activity' && (hasViewAuditLogs || hasPlatformAdmin) && (
        <UserActivityTab orgId={orgId} isPlatformAdmin={hasPlatformAdmin} />
      )}
      {activeTab === 'provisioning' && hasPlatformAdmin && (
        <ProvisioningTab />
      )}
      {activeTab === 'email' && hasPlatformAdmin && (
        <EmailTab />
      )}
    </div>
  );
}

// ============================================================================
// User Activity Tab
// ============================================================================

function UserActivityTab({ orgId, isPlatformAdmin }: { orgId: string | undefined; isPlatformAdmin?: boolean }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [actionFilter, setActionFilter] = useState<string>('');
  const [sinceDate, setSinceDate] = useState<string>('');
  const [untilDate, setUntilDate] = useState<string>('');

  // Pagination
  const [offset, setOffset] = useState(0);
  const limit = 25;

  // User name lookup
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (orgId || isPlatformAdmin) {
      loadAuditLogs();
    }
  }, [orgId, isPlatformAdmin, actionFilter, sinceDate, untilDate, offset]);

  const loadAuditLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.set('limit', limit.toString());
      params.set('offset', offset.toString());

      if (actionFilter) params.set('action', actionFilter);
      if (sinceDate) params.set('since', new Date(sinceDate).toISOString());
      if (untilDate) params.set('until', new Date(untilDate + 'T23:59:59').toISOString());

      // Use platform endpoint when no orgId (admin context), org endpoint otherwise
      const url = orgId
        ? `/organizations/${orgId}/audit-logs?${params.toString()}`
        : `/platform/audit-logs?${params.toString()}`;

      const response = await apiFetch<AuditLogsResponse>(url, { expectKeys: ['audit_logs'] });

      const logs = response.items || [];
      setLogs(logs);
      setTotalCount(response.total || 0);

      // Extract names from details or top-level fields
      const newNames: Record<string, string> = { ...userNameCache };
      logs.forEach(log => {
        if (log.acting_user_email) {
          newNames[log.acting_user_id] = log.acting_user_email;
          userNameCache[log.acting_user_id] = log.acting_user_email;
        }
        if (log.details) {
          if (log.details.acting_user_email) {
            newNames[log.acting_user_id] = log.details.acting_user_email as string;
            userNameCache[log.acting_user_id] = log.details.acting_user_email as string;
          }
          if (log.target_user_id && log.details.target_user_email) {
            newNames[log.target_user_id] = log.details.target_user_email as string;
            userNameCache[log.target_user_id] = log.details.target_user_email as string;
          }
          if (log.target_user_id && log.details.email) {
            newNames[log.target_user_id] = log.details.email as string;
            userNameCache[log.target_user_id] = log.details.email as string;
          }
        }
      });
      setUserNames(newNames);
    } catch (err) {
      logger.error('Failed to load audit logs:', err);
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  const formatAction = (action: string): { label: string; color: string } => {
    const actionMap: Record<string, { label: string; color: string }> = {
      'user.invited': { label: 'User Invited', color: 'bg-semantic-info/10 text-semantic-info' },
      'user.role_changed': { label: 'Role Changed', color: 'bg-semantic-warning/10 text-semantic-warning' },
      'user.deactivated': { label: 'User Deactivated', color: 'bg-semantic-error/10 text-semantic-error' },
      'user.reactivated': { label: 'User Reactivated', color: 'bg-semantic-success/10 text-semantic-success' },
    };
    return actionMap[action] || { label: action, color: 'bg-lichen text-ink' };
  };

  const formatDetails = (log: AuditLog): string => {
    const { action, details } = log;

    switch (action) {
      case 'user.invited':
        return `Invited ${details.email || 'user'} with role "${details.role_display_name || details.role_key || 'unknown'}"`;
      case 'user.role_changed':
        return `Changed role from "${details.old_role_display_name || details.old_role || 'unknown'}" to "${details.new_role_display_name || details.new_role || 'unknown'}"`;
      case 'user.deactivated':
        return `Deactivated user ${details.email || userNames[log.target_user_id || ''] || 'unknown'}`;
      case 'user.reactivated':
        return `Reactivated user ${details.email || userNames[log.target_user_id || ''] || 'unknown'}`;
      default:
        return JSON.stringify(details);
    }
  };

  const getUserDisplay = (userId: string | null): string => {
    if (!userId) return 'System';
    return userNames[userId] || userId.slice(0, 8) + '...';
  };

  const handlePrevPage = () => setOffset(Math.max(0, offset - limit));
  const handleNextPage = () => {
    if (offset + limit < totalCount) setOffset(offset + limit);
  };

  const handleFilterChange = () => setOffset(0);

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(totalCount / limit);

  if (loading && logs.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-ink/50">Loading audit logs...</div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 p-4 bg-parchment rounded-lg border border-lichen">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={18} className="text-ink/50" />
          <span className="text-sm font-medium text-ink">Filters</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="action-filter" className="block text-sm font-medium text-ink mb-1">
              Action Type
            </label>
            <select
              id="action-filter"
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                handleFilterChange();
              }}
              className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="">All Actions</option>
              <option value="user.invited">User Invited</option>
              <option value="user.role_changed">Role Changed</option>
              <option value="user.deactivated">User Deactivated</option>
              <option value="user.reactivated">User Reactivated</option>
            </select>
          </div>
          <div>
            <label htmlFor="since-date" className="block text-sm font-medium text-ink mb-1">
              From Date
            </label>
            <input
              id="since-date"
              type="date"
              value={sinceDate}
              onChange={(e) => {
                setSinceDate(e.target.value);
                handleFilterChange();
              }}
              className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
          <div>
            <label htmlFor="until-date" className="block text-sm font-medium text-ink mb-1">
              To Date
            </label>
            <input
              id="until-date"
              type="date"
              value={untilDate}
              onChange={(e) => {
                setUntilDate(e.target.value);
                handleFilterChange();
              }}
              className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
        </div>
        {(actionFilter || sinceDate || untilDate) && (
          <button
            onClick={() => {
              setActionFilter('');
              setSinceDate('');
              setUntilDate('');
              handleFilterChange();
            }}
            className="mt-3 text-sm text-forest hover:text-forest/80"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Results count */}
      <div className="mb-4 text-sm text-ink/50">
        {totalCount === 0 ? 'No audit logs found' : `Showing ${offset + 1}-${Math.min(offset + limit, totalCount)} of ${totalCount} entries`}
      </div>

      {/* Table */}
      <div className="bg-parchment rounded-lg overflow-hidden border border-lichen">
        <table className="min-w-full divide-y divide-lichen">
          <thead className="bg-parchment">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                Timestamp
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                Action
              </th>
              {!orgId && (
                <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                  Organization
                </th>
              )}
              <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                Performed By
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="bg-parchment divide-y divide-lichen">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={orgId ? 4 : 5} className="px-6 py-8 text-center text-ink/50">
                  <FileText className="mx-auto mb-2 text-ink/30" size={48} />
                  <p>No audit logs found</p>
                </td>
              </tr>
            ) : (
              logs.map((log) => {
                const actionInfo = formatAction(log.action);
                return (
                  <tr key={log.audit_log_id} className="hover:bg-lichen/30">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm text-ink">
                        <Calendar size={14} className="mr-2 text-ink/40" />
                        {formatDateTime(log.created_at)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${actionInfo.color}`}>
                        {actionInfo.label}
                      </span>
                    </td>
                    {!orgId && (
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-ink">
                          <Building2 size={14} className="mr-2 text-ink/40" />
                          {log.organization_name || log.organization_id.slice(0, 8) + '...'}
                        </div>
                      </td>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm text-ink">
                        <User size={14} className="mr-2 text-ink/40" />
                        {getUserDisplay(log.acting_user_id)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-ink max-w-md">
                        {formatDetails(log)}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalCount > limit && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-ink/50">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevPage}
              disabled={offset === 0}
              className="px-3 py-1.5 text-sm border border-lichen rounded hover:bg-lichen/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ChevronLeft size={16} />
              Previous
            </button>
            <button
              onClick={handleNextPage}
              disabled={offset + limit >= totalCount}
              className="px-3 py-1.5 text-sm border border-lichen rounded hover:bg-lichen/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Provisioning Tab
// ============================================================================

function ProvisioningTab() {
  const [logs, setLogs] = useState<ProvisioningLog[]>([]);
  const [stats, setStats] = useState<ProvisioningStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [actionFilter, setActionFilter] = useState<string>('');
  const [organizationSearch, setOrganizationSearch] = useState<string>('');
  const [sinceDate, setSinceDate] = useState<string>('');
  const [untilDate, setUntilDate] = useState<string>('');

  // Pagination
  const [offset, setOffset] = useState(0);
  const limit = 25;

  // Expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.set('limit', limit.toString());
      params.set('offset', offset.toString());

      if (actionFilter) params.set('action', actionFilter);
      if (sinceDate) params.set('since', new Date(sinceDate).toISOString());
      if (untilDate) params.set('until', new Date(untilDate + 'T23:59:59').toISOString());

      const response = await apiFetch<ProvisioningLogsResponse>(
        `/platform/provisioning-logs?${params.toString()}`
      );

      let filteredLogs = response.items;
      if (organizationSearch) {
        const searchLower = organizationSearch.toLowerCase();
        filteredLogs = filteredLogs.filter(
          (log) =>
            log.organization_name?.toLowerCase().includes(searchLower) ||
            log.organization_slug?.toLowerCase().includes(searchLower)
        );
      }

      setLogs(filteredLogs);
      setTotalCount(response.total);
    } catch (err) {
      logger.error('Failed to load provisioning logs:', err);
      setError(err instanceof Error ? err.message : 'Failed to load provisioning logs');
    } finally {
      setLoading(false);
    }
  }, [actionFilter, sinceDate, untilDate, offset, organizationSearch]);

  const loadStats = useCallback(async () => {
    try {
      const response = await apiFetch<ProvisioningStats>('/platform/provisioning-logs/stats');
      setStats(response);
    } catch (err) {
      logger.error('Failed to load provisioning stats:', err);
    }
  }, []);

  useEffect(() => {
    loadLogs();
    loadStats();
  }, [loadLogs, loadStats]);

  const getActionConfig = (action: string) => {
    return PROVISIONING_ACTION_CONFIG[action] || { label: action, color: 'bg-lichen text-ink', icon: Activity };
  };

  const formatDetails = (log: ProvisioningLog): string => {
    const { action, details } = log;

    switch (action) {
      case 'org_created':
        return `Created organization "${details.org_name || 'unknown'}" with admin ${details.admin_email || 'unknown'}`;
      case 'user_bulk_imported':
        return `Imported ${details.count || 0} users (${details.skipped || 0} skipped, ${details.errors || 0} errors)`;
      case 'app_enabled':
        return `Enabled ${details.app_key || 'unknown'}`;
      case 'app_disabled':
        return `Disabled ${details.app_key || 'unknown'}`;
      case 'sso_configured':
        return `Configured SSO for ${details.provider || 'unknown provider'}`;
      case 'contract_created':
        return `Created contract starting ${details.start_date || 'unknown'}`;
      case 'contract_renewed':
        return `Renewed contract until ${details.end_date || 'unknown'}`;
      default:
        return Object.keys(details).length > 0 ? JSON.stringify(details) : 'No details';
    }
  };

  const toggleRowExpanded = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePrevPage = () => setOffset(Math.max(0, offset - limit));
  const handleNextPage = () => {
    if (offset + limit < totalCount) setOffset(offset + limit);
  };

  const handleFilterChange = () => setOffset(0);

  const exportToCsv = () => {
    const headers = ['Timestamp', 'Action', 'Organization', 'Performed By', 'Details', 'IP Address'];
    const rows = logs.map((log) => [
      log.created_at ? formatDateTime(log.created_at) : '',
      getActionConfig(log.action).label,
      log.organization_name || '',
      log.performer_email || log.performer_name || '',
      formatDetails(log),
      log.ip_address || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `provisioning-log-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(totalCount / limit);

  if (loading && logs.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-ink/50">Loading provisioning logs...</div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error">
          {error}
        </div>
      )}

      {/* Stats Summary */}
      {stats && (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-parchment rounded-lg border border-lichen p-4">
            <div className="text-sm text-ink/50">Total Events</div>
            <div className="text-2xl font-bold text-ink">{fmtNumber(stats.total_events)}</div>
          </div>
          <div className="bg-parchment rounded-lg border border-lichen p-4">
            <div className="text-sm text-ink/50">Events Today</div>
            <div className="text-2xl font-bold text-ink">{fmtNumber(stats.events_today)}</div>
          </div>
          <div className="bg-parchment rounded-lg border border-lichen p-4">
            <div className="text-sm text-ink/50">Events This Week</div>
            <div className="text-2xl font-bold text-ink">{fmtNumber(stats.events_this_week)}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 p-4 bg-parchment rounded-lg border border-lichen">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-ink/50" />
            <span className="text-sm font-medium text-ink">Filters</span>
          </div>
          <button
            onClick={exportToCsv}
            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-lichen rounded hover:bg-lichen/30"
            disabled={logs.length === 0}
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label htmlFor="prov-action-filter" className="block text-sm font-medium text-ink mb-1">
              Action Type
            </label>
            <select
              id="prov-action-filter"
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                handleFilterChange();
              }}
              className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <option value="">All Actions</option>
              {Object.entries(PROVISIONING_ACTION_CONFIG).map(([key, config]) => (
                <option key={key} value={key}>
                  {config.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="org-search" className="block text-sm font-medium text-ink mb-1">
              Organization
            </label>
            <input
              id="org-search"
              type="text"
              placeholder="Search organization..."
              value={organizationSearch}
              onChange={(e) => {
                setOrganizationSearch(e.target.value);
                handleFilterChange();
              }}
              className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
          <div>
            <label htmlFor="prov-since-date" className="block text-sm font-medium text-ink mb-1">
              From Date
            </label>
            <input
              id="prov-since-date"
              type="date"
              value={sinceDate}
              onChange={(e) => {
                setSinceDate(e.target.value);
                handleFilterChange();
              }}
              className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
          <div>
            <label htmlFor="prov-until-date" className="block text-sm font-medium text-ink mb-1">
              To Date
            </label>
            <input
              id="prov-until-date"
              type="date"
              value={untilDate}
              onChange={(e) => {
                setUntilDate(e.target.value);
                handleFilterChange();
              }}
              className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            />
          </div>
        </div>
        {(actionFilter || organizationSearch || sinceDate || untilDate) && (
          <button
            onClick={() => {
              setActionFilter('');
              setOrganizationSearch('');
              setSinceDate('');
              setUntilDate('');
              handleFilterChange();
            }}
            className="mt-3 text-sm text-forest hover:text-forest/80"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Results count */}
      <div className="mb-4 text-sm text-ink/50">
        {totalCount === 0 ? 'No provisioning logs found' : `Showing ${offset + 1}-${Math.min(offset + limit, totalCount)} of ${totalCount} entries`}
      </div>

      {/* Table */}
      <div className="bg-parchment rounded-lg overflow-hidden border border-lichen">
        <table className="min-w-full divide-y divide-lichen">
          <thead className="bg-parchment">
            <tr>
              <th className="w-8 px-4 py-3"></th>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                Timestamp
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                Action
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                Organization
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                Performed By
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="bg-parchment divide-y divide-lichen">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-ink/50">
                  <FileText className="mx-auto mb-2 text-ink/30" size={48} />
                  <p>No provisioning logs found</p>
                </td>
              </tr>
            ) : (
              logs.map((log) => {
                const actionConfig = getActionConfig(log.action);
                const ActionIcon = actionConfig.icon;
                const isExpanded = expandedRows.has(log.id);

                return (
                  <React.Fragment key={log.id}>
                    <tr className="hover:bg-lichen/30">
                      <td className="px-4 py-4">
                        <button
                          onClick={() => toggleRowExpanded(log.id)}
                          className="text-ink/50 hover:text-ink"
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-ink">
                          <Calendar size={14} className="mr-2 text-ink/40" />
                          {log.created_at ? formatDateTime(log.created_at) : '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded ${actionConfig.color}`}
                        >
                          <ActionIcon size={12} />
                          {actionConfig.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-ink">
                          {log.organization_name ? (
                            <>
                              <Building2 size={14} className="mr-2 text-ink/40" />
                              {log.organization_name}
                            </>
                          ) : (
                            <span className="text-ink/50">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center text-sm text-ink">
                          <User size={14} className="mr-2 text-ink/40" />
                          {log.performer_email || log.performer_name || 'System'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-ink max-w-md truncate">
                          {formatDetails(log)}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-parchment/50">
                        <td colSpan={6} className="px-6 py-4">
                          <div className="text-sm">
                            <h4 className="font-medium text-ink mb-2">Full Details</h4>
                            <pre className="bg-parchment p-3 rounded-md overflow-x-auto text-xs border border-lichen">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                            {log.ip_address && (
                              <div className="mt-2 text-ink/50">
                                <span className="font-medium">IP Address:</span> {log.ip_address}
                              </div>
                            )}
                            {log.user_agent && (
                              <div className="mt-1 text-ink/50">
                                <span className="font-medium">User Agent:</span>{' '}
                                <span className="truncate">{log.user_agent}</span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalCount > limit && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-ink/50">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevPage}
              disabled={offset === 0}
              className="px-3 py-1.5 text-sm border border-lichen rounded hover:bg-lichen/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ChevronLeft size={16} />
              Previous
            </button>
            <button
              onClick={handleNextPage}
              disabled={offset + limit >= totalCount}
              className="px-3 py-1.5 text-sm border border-lichen rounded hover:bg-lichen/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Email Tab
// ============================================================================

function EmailTab() {
  const { showToast } = useToast();
  const [emailSubTab, setEmailSubTab] = useState<'stats' | 'events' | 'users'>('stats');
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  // Stats state
  const [stats, setStats] = useState<EmailEventStats | null>(null);

  // Events state
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsOffset, setEventsOffset] = useState(0);
  const [eventTypeFilter, setEventTypeFilter] = useState<'bounce' | 'complaint' | ''>('');
  const [emailFilter, setEmailFilter] = useState('');

  // Users state
  const [users, setUsers] = useState<UserEmailStatus[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersOffset, setUsersOffset] = useState(0);
  const [userStatusFilter, setUserStatusFilter] = useState<'active' | 'bounced' | 'complaint' | ''>('');

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EmailEvent | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [bulkDeleteParams, setBulkDeleteParams] = useState<{
    event_type?: 'bounce' | 'complaint';
    before_date?: string;
    delete_all?: boolean;
  }>({});

  const limit = 50;

  // Load stats on mount
  useEffect(() => {
    loadStats();
  }, []);

  // Load events when sub-tab or filters change
  useEffect(() => {
    if (emailSubTab === 'events') {
      loadEvents();
    }
  }, [emailSubTab, eventsOffset, eventTypeFilter, emailFilter]);

  // Load users when sub-tab or filters change
  useEffect(() => {
    if (emailSubTab === 'users') {
      loadUsers();
    }
  }, [emailSubTab, usersOffset, userStatusFilter]);

  const loadStats = async () => {
    try {
      const data = await getEmailStats();
      setStats(data);
    } catch (err) {
      logger.error('Failed to load stats:', err);
      setError(err instanceof Error ? err.message : 'Failed to load statistics');
    }
  };

  const loadEvents = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getEmailEvents({
        event_type: eventTypeFilter || undefined,
        email: emailFilter || undefined,
        limit,
        offset: eventsOffset,
      });
      setEvents(response.items);
      setEventsTotal(response.total);
    } catch (err) {
      logger.error('Failed to load events:', err);
      setError(err instanceof Error ? err.message : 'Failed to load email events');
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getUsersByEmailStatus({
        status: userStatusFilter || undefined,
        limit,
        offset: usersOffset,
      });
      setUsers(response.items);
      setUsersTotal(response.total);
    } catch (err) {
      logger.error('Failed to load users:', err);
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUserStatus = async (userId: string, newStatus: 'active' | 'bounced' | 'complaint') => {
    try {
      setUpdatingUserId(userId);
      await updateUserEmailStatus(userId, newStatus);
      await loadUsers();
      await loadStats();
    } catch (err) {
      logger.error('Failed to update user status:', err);
      showToast({ type: 'error', title: 'Failed to update email status', message: err instanceof Error ? err.message : undefined });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleBulkDelete = async () => {
    setShowBulkDeleteConfirm(true);
  };

  const handleConfirmBulkDelete = async () => {
    setShowBulkDeleteConfirm(false);

    try {
      const result = await bulkDeleteEmailEvents(bulkDeleteParams);
      showToast({ type: 'success', title: result.message });
      setShowBulkDeleteModal(false);
      setBulkDeleteParams({});
      await loadEvents();
      await loadStats();
    } catch (err) {
      logger.error('Failed to bulk delete:', err);
      showToast({ type: 'error', title: 'Failed to bulk delete events', message: err instanceof Error ? err.message : undefined });
    }
  };

  const formatDate = (dateString: string) => formatDateTime(dateString);

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-semantic-success/10 text-semantic-success';
      case 'bounced': return 'bg-semantic-error/10 text-semantic-error';
      case 'complaint': return 'bg-semantic-warning/10 text-semantic-warning';
      default: return 'bg-lichen text-ink';
    }
  };

  const getEventTypeBadgeColor = (type: string) => {
    return type === 'bounce' ? 'bg-semantic-error/10 text-semantic-error' : 'bg-semantic-warning/10 text-semantic-warning';
  };

  return (
    <div>
      {error && (
        <div className="mb-4 p-4 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error">
          {error}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setEmailSubTab('stats')}
          className={`px-4 py-2 text-sm font-medium rounded-lg ${
            emailSubTab === 'stats'
              ? 'bg-forest text-parchment'
              : 'bg-lichen/30 text-ink hover:bg-lichen/50'
          }`}
        >
          <TrendingUp className="w-4 h-4 inline-block mr-2" />
          Statistics
        </button>
        <button
          onClick={() => setEmailSubTab('events')}
          className={`px-4 py-2 text-sm font-medium rounded-lg ${
            emailSubTab === 'events'
              ? 'bg-forest text-parchment'
              : 'bg-lichen/30 text-ink hover:bg-lichen/50'
          }`}
        >
          <Mail className="w-4 h-4 inline-block mr-2" />
          Events
        </button>
        <button
          onClick={() => setEmailSubTab('users')}
          className={`px-4 py-2 text-sm font-medium rounded-lg ${
            emailSubTab === 'users'
              ? 'bg-forest text-parchment'
              : 'bg-lichen/30 text-ink hover:bg-lichen/50'
          }`}
        >
          <Users className="w-4 h-4 inline-block mr-2" />
          Users
        </button>
      </div>

      {/* Statistics Sub-tab */}
      {emailSubTab === 'stats' && stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-parchment rounded-lg border border-lichen p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-ink/50">Bounces (30 days)</h3>
                <AlertTriangle className="w-5 h-5 text-semantic-error" />
              </div>
              <p className="text-3xl font-bold text-ink">{stats.last_30_days.bounces}</p>
            </div>

            <div className="bg-parchment rounded-lg border border-lichen p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-ink/50">Complaints (30 days)</h3>
                <ShieldAlert className="w-5 h-5 text-semantic-warning" />
              </div>
              <p className="text-3xl font-bold text-ink">{stats.last_30_days.complaints}</p>
            </div>

            <div className="bg-parchment rounded-lg border border-lichen p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-ink/50">Total Events (30 days)</h3>
                <Mail className="w-5 h-5 text-semantic-info" />
              </div>
              <p className="text-3xl font-bold text-ink">{stats.last_30_days.total_events}</p>
            </div>
          </div>

          <div className="bg-parchment rounded-lg border border-lichen p-6">
            <h3 className="text-lg font-semibold text-ink mb-4">User Email Status</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="border-l-4 border-semantic-success/30 pl-4">
                <p className="text-sm text-ink/50">Active</p>
                <p className="text-2xl font-bold text-ink">{stats.user_email_status.active}</p>
              </div>
              <div className="border-l-4 border-semantic-error/30 pl-4">
                <p className="text-sm text-ink/50">Bounced</p>
                <p className="text-2xl font-bold text-ink">{stats.user_email_status.bounced}</p>
              </div>
              <div className="border-l-4 border-semantic-warning/30 pl-4">
                <p className="text-sm text-ink/50">Complaints</p>
                <p className="text-2xl font-bold text-ink">{stats.user_email_status.complaint}</p>
              </div>
              <div className="border-l-4 border-semantic-info/30 pl-4">
                <p className="text-sm text-ink/50">Total Users</p>
                <p className="text-2xl font-bold text-ink">{stats.user_email_status.total}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Events Sub-tab */}
      {emailSubTab === 'events' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-parchment rounded-lg border border-lichen p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="email-event-type-filter" className="block text-sm font-medium text-ink mb-1">Event Type</label>
                <select
                  id="email-event-type-filter"
                  value={eventTypeFilter}
                  onChange={(e) => {
                    setEventTypeFilter(e.target.value as 'bounce' | 'complaint' | '');
                    setEventsOffset(0);
                  }}
                  className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                >
                  <option value="">All Types</option>
                  <option value="bounce">Bounce</option>
                  <option value="complaint">Complaint</option>
                </select>
              </div>
              <div>
                <label htmlFor="email-email-filter" className="block text-sm font-medium text-ink mb-1">Email Filter</label>
                <input
                  id="email-email-filter"
                  type="text"
                  value={emailFilter}
                  onChange={(e) => {
                    setEmailFilter(e.target.value);
                    setEventsOffset(0);
                  }}
                  placeholder="Search by email..."
                  className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={loadEvents}
                  className="px-4 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90 flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
                <button
                  onClick={() => setShowBulkDeleteModal(true)}
                  className="px-4 py-2 bg-semantic-error text-parchment rounded-lg hover:bg-semantic-error/80 flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Cleanup
                </button>
              </div>
            </div>
          </div>

          {/* Events List */}
          {loading ? (
            <div className="text-center py-8 text-ink/50">Loading events...</div>
          ) : events.length === 0 ? (
            <div className="text-center py-8 text-ink/50">No email events found</div>
          ) : (
            <>
              <div className="bg-parchment rounded-lg border border-lichen overflow-hidden">
                <table className="min-w-full divide-y divide-lichen">
                  <thead className="bg-parchment">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                        Event Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                        Details
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-parchment divide-y divide-lichen">
                    {events.map((event) => (
                      <tr key={event.event_id} className="hover:bg-lichen/30">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-ink">
                          {event.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getEventTypeBadgeColor(event.event_type)}`}>
                            {event.event_type}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-ink/70">
                          {event.bounce_type && `${event.bounce_type}${event.bounce_subtype ? ` - ${event.bounce_subtype}` : ''}`}
                          {event.complaint_feedback_type && event.complaint_feedback_type}
                          {!event.bounce_type && !event.complaint_feedback_type && '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-ink/70">
                          {formatDate(event.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => setSelectedEvent(event)}
                            className="text-forest hover:text-forest/80"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between bg-parchment px-4 py-3 rounded-lg border border-lichen">
                <div className="text-sm text-ink/50">
                  Showing {eventsOffset + 1} to {Math.min(eventsOffset + limit, eventsTotal)} of {eventsTotal} events
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEventsOffset(Math.max(0, eventsOffset - limit))}
                    disabled={eventsOffset === 0}
                    className="px-3 py-1.5 text-sm border border-lichen rounded hover:bg-lichen/30 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setEventsOffset(eventsOffset + limit)}
                    disabled={eventsOffset + limit >= eventsTotal}
                    className="px-3 py-1.5 text-sm border border-lichen rounded hover:bg-lichen/30 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Users Sub-tab */}
      {emailSubTab === 'users' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="bg-parchment rounded-lg border border-lichen p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="email-user-status-filter" className="block text-sm font-medium text-ink mb-1">Email Status</label>
                <select
                  id="email-user-status-filter"
                  value={userStatusFilter}
                  onChange={(e) => {
                    setUserStatusFilter(e.target.value as 'active' | 'bounced' | 'complaint' | '');
                    setUsersOffset(0);
                  }}
                  className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                >
                  <option value="">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="bounced">Bounced</option>
                  <option value="complaint">Complaint</option>
                </select>
              </div>
              <div className="flex items-end col-span-2">
                <button
                  onClick={loadUsers}
                  className="px-4 py-2 bg-forest text-parchment rounded-lg hover:bg-forest/90 flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
              </div>
            </div>
          </div>

          {/* Users List */}
          {loading ? (
            <div className="text-center py-8 text-ink/50">Loading users...</div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-ink/50">No users found</div>
          ) : (
            <>
              <div className="bg-parchment rounded-lg border border-lichen overflow-hidden">
                <table className="min-w-full divide-y divide-lichen">
                  <thead className="bg-parchment">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                        Email Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                        Account Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                        Created
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-parchment divide-y divide-lichen">
                    {users.map((user) => (
                      <tr key={user.user_id} className="hover:bg-lichen/30">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-ink">
                          {user.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadgeColor(user.email_status)}`}>
                            {user.email_status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-ink/70">
                          {user.status}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-ink/70">
                          {formatDate(user.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {updatingUserId === user.user_id ? (
                            <span className="text-ink/50">Updating...</span>
                          ) : (
                            <select
                              value={user.email_status}
                              onChange={(e) => handleUpdateUserStatus(user.user_id, e.target.value as 'active' | 'bounced' | 'complaint')}
                              aria-label={`Email status for ${user.email}`}
                              className="text-sm rounded border border-lichen focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                            >
                              <option value="active">Active</option>
                              <option value="bounced">Bounced</option>
                              <option value="complaint">Complaint</option>
                            </select>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between bg-parchment px-4 py-3 rounded-lg border border-lichen">
                <div className="text-sm text-ink/50">
                  Showing {usersOffset + 1} to {Math.min(usersOffset + limit, usersTotal)} of {usersTotal} users
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setUsersOffset(Math.max(0, usersOffset - limit))}
                    disabled={usersOffset === 0}
                    className="px-3 py-1.5 text-sm border border-lichen rounded hover:bg-lichen/30 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setUsersOffset(usersOffset + limit)}
                    disabled={usersOffset + limit >= usersTotal}
                    className="px-3 py-1.5 text-sm border border-lichen rounded hover:bg-lichen/30 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center p-4 z-50">
          <div className="bg-parchment rounded-lg max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-ink">Event Details</h2>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="text-ink/50 hover:text-ink"
                >
                  X
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-ink">Email</label>
                  <p className="mt-1 text-sm text-ink">{selectedEvent.email}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink">Event Type</label>
                  <p className="mt-1">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getEventTypeBadgeColor(selectedEvent.event_type)}`}>
                      {selectedEvent.event_type}
                    </span>
                  </p>
                </div>

                {selectedEvent.bounce_type && (
                  <div>
                    <label className="block text-sm font-medium text-ink">Bounce Type</label>
                    <p className="mt-1 text-sm text-ink">
                      {selectedEvent.bounce_type}
                      {selectedEvent.bounce_subtype && ` - ${selectedEvent.bounce_subtype}`}
                    </p>
                  </div>
                )}

                {selectedEvent.complaint_feedback_type && (
                  <div>
                    <label className="block text-sm font-medium text-ink">Complaint Type</label>
                    <p className="mt-1 text-sm text-ink">{selectedEvent.complaint_feedback_type}</p>
                  </div>
                )}

                {selectedEvent.message_id && (
                  <div>
                    <label className="block text-sm font-medium text-ink">SES Message ID</label>
                    <p className="mt-1 text-sm text-ink font-mono">{selectedEvent.message_id}</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-ink">Date</label>
                  <p className="mt-1 text-sm text-ink">{formatDate(selectedEvent.created_at)}</p>
                </div>

                {selectedEvent.raw_message && (
                  <div>
                    <label className="block text-sm font-medium text-ink mb-2">Raw SNS Message</label>
                    <pre className="mt-1 text-xs bg-parchment p-4 rounded border border-lichen overflow-auto max-h-96">
                      {JSON.stringify(selectedEvent.raw_message, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="px-4 py-2 border border-lichen rounded hover:bg-lichen/30"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center p-4 z-50">
          <div className="bg-parchment rounded-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-ink">Cleanup Email Events</h2>
              <button
                onClick={() => {
                  setShowBulkDeleteModal(false);
                  setBulkDeleteParams({});
                }}
                className="text-ink/50 hover:text-ink"
              >
                X
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="flex items-center space-x-2">
                  <Checkbox
                    checked={bulkDeleteParams.delete_all || false}
                    onChange={(e) => setBulkDeleteParams({ delete_all: e.target.checked })}
                    aria-label="Delete ALL events"
                  />
                  <span className="text-sm font-medium text-ink">Delete ALL events</span>
                </label>
              </div>

              {!bulkDeleteParams.delete_all && (
                <>
                  <div>
                    <label htmlFor="bulk-delete-type" className="block text-sm font-medium text-ink mb-1">Filter by Type</label>
                    <select
                      id="bulk-delete-type"
                      value={bulkDeleteParams.event_type || ''}
                      onChange={(e) => setBulkDeleteParams({
                        ...bulkDeleteParams,
                        event_type: e.target.value as 'bounce' | 'complaint' | undefined || undefined
                      })}
                      className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    >
                      <option value="">All Types</option>
                      <option value="bounce">Bounces Only</option>
                      <option value="complaint">Complaints Only</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="bulk-delete-before" className="block text-sm font-medium text-ink mb-1">Delete Events Before</label>
                    <input
                      id="bulk-delete-before"
                      type="date"
                      value={bulkDeleteParams.before_date || ''}
                      onChange={(e) => setBulkDeleteParams({
                        ...bulkDeleteParams,
                        before_date: e.target.value ? new Date(e.target.value).toISOString() : undefined
                      })}
                      className="w-full px-3 py-2 border border-lichen rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                    />
                  </div>
                </>
              )}

              <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded p-3">
                <p className="text-sm text-semantic-warning">
                  <strong>Warning:</strong> This action cannot be undone. Email events will be permanently deleted.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowBulkDeleteModal(false);
                  setBulkDeleteParams({});
                }}
                className="px-4 py-2 border border-lichen rounded hover:bg-lichen/30"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={!bulkDeleteParams.delete_all && !bulkDeleteParams.event_type && !bulkDeleteParams.before_date}
                className="px-4 py-2 bg-semantic-error text-parchment rounded hover:bg-semantic-error/80 disabled:opacity-50"
              >
                Delete Events
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showBulkDeleteConfirm}
        onClose={() => setShowBulkDeleteConfirm(false)}
        onConfirm={handleConfirmBulkDelete}
        title="Delete Email Events"
        message={
          bulkDeleteParams.delete_all
            ? 'Delete ALL email events? This action cannot be undone.'
            : 'Delete the selected email events? This action cannot be undone.'
        }
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
