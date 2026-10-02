import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Loader2,
  X,
  Sparkles,
  ScanBarcode,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { formatDateTime as fmtDateTime } from '@/lib/formatters';

interface ScanSummary {
  scan_id: string;
  barcode_value: string;
  resolved_entity_type: string | null;
  resolved_entity_type_label: string | null;
  resolved_entity_id: string | null;
  action_type: string;
  action_type_label: string;
  result_status: string;
  result_status_label: string;
  device_name: string | null;
  scanned_at: string;
  scanned_by: string | null;
}

interface ListResponse {
  items: ScanSummary[];
  total: number;
}

const ACTION_STYLES: Record<string, string> = {
  verify: 'bg-semantic-info/10 text-semantic-info',
  move: 'bg-bark/10 text-bark',
  audit: 'bg-semantic-info/10 text-semantic-info',
  lookup: 'bg-stone text-ink',
  checkout: 'bg-semantic-warning/10 text-semantic-warning',
  checkin: 'bg-semantic-success/10 text-semantic-success',
};

const RESULT_STYLES: Record<string, string> = {
  success: 'bg-semantic-success/10 text-semantic-success',
  not_found: 'bg-semantic-error/10 text-semantic-error',
  mismatch: 'bg-semantic-warning/10 text-semantic-warning',
  error: 'bg-semantic-error/10 text-semantic-error',
};

const formatDateTime = (dateStr: string | null): string => {
  return fmtDateTime(dateStr);
};

const LIMIT = 25;
const SCROLL_KEY = 'barcode-scans-scroll';

/* L07 — Extracted row component */
function ScanRow({ scan }: { scan: ScanSummary }) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <tr
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3 text-sm text-ink whitespace-nowrap">
        {formatDateTime(scan.scanned_at)}
      </td>
      <td className="px-4 py-3 text-sm font-medium text-ink font-mono">
        {scan.barcode_value}
      </td>
      <td className="px-4 py-3 text-sm text-ink">
        {scan.resolved_entity_type_label || '—'}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${ACTION_STYLES[scan.action_type] || 'bg-stone text-ink'}`}>
          {scan.action_type_label}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${RESULT_STYLES[scan.result_status] || 'bg-stone text-ink'}`}>
          {scan.result_status_label}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-ink">
        {scan.device_name || '—'}
      </td>
      <td className="px-4 py-3 text-sm text-ink">
        {scan.scanned_by || '—'}
      </td>
    </tr>
  );
}

export default function BarcodeScansPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [actionTypeFilter, setActionTypeFilter] = useState<string>('');
  const [resultStatusFilter, setResultStatusFilter] = useState<string>('');
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
  }, [debouncedSearch, actionTypeFilter, resultStatusFilter]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['barcode-scans', orgId, debouncedSearch, actionTypeFilter, resultStatusFilter, offset],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (actionTypeFilter) params.set('action_type', actionTypeFilter);
      if (resultStatusFilter) params.set('result_status', resultStatusFilter);
      params.set('limit', String(LIMIT));
      params.set('offset', String(offset));
      return apiFetch<ListResponse>(
        `/organizations/${orgId}/collections/barcodes/scans?${params}`
      );
    },
    enabled: !!orgId,
    placeholderData: (prev) => prev,
  });

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-stone rounded w-48" />
          <div className="bg-parchment border border-lichen rounded-lg p-4">
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-stone rounded" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-semantic-error/10 border border-semantic-error/30 rounded-lg p-4 text-semantic-error">
          Error loading scan history: {(error as Error).message}
        </div>
      </div>
    );
  }

  const scans = data?.items || [];
  const total = data?.total || 0;
  const hasFilters = !!(debouncedSearch || actionTypeFilter || resultStatusFilter);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* L02 — Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <ScanBarcode size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Barcode Scans</h1>
              <p className="text-sm text-archive mt-0.5">{total} {total === 1 ? 'scan' : 'scans'}</p>
            </div>
          </div>
        </div>
        <p className="text-sm text-archive leading-relaxed">View scan history and results.</p>
      </div>

      {/* L04 — Search hero */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              placeholder="Search scans..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border border-lichen rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
            {isFetching && (
              <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-archive animate-spin" />
            )}
          </div>
          <select
            value={actionTypeFilter}
            onChange={(e) => setActionTypeFilter(e.target.value)}
            className="px-3 py-2 border border-lichen rounded-lg text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
          >
            <option value="">All Actions</option>
            <option value="verify">Verify</option>
            <option value="move">Move</option>
            <option value="audit">Audit</option>
            <option value="lookup">Lookup</option>
            <option value="checkout">Checkout</option>
            <option value="checkin">Checkin</option>
          </select>
          <select
            value={resultStatusFilter}
            onChange={(e) => setResultStatusFilter(e.target.value)}
            className="px-3 py-2 border border-lichen rounded-lg text-sm text-ink bg-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
          >
            <option value="">All Results</option>
            <option value="success">Success</option>
            <option value="not_found">Not Found</option>
            <option value="mismatch">Mismatch</option>
            <option value="error">Error</option>
          </select>
        </div>
      </div>

      {/* Content Card */}
      <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
        {/* Table */}
        {scans.length > 0 ? (
          <table className="w-full">
            {/* L06 — thead styling */}
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Time</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Barcode</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Entity</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Action</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Result</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Device</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {scans.map((scan) => (
                <ScanRow key={scan.scan_id} scan={scan} />
              ))}
            </tbody>
          </table>
        ) : hasFilters ? (
          /* L08 — No search results */
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No scans match your search</h3>
            <p className="text-archive max-w-md mx-auto mb-6">We couldn&apos;t find any scans matching your filters. Try adjusting your search terms.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setSearchQuery(''); setActionTypeFilter(''); setResultStatusFilter(''); }} className="btn btn-secondary"><X size={16} className="mr-1.5" />Clear filters</button>
            </div>
          </div>
        ) : (
          /* L08 — First time empty state */
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No barcode scans yet.</h3>
          </div>
        )}
      </div>

      {/* L09 — Pagination */}
      {data && total > LIMIT && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-accessible-gray">Showing {offset + 1} - {Math.min(offset + LIMIT, total)} of {total}</p>
          <div className="flex gap-2">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="btn btn-tertiary text-sm">Previous</button>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= total} className="btn btn-tertiary text-sm">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
