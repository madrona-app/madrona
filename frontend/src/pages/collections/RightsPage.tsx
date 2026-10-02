import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Shield,
  Plus,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  Globe,
  Trash2,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { getAllRights, deleteObjectRight } from '../../lib/api';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { usePermissions } from '../../hooks/usePermissions';
import type { ObjectRight } from '../../lib/schemas';
import ConfirmDialog from '../../components/ConfirmDialog';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const SCROLL_KEY = 'rights-scroll';
const LIMIT = 24;

const RIGHT_TYPE_LABELS: Record<string, string> = {
  copyright: 'Copyright',
  reproduction: 'Reproduction',
  exhibition: 'Exhibition',
  publication: 'Publication',
  broadcast: 'Broadcast',
  performance: 'Performance',
  adaptation: 'Adaptation',
  distribution: 'Distribution',
  moral_rights: 'Moral Rights',
  database_rights: 'Database Rights',
  trademark: 'Trademark',
  other: 'Other',
};

const STATUS_LABELS: Record<string, string> = {
  unknown: 'Unknown',
  public_domain: 'Public Domain',
  owned: 'Owned',
  licensed: 'Licensed',
  granted: 'Granted',
  requested: 'Requested',
  denied: 'Denied',
  expired: 'Expired',
  orphan: 'Orphan Work',
  disputed: 'Disputed',
};

const STATUS_STYLES: Record<string, string> = {
  unknown: 'bg-stone text-ink',
  public_domain: 'bg-semantic-success/10 text-semantic-success',
  owned: 'bg-semantic-info/10 text-semantic-info',
  licensed: 'bg-forest/10 text-forest',
  granted: 'bg-semantic-success/10 text-semantic-success',
  requested: 'bg-semantic-warning/10 text-semantic-warning',
  denied: 'bg-semantic-error/10 text-semantic-error',
  expired: 'bg-stone text-ink',
  orphan: 'bg-copper/10 text-copper',
  disputed: 'bg-semantic-error/10 text-semantic-error',
};

function RightRow({ right, orgId, onDelete, onNavigate }: {
  right: ObjectRight;
  orgId: string;
  onDelete: (rightId: string) => void;
  onNavigate: (rightId: string) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <tr
      onClick={() => onNavigate(right.right_id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-ink">
          {right.object_title || right.object_number || 'Untitled'}
        </span>
        {right.object_number && right.object_title && (
          <p className="text-xs text-archive">{right.object_number}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-ink">
          {RIGHT_TYPE_LABELS[right.right_type] || right.right_type}
        </span>
        {right.right_subtype && (
          <p className="text-xs text-archive">{right.right_subtype}</p>
        )}
      </td>
      <td className="px-4 py-3">
        {right.rights_holder_contact?.name ? (
          <span className="text-sm text-ink">{right.rights_holder_contact.name}</span>
        ) : (
          <span className="text-sm text-archive italic">Unknown</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[right.status] || 'bg-stone text-ink'}`}>
          {STATUS_LABELS[right.status] || right.status}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-archive">
        {right.is_perpetual ? (
          <span className="flex items-center gap-1">
            <CheckCircle size={14} className="text-forest" />
            Perpetual
          </span>
        ) : right.end_date ? (
          <span>
            {right.start_date && `${formatDateShort(right.start_date)} - `}
            {formatDateShort(right.end_date)}
          </span>
        ) : (
          <span className="text-archive">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {right.is_orphan_work && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-copper/10 text-copper" title="Orphan Work">
              <AlertTriangle size={12} />
              Orphan
            </span>
          )}
          {right.territory && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-stone text-archive" title={`Territory: ${right.territory}`}>
              <Globe size={12} />
              {right.territory}
            </span>
          )}
          {right.fee_required && (
            <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-azurite/10 text-azurite" title="Fee Required">
              Fee
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <Link
            to={`/organizations/${orgId}/collections/rights/${right.right_id}/edit`}
            onClick={(e) => e.stopPropagation()}
            className="px-2 py-1 text-sm text-archive hover:text-bark no-underline"
          >
            Edit
          </Link>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(right.right_id);
            }}
            className="p-1.5 text-archive hover:text-semantic-error rounded"
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function RightsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [orphanFilter, setOrphanFilter] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [rightToDelete, setRightToDelete] = useState<string | null>(null);

  // L17: Scroll persistence — restore
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) sessionStorage.removeItem(SCROLL_KEY);
    if (saved) {
      requestAnimationFrame(() => {
        document.querySelector('.app-shell-content')?.scrollTo(0, parseInt(saved, 10));
      });
    }
  }, []);

  // L17: Scroll persistence — save on cleanup
  useEffect(() => {
    return () => {
      sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    };
  }, []);

  // L18: Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['rights', orgId, debouncedSearch, typeFilter, statusFilter, orphanFilter, offset],
    queryFn: () => getAllRights(orgId!, {
      q: debouncedSearch || undefined,
      right_type: typeFilter || undefined,
      status: statusFilter || undefined,
      is_orphan_work: orphanFilter === 'true' ? true : orphanFilter === 'false' ? false : undefined,
      limit: LIMIT,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const deleteMutation = useMutation({
    mutationFn: (rightId: string) => deleteObjectRight(orgId!, rightId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rights', orgId] });
    },
  });

  // L23: Navigation handler — save scroll before navigating
  const handleRightClick = useCallback((rightId: string) => {
    sessionStorage.setItem(SCROLL_KEY, String((document.querySelector('.app-shell-content')?.scrollTop ?? 0)));
    navigate(`/organizations/${orgId}/collections/rights/${rightId}/edit`);
  }, [navigate, orgId]);

  const handleDeleteClick = useCallback((rightId: string) => {
    setRightToDelete(rightId);
    setShowDeleteConfirm(true);
  }, []);

  // L22: Filter reset — reset offset on filter change
  const handleTypeFilterChange = useCallback((value: string) => {
    setTypeFilter(value);
    setOffset(0);
  }, []);

  const handleStatusFilterChange = useCallback((value: string) => {
    setStatusFilter(value);
    setOffset(0);
  }, []);

  const handleOrphanFilterChange = useCallback((value: string) => {
    setOrphanFilter(value);
    setOffset(0);
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearch('');
    setTypeFilter('');
    setStatusFilter('');
    setOrphanFilter('');
    setOffset(0);
  }, []);

  const hasActiveFilters = debouncedSearch || typeFilter || statusFilter || orphanFilter;

  // L20: Smart skeleton
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
          Error loading rights: {(error as Error).message}
        </div>
      </div>
    );
  }

  const rights = data?.items || [];

  // Calculate stats
  const stats = {
    total: data?.total ?? 0,
    orphan: rights.filter((r: ObjectRight) => r.is_orphan_work).length,
    expiringSoon: rights.filter((r: ObjectRight) => {
      if (!r.end_date || r.is_perpetual) return false;
      const endDate = new Date(r.end_date);
      const threeMonths = new Date();
      threeMonths.setMonth(threeMonths.getMonth() + 3);
      return endDate <= threeMonths && endDate > new Date();
    }).length,
    needsReview: rights.filter((r: ObjectRight) => {
      if (!r.next_review_date) return false;
      return new Date(r.next_review_date) <= new Date();
    }).length,
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        {/* Header Row: Title + Action */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Shield size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">Rights Management</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? <span>No rights records yet</span>
                  : data.total === 1 ? <span>1 rights record</span>
                  : <span>{formatNumber(data.total)} rights records</span>
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          {hasPermission('collections.create') ? (
            <Link
              to={`/organizations/${orgId}/collections/rights/create`}
              className="btn btn-primary flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 no-underline shrink-0 sm:self-auto self-start"
            >
              <Plus size={18} />
              Add Right Record
            </Link>
          ) : (
            <span
              className="flex items-center justify-center gap-2 px-4 py-2 bg-archive/50 text-parchment rounded-lg cursor-not-allowed shrink-0 sm:self-auto self-start"
              title="Requires collections.create permission"
            >
              <Plus size={18} />
              Add Right Record
            </span>
          )}
        </div>
        {/* Description: Full width, below header row */}
        <p className="text-sm text-archive leading-relaxed">
          Documents intellectual property rights and restrictions associated with collection objects and related media. Supports licensing, permissions, and compliance with legal and ethical obligations.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-forest/10 rounded-lg flex items-center justify-center">
              <Shield size={20} className="text-forest" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{stats.total}</p>
              <p className="text-sm text-archive">Total Rights</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-warning/10 rounded-lg flex items-center justify-center">
              <AlertTriangle size={20} className="text-semantic-warning" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{stats.orphan}</p>
              <p className="text-sm text-archive">Orphan Works</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-semantic-warning/10 rounded-lg flex items-center justify-center">
              <Clock size={20} className="text-semantic-warning" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{stats.expiringSoon}</p>
              <p className="text-sm text-archive">Expiring Soon</p>
            </div>
          </div>
        </div>
        <div className="bg-parchment border border-lichen rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-bark/10 rounded-lg flex items-center justify-center">
              <Calendar size={20} className="text-bark" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-ink">{stats.needsReview}</p>
              <p className="text-sm text-archive">Due for Review</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search Hero */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 w-full">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-archive" />
            <input
              type="text"
              placeholder="Search rights..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-full pl-12 pr-4 py-3 text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-archive hover:text-ink"
              >
                <X size={18} />
              </button>
            )}
          </div>
          <select
            value={typeFilter}
            onChange={(e) => handleTypeFilterChange(e.target.value)}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
          >
            <option value="">All Types</option>
            {Object.entries(RIGHT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilterChange(e.target.value)}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            value={orphanFilter}
            onChange={(e) => handleOrphanFilterChange(e.target.value)}
            className="px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-40"
          >
            <option value="">All Works</option>
            <option value="true">Orphan Works Only</option>
            <option value="false">Non-Orphan Only</option>
          </select>
        </div>
      </div>

      {/* Content Card */}
      <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
        {/* Table or Empty States */}
        {rights.length > 0 ? (
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Object</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Right Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Holder</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Dates</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Flags</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-ink">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {rights.map((right: ObjectRight) => (
                <RightRow
                  key={right.right_id}
                  right={right}
                  orgId={orgId!}
                  onDelete={handleDeleteClick}
                  onNavigate={handleRightClick}
                />
              ))}
            </tbody>
          </table>
        ) : hasActiveFilters ? (
          /* L13: Empty state — no search results */
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
              <Search size={32} className="text-archive" />
            </div>
            <h3 className="text-xl font-serif font-medium text-forest mb-3">
              No rights records match your search
            </h3>
            <p className="text-archive max-w-md mx-auto mb-6">
              We couldn&apos;t find any rights records matching your current filters. Try adjusting your search terms or clearing some filters.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={clearFilters} className="btn btn-secondary">
                <X size={16} className="mr-1.5" />
                Clear filters
              </button>
            </div>
          </div>
        ) : (
          /* L14: Empty state — first time (no data) */
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
              <Sparkles size={40} className="text-bark" />
            </div>
            <h3 className="text-2xl font-serif font-medium text-forest mb-6">No rights records yet.</h3>
            <div className="flex items-center justify-center gap-4">
              <Link
                to={`/organizations/${orgId}/collections/rights/create`}
                className="btn btn-primary flex items-center gap-2"
              >
                <Plus size={18} />
                Add Right Record
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* L16: Pagination */}
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

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setRightToDelete(null);
        }}
        onConfirm={() => {
          if (rightToDelete) {
            deleteMutation.mutate(rightToDelete);
          }
          setRightToDelete(null);
        }}
        title="Delete Rights Record"
        message="Are you sure you want to delete this rights record? This action cannot be undone."
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
