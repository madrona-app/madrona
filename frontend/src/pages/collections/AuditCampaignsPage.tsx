import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, Plus, PlayCircle, FileText, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { getAuditCampaigns } from '../../lib/api';
import { formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  approved: 'bg-semantic-success/10 text-semantic-success',
  in_progress: 'bg-forest/10 text-forest',
  completed: 'bg-stone text-archive',
  cancelled: 'bg-stone text-archive',
};

const TYPE_LABELS: Record<string, string> = {
  location: 'Location Audit',
  condition: 'Condition Audit',
  documentation: 'Documentation Audit',
  security: 'Security Audit',
  comprehensive: 'Comprehensive',
  spot_check: 'Spot Check',
  annual: 'Annual Audit',
};

const LIMIT = 25;
const SCROLL_KEY = 'audit-campaigns-scroll';

function CampaignRow({ campaign, orgId }: { campaign: any; orgId: string }) {
  const [isHovered, setIsHovered] = useState(false);
  const progress = campaign.items_total > 0
    ? Math.round((campaign.items_audited / campaign.items_total) * 100)
    : 0;

  return (
    <tr
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/audits/${campaign.audit_id}`}
          className="text-bark hover:text-copper-dark font-medium"
          onClick={() => sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)))}
        >
          {campaign.title || campaign.audit_number || campaign.audit_id.slice(0, 8)}
        </Link>
        {campaign.scope && (
          <p className="text-sm text-archive mt-0.5 line-clamp-1">
            {campaign.scope}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-ink">
        {TYPE_LABELS[campaign.audit_type] || campaign.audit_type}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-stone rounded-full overflow-hidden max-w-[80px]">
            <div
              className="h-full bg-forest rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-sm text-archive">
            {campaign.items_audited}/{campaign.items_total}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        {campaign.accuracy_rate !== null ? (
          <span className={`font-semibold ${
            campaign.accuracy_rate >= 95 ? 'text-semantic-success' :
            campaign.accuracy_rate >= 90 ? 'text-semantic-warning' :
            'text-semantic-error'
          }`}>
            {campaign.accuracy_rate.toFixed(1)}%
          </span>
        ) : (
          <span className="text-archive">&mdash;</span>
        )}
      </td>
      <td className="px-4 py-3">
        {campaign.discrepancies_found > 0 ? (
          <span className="inline-flex items-center gap-1 text-semantic-warning">
            <AlertTriangle size={14} />
            {campaign.discrepancies_found}
          </span>
        ) : (
          <span className="text-archive">0</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[campaign.status] || 'bg-stone text-archive'}`}>
          {campaign.status.replace('_', ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
        </span>
      </td>
    </tr>
  );
}

export default function AuditCampaignsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);

  // L10: Restore scroll on mount
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) sessionStorage.removeItem(SCROLL_KEY);
    if (saved) {
      requestAnimationFrame(() => {
        document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10));
      });
    }
  }, []);

  // L10: Save scroll on unmount
  useEffect(() => {
    return () => {
      sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading, isFetching: _isFetching, error } = useQuery({
    queryKey: ['audit-campaigns', orgId, debouncedSearch, statusFilter, typeFilter, offset],
    queryFn: () => getAuditCampaigns(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      audit_type: typeFilter || undefined,
      limit: LIMIT,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const showSkeleton = isLoading && !data;

  if (showSkeleton) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <MadronaLoader label="Loading…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          Error loading audit campaigns: {(error as Error).message}
        </div>
      </div>
    );
  }

  const campaigns = data?.items || [];

  // Stats
  const draftCount = campaigns.filter(c => c.status === 'draft').length;
  const inProgressCount = campaigns.filter(c => c.status === 'in_progress').length;
  const completedCount = campaigns.filter(c => c.status === 'completed').length;

  // Calculate average accuracy rate
  const completedWithRate = campaigns.filter(c => c.status === 'completed' && c.accuracy_rate !== null);
  const avgAccuracy = completedWithRate.length > 0
    ? completedWithRate.reduce((sum, c) => sum + (c.accuracy_rate || 0), 0) / completedWithRate.length
    : null;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg p-6">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Search size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Audit</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No audits yet</span>
                  : data.total === 1 ? <span>1 audit</span>
                  : <span>{formatNumber(data.total)} audits</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          <Link
            to={`/organizations/${orgId}/collections/audits/create`}
            className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
          >
            <Plus size={18} />
            New Audit
          </Link>
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Manages structured audits of collection records and physical holdings. Used to assess compliance, data quality, and institutional accountability.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone rounded-lg flex items-center justify-center">
              <FileText size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{draftCount}</p>
              <p className="text-sm text-archive">Planned</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-forest/10 rounded-lg flex items-center justify-center">
              <PlayCircle size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{inProgressCount}</p>
              <p className="text-sm text-archive">In Progress</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{completedCount}</p>
              <p className="text-sm text-archive">Completed</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              avgAccuracy !== null && avgAccuracy >= 95 ? 'bg-semantic-success/10' :
              avgAccuracy !== null && avgAccuracy >= 90 ? 'bg-semantic-warning/10' :
              'bg-stone'
            }`}>
              <Search size={20} className={
                avgAccuracy !== null && avgAccuracy >= 95 ? 'text-semantic-success' :
                avgAccuracy !== null && avgAccuracy >= 90 ? 'text-semantic-warning' :
                'text-archive'
              } />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {avgAccuracy !== null ? `${avgAccuracy.toFixed(1)}%` : '—'}
              </p>
              <p className="text-sm text-archive">Avg Accuracy</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              placeholder="Search audits..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-full pl-12 pr-4 py-3 text-lg"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-archive hover:text-ink">
                <X size={18} />
              </button>
            )}
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Types</option>
            <option value="location">Location Audit</option>
            <option value="condition">Condition Audit</option>
            <option value="documentation">Documentation Audit</option>
            <option value="security">Security Audit</option>
            <option value="comprehensive">Comprehensive</option>
            <option value="spot_check">Spot Check</option>
            <option value="annual">Annual Audit</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-stone/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Campaign</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Progress</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Accuracy</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Discrepancies</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-lichen">
            {campaigns.map((campaign) => (
              <CampaignRow key={campaign.audit_id} campaign={campaign} orgId={orgId!} />
            ))}
          </tbody>
        </table>

        {campaigns.length === 0 && (
          <div className="text-center py-12">
            <Search size={48} className="mx-auto text-archive mb-4" />
            <h3 className="text-lg font-serif font-medium text-forest mb-2">No audit campaigns</h3>
            <p className="text-accessible-gray mb-4">Start an inventory audit campaign.</p>
            <Link
              to={`/organizations/${orgId}/collections/audits/create`}
              className="btn btn-primary inline-flex items-center gap-2 no-underline"
            >
              New Audit
            </Link>
          </div>
        )}
      </div>

      {/* L09: Pagination */}
      {data && data.total > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">
            Showing {offset + 1} - {Math.min(offset + LIMIT, data.total)} of {data.total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              disabled={offset === 0}
              className="btn btn-tertiary text-sm"
            >
              Previous
            </button>
            <button
              onClick={() => setOffset(offset + LIMIT)}
              disabled={offset + LIMIT >= data.total}
              className="btn btn-tertiary text-sm"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
