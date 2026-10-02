/**
 * AddToMediaWorkspaceDialog - Dialog to add assets to a Work Set
 *
 * Work Sets are operational groupings for bulk operations and team collaboration.
 * Allows users to:
 * - Select an existing work set to add assets to
 * - Create a new work set and add assets
 * - Add single or multiple assets at once
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Layers, Plus, Check, Search, Lock, Users, Globe, Image } from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { useAccessibleModal, getModalAriaProps } from '../../hooks/useAccessibleModal';
import { cn } from '../../lib/utils';
import { getMediaWorkspaces, addMediaWorkspaceItems, createMediaWorkspace, setMediaWorkspaceContext } from '../../lib/api';
import { ModalPortal } from '../ModalPortal';

interface AddToMediaWorkspaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mediaIds: string[];
  assetLabel?: string; // e.g., "photo.jpg" or "3 assets"
}

export default function AddToMediaWorkspaceDialog({
  isOpen,
  onClose,
  mediaIds,
  assetLabel,
}: AddToMediaWorkspaceDialogProps) {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const queryClient = useQueryClient();

  const { modalRef, titleId, descriptionId } = useAccessibleModal({
    isOpen,
    onClose,
    titlePrefix: 'add-to-media-workspace-dialog',
  });

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Fetch user's workspaces
  const { data: workspacesData, isLoading } = useQuery({
    queryKey: ['media-workspaces', orgId, 'mine'],
    queryFn: () => getMediaWorkspaces(orgId!, { filter: 'mine', limit: 50 }),
    enabled: !!orgId && isOpen,
  });

  const workspaces = workspacesData?.items ?? [];

  // Filter workspaces by search query
  const filteredWorkspaces = searchQuery
    ? workspaces.filter((ws) =>
        ws.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : workspaces;

  // Add to existing workspace mutation
  const addToWorkspaceMutation = useMutation({
    mutationFn: async (workspaceId: string) => {
      await addMediaWorkspaceItems(orgId!, workspaceId, mediaIds);
      // Context is a convenience so the record strip appears. A failure here
      // must not report an add that already landed as a failure.
      try {
        await setMediaWorkspaceContext(orgId!, workspaceId);
      } catch {
        // no-op: the assets are in the work set regardless
      }
      return workspaceId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['media-workspace'] });
      queryClient.invalidateQueries({ queryKey: ['media-active-context', orgId] });
      setSuccess(true);
      setError(null);
      // Auto-close after success
      setTimeout(() => {
        handleClose();
      }, 1500);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to add to work set');
    },
  });

  // Create new workspace mutation (add assets separately after creation)
  const createWorkspaceMutation = useMutation({
    mutationFn: async () => {
      const result = await createMediaWorkspace(orgId!, {
        name: newWorkspaceName,
        visibility: 'private',
      });
      // Add assets to the new workspace
      await addMediaWorkspaceItems(orgId!, result.workspace_id, mediaIds);
      // See above: context is never a reason to report failure.
      try {
        await setMediaWorkspaceContext(orgId!, result.workspace_id);
      } catch {
        // no-op: the assets are in the work set regardless
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['media-active-context', orgId] });
      setSuccess(true);
      setError(null);
      // Auto-close after success
      setTimeout(() => {
        handleClose();
      }, 1500);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create work set');
    },
  });

  const handleClose = () => {
    setSelectedWorkspaceId(null);
    setShowCreateNew(false);
    setNewWorkspaceName('');
    setSearchQuery('');
    setError(null);
    setSuccess(false);
    onClose();
  };

  const handleAddToWorkspace = () => {
    if (selectedWorkspaceId) {
      addToWorkspaceMutation.mutate(selectedWorkspaceId);
    }
  };

  const handleCreateAndAdd = () => {
    if (newWorkspaceName.trim()) {
      createWorkspaceMutation.mutate();
    }
  };

  const getVisibilityIcon = (visibility: string) => {
    switch (visibility) {
      case 'private':
        return <Lock size={12} className="text-archive" />;
      case 'shared':
        return <Users size={12} className="text-bark" />;
      case 'org':
        return <Globe size={12} className="text-semantic-success" />;
      default:
        return null;
    }
  };

  const isPending = addToWorkspaceMutation.isPending || createWorkspaceMutation.isPending;

  if (!isOpen) return null;

  const label = assetLabel || `${mediaIds.length} asset${mediaIds.length !== 1 ? 's' : ''}`;

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/50"
      onClick={handleClose}
    >
      <div
        ref={modalRef}
        {...getModalAriaProps(titleId, descriptionId)}
        onClick={(e) => e.stopPropagation()}
        className="bg-parchment rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-lichen">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-bark/10 rounded-sm">
                <Layers size={20} className="text-bark" />
              </div>
              <div>
                <h2 id={titleId} className="text-lg font-semibold text-ink">Add to Work Set</h2>
                <p id={descriptionId} className="text-sm text-archive">{label}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-1 text-archive hover:text-ink rounded"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {success ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-semantic-success/10 rounded-full flex items-center justify-center mx-auto mb-3">
                <Check size={24} className="text-semantic-success" />
              </div>
              <p className="text-ink font-medium">Added to work set!</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-sm text-sm text-semantic-error">
                  {error}
                </div>
              )}

              {!showCreateNew ? (
                <>
                  {/* Search */}
                  <div className="relative">
                    <Search
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-archive"
                    />
                    <input
                      type="text"
                      placeholder="Search work sets..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                    />
                  </div>

                  {/* Create new button */}
                  <button
                    onClick={() => setShowCreateNew(true)}
                    className="w-full flex items-center gap-3 p-3 border border-dashed border-lichen rounded-sm hover:border-bark/30 hover:bg-stone/30"
                  >
                    <div className="p-2 bg-bark/10 rounded-sm">
                      <Plus size={16} className="text-bark" />
                    </div>
                    <span className="text-sm font-medium text-ink">Create new work set</span>
                  </button>

                  {/* Workspaces list */}
                  <div className="space-y-2">
                    {isLoading ? (
                      <div className="text-center py-4 text-sm text-archive">
                        Loading work sets...
                      </div>
                    ) : filteredWorkspaces.length === 0 ? (
                      <div className="text-center py-4 text-sm text-archive">
                        {searchQuery
                          ? 'No work sets match your search'
                          : 'No work sets yet. Create one to get started.'}
                      </div>
                    ) : (
                      filteredWorkspaces.map((ws) => (
                        <button
                          key={ws.workspace_id}
                          onClick={() => setSelectedWorkspaceId(ws.workspace_id)}
                          className={cn(
                            'w-full flex items-center gap-3 p-3 border rounded-sm text-left transition-colors',
                            selectedWorkspaceId === ws.workspace_id
                              ? 'border-bark bg-bark/5'
                              : 'border-lichen hover:border-bark/30'
                          )}
                        >
                          {/* Workspace thumbnail or icon */}
                          {ws.cover_thumbnail_url ? (
                            <img
                              src={ws.cover_thumbnail_url}
                              alt=""
                              className="w-10 h-10 object-cover rounded"
                            />
                          ) : (
                            <div
                              className={cn(
                                'w-10 h-10 rounded flex items-center justify-center',
                                selectedWorkspaceId === ws.workspace_id
                                  ? 'bg-bark/10'
                                  : 'bg-stone/50'
                              )}
                            >
                              <Image
                                size={16}
                                className={
                                  selectedWorkspaceId === ws.workspace_id
                                    ? 'text-bark'
                                    : 'text-archive'
                                }
                              />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-ink truncate">
                              {ws.name}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-archive">
                              <span>{ws.asset_count} assets</span>
                              <span className="flex items-center gap-1">
                                {getVisibilityIcon(ws.visibility)}
                              </span>
                            </div>
                          </div>
                          {selectedWorkspaceId === ws.workspace_id && (
                            <Check size={18} className="text-bark" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </>
              ) : (
                /* Create new workspace form */
                <div className="space-y-4">
                  <button
                    onClick={() => setShowCreateNew(false)}
                    className="px-4 py-2 text-archive hover:text-ink transition-colors"
                  >
                    &larr; Back to work sets
                  </button>

                  <div>
                    <label
                      htmlFor="workspace-name"
                      className="block text-sm font-medium text-ink mb-1"
                    >
                      Work Set Name
                    </label>
                    <input
                      id="workspace-name"
                      type="text"
                      value={newWorkspaceName}
                      onChange={(e) => setNewWorkspaceName(e.target.value)}
                      placeholder="e.g., Website Redesign Assets"
                      className="w-full px-3 py-2 border border-lichen rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
                      autoFocus
                    />
                  </div>

                  <p className="text-sm text-archive">
                    The work set will be created as private. You can change visibility later.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="px-6 py-4 border-t border-lichen flex justify-end gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-archive hover:text-ink transition-colors"
            >
              Cancel
            </button>
            {!showCreateNew ? (
              <button
                onClick={handleAddToWorkspace}
                disabled={!selectedWorkspaceId || isPending}
                className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? 'Adding...' : 'Add to Work Set'}
              </button>
            ) : (
              <button
                onClick={handleCreateAndAdd}
                disabled={!newWorkspaceName.trim() || isPending}
                className="px-4 py-2 bg-bark text-parchment rounded-sm hover:bg-bark/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? 'Creating...' : 'Create & Add'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
    </ModalPortal>
  );
}
