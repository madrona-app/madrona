import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Folder, AlertCircle } from 'lucide-react';
import { createMediaFolder, updateMediaFolder } from '../../lib/api';
import type { MediaFolder } from '../../lib/schemas';

interface CreateFolderModalProps {
  organizationId: string;
  parentFolderId?: string | null;
  parentFolderName?: string | null;
  editFolder?: MediaFolder | null;
  onClose: () => void;
}

export function CreateFolderModal({
  organizationId,
  parentFolderId = null,
  parentFolderName = null,
  editFolder = null,
  onClose,
}: CreateFolderModalProps) {
  const queryClient = useQueryClient();
  const isEditing = !!editFolder;

  const [name, setName] = useState(editFolder?.name || '');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createMediaFolder(organizationId, {
        name: name.trim(),
        parent_folder_id: parentFolderId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-folders', organizationId] });
      onClose();
    },
    onError: (err: Error & { message?: string }) => {
      if (err.message?.includes('DUPLICATE_NAME')) {
        setError('A folder with this name already exists in this location');
      } else {
        setError(err.message || 'Failed to create folder');
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateMediaFolder(organizationId, editFolder!.folder_id, {
        name: name.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-folders', organizationId] });
      onClose();
    },
    onError: (err: Error & { message?: string }) => {
      if (err.message?.includes('DUPLICATE_NAME')) {
        setError('A folder with this name already exists in this location');
      } else {
        setError(err.message || 'Failed to rename folder');
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Folder name is required');
      return;
    }

    if (isEditing) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div role="presentation" className="absolute inset-0 bg-ink/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-parchment rounded-lg shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder size={20} className="text-forest" />
            <h2 className="text-lg font-semibold text-ink">
              {isEditing ? 'Rename Folder' : 'Create Folder'}
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
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            {/* Parent folder info */}
            {!isEditing && parentFolderName && (
              <div className="text-sm text-archive">
                Creating folder in: <span className="font-medium text-ink">{parentFolderName}</span>
              </div>
            )}

            {/* Folder name */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                Folder Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter folder name"
                className="w-full px-3 py-2 border border-lichen rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                autoFocus
              />
            </div>

            {/* Error */}
            {error && (
              <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-semantic-error flex items-center gap-2 text-sm">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-lichen bg-parchment flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-lichen rounded-lg text-sm text-ink hover:bg-stone transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isPending}
              className="px-4 py-2 bg-forest text-parchment rounded-lg text-sm hover:bg-forest/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              {isPending ? (
                <>
                  <span className="animate-spin h-4 w-4 border-2 border-parchment/30 border-t-white rounded-full" />
                  {isEditing ? 'Renaming...' : 'Creating...'}
                </>
              ) : (
                <>
                  <Folder size={16} />
                  {isEditing ? 'Rename' : 'Create Folder'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
