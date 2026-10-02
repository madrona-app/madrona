import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, ChevronDown, Check, Loader2 } from 'lucide-react';
import { WorkspaceSection } from '../../../components/workspace';
import { RecordLinker } from '../../../components/records/RecordLinker';
import SlideOver from '../../../components/ui/SlideOver';
import ConfirmDialog from '../../../components/ConfirmDialog';
import {
  addShipmentItem,
  removeShipmentItem,
  updateShipmentItem,
  listCrates,
} from '../../../lib/api/shipments';
import { searchCollections } from '../../../lib/api/collections';
import { useToast } from '../../../contexts/ToastContext';
import type { ShipmentDetail, ItemData } from './types';
import type { CollectionsSearchHit } from '../../../lib/schemas';
import type { SearchConfig } from '../../../components/records/types';

interface ItemsSectionProps {
  orgId: string;
  shipmentId: string;
  shipment: ShipmentDetail;
  isEditing: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  order?: number;
  isEmpty: boolean;
  summary?: string;
}

export default function ItemsSection({
  orgId,
  shipmentId,
  shipment,
  isEditing,
  isExpanded,
  onToggle,
  order,
  isEmpty,
  summary,
}: ItemsSectionProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [_editingItem, _setEditingItem] = useState<ItemData | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ItemData | null>(null);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['shipment', orgId, shipmentId] }),
    [queryClient, orgId, shipmentId],
  );

  const { data: cratesData } = useQuery({
    queryKey: ['crates', orgId],
    queryFn: () => listCrates(orgId, { active: 'true', limit: 50 }),
    enabled: isEditing,
    staleTime: 30_000,
  });
  const crates = cratesData?.items ?? [];

  // --- Search config for RecordLinker ---
  const search: SearchConfig<CollectionsSearchHit> = useMemo(
    () => ({
      title: 'Add Object to Shipment',
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
          {/* Thumbnail */}
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

  // --- Link handler: intercept to show metadata slide-over ---
  const [pendingItem, setPendingItem] = useState<CollectionsSearchHit | null>(null);

  const handleLink = useCallback(
    async (hit: CollectionsSearchHit) => {
      setPendingItem(hit);
    },
    [],
  );

  const handleConfirmAdd = useCallback(
    async (objectId: string, crateId: string | null, packingNotes: string | null) => {
      await addShipmentItem(orgId, shipmentId, {
        object_id: objectId,
        crate_id: crateId || undefined,
        packing_notes: packingNotes || undefined,
      });
      invalidate();
      setPendingItem(null);
      showToast({ type: 'success', title: 'Item added to shipment' });
    },
    [orgId, shipmentId, invalidate, showToast],
  );

  // --- Unlink handler ---
  const handleUnlink = useCallback(
    async (item: ItemData) => {
      setConfirmRemove(item);
    },
    [],
  );

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => removeShipmentItem(orgId, shipmentId, itemId),
    onSuccess: () => {
      invalidate();
      setConfirmRemove(null);
      showToast({ type: 'success', title: 'Item removed from shipment' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: err.message || 'Failed to remove item' });
    },
  });

  const items = shipment.items ?? [];

  return (
    <WorkspaceSection
      id="items"
      title="Items"
      icon={<Package size={18} />}
      isExpanded={isExpanded}
      onToggle={onToggle}
      isEditing={isEditing}
      order={order}
      isEmpty={isEmpty}
      summary={summary}
    >
      <RecordLinker<ItemData, CollectionsSearchHit>
        organizationId={orgId}
        title={`Shipment Items (${items.length})`}
        addLabel="Add Object"
        emptyMessage="No objects in this shipment yet."
        linkedItems={items}
        getItemId={(item) => item.shipment_item_id}
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
              {item.packing_notes && (
                <p className="text-xs text-archive/70 truncate mt-0.5">
                  {item.packing_notes}
                </p>
              )}
            </div>
            {/* Crate badge */}
            {item.crate_number && (
              <span className="inline-flex items-center gap-1 text-xs text-archive bg-stone/50 px-2 py-0.5 rounded flex-shrink-0">
                <Package size={10} />
                {item.crate_number}
              </span>
            )}
            {/* Status badge */}
            <span
              className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                item.status === 'delivered'
                  ? 'bg-semantic-success/10 text-semantic-success'
                  : 'bg-stone text-ink'
              }`}
            >
              {item.status_label}
            </span>
          </div>
        )}
        getItemHref={(item) =>
          `/organizations/${orgId}/collections/objects/${item.object_id}`
        }
        isEditing={isEditing}
        onLink={handleLink}
        onUnlink={handleUnlink}
        search={search}
        invalidateKeys={[['shipment', orgId, shipmentId]]}
        submitLabel="Add to Shipment"
        editLink={{
          renderEditSlideOver: (item, onClose, onSuccess) => (
            <ItemEditSlideOver
              orgId={orgId}
              shipmentId={shipmentId}
              item={item}
              crates={crates}
              onClose={onClose}
              onSuccess={() => {
                invalidate();
                onSuccess();
              }}
            />
          ),
        }}
      />

      {/* Add item metadata slide-over (shown after selecting an object) */}
      {pendingItem && (
        <AddItemSlideOver
          orgId={orgId}
          shipmentId={shipmentId}
          hit={pendingItem}
          crates={cratesData?.items || []}
          onClose={() => setPendingItem(null)}
          onConfirm={handleConfirmAdd}
        />
      )}

      {/* Confirm remove dialog */}
      <ConfirmDialog
        isOpen={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => {
          if (confirmRemove) {
            removeMutation.mutate(confirmRemove.shipment_item_id);
          }
        }}
        title="Remove Item"
        message={
          <>
            Remove{' '}
            <strong>
              {confirmRemove?.object_number || confirmRemove?.object_id.slice(0, 8)}
            </strong>{' '}
            from this shipment? The object itself will not be deleted.
          </>
        }
        confirmText="Remove"
        confirmStyle="danger"
      />
    </WorkspaceSection>
  );
}

// ---------------------------------------------------------------------------
// Inline edit slide-over for item metadata (crate, insurance, packing notes)
// ---------------------------------------------------------------------------

interface ItemEditSlideOverProps {
  orgId: string;
  shipmentId: string;
  item: ItemData;
  crates: Array<{
    crate_id: string;
    crate_number: string;
    description: string | null;
  }>;
  onClose: () => void;
  onSuccess: () => void;
}

function ItemEditSlideOver({
  orgId,
  shipmentId,
  item,
  crates,
  onClose,
  onSuccess,
}: ItemEditSlideOverProps) {
  const { showToast } = useToast();
  const [crateId, setCrateId] = useState(item.crate_id ?? '');
  const [packingNotes, setPackingNotes] = useState(item.packing_notes ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateShipmentItem(orgId, shipmentId, item.shipment_item_id, {
        crate_id: crateId || null,
        packing_notes: packingNotes || null,
      });
      showToast({ type: 'success', title: 'Item updated' });
      onSuccess();
    } catch (err) {
      showToast({
        type: 'error',
        title: err instanceof Error ? err.message : 'Failed to update item',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SlideOver
      isOpen
      onClose={onClose}
      title="Edit Shipment Item"
      subtitle={item.object_number || item.object_id.slice(0, 8)}
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check size={16} />
                Save
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Object info (read-only) */}
        <div className="p-3 bg-stone/30 rounded-lg">
          <p className="text-sm font-medium text-ink">
            {item.object_number || item.object_id.slice(0, 8)}
          </p>
          {item.object_title && (
            <p className="text-xs text-archive mt-0.5">{item.object_title}</p>
          )}
        </div>

        {/* Crate assignment */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Crate Assignment
          </label>
          <div className="relative">
            <Package
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-archive pointer-events-none"
            />
            <select
              value={crateId}
              onChange={(e) => setCrateId(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment text-ink appearance-none"
            >
              <option value="">No crate</option>
              {crates.map((c) => (
                <option key={c.crate_id} value={c.crate_id}>
                  {c.crate_number}
                  {c.description ? ` — ${c.description}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-archive pointer-events-none"
            />
          </div>
        </div>

        {/* Packing notes */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">
            Packing Notes
          </label>
          <textarea
            value={packingNotes}
            onChange={(e) => setPackingNotes(e.target.value)}
            placeholder="Special packing instructions..."
            rows={3}
            className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment resize-none"
          />
        </div>
      </div>
    </SlideOver>
  );
}

// ---------------------------------------------------------------------------
// Add-item slide-over (shown after selecting an object, before linking)
// ---------------------------------------------------------------------------

interface AddItemSlideOverProps {
  orgId: string;
  shipmentId: string;
  hit: CollectionsSearchHit;
  crates: Array<{ crate_id: string; crate_number: string; description: string | null }>;
  onClose: () => void;
  onConfirm: (objectId: string, crateId: string | null, packingNotes: string | null) => Promise<void>;
}

function AddItemSlideOver({ orgId: _orgId, shipmentId: _shipmentId, hit, crates, onClose, onConfirm }: AddItemSlideOverProps) {
  const [crateId, setCrateId] = useState('');
  const [packingNotes, setPackingNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { showToast } = useToast();

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onConfirm(hit.object_id, crateId || null, packingNotes || null);
    } catch (err) {
      showToast({
        type: 'error',
        title: err instanceof Error ? err.message : 'Failed to add item',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SlideOver
      isOpen
      onClose={onClose}
      title="Add to Shipment"
      subtitle={hit.object_number || hit.title || hit.object_id.slice(0, 8)}
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-lichen rounded-lg hover:bg-stone/50">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving ? <><Loader2 size={16} className="animate-spin" />Adding...</> : <><Check size={16} />Add Item</>}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Object info */}
        <div className="p-3 bg-stone/30 rounded-lg">
          <p className="text-sm font-medium text-ink">{hit.object_number || hit.object_id.slice(0, 8)}</p>
          {hit.title && <p className="text-xs text-archive mt-0.5">{hit.title}</p>}
        </div>

        {/* Crate assignment */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">Crate Assignment</label>
          <div className="relative">
            <Package size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-archive pointer-events-none" />
            <select
              value={crateId}
              onChange={(e) => setCrateId(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment text-ink appearance-none"
            >
              <option value="">No crate</option>
              {crates.map((c) => (
                <option key={c.crate_id} value={c.crate_id}>
                  {c.crate_number}{c.description ? ` — ${c.description}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-archive pointer-events-none" />
          </div>
        </div>

        {/* Packing notes */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">Packing Notes</label>
          <textarea
            value={packingNotes}
            onChange={(e) => setPackingNotes(e.target.value)}
            placeholder="Special packing instructions..."
            rows={3}
            className="w-full px-3 py-2 text-sm border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark bg-parchment resize-none"
          />
        </div>
      </div>
    </SlideOver>
  );
}
