import { useState, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  MoreHorizontal,
  FileQuestion,
} from 'lucide-react';
import { listMediaFolders } from '../../lib/api';
import type { MediaFolder } from '../../lib/schemas';

// Helper to get all ancestor folder IDs for a given folder
function getAncestorIds(folderId: string, folders: MediaFolder[]): string[] {
  const ancestors: string[] = [];
  const folderMap = new Map(folders.map(f => [f.folder_id, f]));

  let current = folderMap.get(folderId);
  while (current?.parent_folder_id) {
    ancestors.push(current.parent_folder_id);
    current = folderMap.get(current.parent_folder_id);
  }

  return ancestors;
}

interface FolderTreeProps {
  organizationId: string;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder?: (parentId: string | null) => void;
  onFolderContextMenu?: (folder: MediaFolder | null, event: React.MouseEvent) => void;
  onDropMedia?: (folderId: string) => void;
  isDraggingMedia?: boolean;
  draggingCount?: number;
}

interface FolderNodeProps {
  folder: MediaFolder;
  folders: MediaFolder[];
  selectedFolderId: string | null;
  expandedIds: Set<string>;
  onToggleExpand: (folderId: string) => void;
  onSelectFolder: (folderId: string | null) => void;
  onContextMenu?: (folder: MediaFolder, event: React.MouseEvent) => void;
  onDropMedia?: (folderId: string) => void;
  isDraggingMedia?: boolean;
  draggingCount?: number;
}

function FolderNode({
  folder,
  folders,
  selectedFolderId,
  expandedIds,
  onToggleExpand,
  onSelectFolder,
  onContextMenu,
  onDropMedia,
  isDraggingMedia,
  draggingCount,
}: FolderNodeProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const children = folders.filter((f) => f.parent_folder_id === folder.folder_id);
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(folder.folder_id);
  const isSelected = selectedFolderId === folder.folder_id;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    onDropMedia?.(folder.folder_id);
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer group transition-colors ${
          isDragOver
            ? 'bg-forest/20 ring-2 ring-forest ring-inset'
            : isSelected
              ? 'bg-forest/10 text-forest'
              : isDraggingMedia
                ? 'hover:bg-forest/10'
                : 'hover:bg-stone/30 text-ink'
        }`}
        style={{ paddingLeft: `${(folder.depth * 16) + 8}px` }}
        onClick={() => onSelectFolder(folder.folder_id)}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu?.(folder, e);
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Expand/collapse toggle */}
        <button
          className="p-0.5 hover:bg-stone/30 rounded"
          aria-label={hasChildren ? (isExpanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`) : undefined}
          aria-expanded={hasChildren ? isExpanded : undefined}
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
        <div className="relative">
          {isExpanded && hasChildren ? (
            <FolderOpen size={16} className={isDragOver ? 'text-forest' : isSelected ? 'text-forest' : 'text-archive'} />
          ) : (
            <Folder size={16} className={isDragOver ? 'text-forest' : isSelected ? 'text-forest' : 'text-archive'} />
          )}
          {/* Drop indicator badge */}
          {isDragOver && draggingCount && draggingCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-forest text-parchment text-[10px] font-medium min-w-[14px] h-[14px] rounded-full flex items-center justify-center">
              {draggingCount}
            </span>
          )}
        </div>

        {/* Folder name */}
        <span className="flex-1 text-sm truncate">{folder.name}</span>

        {/* Media count */}
        {(folder.media_count ?? 0) > 0 && (
          <span className="text-xs text-archive">{folder.media_count}</span>
        )}

        {/* Context menu trigger */}
        <button
          className="p-0.5 opacity-0 group-hover:opacity-100 hover:bg-stone/30 rounded"
          aria-label={`More options for ${folder.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu?.(folder, e);
          }}
        >
          <MoreHorizontal size={14} className="text-archive" />
        </button>
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div className="animate-fade-in">
          {children
            .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
            .map((child) => (
              <FolderNode
                key={child.folder_id}
                folder={child}
                folders={folders}
                selectedFolderId={selectedFolderId}
                expandedIds={expandedIds}
                onToggleExpand={onToggleExpand}
                onSelectFolder={onSelectFolder}
                onContextMenu={onContextMenu}
                onDropMedia={onDropMedia}
                isDraggingMedia={isDraggingMedia}
                draggingCount={draggingCount}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// Reusable droppable row component for special folders (All Media, Unfiled)
function DroppableRow({
  folderId,
  isSelected,
  onSelect,
  onDropMedia,
  isDraggingMedia,
  draggingCount,
  title,
  children,
}: {
  folderId: string;
  isSelected: boolean;
  onSelect: () => void;
  onDropMedia?: (folderId: string) => void;
  isDraggingMedia?: boolean;
  draggingCount?: number;
  title?: string;
  children: React.ReactNode;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    onDropMedia?.(folderId);
  };

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
        isDragOver
          ? 'bg-forest/20 ring-2 ring-forest ring-inset'
          : isSelected
            ? 'bg-forest/10 text-forest'
            : isDraggingMedia
              ? 'hover:bg-forest/10 text-ink'
              : 'hover:bg-stone/30 text-ink'
      }`}
      onClick={onSelect}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title={title}
    >
      {children}
      {/* Drop indicator badge */}
      {isDragOver && draggingCount && draggingCount > 0 && (
        <span className="bg-forest text-parchment text-[10px] font-medium min-w-[14px] h-[14px] rounded-full flex items-center justify-center flex-shrink-0">
          {draggingCount}
        </span>
      )}
    </div>
  );
}

export function FolderTree({
  organizationId,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onFolderContextMenu,
  onDropMedia,
  isDraggingMedia,
  draggingCount,
}: FolderTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['media-folders', organizationId],
    queryFn: () => listMediaFolders(organizationId),
    enabled: !!organizationId,
    placeholderData: keepPreviousData,
    staleTime: 30000, // Consider data fresh for 30 seconds
  });

  const folders = (data?.folders || []) as MediaFolder[];
  const unfiledCount = data?.unfiled_count ?? 0;
  const rootFolders = folders.filter((f) => !f.parent_folder_id);

  // Auto-expand ancestors of the selected folder (only when selection changes)
  const [lastExpandedForSelection, setLastExpandedForSelection] = useState<string | null>(null);

  useEffect(() => {
    // Only run when selectedFolderId changes to a new folder (not on every folders refetch)
    if (
      selectedFolderId &&
      selectedFolderId !== 'unfiled' &&
      selectedFolderId !== lastExpandedForSelection &&
      folders.length > 0
    ) {
      const ancestorIds = getAncestorIds(selectedFolderId, folders);
      if (ancestorIds.length > 0) {
        setExpandedIds((prev) => {
          // Check if all ancestors are already expanded
          const allExpanded = ancestorIds.every(id => prev.has(id));
          if (allExpanded) return prev;

          const next = new Set(prev);
          ancestorIds.forEach((id) => next.add(id));
          return next;
        });
      }
      setLastExpandedForSelection(selectedFolderId);
    } else if (!selectedFolderId || selectedFolderId === 'unfiled') {
      setLastExpandedForSelection(null);
    }
  }, [selectedFolderId, folders, lastExpandedForSelection]);

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

  // Only show loading on true initial load (no data yet)
  if (isLoading && !data) {
    return (
      <div className="p-4 text-sm text-archive">
        Loading folders...
      </div>
    );
  }

  return (
    <div className="py-2" role="tree" aria-label="Media folders">
      {/* Header with add button */}
      <div className="px-3 mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-archive uppercase tracking-wider">
          Folders
        </span>
        {onCreateFolder && (
          <button
            onClick={() => onCreateFolder(null)}
            className="p-1 hover:bg-stone/20 rounded"
            title="Create folder"
            aria-label="Create folder"
          >
            <Plus size={14} className="text-archive" />
          </button>
        )}
      </div>

      {/* All Media (root) */}
      <div
        className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${
          selectedFolderId === null
            ? 'bg-forest/10 text-forest'
            : 'hover:bg-stone/30 text-ink'
        }`}
        onClick={() => onSelectFolder(null)}
      >
        <Folder size={16} className={selectedFolderId === null ? 'text-forest' : 'text-archive'} />
        <span className="flex-1 text-sm">All Media</span>
      </div>

      {/* Unfiled - items not yet organized (droppable) */}
      <DroppableRow
        folderId="unfiled"
        isSelected={selectedFolderId === 'unfiled'}
        onSelect={() => onSelectFolder('unfiled')}
        onDropMedia={onDropMedia}
        isDraggingMedia={isDraggingMedia}
        draggingCount={draggingCount}
        title="Items not yet organized"
      >
        <FileQuestion size={16} className={selectedFolderId === 'unfiled' ? 'text-forest' : 'text-archive'} />
        <div className="flex-1 min-w-0">
          <span className="text-sm block">Unfiled</span>
          <span className="text-xs text-archive block">Items not yet organized</span>
        </div>
        {unfiledCount > 0 && (
          <span className="text-xs text-archive flex-shrink-0">{unfiledCount}</span>
        )}
      </DroppableRow>

      {/* Folder tree */}
      <div className="mt-1">
        {rootFolders
          .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
          .map((folder) => (
            <FolderNode
              key={folder.folder_id}
              folder={folder}
              folders={folders}
              selectedFolderId={selectedFolderId}
              expandedIds={expandedIds}
              onToggleExpand={handleToggleExpand}
              onSelectFolder={onSelectFolder}
              onContextMenu={onFolderContextMenu}
              onDropMedia={onDropMedia}
              isDraggingMedia={isDraggingMedia}
              draggingCount={draggingCount}
            />
          ))}
      </div>

      {/* Empty state */}
      {rootFolders.length === 0 && (
        <div className="px-3 py-4 text-sm text-archive text-center">
          No folders yet
          {onCreateFolder && (
            <button
              onClick={() => onCreateFolder(null)}
              className="block mx-auto mt-2 text-forest hover:underline"
            >
              Create your first folder
            </button>
          )}
        </div>
      )}
    </div>
  );
}
