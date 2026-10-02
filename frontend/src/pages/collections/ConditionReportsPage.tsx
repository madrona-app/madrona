import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { FileText, ClipboardCheck, Plus, Search, Sparkles, X } from 'lucide-react';
import { getConditionReports } from '../../lib/api';
import type { ConditionReport } from '../../lib/schemas';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-ink',
  completed: 'bg-semantic-info/10 text-semantic-info',
  reviewed: 'bg-semantic-success/10 text-semantic-success',
};

const CONDITION_STYLES: Record<string, string> = {
  excellent: 'bg-semantic-success/10 text-semantic-success',
  good: 'bg-semantic-info/10 text-semantic-info',
  fair: 'bg-semantic-warning/10 text-semantic-warning',
  poor: 'bg-copper/10 text-copper',
  unacceptable: 'bg-semantic-error/10 text-semantic-error',
};

const REPORT_TYPE_LABELS: Record<string, string> = {
  intake: 'Intake',
  loan_out: 'Loan Out',
  loan_in: 'Loan In',
  periodic: 'Periodic',
  conservation: 'Conservation',
  incident: 'Incident',
};

const SCROLL_KEY = 'condition-reports-scroll';
const LIMIT = 25;

function ConditionReportRow({ report, orgId }: { report: ConditionReport; orgId: string }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <tr
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/condition-reports/${report.report_id}`}
          className="text-bark hover:text-copper-dark font-medium no-underline"
        >
          {report.report_number}
        </Link>
      </td>
      <td className="px-4 py-3 text-ink">
        {REPORT_TYPE_LABELS[report.report_type] || report.report_type}
      </td>
      <td className="px-4 py-3 text-ink">
        {formatDateShort(report.report_date)}
      </td>
      <td className="px-4 py-3">
        {report.overall_condition ? (
          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${CONDITION_STYLES[report.overall_condition] || 'bg-stone text-ink'}`}>
            {report.overall_condition.charAt(0).toUpperCase() + report.overall_condition.slice(1)}
          </span>
        ) : (
          <span className="text-sm text-archive">Not assessed</span>
        )}
      </td>
      <td className="px-4 py-3 text-ink">{report.examiner_name || '—'}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[report.status] || 'bg-stone text-ink'}`}>
          {report.status.charAt(0).toUpperCase() + report.status.slice(1)}
        </span>
      </td>
    </tr>
  );
}

export default function ConditionReportsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);

  // L10 — Scroll persistence
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) { sessionStorage.removeItem(SCROLL_KEY); requestAnimationFrame(() => { document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10)); }); }
  }, []);
  useEffect(() => { return () => { sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0))); }; }, []);

  // Debounce search query to avoid API calls on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['condition-reports', orgId, debouncedSearch, statusFilter, typeFilter, offset],
    queryFn: () => getConditionReports(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      report_type: typeFilter || undefined,
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
          Error loading condition reports: {(error as Error).message}
        </div>
      </div>
    );
  }

  const reports = data?.items || [];

  // Stats
  const draftCount = reports.filter(r => r.status === 'draft').length;
  const completedCount = reports.filter(r => r.status === 'completed').length;
  const reviewedCount = reports.filter(r => r.status === 'reviewed').length;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <ClipboardCheck size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Condition Reports</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No condition reports yet</span>
                  : data.total === 1 ? <span>1 condition report</span>
                  : <span>{formatNumber(data.total)} condition reports</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          <Link
            to={`/organizations/${orgId}/collections/condition-reports/create`}
            className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
          >
            <Plus size={18} />
            New Condition Report
          </Link>
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Documents the physical condition of objects at specific points in time. Used to assess stability, identify damage, and support loans, conservation, and risk management.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone rounded-lg flex items-center justify-center">
              <FileText size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{draftCount}</p>
              <p className="text-sm text-archive">Drafts</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-forest/10 rounded-lg flex items-center justify-center">
              <ClipboardCheck size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{completedCount}</p>
              <p className="text-sm text-archive">Completed</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-success/10 rounded-lg flex items-center justify-center">
              <ClipboardCheck size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{reviewedCount}</p>
              <p className="text-sm text-archive">Reviewed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 w-full">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              placeholder="Search reports..."
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
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="completed">Completed</option>
            <option value="reviewed">Reviewed</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
          >
            <option value="">All Types</option>
            <option value="intake">Intake</option>
            <option value="loan_out">Loan Out</option>
            <option value="loan_in">Loan In</option>
            <option value="periodic">Periodic</option>
            <option value="conservation">Conservation</option>
            <option value="incident">Incident</option>
          </select>
        </div>
      </div>

      {/* Content Card */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {/* Table */}
        {reports.length > 0 ? (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Report Number</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Date</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Condition</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Examiner</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {reports.map((report) => (
                <ConditionReportRow
                  key={report.report_id}
                  report={report}
                  orgId={orgId!}
                />
              ))}
            </tbody>
          </table>
        ) : (searchQuery || statusFilter || typeFilter) ? (
          /* L08 — No search results */
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No condition reports match your search</h3>
            <p className="text-archive max-w-md mx-auto mb-6">We couldn&apos;t find any condition reports matching &ldquo;{searchQuery || statusFilter || typeFilter}&rdquo;. Try adjusting your search terms.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setSearchQuery(''); setStatusFilter(''); setTypeFilter(''); }} className="btn btn-secondary"><X size={16} className="mr-1.5" />Clear filters</button>
            </div>
          </div>
        ) : (
          /* L08 — First time empty state */
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No condition reports yet.</h3>
          </div>
        )}
      </div>

      {/* L09 — Pagination */}
      {data && data.total > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">Showing {offset + 1} - {Math.min(offset + LIMIT, data.total)} of {data.total}</p>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="btn btn-tertiary text-sm">Previous</button>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= data.total} className="btn btn-tertiary text-sm">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
