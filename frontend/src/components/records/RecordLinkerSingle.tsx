import { useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, X, Loader2 } from 'lucide-react';
import { RecordLinkerSlideOver } from './RecordLinkerSlideOver';
import { MadronaLoader } from '../ui/MadronaLoader';
import type {
  SearchConfig,
  MetadataFieldDef,
  CreateConfig,
  RemoteCacheConfig,
} from './types';

interface RecordLinkerSingleProps<TLinked, TSearch> {
  organizationId: string;
  singularNoun: string;
  emptyLabel?: string;
  linkedItem: TLinked | null;
  isLoading?: boolean;
  renderItem: (item: TLinked) => ReactNode;
  isEditing?: boolean;
  onLink: (item: TSearch, metadata: Record<string, any>) => Promise<void>;
  onUnlink: () => Promise<void>;
  search: SearchConfig<TSearch>;
  metadataFields?: MetadataFieldDef[];
  create?: CreateConfig;
  remoteCache?: RemoteCacheConfig<TSearch>;
  onLinkChange?: () => void;
  invalidateKeys?: string[][];
  submitLabel?: string;
  /** Called when the linked count changes (0 or 1) — use to set badge on parent WorkspaceSection */
  onCountChange?: (count: number) => void;
}

export function RecordLinkerSingle<TLinked, TSearch>({
  singularNoun,
  emptyLabel,
  linkedItem,
  isLoading = false,
  renderItem,
  isEditing = false,
  onLink,
  onUnlink,
  search,
  metadataFields,
  create,
  remoteCache,
  onLinkChange,
  invalidateKeys,
  submitLabel,
  onCountChange,
}: RecordLinkerSingleProps<TLinked, TSearch>) {
  const queryClient = useQueryClient();
  const [showSlideOver, setShowSlideOver] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);

  // Report count to parent for badge display
  useEffect(() => {
    onCountChange?.(linkedItem ? 1 : 0);
  }, [linkedItem, onCountChange]);

  const invalidate = useCallback(() => {
    invalidateKeys?.forEach((key) => {
      queryClient.invalidateQueries({ queryKey: key });
    });
  }, [queryClient, invalidateKeys]);

  const handleLink = useCallback(
    async (item: TSearch, metadata: Record<string, any>) => {
      await onLink(item, metadata);
      invalidate();
      onLinkChange?.();
    },
    [onLink, invalidate, onLinkChange]
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
        onLinkChange?.();
      },
    };
  }, [create, invalidate, onLinkChange]);

  const handleUnlink = useCallback(async () => {
    setIsUnlinking(true);
    try {
      await onUnlink();
      invalidate();
      onLinkChange?.();
    } finally {
      setIsUnlinking(false);
    }
  }, [onUnlink, invalidate, onLinkChange]);

  if (isLoading) {
    return <MadronaLoader variant="dots" />;
  }

  return (
    <div>
      {linkedItem ? (
        <div>
          {renderItem(linkedItem)}
          {isEditing && (
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => setShowSlideOver(true)}
                className="text-sm text-bark hover:text-copper-dark"
              >
                Change
              </button>
              <button
                onClick={handleUnlink}
                disabled={isUnlinking}
                className="flex items-center gap-1 text-sm text-semantic-error hover:text-semantic-error/80 disabled:opacity-50"
              >
                {isUnlinking ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <X size={14} />
                )}
                Unlink
              </button>
            </div>
          )}
        </div>
      ) : (
        <div>
          {isEditing ? (
            <button
              onClick={() => setShowSlideOver(true)}
              className="w-full p-4 border-2 border-dashed border-lichen rounded-lg text-archive hover:border-bark hover:text-bark transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              {emptyLabel || `Link to ${singularNoun}`}
            </button>
          ) : (
            <p className="text-sm text-archive italic py-4 text-center">
              No {singularNoun.toLowerCase()} linked.
            </p>
          )}
        </div>
      )}

      <RecordLinkerSlideOver
        isOpen={showSlideOver}
        onClose={() => setShowSlideOver(false)}
        search={search}
        metadataFields={metadataFields}
        create={wrappedCreate}
        remoteCache={remoteCache}
        linkedIds={new Set()}
        onLink={handleLink}
        submitLabel={submitLabel}
      />
    </div>
  );
}
