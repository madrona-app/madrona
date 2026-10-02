import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, ExternalLink, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { RecordLinkerSlideOver } from './RecordLinkerSlideOver';
import { MadronaLoader } from '../ui/MadronaLoader';
import type {
  SearchConfig,
  MetadataFieldDef,
  CreateConfig,
  RemoteCacheConfig,
} from './types';

interface RecordLinkerProps<TLinked, TSearch> {
  organizationId: string;
  // Display
  title: string;
  icon?: LucideIcon;
  addLabel?: string;
  emptyMessage?: string;
  // Data
  linkedItems: TLinked[];
  isLoading?: boolean;
  // Item rendering
  getItemId: (item: TLinked) => string;
  /** Entity ID used for duplicate filtering (defaults to getItemId) */
  getLinkedEntityId?: (item: TLinked) => string;
  renderItem: (item: TLinked) => ReactNode;
  getItemHref?: (item: TLinked) => string | null;
  // Grouping (optional)
  getItemGroup?: (item: TLinked) => string;
  groupLabels?: Record<string, string>;
  groupOrder?: string[];
  // Editing
  isEditing?: boolean;
  // Actions
  onLink: (item: TSearch, metadata: Record<string, any>) => Promise<void>;
  onUnlink: (item: TLinked) => Promise<void>;
  // Search config
  search: SearchConfig<TSearch>;
  // Optional capabilities
  metadataFields?: MetadataFieldDef[];
  create?: CreateConfig;
  remoteCache?: RemoteCacheConfig<TSearch>;
  bulkSelect?: boolean;
  /** Render a custom edit slide-over for a linked item */
  editLink?: {
    renderEditSlideOver: (
      item: TLinked,
      onClose: () => void,
      onSuccess: () => void
    ) => ReactNode;
  };
  // Cache invalidation
  invalidateKeys?: string[][];
  submitLabel?: string;
  /** Called when item count changes — use to set badge on parent WorkspaceSection */
  onCountChange?: (count: number) => void;
}

export function RecordLinker<TLinked, TSearch>({
  title,
  addLabel = 'Add',
  emptyMessage,
  linkedItems,
  isLoading = false,
  getItemId,
  getLinkedEntityId,
  renderItem,
  getItemHref,
  getItemGroup,
  groupLabels,
  groupOrder,
  isEditing = false,
  onLink,
  onUnlink,
  search,
  metadataFields,
  create,
  remoteCache,
  bulkSelect,
  editLink,
  invalidateKeys,
  submitLabel,
  onCountChange,
}: RecordLinkerProps<TLinked, TSearch>) {
  const queryClient = useQueryClient();

  // Report count to parent for badge display
  useEffect(() => {
    onCountChange?.(linkedItems.length);
  }, [linkedItems.length, onCountChange]);

  const [showSlideOver, setShowSlideOver] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<TLinked | null>(null);

  // IDs of linked entities for duplicate filtering in the slide-over
  const linkedIds = useMemo(() => {
    const ids = new Set<string>();
    linkedItems.forEach((item) => {
      ids.add(
        getLinkedEntityId ? getLinkedEntityId(item) : getItemId(item)
      );
    });
    return ids;
  }, [linkedItems, getItemId, getLinkedEntityId]);

  const invalidate = useCallback(() => {
    invalidateKeys?.forEach((key) => {
      queryClient.invalidateQueries({ queryKey: key });
    });
  }, [queryClient, invalidateKeys]);

  const handleLink = useCallback(
    async (item: TSearch, metadata: Record<string, any>) => {
      await onLink(item, metadata);
      invalidate();
    },
    [onLink, invalidate]
  );

  // Wrap create config to add invalidation
  const wrappedCreate = useMemo(() => {
    if (!create) return undefined;
    return {
      ...create,
      onCreateSubmit: async (
        formData: Record<string, any>,
        metadata: Record<string, any>
      ) => {
        await create.onCreateSubmit(formData, metadata);
        invalidate();
      },
    };
  }, [create, invalidate]);

  const handleUnlink = useCallback(
    async (item: TLinked) => {
      const id = getItemId(item);
      setUnlinkingId(id);
      try {
        await onUnlink(item);
        invalidate();
      } finally {
        setUnlinkingId(null);
      }
    },
    [onUnlink, getItemId, invalidate]
  );

  // Group items if grouping is configured
  const groupedItems = useMemo(() => {
    if (!getItemGroup) return null;
    const groups: Record<string, TLinked[]> = {};
    linkedItems.forEach((item) => {
      const group = getItemGroup(item);
      if (!groups[group]) groups[group] = [];
      groups[group].push(item);
    });
    return groups;
  }, [linkedItems, getItemGroup]);

  const renderItemCard = (item: TLinked) => {
    const id = getItemId(item);
    const href = getItemHref?.(item);
    return (
      <div
        key={id}
        className="flex items-center justify-between p-3 border border-lichen rounded-lg bg-parchment"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {renderItem(item)}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {href && (
            <a
              href={href}
              className="text-bark hover:text-copper-dark p-1"
              title="View record"
            >
              <ExternalLink size={14} />
            </a>
          )}
          {isEditing && editLink && (
            <button
              onClick={() => setEditingItem(item)}
              className="text-archive hover:text-ink p-1"
              title="Edit details"
            >
              <ExternalLink size={14} />
            </button>
          )}
          {isEditing && (
            <button
              onClick={() => handleUnlink(item)}
              disabled={unlinkingId === id}
              className="text-semantic-error hover:text-semantic-error/80 p-1 disabled:opacity-50"
              title="Unlink"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-ink">
          {title}
        </h4>
        {isEditing && (
          <button
            onClick={() => setShowSlideOver(true)}
            className="flex items-center gap-1 text-sm text-bark hover:text-copper-dark"
          >
            <Plus size={14} />
            {addLabel}
          </button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <MadronaLoader variant="dots" />
      ) : linkedItems.length === 0 ? (
        <div className="text-sm text-archive italic py-4 text-center">
          {emptyMessage || 'No items linked.'}
          {isEditing && (
            <button
              onClick={() => setShowSlideOver(true)}
              className="block mx-auto mt-2 text-bark hover:text-copper-dark"
            >
              {addLabel}
            </button>
          )}
        </div>
      ) : groupedItems ? (
        <div className="space-y-4">
          {(groupOrder || Object.keys(groupedItems)).map((group) => {
            const items = groupedItems[group];
            if (!items || items.length === 0) return null;
            return (
              <div key={group}>
                <h5 className="text-xs font-medium text-archive uppercase tracking-wide mb-2">
                  {groupLabels?.[group] || group}
                </h5>
                <div className="space-y-2">{items.map(renderItemCard)}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">{linkedItems.map(renderItemCard)}</div>
      )}

      {/* Search slide-over */}
      <RecordLinkerSlideOver
        isOpen={showSlideOver}
        onClose={() => setShowSlideOver(false)}
        search={search}
        metadataFields={metadataFields}
        create={wrappedCreate}
        remoteCache={remoteCache}
        bulkSelect={bulkSelect}
        linkedIds={linkedIds}
        onLink={handleLink}
        submitLabel={submitLabel}
      />

      {/* Edit slide-over */}
      {editLink &&
        editingItem &&
        editLink.renderEditSlideOver(
          editingItem,
          () => setEditingItem(null),
          () => {
            setEditingItem(null);
            invalidate();
          }
        )}
    </div>
  );
}
