import { useState, useEffect, useLayoutEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Tag,
  Plus,
  Search,
  Printer,
  XCircle,
  X,
  Sparkles,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

interface BarcodeLabelSummary {
  label_id: string;
  barcode_value: string;
  entity_type: string;
  entity_id: string;
  entity_summary: {
    name: string;
  } | null;
  format: string;
  status: string;
  print_count: number;
  created_at: string;
}

interface ListResponse {
  items: BarcodeLabelSummary[];
  summary: {
    total_active: number;
    printed: number;
    unprinted: number;
    void: number;
  };
  total: number;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-semantic-success/10 text-semantic-success',
  void: 'bg-semantic-error/10 text-semantic-error',
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  collection_object: 'Collection Object',
  object_part: 'Object Part',
  location: 'Location',
  crate: 'Crate',
};

const formatDate = (dateStr: string | null): string => {
  return formatDateShort(dateStr);
};

const LIMIT = 25;
const SCROLL_KEY = 'barcode-labels-scroll';

function LabelRow({ label, orgId }: { label: BarcodeLabelSummary; orgId: string }) {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <tr
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <Link
          to={`/organizations/${orgId}/collections/barcodes/labels/${label.label_id}`}
          className="font-medium text-ink hover:text-bark no-underline"
        >
          {label.barcode_value}
        </Link>
      </td>
      <td className="px-4 py-3 text-sm text-ink">
        {ENTITY_TYPE_LABELS[label.entity_type] || label.entity_type}
      </td>
      <td className="px-4 py-3 text-sm text-ink">
        {label.entity_summary?.name || '\u2014'}
      </td>
      <td className="px-4 py-3 text-sm text-ink">
        {label.format}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[label.status] || 'bg-stone text-ink'}`}>
          {label.status.charAt(0).toUpperCase() + label.status.slice(1)}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-right">
        {label.print_count > 0 ? (
          <span className="flex items-center justify-end gap-1 text-archive">
            <Printer className="w-3.5 h-3.5" />
            {label.print_count}
          </span>
        ) : (
          <span className="text-archive">{'\u2014'}</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-ink">
        {formatDate(label.created_at)}
      </td>
    </tr>
  );
}

export default function BarcodeLabelsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('');
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
  }, [debouncedSearch, statusFilter, entityTypeFilter]);

  const { data, isLoading, isFetching: _isFetching, error } = useQuery({
    queryKey: ['barcode-labels', orgId, debouncedSearch, statusFilter, entityTypeFilter, offset],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('barcode_value', debouncedSearch);
      if (statusFilter) params.set('status', statusFilter);
      if (entityTypeFilter) params.set('entity_type', entityTypeFilter);
      params.set('limit', String(LIMIT));
      params.set('offset', String(offset));
      return apiFetch<ListResponse>(
        `/organizations/${orgId}/collections/barcodes/labels?${params}`
      );
    },
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
          Error loading barcode labels: {(error as Error).message}
        </div>
      </div>
    );
  }

  const labels = data?.items || [];
  const summary = data?.summary || { total_active: 0, printed: 0, unprinted: 0, void: 0 };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card — L04 */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Tag size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Barcode Labels</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No labels yet</span>
                  : data.total === 1 ? <span>1 label</span>
                  : <span>{formatNumber(data.total)} labels</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          <Link
            to={`/organizations/${orgId}/collections/barcodes/labels/create`}
            className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
          >
            <Plus size={18} />
            Generate Labels
          </Link>
        </div>
        <p className="text-sm text-archive leading-relaxed">
          Generate and manage barcode labels for collection objects, parts, locations, and crates.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="text-sm text-archive mb-1">Total Active</div>
          <div className="text-2xl font-semibold text-ink">{summary.total_active}</div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="text-sm text-archive mb-1 flex items-center gap-1">
            <Printer className="w-3.5 h-3.5 text-semantic-success" />
            Printed
          </div>
          <div className="text-2xl font-semibold text-semantic-success">{summary.printed}</div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="text-sm text-archive mb-1 flex items-center gap-1">
            <Tag className="w-3.5 h-3.5 text-semantic-warning" />
            Unprinted
          </div>
          <div className="text-2xl font-semibold text-semantic-warning">{summary.unprinted}</div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="text-sm text-archive mb-1 flex items-center gap-1">
            <XCircle className="w-3.5 h-3.5 text-semantic-error" />
            Void
          </div>
          <div className="text-2xl font-semibold text-semantic-error">{summary.void}</div>
        </div>
      </div>

      {/* Content Card */}
      <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-lichen">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
              <input
                type="text"
                placeholder="Search by barcode value..."
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
              value={entityTypeFilter}
              onChange={(e) => { setEntityTypeFilter(e.target.value); setOffset(0); }}
              className="px-3 py-2 border border-lichen rounded-lg text-sm text-ink bg-parchment"
            >
              <option value="">All Entity Types</option>
              <option value="collection_object">Collection Object</option>
              <option value="object_part">Object Part</option>
              <option value="location">Location</option>
              <option value="crate">Crate</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }}
              className="px-3 py-2 border border-lichen rounded-lg text-sm text-ink bg-parchment"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="void">Void</option>
            </select>
          </div>
        </div>

        {/* Table — L06, L08 */}
        {labels.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-stone/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Barcode Value</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Entity Type</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Entity</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Format</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink text-right">Printed</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-ink">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lichen">
                {labels.map((label) => (
                  <LabelRow key={label.label_id} label={label} orgId={orgId!} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (debouncedSearch || statusFilter || entityTypeFilter) ? (
          /* L08 — No search results */
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">No barcode labels match your search</h3>
            <p className="text-archive max-w-md mx-auto mb-6">We couldn&apos;t find any barcode labels matching your criteria. Try adjusting your search terms or filters.</p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setSearchQuery(''); setStatusFilter(''); setEntityTypeFilter(''); }} className="btn btn-secondary"><X size={16} className="mr-1.5" />Clear filters</button>
            </div>
          </div>
        ) : (
          /* L08 — First time empty state */
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No barcode labels yet.</h3>
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
