import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Folder, FolderOpen, ChevronRight, ChevronDown, Check } from 'lucide-react';
import { listMediaFolders, moveMediaToFolder } from '../../lib/api';
import type { MediaFolder } from '../../lib/schemas';

interface MoveToFolderModalProps {
  organizationId: string;
  mediaIds: string[];
  currentFolderId?: string | null;
  onClose: () => void;
  onSuccess?: () => void;
}

interface FolderSelectNodeProps {
  folder: MediaFolder;
  folders: MediaFolder[];
  selectedFolderId: string | null;
  expandedIds: Set<string>;
  disabledIds: Set<string>;
  onToggleExpand: (folderId: string) => void;
  onSelectFolder: (folderId: string | null) => void;
}

function FolderSelectNode({
  folder,
  folders,
  selectedFolderId,
  expandedIds,
  disabledIds,
  onToggleExpand,
  onSelectFolder,
}: FolderSelectNodeProps) {
  const children = folders.filter((f) => f.parent_folder_id === folder.folder_id);
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(folder.folder_id);
  const isSelected = selectedFolderId === folder.folder_id;
  const isDisabled = disabledIds.has(folder.folder_id);

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer ${
          isDisabled
            ? 'opacity-50 cursor-not-allowed'
            : isSelected
              ? 'bg-forest/10 text-forest'
              : 'hover:bg-stone/20 text-ink'
        }`}
        style={{ paddingLeft: `${folder.depth * 16 + 8}px` }}
        onClick={() => !isDisabled && onSelectFolder(folder.folder_id)}
      >
        {/* Expand/collapse toggle */}
        <button
          className="p-0.5 hover:bg-stone/30 rounded"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) {
              onToggleExpand(folder.folder_id);
            }
          }}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown size={14} className="text-archive" />
            ) : (
              <ChevronRight size={14} className="text-archive" />
            )
          ) : (
            <span className="w-3.5" />
          )}
        </button>

        {/* Folder icon */}
        {isExpanded && hasChildren ? (
          <FolderOpen size={16} className={isSelected ? 'text-forest' : 'text-archive'} />
        ) : (
          <Folder size={16} className={isSelected ? 'text-forest' : 'text-archive'} />
        )}

        {/* Folder name */}
        <span className="flex-1 text-sm truncate">{folder.name}</span>

        {/* Selected indicator */}
        {isSelected && <Check size={16} className="text-forest" />}
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div>
          {children
            .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
            .map((child) => (
              <FolderSelectNode
                key={child.folder_id}
                folder={child}
                folders={folders}
                selectedFolderId={selectedFolderId}
                expandedIds={expandedIds}
                disabledIds={disabledIds}
                onToggleExpand={onToggleExpand}
                onSelectFolder={onSelectFolder}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export function MoveToFolderModal({
  organizationId,
  mediaIds,
  currentFolderId = null,
  onClose,
  onSuccess,
}: MoveToFolderModalProps) {
  const queryClient = useQueryClient();
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['media-folders', organizationId],
    queryFn: () => listMediaFolders(organizationId),
    enabled: !!organizationId,
  });

  const moveMutation = useMutation({
    mutationFn: () => moveMediaToFolder(organizationId, selectedFolderId!, mediaIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-folders', organizationId] });
      queryClient.invalidateQueries({ queryKey: ['media', organizationId] });
      onSuccess?.();
      onClose();
    },
  });

  const folders = (data?.folders || []) as MediaFolder[];
  const rootFolders = folders.filter((f) => !f.parent_folder_id);

  // Disable the current folder (can't move to where items already are)
  const disabledIds = new Set<string>();
  if (currentFolderId) {
    disabledIds.add(currentFolderId);
  }

  const handleToggleExpand = (folderId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const itemCount = mediaIds.length;
  const itemLabel = itemCount === 1 ? 'item' : 'items';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-parchment rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder size={20} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">
              Move {itemCount} {itemLabel}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-archive hover:text-ink rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="py-8 text-center text-archive">Loading folders...</div>
          ) : (
            <div className="space-y-1">
              {/* Root option */}
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer ${
                  selectedFolderId === null && currentFolderId !== null
                    ? 'bg-forest/10 text-forest'
                    : currentFolderId === null
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-stone/20 text-ink'
                }`}
                onClick={() => currentFolderId !== null && setSelectedFolderId(null)}
              >
                <Folder
                  size={16}
                  className={
                    selectedFolderId === null && currentFolderId !== null
                      ? 'text-forest'
                      : 'text-archive'
                  }
                />
                <span className="flex-1 text-sm font-medium">Root (No folder)</span>
                {selectedFolderId === null && currentFolderId !== null && (
                  <Check size={16} className="text-forest" />
                )}
              </div>

              {/* Folder tree */}
              {rootFolders
                .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
                .map((folder) => (
                  <FolderSelectNode
                    key={folder.folder_id}
                    folder={folder}
                    folders={folders}
                    selectedFolderId={selectedFolderId}
                    expandedIds={expandedIds}
                    disabledIds={disabledIds}
                    onToggleExpand={handleToggleExpand}
                    onSelectFolder={setSelectedFolderId}
                  />
                ))}

              {rootFolders.length === 0 && (
                <div className="py-8 text-center text-archive text-sm">
                  No folders available
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lichen bg-stone/20 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-lichen rounded-lg text-sm text-ink hover:bg-stone/20 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => moveMutation.mutate()}
            disabled={
              moveMutation.isPending ||
              (selectedFolderId === null && currentFolderId === null) ||
              selectedFolderId === currentFolderId
            }
            className="px-4 py-2 bg-forest text-parchment rounded-lg text-sm hover:bg-forest/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
          >
            {moveMutation.isPending ? (
              <>
                <span className="animate-spin h-4 w-4 border-2 border-parchment/30 border-t-white rounded-full" />
                Moving...
              </>
            ) : (
              <>
                <Folder size={16} />
                Move Here
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
