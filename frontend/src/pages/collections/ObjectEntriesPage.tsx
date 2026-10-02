import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Package, ArrowDownToLine, Clock, CheckCircle, Plus, Search, X, Sparkles } from 'lucide-react';
import { getObjectEntries } from '../../lib/api';
import type { ObjectEntry } from '../../lib/schemas';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { usePermissions } from '../../hooks/usePermissions';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-semantic-warning/10 text-semantic-warning',
  received: 'bg-semantic-info/10 text-semantic-info',
  processing: 'bg-copper/10 text-copper',
  processed: 'bg-bark/10 text-bark',
  returned: 'bg-stone text-ink',
  acquired: 'bg-semantic-success/10 text-semantic-success',
};

const REASON_LABELS: Record<string, string> = {
  loan_consideration: 'Loan Consideration',
  gift_offer: 'Gift Offer',
  identification: 'Identification',
  conservation: 'Conservation',
  enquiry: 'Enquiry',
  other: 'Other',
};

const LIMIT = 25;
const SCROLL_KEY = 'object-entries-scroll';

function EntryRow({ entry, onClick }: { entry: ObjectEntry; onClick: () => void }) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <span className="text-bark hover:text-copper-dark font-medium">
          {entry.entry_number}
        </span>
      </td>
      <td className="px-4 py-3 text-ink">
        {formatDateShort(entry.entry_date)}
      </td>
      <td className="px-4 py-3 text-ink">{entry.depositor_name || '—'}</td>
      <td className="px-4 py-3 text-ink">
        {REASON_LABELS[entry.reason] || entry.reason}
      </td>
      <td className="px-4 py-3 text-ink">{entry.objects_count}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[entry.status] || 'bg-stone text-ink'}`}>
          {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
        </span>
      </td>
    </tr>
  );
}

export default function ObjectEntriesPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
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
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, statusFilter, reasonFilter]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['object-entries', orgId, debouncedSearch, statusFilter, reasonFilter, offset],
    queryFn: () => getObjectEntries(orgId!, {
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
          Error loading object entries: {(error as Error).message}
        </div>
      </div>
    );
  }

  const entries = data?.items || [];

  const handleEntryClick = (id: string) => {
    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    navigate(`/organizations/${orgId}/collections/entries/${id}`);
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Package size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Object Entry</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No entries yet</span>
                  : data.total === 1 ? <span>1 entry</span>
                  : <span>{formatNumber(data.total)} entries</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          {hasPermission('collections.create') ? (
            <Link
              to={`/organizations/${orgId}/collections/entries/create`}
              className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
            >
              <Plus size={18} />
              New Entry
            </Link>
          ) : (
            <span className="flex items-center justify-center gap-2 px-4 py-2 bg-archive/50 text-parchment rounded-lg cursor-not-allowed shrink-0 sm:self-auto self-start" title="Requires collections.create permission">
              <Plus size={18} />
              New Entry
            </span>
          )}
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Records the temporary receipt of objects into institutional custody prior to accession, loan processing, or return. Used when objects enter the institution for evaluation, conservation, photography, or other short-term purposes. Does not confer ownership or create an accession record.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-warning/10 rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-semantic-warning" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {entries.filter(e => e.status === 'pending').length}
              </p>
              <p className="text-sm text-archive">Pending</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-forest/10 rounded-lg flex items-center justify-center">
              <ArrowDownToLine size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {entries.filter(e => e.status === 'received').length}
              </p>
              <p className="text-sm text-archive">Received</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-bark/10 rounded-lg flex items-center justify-center">
              <Package size={20} className="text-bark" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {entries.filter(e => e.status === 'processed').length}
              </p>
              <p className="text-sm text-archive">Processing</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-success/10 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {entries.filter(e => e.status === 'acquired').length}
              </p>
              <p className="text-sm text-archive">Acquired</p>
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
              placeholder="Search entries..."
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
            <option value="pending">Pending</option>
            <option value="received">Received</option>
            <option value="processing">Processing</option>
            <option value="processed">Processed</option>
            <option value="returned">Returned</option>
            <option value="acquired">Acquired</option>
          </select>
          <select
            value={reasonFilter}
            onChange={(e) => { setReasonFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
          >
            <option value="">All Reasons</option>
            <option value="loan_consideration">Loan Consideration</option>
            <option value="gift_offer">Gift Offer</option>
            <option value="identification">Identification</option>
            <option value="conservation">Conservation</option>
            <option value="enquiry">Enquiry</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* Content Card */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {/* Table */}
        {entries.length > 0 ? (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Entry Number</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Date</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Depositor</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Reason</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Objects</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {entries.map((entry) => (
                <EntryRow
                  key={entry.entry_id}
                  entry={entry}
                  onClick={() => handleEntryClick(entry.entry_id)}
                />
              ))}
            </tbody>
          </table>
        ) : (debouncedSearch || statusFilter || reasonFilter) ? (
          /* L08 — No search results */
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No entries match your search</h3>
            <p className="text-archive max-w-md mx-auto mb-6">We couldn&apos;t find any entries matching &ldquo;{searchQuery}&rdquo;. Try adjusting your search terms.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setSearchQuery(''); setStatusFilter(''); setReasonFilter(''); }} className="btn btn-secondary"><X size={16} className="mr-1.5" />Clear filters</button>
            </div>
          </div>
        ) : (
          /* L08 — First time empty state */
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No entries yet.</h3>
            {hasPermission('collections.create') && (
              <Link
                to={`/organizations/${orgId}/collections/entries/create`}
                className="btn btn-primary inline-flex items-center gap-2 no-underline"
              >
                <Plus size={18} />
                New Entry
              </Link>
            )}
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
