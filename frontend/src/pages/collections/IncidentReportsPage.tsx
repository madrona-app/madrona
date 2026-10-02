import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Search, CheckCircle, FileText, Sparkles, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { getIncidentReports } from '../../lib/api';
import { formatDateShort } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const LIMIT = 25;
const SCROLL_KEY = 'incident-reports-scroll';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-stone text-archive',
  submitted: 'bg-semantic-info/10 text-semantic-info',
  under_investigation: 'bg-semantic-warning/10 text-semantic-warning',
  resolved: 'bg-semantic-success/10 text-semantic-success',
  closed: 'bg-stone text-archive',
};

const TYPE_LABELS: Record<string, string> = {
  damage: 'Damage',
  loss: 'Loss',
  theft: 'Theft',
  vandalism: 'Vandalism',
  environmental: 'Environmental',
  fire: 'Fire',
  water: 'Water',
  pest: 'Pest',
  other: 'Other',
};

const TYPE_STYLES: Record<string, string> = {
  damage: 'bg-semantic-warning/10 text-semantic-warning',
  loss: 'bg-semantic-error/10 text-semantic-error',
  theft: 'bg-semantic-error/10 text-semantic-error',
  vandalism: 'bg-semantic-error/10 text-semantic-error',
  environmental: 'bg-bark/10 text-bark',
  fire: 'bg-semantic-error/10 text-semantic-error',
  water: 'bg-semantic-info/10 text-semantic-info',
  pest: 'bg-copper/10 text-copper',
  other: 'bg-stone text-archive',
};

function IncidentRow({ report, orgId, saveScrollPosition }: { report: any; orgId: string; saveScrollPosition: () => void }) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <tr
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/incidents/${report.report_id}`}
          onClick={saveScrollPosition}
          className="text-bark hover:text-copper-dark font-medium"
        >
          {report.report_number || report.report_id.slice(0, 8)}
        </Link>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${TYPE_STYLES[report.incident_type || ''] || 'bg-stone text-archive'}`}>
          {TYPE_LABELS[report.incident_type || ''] || report.incident_type || 'Unknown'}
        </span>
      </td>
      <td className="px-4 py-3 text-accessible-gray">
        {formatDateShort(report.incident_date)}
      </td>
      <td className="px-4 py-3 text-ink max-w-xs truncate">
        {report.incident_description || '\u2014'}
      </td>
      <td className="px-4 py-3 text-ink">
        {report.affected_objects?.length || 0}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[report.status || 'draft'] || 'bg-stone text-archive'}`}>
          {(report.status || 'draft').replace('_', ' ').split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
        </span>
      </td>
    </tr>
  );
}

export default function IncidentReportsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const scrollRef = useRef<number>(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, statusFilter, typeFilter]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['incident-reports', orgId, debouncedSearch, statusFilter, typeFilter, offset],
    queryFn: () => getIncidentReports(orgId!, {
      q: debouncedSearch || undefined,
      status: statusFilter || undefined,
      incident_type: typeFilter || undefined,
      limit: LIMIT,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  // L10 — Scroll persistence: restore on mount
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) sessionStorage.removeItem(SCROLL_KEY);
    if (saved) {
      document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10));
    }
  }, []);

  // L10 — Scroll persistence: track scroll position
  useEffect(() => {
    const handleScroll = () => {
      scrollRef.current = (document.querySelector('.app-shell-content')?.scrollTop ?? 0);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      sessionStorage.setItem(SCROLL_KEY, String(scrollRef.current));
    };
  }, []);

  const saveScrollPosition = useCallback(() => {
    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
  }, []);

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
          Error loading incident reports: {(error as Error).message}
        </div>
      </div>
    );
  }

  const reports = data?.items || [];
  const total = data?.total ?? 0;
  const hasFilters = debouncedSearch || statusFilter || typeFilter;
  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  // Stats
  const openCount = reports.filter(r =>
    r.status === 'draft' || r.status === 'submitted'
  ).length;
  const investigatingCount = reports.filter(r => r.status === 'under_investigation').length;
  const resolvedCount = reports.filter(r => r.status === 'resolved').length;
  const closedCount = reports.filter(r => r.status === 'closed').length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* L02 — Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <AlertCircle size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Damage and Loss</h1>
              <p className="text-sm text-archive mt-0.5">
                {total} incident report{total !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <Link
            to={`/organizations/${orgId}/collections/incidents/create`}
            onClick={saveScrollPosition}
            className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
          >
            <AlertTriangle size={18} />
            Report Incident
          </Link>
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Documents incidents involving damage, loss, or theft of objects. Supports investigation, reporting, insurance claims, and remediation.
        </p>
      </div>

      {/* Warning Banner */}
      <div className="bg-semantic-warning/10 border border-semantic-warning/30 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-semantic-warning mt-0.5" />
          <div>
            <h3 className="font-medium text-ink">Incident Documentation</h3>
            <p className="text-sm text-accessible-gray mt-1">
              All incidents should be documented promptly. For theft or major damage,
              notify security and consider filing a police report.
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-info/10 rounded-lg flex items-center justify-center">
              <FileText size={20} className="text-semantic-info" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{openCount}</p>
              <p className="text-sm text-archive">Open</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-warning/10 rounded-lg flex items-center justify-center">
              <Search size={20} className="text-semantic-warning" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{investigatingCount}</p>
              <p className="text-sm text-archive">Investigating</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-success/10 rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-semantic-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{resolvedCount}</p>
              <p className="text-sm text-archive">Resolved</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-stone rounded-lg flex items-center justify-center">
              <CheckCircle size={20} className="text-archive" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{closedCount}</p>
              <p className="text-sm text-archive">Closed</p>
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
              placeholder="Search incidents..."
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
            <option value="submitted">Submitted</option>
            <option value="under_investigation">Under Investigation</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Types</option>
            <option value="damage">Damage</option>
            <option value="loss">Loss</option>
            <option value="theft">Theft</option>
            <option value="vandalism">Vandalism</option>
            <option value="environmental">Environmental</option>
            <option value="fire">Fire</option>
            <option value="water">Water</option>
            <option value="pest">Pest</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* L05 — Table wrapper with opacity transition */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {reports.length > 0 ? (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Report Number</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Incident Date</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Description</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Objects Affected</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {reports.map((report) => (
                <IncidentRow key={report.report_id} report={report} orgId={orgId!} saveScrollPosition={saveScrollPosition} />
              ))}
            </tbody>
          </table>
        ) : hasFilters ? (
          /* L08 — Empty state: no search results */
          <div className="text-center py-12">
            <Search size={48} className="mx-auto text-archive mb-4" />
            <h3 className="text-lg font-serif font-medium text-forest mb-2">No incident reports match your search</h3>
            <p className="text-accessible-gray mb-4">Try adjusting your filters or search terms.</p>
            <button
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('');
                setTypeFilter('');
              }}
              className="btn btn-primary inline-flex items-center gap-2"
            >
              Clear Filters
            </button>
          </div>
        ) : (
          /* L08 — Empty state: first time */
          <div className="text-center py-12">
            <Sparkles size={48} className="mx-auto text-archive mb-4" />
            <h3 className="text-lg font-serif font-medium text-forest mb-2">No Incident Reports Yet</h3>
            <p className="text-accessible-gray mb-1">Document and track incidents affecting your collection.</p>
            <p className="text-accessible-gray mb-4">Record damage, theft, and other incidents for insurance and security.</p>
            <Link
              to={`/organizations/${orgId}/collections/incidents/create`}
              onClick={saveScrollPosition}
              className="btn btn-primary inline-flex items-center gap-2 no-underline"
            >
              <AlertTriangle size={18} />
              Report Incident
            </Link>
          </div>
        )}
      </div>

      {/* L09 — Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-parchment border border-lichen rounded-lg px-4 py-3">
          <p className="text-sm text-archive">
            Showing {offset + 1}\u2013{Math.min(offset + LIMIT, total)} of {total} incident report{total !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              disabled={offset === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-lichen rounded-lg hover:bg-stone disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
              Previous
            </button>
            <span className="text-sm text-archive px-2">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setOffset(offset + LIMIT)}
              disabled={offset + LIMIT >= total}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-lichen rounded-lg hover:bg-stone disabled:opacity-40 disabled:cursor-not-allowed"
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
