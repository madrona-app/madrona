/**
 * WorkspaceEditPage - Edit an existing Work Set
 *
 * Unified page that handles both collections and media workspaces.
 * Determines type from workspace data and renders appropriate UI.
 */

import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layers, ChevronLeft, Globe, Lock, Users, UserPlus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getWorkspace, updateWorkspace, listWorkspaceShares, deleteWorkspaceShare } from '../../lib/api';
import WorkspaceShareDialog from '../../components/workspaces/WorkspaceShareDialog';
import MediaWorkspaceShareDialog from '../../components/media-workspaces/MediaWorkspaceShareDialog';
import type { WorkspaceShare } from '../../lib/schemas';

export default function WorkspaceEditPage() {
  const { orgId, workspaceId } = useParams<{ orgId: string; workspaceId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'shared' | 'org'>('private');
  const [error, setError] = useState<string | null>(null);
  const [showShareDialog, setShowShareDialog] = useState(false);

  // Fetch workspace details - unified API returns workspace_type
  const { data: workspace, isLoading } = useQuery({
    queryKey: ['workspace', orgId, workspaceId],
    queryFn: () => getWorkspace(orgId!, workspaceId!),
    enabled: !!orgId && !!workspaceId,
  });

  // Determine if this is a media workspace
  const isMedia = workspace?.workspace_type === 'media';
  const workSegment = isMedia ? 'media' : 'collections';

  // Fetch existing shares
  const { data: sharesData } = useQuery({
    queryKey: ['workspace-shares', orgId, workspaceId],
    queryFn: () => listWorkspaceShares(orgId!, workspaceId!),
    enabled: !!orgId && !!workspaceId,
  });

  // Delete share mutation
  const deleteShareMutation = useMutation({
    mutationFn: (shareId: string) => deleteWorkspaceShare(orgId!, workspaceId!, shareId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-shares', orgId, workspaceId] });
    },
  });

  // Populate form when data loads
  useEffect(() => {
    if (workspace) {
      setName(workspace.name);
      setDescription(workspace.description || '');
      setVisibility(workspace.visibility as 'private' | 'shared' | 'org');
    }
  }, [workspace]);

  const existingShares = sharesData?.shares || [];

  const updateMutation = useMutation({
    mutationFn: () => updateWorkspace(orgId!, workspaceId!, { name, description, visibility }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', orgId, workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      navigate(`/organizations/${orgId}/${workSegment}/work/workspaces/${workspaceId}`);
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to update work set');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setError(null);
    updateMutation.mutate();
  };

  const visibilityOptions = [
    {
      value: 'private' as const,
      label: 'Private',
      description: 'Only you can see this work set',
      icon: Lock,
    },
    {
      value: 'shared' as const,
      label: 'Shared',
      description: 'Share with specific users',
      icon: Users,
    },
    {
      value: 'org' as const,
      label: 'Organization',
      description: 'All organization members can see',
      icon: Globe,
    },
  ];

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-stone/50 rounded w-1/4" />
          <div className="h-4 bg-stone/50 rounded w-1/3" />
          <div className="h-64 bg-stone/50 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="text-center py-16">
          <Layers size={48} className="mx-auto text-archive mb-4" />
          <h3 className="text-lg font-medium text-ink mb-2">Work set not found</h3>
          <Link
            to={`/organizations/${orgId}/${workSegment}/work/workspaces`}
            className="text-bark hover:text-copper-dark"
          >
            Back to work sets
          </Link>
        </div>
      </div>
    );
  }

  // Only owner can edit
  if (!workspace.is_owner) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="text-center py-16">
          <Layers size={48} className="mx-auto text-archive mb-4" />
          <h3 className="text-lg font-medium text-ink mb-2">Permission denied</h3>
          <p className="text-sm text-archive mb-4">Only the work set owner can edit settings.</p>
          <Link
            to={`/organizations/${orgId}/${workSegment}/work/workspaces/${workspaceId}`}
            className="text-bark hover:text-copper-dark"
          >
            Back to work set
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link
          to={`/organizations/${orgId}/${workSegment}/work/workspaces/${workspaceId}`}
          className="flex items-center gap-1 text-archive hover:text-bark"
        >
          <ChevronLeft size={16} />
          {workspace.name}
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-bark/10 rounded-lg">
          <Layers size={24} className="text-bark" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-ink">Edit Work Set</h1>
          <p className="text-sm text-archive">
            Update work set settings
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-3 bg-semantic-error/10 border border-semantic-error/30 rounded-lg text-sm text-semantic-error">
            {error}
          </div>
        )}

        {/* Name */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-ink mb-1">
            Name <span className="text-semantic-error">*</span>
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isMedia ? 'e.g., Website Redesign Assets' : 'e.g., Q1 Loan Exhibition Objects'}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
            autoFocus
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-ink mb-1">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description of what this work set is for..."
            rows={3}
            className="w-full px-3 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark resize-none"
          />
        </div>

        {/* Visibility */}
        <div>
          <label className="block text-sm font-medium text-ink mb-2">
            Visibility
          </label>
          <div className="space-y-2">
            {visibilityOptions.map((option) => {
              const Icon = option.icon;
              return (
                <label
                  key={option.value}
                  className={cn(
                    'flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors',
                    visibility === option.value
                      ? 'border-bark bg-bark/5'
                      : 'border-lichen hover:border-bark/30'
                  )}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={option.value}
                    checked={visibility === option.value}
                    onChange={(e) => setVisibility(e.target.value as typeof visibility)}
                    className="sr-only"
                  />
                  <div className={cn(
                    'p-2 rounded-lg',
                    visibility === option.value ? 'bg-bark/10' : 'bg-stone/30'
                  )}>
                    <Icon size={18} className={visibility === option.value ? 'text-bark' : 'text-archive'} />
                  </div>
                  <div>
                    <div className="font-medium text-ink">{option.label}</div>
                    <div className="text-sm text-archive">{option.description}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Shared with specific users */}
        {(visibility === 'shared' || existingShares.length > 0) && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-ink">
                Shared with ({existingShares.length})
              </label>
              <button
                type="button"
                onClick={() => setShowShareDialog(true)}
                className="flex items-center gap-1 text-sm text-bark hover:text-copper-dark"
              >
                <UserPlus size={14} />
                Add people
              </button>
            </div>
            {existingShares.length === 0 ? (
              <div className="p-4 border border-dashed border-lichen rounded-lg text-center">
                <p className="text-sm text-archive mb-2">No users added yet</p>
                <button
                  type="button"
                  onClick={() => setShowShareDialog(true)}
                  className="text-sm text-bark hover:text-copper-dark"
                >
                  Add people to share with
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {existingShares.map((share: WorkspaceShare) => (
                  <div
                    key={share.share_id}
                    className="flex items-center gap-3 p-3 border border-lichen rounded-lg"
                  >
                    <div className="w-8 h-8 rounded-full bg-bark/10 flex items-center justify-center">
                      <span className="text-xs font-medium text-bark">
                        {(share.principal_name || share.principal_email || 'U')
                          .charAt(0)
                          .toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">
                        {share.principal_name || share.principal_email || 'Unknown user'}
                      </div>
                      {share.principal_name && share.principal_email && (
                        <div className="text-xs text-archive truncate">
                          {share.principal_email}
                        </div>
                      )}
                    </div>
                    <span className="text-xs px-2 py-1 bg-stone/50 rounded text-archive capitalize">
                      {share.permission}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteShareMutation.mutate(share.share_id)}
                      disabled={deleteShareMutation.isPending}
                      className="p-1 text-archive hover:text-semantic-error"
                      title="Remove access"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-lichen">
          <Link
            to={`/organizations/${orgId}/${workSegment}/work/workspaces/${workspaceId}`}
            className="px-4 py-2 text-sm text-archive hover:text-ink"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Share Dialog - render appropriate one based on workspace type */}
      {showShareDialog && (
        isMedia ? (
          <MediaWorkspaceShareDialog
            isOpen={showShareDialog}
            onClose={() => setShowShareDialog(false)}
            workspaceId={workspaceId!}
            workspaceName={workspace.name}
            ownerId={workspace.owner_user_id}
          />
        ) : (
          <WorkspaceShareDialog
            isOpen={showShareDialog}
            onClose={() => setShowShareDialog(false)}
            workspaceId={workspaceId!}
            workspaceName={workspace.name}
            ownerId={workspace.owner_user_id}
          />
        )
      )}
    </div>
  );
}
