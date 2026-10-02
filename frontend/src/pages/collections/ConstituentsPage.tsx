import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Building2, User, Plus, Search, Trash2, Users, CheckCircle, X, Sparkles } from 'lucide-react';
import { getConstituents, deleteConstituent } from '../../lib/api/constituents';
import { usePermissions } from '../../hooks/usePermissions';
import { useListState } from '../../hooks/useListState';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { Constituent } from '../../lib/api/constituents';
import { formatNumber } from '@/lib/formatters';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

const typeLabels: Record<string, string> = {
  person: 'Person',
  organization: 'Organization',
  corporate_body: 'Corporate Body',
  family: 'Family',
  department: 'Department',
  estate: 'Estate',
  dealer: 'Dealer',
  auction_house: 'Auction House',
  unknown: 'Unknown',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  deprecated: 'Deprecated',
  merged: 'Merged',
  deleted: 'Deleted',
};

const LIMIT = 24;

export default function ConstituentsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const {
    searchQuery, debouncedQuery, offset,
    setSearchQuery, setOffset, getFilter, setFilter, clearAll,
  } = useListState({ limit: LIMIT });
  const constituentType = getFilter('type');
  const status = getFilter('status');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [constituentToDelete, setConstituentToDelete] = useState<string | null>(null);

  const hasActiveFilters = !!(debouncedQuery || constituentType || status);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['constituents', orgId, debouncedQuery, constituentType, status, offset],
    queryFn: () => getConstituents(orgId!, {
      q: debouncedQuery || undefined,
      constituent_type: constituentType || undefined,
      status: status || undefined,
      limit: LIMIT,
      offset,
    }),
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteConstituent(orgId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['constituents', orgId] });
    },
  });

  // Only show skeleton on initial load (no data yet)
  const showSkeleton = isLoading && !data;

  const handleConstituentClick = (constituentId: string) => {
    navigate(`/organizations/${orgId}/collections/constituents/${constituentId}`);
  };

  const clearFilters = () => {
    clearAll();
  };

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
          Error loading people and organizations: {(error as Error).message}
        </div>
      </div>
    );
  }

  const constituents = data?.items || [];

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header Card */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 bg-bark/10 rounded-lg shrink-0">
              <Users size={28} className="text-bark" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-ink">People and Organizations</h1>
              <p className="text-sm text-archive mt-0.5">
                {data?.total !== undefined ? (
                  data.total === 0 ? (
                    <span>No people or organizations yet</span>
                  ) : data.total === 1 ? (
                    <span>1 person or organization</span>
                  ) : (
                    <span>{formatNumber(data.total)} people and organizations</span>
                  )
                ) : (
                  <span className="animate-pulse">Loading...</span>
                )}
              </p>
            </div>
          </div>
          {hasPermission('collections.create') ? (
            <Link
              to={`/organizations/${orgId}/collections/constituents/create`}
              className="btn btn-primary flex items-center gap-2 no-underline shrink-0 sm:self-auto self-start"
            >
              <Plus size={18} />
              New Person or Organization
            </Link>
          ) : (
            <span
              className="flex items-center justify-center gap-2 px-4 py-2 bg-archive/50 text-parchment rounded-lg cursor-not-allowed shrink-0 sm:self-auto self-start"
              title="Requires collections.create permission"
            >
              <Plus size={18} />
              New Person or Organization
            </span>
          )}
        </div>
        <p className="text-sm text-archive leading-relaxed">
          People, organizations, families, and other entities associated with collection objects. Includes identity, contact details, biographical information, and linked authority records.
        </p>
      </div>

      {/* Search Bar - Hero Element */}
      <div className="bg-parchment border border-lichen rounded-lg px-6 py-4 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          {/* Search Input - Larger, more prominent */}
          <div className="relative flex-1 w-full">
            <Search
              size={20}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-archive"
            />
            <input
              type="text"
              placeholder="Search by name, organization, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-full pl-12 pr-10 py-3 text-lg"
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
            value={constituentType}
            onChange={(e) => setFilter('type', e.target.value)}
            className="px-3 py-3 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Types</option>
            <option value="person">Person</option>
            <option value="organization">Organization</option>
            <option value="corporate_body">Corporate Body</option>
            <option value="family">Family</option>
            <option value="department">Department</option>
            <option value="estate">Estate</option>
            <option value="dealer">Dealer</option>
            <option value="auction_house">Auction House</option>
            <option value="unknown">Unknown</option>
          </select>
          <select
            value={status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="px-3 py-3 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark w-full sm:w-48"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="deprecated">Deprecated</option>
            <option value="merged">Merged</option>
            <option value="deleted">Deleted</option>
          </select>
        </div>
      </div>

      {/* Constituents Table */}
      {constituents.length > 0 ? (
        <div className={`bg-parchment border border-lichen rounded-lg overflow-hidden transition-opacity duration-200 ${isFetching ? 'opacity-60' : 'opacity-100'}`}>
          <table className="w-full">
            <thead className="bg-stone/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Name</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Type</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Dates</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Nationality</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Email</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-ink">Status</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-ink">Verified</th>
                <th className="w-12 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {constituents.map((constituent) => (
                <ConstituentRow
                  key={constituent.constituent_id}
                  constituent={constituent}
                  onClick={() => handleConstituentClick(constituent.constituent_id)}
                  onDelete={hasPermission('collections.delete') ? () => {
                    setConstituentToDelete(constituent.constituent_id);
                    setShowDeleteConfirm(true);
                  } : undefined}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : hasActiveFilters ? (
        /* Search returned no results */
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-stone flex items-center justify-center">
            <Search size={32} className="text-archive" />
          </div>
          <h3 className="text-xl font-serif font-medium text-forest mb-3">
            No constituents match your search
          </h3>
          <p className="text-archive max-w-md mx-auto mb-6">
            We couldn't find any people or organizations matching "{searchQuery || 'your filters'}".
            Try adjusting your search terms or clearing some filters.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={clearFilters}
              className="btn btn-secondary"
            >
              <X size={16} className="mr-1.5" />
              Clear filters
            </button>
          </div>
        </div>
      ) : (
        /* First-time / empty collection state */
        <div className="text-center py-16">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-bark/10 to-copper/10 flex items-center justify-center">
            <Sparkles size={40} className="text-bark" />
          </div>
          <h3 className="text-2xl font-serif font-medium text-forest mb-6">No people or organizations yet.</h3>
          <div className="flex items-center justify-center gap-4">
            {hasPermission('collections.create') ? (
              <Link
                to={`/organizations/${orgId}/collections/constituents/create`}
                className="btn btn-primary flex items-center gap-2 no-underline"
              >
                <Plus size={16} className="mr-1.5" />
                Add your first constituent
              </Link>
            ) : (
              <span
                className="btn bg-archive/50 text-parchment cursor-not-allowed flex items-center gap-2"
                title="Requires collections.create permission"
              >
                <Plus size={16} className="mr-1.5" />
                Add your first constituent
              </span>
            )}
          </div>
        </div>
      )}

      {/* Pagination */}
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

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setConstituentToDelete(null);
        }}
        onConfirm={() => {
          if (constituentToDelete) {
            deleteMutation.mutate(constituentToDelete);
          }
          setShowDeleteConfirm(false);
          setConstituentToDelete(null);
        }}
        title="Delete Person or Organization"
        message={<>Are you sure you want to delete <strong>{constituents.find(c => c.constituent_id === constituentToDelete)?.name || 'this record'}</strong>? This action cannot be undone.</>}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}

// Extracted row component (matches ObjectRow pattern)
function ConstituentRow({
  constituent,
  onClick,
  onDelete,
}: {
  constituent: Constituent;
  onClick: () => void;
  onDelete?: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);

  const TypeIcon = constituent.constituent_type === 'organization' ||
                   constituent.constituent_type === 'corporate_body' ||
                   constituent.constituent_type === 'auction_house' ||
                   constituent.constituent_type === 'dealer'
    ? Building2
    : constituent.constituent_type === 'department' ||
      constituent.constituent_type === 'family'
      ? Users
      : User;

  const dates = [constituent.birth_date_display, constituent.death_date_display]
    .filter(Boolean)
    .join(' \u2013 ');

  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`cursor-pointer transition-colors ${isHovered ? 'bg-stone/30' : ''}`}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
            constituent.constituent_type === 'organization' ||
            constituent.constituent_type === 'corporate_body' ||
            constituent.constituent_type === 'auction_house'
              ? 'bg-bark/10 text-bark'
              : constituent.constituent_type === 'department' ||
                constituent.constituent_type === 'family'
                ? 'bg-forest/10 text-forest'
                : 'bg-copper/10 text-copper'
          }`}>
            <TypeIcon size={16} />
          </div>
          <div>
            <p className="font-medium text-ink text-sm">{constituent.name}</p>
            {constituent.organization_name && (
              <p className="text-xs text-archive">{constituent.organization_name}</p>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-ink">
          {typeLabels[constituent.constituent_type] || constituent.constituent_type}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-archive">
        {dates || '\u2014'}
      </td>
      <td className="px-4 py-3 text-sm text-archive">
        {constituent.nationality || '\u2014'}
      </td>
      <td className="px-4 py-3 text-sm">
        {constituent.email ? (
          <a
            href={`mailto:${constituent.email}`}
            className="text-bark hover:text-copper-dark"
            onClick={(e) => e.stopPropagation()}
          >
            {constituent.email}
          </a>
        ) : (
          <span className="text-archive">{'\u2014'}</span>
        )}
      </td>
      <td className="px-4 py-3">
        {constituent.status ? (
          <span className={`px-2 py-0.5 text-xs rounded-full ${
            constituent.status === 'active'
              ? 'bg-semantic-success/10 text-semantic-success'
              : constituent.status === 'deprecated' || constituent.status === 'deleted'
                ? 'bg-semantic-error/10 text-semantic-error'
                : 'bg-stone text-ink'
          }`}>
            {STATUS_LABELS[constituent.status] || constituent.status}
          </span>
        ) : (
          <span className="text-archive text-sm">{'\u2014'}</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        {constituent.is_verified && (
          <CheckCircle size={16} className="text-semantic-success inline-block" />
        )}
      </td>
      <td className="px-4 py-3">
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1.5 text-archive hover:text-semantic-error hover:bg-semantic-error/10 rounded transition-colors"
            title="Delete person or organization"
          >
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}

