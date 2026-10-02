import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { WorkspaceSection } from '../../../components/workspace';
import { RecordLinker } from '../../../components/records/RecordLinker';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { addIndemnityObject, removeIndemnityObject } from '../../../lib/api';
import { searchCollections } from '../../../lib/api/collections';
import { formatCurrency } from '@/lib/formatters';
import { useToast } from '../../../contexts/ToastContext';
import type { CollectionsSearchHit } from '../../../lib/schemas';
import type { SearchConfig } from '../../../components/records/types';
import type { IndemnityObject } from '../../../lib/schemas/procedures';

// IndemnityObject already has: link_id, object_id, object_number, object_title,
// declared_value, approved_value, value_currency
type IndemnityObjectItem = IndemnityObject

interface ObjectsSectionProps {
  orgId: string;
  indemnityId: string;
  objects: IndemnityObjectItem[];
  coverageCurrency: string;
  isEditing: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  order?: number;
  isEmpty: boolean;
  summary: string;
}

export default function ObjectsSection({
  orgId,
  indemnityId,
  objects,
  coverageCurrency,
  isEditing,
  isExpanded,
  onToggle,
  order,
  isEmpty,
  summary,
}: ObjectsSectionProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [confirmRemove, setConfirmRemove] = useState<IndemnityObjectItem | null>(null);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['indemnity-arrangement', orgId, indemnityId] }),
    [queryClient, orgId, indemnityId],
  );

  // --- Search config for RecordLinker ---
  const search: SearchConfig<CollectionsSearchHit> = useMemo(
    () => ({
      title: 'Add Object to Indemnity',
      subtitle: 'Search collection objects by number or title',
      placeholder: 'Search by object number or title...',
      searchLabel: 'Search Objects',
      queryKey: ['collections-search', orgId],
      searchFn: async (term: string) => {
        const res = await searchCollections(orgId, {
          query: { q: term, fields: ['object_number', 'title', 'object_name'] },
          limit: 20,
        });
        return res.hits;
      },
      getSearchItemId: (hit) => hit.object_id,
      getSearchItemLabel: (hit) =>
        [hit.object_number, hit.title].filter(Boolean).join(' — '),
      renderSearchItem: (hit, isSelected) => (
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded overflow-hidden bg-stone/40 flex-shrink-0">
            {hit.primary_image_url ? (
              <img
                src={hit.primary_image_url}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package size={16} className="text-archive" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-medium truncate ${isSelected ? 'text-bark' : 'text-ink'}`}>
              {hit.object_number || 'No number'}
            </p>
            {hit.title && (
              <p className="text-xs text-archive truncate">{hit.title}</p>
            )}
          </div>
          {hit.object_type && (
            <span className="text-[10px] text-archive bg-stone/50 px-1.5 py-0.5 rounded flex-shrink-0">
              {hit.object_type}
            </span>
          )}
        </div>
      ),
    }),
    [orgId],
  );

  // --- Link handler ---
  const handleLink = useCallback(
    async (hit: CollectionsSearchHit) => {
      await addIndemnityObject(orgId, indemnityId, {
        object_id: hit.object_id,
        object_number: hit.object_number || null,
        object_title: hit.title || null,
        value_currency: coverageCurrency || 'USD',
      });
      invalidate();
      showToast({ title: 'Object added to indemnity', type: 'success' });
    },
    [orgId, indemnityId, coverageCurrency, invalidate, showToast],
  );

  // --- Unlink handler ---
  const handleUnlink = useCallback(
    async (item: IndemnityObjectItem) => {
      setConfirmRemove(item);
    },
    [],
  );

  const removeMutation = useMutation({
    mutationFn: (linkId: string) => removeIndemnityObject(orgId, indemnityId, linkId),
    onSuccess: () => {
      invalidate();
      setConfirmRemove(null);
      showToast({ title: 'Object removed from indemnity', type: 'success' });
    },
    onError: (err: Error) => {
      showToast({ title: err.message || 'Failed to remove object', type: 'error' });
    },
  });

  // --- Totals ---
  const totalDeclared = objects.reduce((sum, o) => sum + (o.declared_value ?? 0), 0);
  const totalApproved = objects.reduce((sum, o) => sum + (o.approved_value ?? 0), 0);
  const currency = coverageCurrency || 'USD';

  return (
    <WorkspaceSection
      id="objects"
      title="Covered Objects"
      icon={<Package size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
      isEmpty={isEmpty}
      summary={summary}
    >
      <RecordLinker<IndemnityObjectItem, CollectionsSearchHit>
        organizationId={orgId}
        title={`Covered Objects (${objects.length})`}
        addLabel="Add Object"
        emptyMessage="No objects linked to this indemnity yet."
        linkedItems={objects}
        getItemId={(item) => item.link_id}
        getLinkedEntityId={(item) => item.object_id}
        renderItem={(item) => (
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink truncate">
                {item.object_number || item.object_id.slice(0, 8)}
              </p>
              {item.object_title && (
                <p className="text-xs text-archive truncate">{item.object_title}</p>
              )}
            </div>
            {(item.declared_value != null && item.declared_value > 0) && (
              <span className="text-xs text-archive flex-shrink-0">
                Declared: {formatCurrency(item.declared_value, item.value_currency || currency, 0)}
              </span>
            )}
            {(item.approved_value != null && item.approved_value > 0) && (
              <span className="text-xs text-semantic-success flex-shrink-0">
                Approved: {formatCurrency(item.approved_value, item.value_currency || currency, 0)}
              </span>
            )}
          </div>
        )}
        getItemHref={(item) =>
          `/organizations/${orgId}/collections/objects/${item.object_id}`
        }
        isEditing={isEditing}
        onLink={handleLink}
        onUnlink={handleUnlink}
        search={search}
        invalidateKeys={[['indemnity-arrangement', orgId, indemnityId]]}
        submitLabel="Add to Indemnity"
      />

      {/* Totals */}
      {objects.length > 0 && (
        <div className="mt-4 pt-3 border-t border-lichen flex items-center gap-6 text-sm">
          {totalDeclared > 0 && (
            <div>
              <span className="text-archive">Total declared:</span>{' '}
              <span className="font-medium text-ink">
                {formatCurrency(totalDeclared, currency, 0)}
              </span>
            </div>
          )}
          {totalApproved > 0 && (
            <div>
              <span className="text-archive">Total approved:</span>{' '}
              <span className="font-medium text-semantic-success">
                {formatCurrency(totalApproved, currency, 0)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Confirm remove dialog */}
      <ConfirmDialog
        isOpen={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => {
          if (confirmRemove) {
            removeMutation.mutate(confirmRemove.link_id);
          }
        }}
        title="Remove Object"
        message={
          <>
            Remove{' '}
            <strong>
              {confirmRemove?.object_number || confirmRemove?.object_id.slice(0, 8)}
            </strong>{' '}
            from this indemnity arrangement? The object itself will not be deleted.
          </>
        }
        confirmText="Remove"
        confirmStyle="danger"
      />
    </WorkspaceSection>
  );
}
