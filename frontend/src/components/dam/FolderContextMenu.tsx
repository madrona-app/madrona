import { useRef, useEffect } from 'react';
import { FolderPlus, Pencil, Trash2, FolderInput } from 'lucide-react';
import type { MediaFolder } from '../../lib/schemas';

interface FolderContextMenuProps {
  folder: MediaFolder | null;
  position: { x: number; y: number };
  onClose: () => void;
  onCreateSubfolder: (parentId: string | null) => void;
  onRename: (folder: MediaFolder) => void;
  onDelete: (folder: MediaFolder) => void;
  onMoveToFolder?: (folder: MediaFolder) => void;
}

export function FolderContextMenu({
  folder,
  position,
  onClose,
  onCreateSubfolder,
  onRename,
  onDelete,
  onMoveToFolder,
}: FolderContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to keep menu on screen
  const adjustedPosition = { ...position };
  if (typeof window !== 'undefined') {
    const menuWidth = 200;
    const menuHeight = 160;
    if (position.x + menuWidth > window.innerWidth) {
      adjustedPosition.x = window.innerWidth - menuWidth - 8;
    }
    if (position.y + menuHeight > window.innerHeight) {
      adjustedPosition.y = window.innerHeight - menuHeight - 8;
    }
  }

  const menuItems = [
    {
      icon: FolderPlus,
      label: 'New Subfolder',
      onClick: () => {
        onCreateSubfolder(folder?.folder_id || null);
        onClose();
      },
    },
    ...(folder
      ? [
          {
            icon: Pencil,
            label: 'Rename',
            onClick: () => {
              onRename(folder);
              onClose();
            },
          },
          ...(onMoveToFolder
            ? [
                {
                  icon: FolderInput,
                  label: 'Move to...',
                  onClick: () => {
                    onMoveToFolder(folder);
                    onClose();
                  },
                },
              ]
            : []),
          {
            icon: Trash2,
            label: 'Delete',
            onClick: () => {
              onDelete(folder);
              onClose();
            },
            danger: true,
          },
        ]
      : []),
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-parchment rounded-lg shadow-lg border border-lichen py-1 min-w-[180px]"
      role="menu"
      aria-label={folder ? `Actions for ${folder.name}` : 'Folder actions'}
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      {menuItems.map((item, index) => (
        <button
          key={index}
          onClick={item.onClick}
          role="menuitem"
          className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
            item.danger
              ? 'text-semantic-error hover:bg-semantic-error/10'
              : 'text-ink hover:bg-stone/20'
          }`}
        >
          <item.icon size={16} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
