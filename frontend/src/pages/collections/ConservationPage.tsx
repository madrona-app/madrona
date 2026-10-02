import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Wrench, Clock, PlayCircle, CheckCircle, User, DollarSign, Plus, Search, X, Sparkles } from 'lucide-react';
import { getConservationTreatments } from '../../lib/api';
import type { ConservationTreatment as Treatment } from '../../lib/schemas';
import { formatDateShort, formatCurrency, formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const STATUS_STYLES: Record<string, string> = {
  proposed: 'bg-semantic-warning/10 text-semantic-warning',
  approved: 'bg-semantic-info/10 text-semantic-info',
  in_progress: 'bg-bark/10 text-bark',
  completed: 'bg-semantic-success/10 text-semantic-success',
  cancelled: 'bg-stone text-ink',
};

const TYPE_LABELS: Record<string, string> = {
  preventive: 'Preventive',
  remedial: 'Remedial',
  restoration: 'Restoration',
  analysis: 'Analysis',
  other: 'Other',
};

const LIMIT = 25;
const SCROLL_KEY = 'conservation-scroll';

function TreatmentRow({ treatment, orgId }: { treatment: Treatment; orgId: string }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <tr
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/conservation/${treatment.treatment_id}`}
          className="text-bark hover:text-copper-dark font-medium no-underline"
        >
          {treatment.treatment_number}
        </Link>
        {treatment.proposal_summary && (
          <p className="text-sm text-archive mt-0.5 line-clamp-1">
            {treatment.proposal_summary}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-ink">
        {TYPE_LABELS[treatment.treatment_type] || treatment.treatment_type}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <User size={16} className="text-archive" />
          <div>
            <span className="text-ink">{treatment.conservator_name || '—'}</span>
            {treatment.conservator_institution && (
              <p className="text-xs text-archive">{treatment.conservator_institution}</p>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm">
          {treatment.start_date && treatment.end_date ? (
            <span className="text-ink">
              {formatDateShort(treatment.start_date)} – {formatDateShort(treatment.end_date)}
            </span>
          ) : treatment.start_date ? (
            <span className="text-ink">
              Started {formatDateShort(treatment.start_date)}
            </span>
          ) : treatment.proposal_date ? (
            <span className="text-archive">
              Proposed {formatDateShort(treatment.proposal_date)}
            </span>
          ) : (
            <span className="text-archive">—</span>
          )}
          {treatment.estimated_duration_days && treatment.status !== 'completed' && (
            <p className="text-xs text-archive">
              Est. {treatment.estimated_duration_days} days
            </p>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-ink">
          {treatment.estimated_cost
            ? formatCurrency(treatment.estimated_cost, treatment.estimated_cost_currency || 'USD', 0)
            : '—'}
        </span>
        {treatment.actual_cost && (
          <p className="text-xs text-archive">
            Actual: {formatCurrency(treatment.actual_cost, 'USD', 0)}
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[treatment.status] || 'bg-stone text-ink'}`}>
          {treatment.status.replace('_', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
        </span>
      </td>
    </tr>
  );
}

export default function ConservationPage() {
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
    queryKey: ['conservation', orgId, debouncedSearch, statusFilter, typeFilter, offset],
    queryFn: () => getConservationTreatments(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      treatment_type: typeFilter || undefined,
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
          Error loading conservation treatments: {(error as Error).message}
        </div>
      </div>
    );
  }

  const treatments = data?.items || [];

  // Calculate stats
  const inProgressCount = treatments.filter(t => t.status === 'in_progress').length;
  const awaitingApproval = treatments.filter(t => t.status === 'proposed').length;
  const completedCount = treatments.filter(t => t.status === 'completed').length;
  const totalEstimatedCost = treatments
    .filter(t => t.status === 'proposed' || t.status === 'approved')
    .reduce((sum, t) => sum + (t.estimated_cost || 0), 0);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Wrench size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Conservation</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No treatments yet</span>
                  : data.total === 1 ? <span>1 treatment</span>
                  : <span>{formatNumber(data.total)} treatments</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          <Link
            to={`/organizations/${orgId}/collections/conservation/create`}
            className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
          >
            <Plus size={18} />
            New Conservation Treatment
          </Link>
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Records conservation treatments, preventive care activities, and ongoing stewardship actions. Documents decisions, methods, and outcomes related to preserving objects over time.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-bark/10 rounded-lg flex items-center justify-center">
              <PlayCircle size={20} className="text-bark" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{inProgressCount}</p>
              <p className="text-sm text-archive">In Progress</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-warning/10 rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-semantic-warning" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{awaitingApproval}</p>
              <p className="text-sm text-archive">Awaiting Approval</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-success/10 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{completedCount}</p>
              <p className="text-sm text-archive">Completed</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-copper/10 rounded-lg flex items-center justify-center">
              <DollarSign size={20} className="text-copper" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">
                {formatCurrency(totalEstimatedCost, 'USD', 0)}
              </p>
              <p className="text-sm text-archive">Pending Budget</p>
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
              placeholder="Search treatments..."
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
            <option value="proposed">Proposed</option>
            <option value="approved">Approved</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
          >
            <option value="">All Types</option>
            <option value="preventive">Preventive</option>
            <option value="remedial">Remedial</option>
            <option value="restoration">Restoration</option>
            <option value="analysis">Analysis</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* Content Card */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {/* Table */}
        {treatments.length > 0 ? (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Treatment Number</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Conservator</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Dates</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Est. Cost</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {treatments.map((treatment) => (
                <TreatmentRow
                  key={treatment.treatment_id}
                  treatment={treatment}
                  orgId={orgId!}
                />
              ))}
            </tbody>
          </table>
        ) : (debouncedSearch || statusFilter || typeFilter) ? (
          /* L08 — No search results */
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No conservation records match your search</h3>
            <p className="text-archive max-w-md mx-auto mb-6">We couldn&apos;t find any conservation records matching &ldquo;{searchQuery}&rdquo;. Try adjusting your search terms.</p>
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
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No conservation records yet.</h3>
          </div>
        )}

        {/* L09 — Pagination */}
        {data && data.total > LIMIT && (
          <div className="px-4 py-3 border-t border-lichen flex items-center justify-between">
            <p className="text-sm text-accessible-gray">Showing {offset + 1} – {Math.min(offset + LIMIT, data.total)} of {data.total}</p>
            <div className="flex gap-2">
              <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="btn btn-tertiary text-sm">Previous</button>
              <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= data.total} className="btn btn-tertiary text-sm">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
