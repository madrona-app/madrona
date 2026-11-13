import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Folder, FolderOpen, ChevronRight, ChevronDown, Check } from 'lucide-react';
import { listMediaFolders, moveMediaToFolder } from '../../lib/api';
import type { MediaFolder } from '../../lib/schemas';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';

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
    <li>
      <div
        className={`relative flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer ${
          isDisabled
            ? 'opacity-50 cursor-not-allowed'
            : isSelected
              ? 'bg-forest/10 text-forest'
              : 'hover:bg-stone/20 text-ink'
        }`}
        style={{ paddingLeft: `${folder.depth * 16 + 8}px` }}
      >
        {/* Expand/collapse toggle */}
        <button
          type="button"
          className="relative z-10 p-0.5 hover:bg-stone/30 rounded"
          aria-label={hasChildren ? (isExpanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`) : undefined}
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-hidden={hasChildren ? undefined : true}
          tabIndex={hasChildren ? undefined : -1}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) {
              onToggleExpand(folder.folder_id);
            }
          }}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown size={14} className="text-archive" aria-hidden="true" />
            ) : (
              <ChevronRight size={14} className="text-archive" aria-hidden="true" />
            )
          ) : (
            <span className="w-3.5" />
          )}
        </button>

        {/* Choose destination: its ::after stretches over the whole row so a click anywhere selects */}
        <button
          type="button"
          aria-pressed={isSelected}
          disabled={isDisabled}
          onClick={() => onSelectFolder(folder.folder_id)}
          className="flex flex-1 min-w-0 items-center gap-1 text-left bg-transparent p-0 border-0 cursor-pointer disabled:cursor-not-allowed after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-bark/30 focus-visible:after:ring-offset-2"
        >
          {/* Folder icon */}
          {isExpanded && hasChildren ? (
            <FolderOpen size={16} className={isSelected ? 'text-forest' : 'text-archive'} aria-hidden="true" />
          ) : (
            <Folder size={16} className={isSelected ? 'text-forest' : 'text-archive'} aria-hidden="true" />
          )}

          {/* Folder name */}
          <span className="flex-1 text-sm truncate">
            {folder.name}
            {isDisabled && <span className="sr-only"> (current folder)</span>}
          </span>

          {/* Selected indicator */}
          {isSelected && <Check size={16} className="text-forest" aria-hidden="true" />}
        </button>
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <ul>
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
        </ul>
      )}
    </li>
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
  const { modalRef, titleId } = useAccessibleModal({
    isOpen: true,
    onClose,
    titlePrefix: 'move-to-folder-modal',
  });

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
      <div aria-hidden="true" className="absolute inset-0 bg-ink/50" onClick={onClose} />

      {/* Modal */}
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId)}
        className="relative bg-parchment rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder size={20} className="text-forest" aria-hidden="true" />
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              Move {itemCount} {itemLabel}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-archive hover:text-ink rounded transition-colors"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="py-8 text-center text-archive">Loading folders...</div>
          ) : (
            <ul className="space-y-1" aria-label="Destination folder">
              {/* Root option */}
              <li>
              <button
                type="button"
                aria-pressed={selectedFolderId === null && currentFolderId !== null}
                disabled={currentFolderId === null}
                className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 ${
                  selectedFolderId === null && currentFolderId !== null
                    ? 'bg-forest/10 text-forest'
                    : currentFolderId === null
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-stone/20 text-ink'
                }`}
                onClick={() => currentFolderId !== null && setSelectedFolderId(null)}
              >
                <Folder
                  aria-hidden="true"
                  size={16}
                  className={
                    selectedFolderId === null && currentFolderId !== null
                      ? 'text-forest'
                      : 'text-archive'
                  }
                />
                <span className="flex-1 text-sm font-medium">Root (No folder)</span>
                {selectedFolderId === null && currentFolderId !== null && (
                  <Check size={16} className="text-forest" aria-hidden="true" />
                )}
              </button>
              </li>

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
                <li className="py-8 text-center text-archive text-sm">
                  No folders available
                </li>
              )}
            </ul>
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
                <Folder size={16} aria-hidden="true" />
                Move Here
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
