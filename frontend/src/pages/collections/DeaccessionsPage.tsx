import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Trash2, AlertTriangle, FileText, Gavel, CheckCircle, Clock, Plus, Search, X, Sparkles } from 'lucide-react';
import { getDeaccessions } from '../../lib/api';
import { formatDateShort, formatCurrency, formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const STATUS_STYLES: Record<string, string> = {
  proposed: 'bg-semantic-warning/10 text-semantic-warning',
  under_review: 'bg-semantic-info/10 text-semantic-info',
  committee_reviewed: 'bg-bark/10 text-bark',
  pending_board: 'bg-copper/10 text-copper',
  approved: 'bg-semantic-success/10 text-semantic-success',
  in_progress: 'bg-forest/10 text-forest',
  completed: 'bg-stone text-ink',
  cancelled: 'bg-stone text-ink',
  rejected: 'bg-semantic-error/10 text-semantic-error',
};

const REASON_LABELS: Record<string, string> = {
  duplicate: 'Duplicate',
  outside_scope: 'Outside Scope',
  deterioration: 'Deterioration',
  damage: 'Damage',
  repatriation: 'Repatriation',
  theft_loss: 'Theft/Loss',
  exchange: 'Exchange',
  ethical: 'Ethical Concerns',
  donor_request: 'Donor Request',
  legal_requirement: 'Legal Requirement',
  hazard: 'Hazard',
  other: 'Other',
};

const METHOD_LABELS: Record<string, string> = {
  sale: 'Sale',
  gift: 'Gift',
  exchange: 'Exchange',
  destruction: 'Destruction',
  repatriation: 'Repatriation',
  transfer: 'Transfer',
  return_to_donor: 'Return to Donor',
  write_off: 'Write-off',
  other: 'Other',
};

const SCROLL_KEY = 'deaccessions-scroll';
const LIMIT = 25;

function DeaccessionRow({ deaccession, orgId }: { deaccession: any; orgId: string }) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <tr
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/deaccessions/${deaccession.deaccession_id}`}
          className="text-bark hover:text-copper-dark font-medium no-underline"
        >
          {deaccession.deaccession_number}
        </Link>
        {deaccession.justification && (
          <p className="text-sm text-archive mt-0.5 line-clamp-1">
            {deaccession.justification}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-ink">
        {REASON_LABELS[deaccession.reason] || deaccession.reason}
      </td>
      <td className="px-4 py-3 text-ink">
        {deaccession.disposal_method
          ? METHOD_LABELS[deaccession.disposal_method] || deaccession.disposal_method
          : '\u2014'}
      </td>
      <td className="px-4 py-3 text-ink">
        {deaccession.appraised_value
          ? formatCurrency(deaccession.appraised_value, deaccession.appraised_value_currency || 'USD', 0)
          : '\u2014'}
      </td>
      <td className="px-4 py-3 text-ink">
        {formatDateShort(deaccession.proposal_date)}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[deaccession.status] || 'bg-stone text-ink'}`}>
          {deaccession.status.replace('_', ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
        </span>
      </td>
    </tr>
  );
}

export default function DeaccessionsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [reasonFilter, setReasonFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);

  // L10 — Scroll persistence
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) { sessionStorage.removeItem(SCROLL_KEY); requestAnimationFrame(() => { document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10)); }); }
  }, []);

  useEffect(() => {
    return () => { sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0))); };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['deaccessions', orgId, debouncedSearch, statusFilter, reasonFilter, offset],
    queryFn: () => getDeaccessions(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      reason: reasonFilter || undefined,
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
          Error loading deaccessions: {(error as Error).message}
        </div>
      </div>
    );
  }

  const deaccessions = data?.items || [];

  // Stats
  const needingReview = deaccessions.filter(d =>
    d.status === 'proposed' || d.status === 'under_review'
  ).length;
  const pendingBoard = deaccessions.filter(d => d.status === 'pending_board').length;
  const inProgress = deaccessions.filter(d =>
    d.status === 'approved' || d.status === 'in_progress'
  ).length;
  const completedCount = deaccessions.filter(d => d.status === 'completed').length;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg p-6">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Trash2 size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Deaccessioning</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No deaccessions yet</span>
                  : data.total === 1 ? <span>1 deaccession</span>
                  : <span>{formatNumber(data.total)} deaccessions</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          <Link
            to={`/organizations/${orgId}/collections/deaccessions/create`}
            className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
          >
            <Plus size={18} />
            New Deaccession
          </Link>
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Documents the formal decision to permanently remove objects from the collection. Records approvals, rationale, and compliance with institutional policy.
        </p>
      </div>

      {/* Warning Banner */}
      <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-semantic-warning mt-0.5" />
          <div>
            <h3 className="font-medium text-ink">Deaccession Review Process</h3>
            <p className="text-sm text-archive mt-1">
              Deaccessions require committee review and board approval before completion.
              All actions are fully audited.
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-warning/10 rounded-lg flex items-center justify-center">
              <FileText size={20} className="text-semantic-warning" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{needingReview}</p>
              <p className="text-sm text-archive">Needs Review</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-copper/10 rounded-lg flex items-center justify-center">
              <Gavel size={20} className="text-copper" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{pendingBoard}</p>
              <p className="text-sm text-archive">Pending Board</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-forest/10 rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{inProgress}</p>
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
      </div>

      {/* Search Hero Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 w-full">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              placeholder="Search deaccessions..."
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
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-44"
          >
            <option value="">All Statuses</option>
            <option value="proposed">Proposed</option>
            <option value="under_review">Under Review</option>
            <option value="committee_reviewed">Committee Reviewed</option>
            <option value="pending_board">Pending Board</option>
            <option value="approved">Approved</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            value={reasonFilter}
            onChange={(e) => { setReasonFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-44"
          >
            <option value="">All Reasons</option>
            <option value="duplicate">Duplicate</option>
            <option value="outside_scope">Outside Scope</option>
            <option value="deterioration">Deterioration</option>
            <option value="damage">Damage</option>
            <option value="repatriation">Repatriation</option>
            <option value="ethical">Ethical Concerns</option>
            <option value="donor_request">Donor Request</option>
            <option value="legal_requirement">Legal Requirement</option>
          </select>
        </div>
      </div>

      {/* Content Card */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {/* Table */}
        {deaccessions.length > 0 ? (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Deaccession Number</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Reason</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Disposal Method</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Appraised Value</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Proposal Date</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {deaccessions.map((deaccession) => (
                <DeaccessionRow key={deaccession.deaccession_id} deaccession={deaccession} orgId={orgId!} />
              ))}
            </tbody>
          </table>
        ) : debouncedSearch || statusFilter || reasonFilter ? (
          /* L08 — No search results */
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">
              No deaccessions match your search
            </h3>
            <p className="text-archive max-w-md mx-auto mb-6">
              We couldn&apos;t find any deaccessions matching &ldquo;{searchQuery || statusFilter || reasonFilter}&rdquo;. Try adjusting your search terms.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setSearchQuery(''); setStatusFilter(''); setReasonFilter(''); }} className="btn btn-secondary">
                <X size={16} className="mr-1.5" />
                Clear filters
              </button>
            </div>
          </div>
        ) : (
          /* L08 — First time / no data */
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No deaccessions yet.</h3>
          </div>
        )}
      </div>

      {/* L09 — Pagination */}
      {data && data.total > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">
            Showing {offset + 1} - {Math.min(offset + LIMIT, data.total)} of {data.total}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="btn btn-tertiary text-sm">Previous</button>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= data.total} className="btn btn-tertiary text-sm">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
