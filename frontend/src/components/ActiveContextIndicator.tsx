/**
 * ActiveContextIndicator - Shows the current active context (object or workspace)
 *
 * Displays in the header/top bar:
 * - Current object context with accession number
 * - Current workspace context with name and object count
 * - Quick actions to view or clear context
 * - Quick Actions button for workspace context
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Layers,
  X,
  ChevronDown,
  ExternalLink,
  Zap,
} from 'lucide-react';
import { useOrganization } from '../contexts/useOrganization';
import { useActiveProduct } from '../hooks/useActiveProduct';
import { cn } from '../lib/utils';
import {
  getActiveContext,
  clearActiveContext,
  getMediaActiveContext,
  clearMediaActiveContext,
} from '../lib/api';
import { BulkActionDialog } from './workspaces';
import { MediaBulkActionDialog } from './media-workspaces';

/**
 * Reads the item count from an active-context workspace. Collections
 * workspaces expose `object_count`; media workspaces expose `asset_count`.
 */
function getWorkspaceCount(
  workspace:
    | { object_count: number }
    | { asset_count: number }
    | null
    | undefined
): number {
  if (!workspace) return 0;
  return 'object_count' in workspace ? workspace.object_count : workspace.asset_count;
}

export function ActiveContextIndicator() {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const { activeProductId } = useActiveProduct();
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showBulkActionDialog, setShowBulkActionDialog] = useState(false);

  const isCollections = activeProductId === 'collections';
  const isMedia = activeProductId === 'media';

  // Fetch collections context
  const { data: collectionsData, isLoading: collectionsLoading } = useQuery({
    queryKey: ['active-context', orgId],
    queryFn: () => getActiveContext(orgId!),
    enabled: !!orgId && isCollections,
    refetchInterval: 30000,
  });

  // Fetch media context
  const { data: mediaData, isLoading: mediaLoading } = useQuery({
    queryKey: ['media-active-context', orgId],
    queryFn: () => getMediaActiveContext(orgId!),
    enabled: !!orgId && isMedia,
    refetchInterval: 30000,
  });

  // Clear context mutation — calls the right API for the current app
  const clearMutation = useMutation({
    mutationFn: async (): Promise<{ message: string }> => {
      if (isMedia) {
        await clearMediaActiveContext(orgId!);
        return { message: 'Context cleared' };
      }
      return clearActiveContext(orgId!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-context', orgId] });
      queryClient.invalidateQueries({ queryKey: ['media-active-context', orgId] });
      setIsExpanded(false);
    },
  });

  const isLoading = isCollections ? collectionsLoading : isMedia ? mediaLoading : false;
  const context = isCollections
    ? collectionsData?.context
    : isMedia
      ? mediaData?.context
      : null;

  // Don't show anything if no context, or not in collections/media
  if (isLoading || !context || !context.type || (!isCollections && !isMedia)) {
    return null;
  }

  const isObject = context.type === 'object';
  const isMediaWorkspace = context.type === 'media_workspace';
  const isWorkspace = context.type === 'workspace' || isMediaWorkspace;

  // Build the link to the context item
  const contextLink = isObject
    ? `/organizations/${orgId}/collections/objects/${context.object?.object_id}`
    : isMediaWorkspace
    ? `/organizations/${orgId}/media/work/workspaces/${context.workspace?.workspace_id}`
    : `/organizations/${orgId}/collections/work/workspaces/${context.workspace?.workspace_id}`;

  const contextLabel = isObject
    ? context.object?.accession_number || 'Object'
    : context.workspace?.name || 'Workspace';

  const contextSublabel = isObject
    ? context.object?.title
    : `${getWorkspaceCount(context.workspace)} ${isMediaWorkspace ? 'assets' : 'objects'}`;

  return (
    <div className="relative">
      {/* Main indicator button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors',
          'bg-bark/10 hover:bg-bark/20 border border-bark/30',
          isExpanded && 'bg-bark/20'
        )}
      >
        {/* Icon */}
        <div className={cn(
          'p-1 rounded',
          isObject ? 'bg-forest/10' : 'bg-bark/10'
        )}>
          {isObject ? (
            <Package size={14} className="text-forest" />
          ) : (
            <Layers size={14} className="text-bark" />
          )}
        </div>

        {/* Label */}
        <div className="text-left">
          <div className="text-xs text-archive">
            {isObject ? 'Active Object' : 'Active Workspace'}
          </div>
          <div className="text-sm font-medium text-ink truncate max-w-[150px]">
            {contextLabel}
          </div>
        </div>

        {/* Expand indicator */}
        <ChevronDown
          size={14}
          className={cn(
            'text-archive transition-transform',
            isExpanded && 'rotate-180'
          )}
        />
      </button>

      {/* Expanded dropdown */}
      {isExpanded && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsExpanded(false)}
          />

          {/* Dropdown content */}
          <div className="absolute top-full left-0 mt-2 w-72 bg-parchment border border-lichen rounded-lg shadow-lg z-50">
            {/* Context details */}
            <div className="p-4 border-b border-lichen">
              <div className="flex items-start gap-3">
                <div className={cn(
                  'p-2 rounded-lg',
                  isObject ? 'bg-forest/10' : 'bg-bark/10'
                )}>
                  {isObject ? (
                    <Package size={20} className="text-forest" />
                  ) : (
                    <Layers size={20} className="text-bark" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-archive mb-1">
                    {isObject ? 'Active Object' : 'Active Workspace'}
                  </div>
                  <div className="font-medium text-ink">
                    {contextLabel}
                  </div>
                  {contextSublabel && (
                    <div className="text-sm text-archive truncate">
                      {contextSublabel}
                    </div>
                  )}
                </div>
              </div>

              {/* Help text */}
              <p className="text-xs text-archive mt-3">
                {isObject
                  ? 'Quick actions will apply to this object. Clear context to return to general mode.'
                  : 'Quick actions will apply to all objects in this workspace.'}
              </p>
            </div>

            {/* Actions */}
            <div className="p-2">
              {/* Quick Actions button for workspace */}
              {isWorkspace && context.workspace && getWorkspaceCount(context.workspace) > 0 && (
                <button
                  onClick={() => {
                    setIsExpanded(false);
                    setShowBulkActionDialog(true);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left rounded-lg bg-bark text-parchment hover:bg-copper-dark hover:text-parchment mb-1"
                >
                  <Zap size={14} />
                  Quick Actions
                </button>
              )}
              <Link
                to={contextLink}
                onClick={() => setIsExpanded(false)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left rounded-lg hover:bg-stone/50"
              >
                <ExternalLink size={14} className="text-archive" />
                View {isObject ? 'Object' : 'Workspace'}
              </Link>
              <button
                onClick={() => clearMutation.mutate()}
                disabled={clearMutation.isPending}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left rounded-lg hover:bg-stone/50 text-semantic-error"
              >
                <X size={14} />
                {clearMutation.isPending ? 'Clearing...' : 'Clear Context'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Bulk Action Dialog for workspace context — product-specific */}
      {isWorkspace && context.workspace && isCollections && (
        <BulkActionDialog
          isOpen={showBulkActionDialog}
          onClose={() => {
            setShowBulkActionDialog(false);
            queryClient.invalidateQueries({ queryKey: ['active-context', orgId] });
          }}
          workspaceId={context.workspace.workspace_id}
          workspaceName={context.workspace.name}
          objectCount={getWorkspaceCount(context.workspace)}
        />
      )}
      {isWorkspace && context.workspace && isMedia && (
        <MediaBulkActionDialog
          isOpen={showBulkActionDialog}
          onClose={() => {
            setShowBulkActionDialog(false);
            queryClient.invalidateQueries({ queryKey: ['media-active-context', orgId] });
          }}
          workspaceId={context.workspace.workspace_id}
          workspaceName={context.workspace.name}
          assetCount={getWorkspaceCount(context.workspace)}
        />
      )}
    </div>
  );
}

/**
 * Compact version for the top bar
 * Shows just the icon and brief label
 */
export function ActiveContextBadge() {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const { activeProductId } = useActiveProduct();
  const queryClient = useQueryClient();

  const isCollections = activeProductId === 'collections';
  const isMedia = activeProductId === 'media';

  const { data: collectionsData, isLoading: cl } = useQuery({
    queryKey: ['active-context', orgId],
    queryFn: () => getActiveContext(orgId!),
    enabled: !!orgId && isCollections,
    refetchInterval: 30000,
  });

  const { data: mediaData, isLoading: ml } = useQuery({
    queryKey: ['media-active-context', orgId],
    queryFn: () => getMediaActiveContext(orgId!),
    enabled: !!orgId && isMedia,
    refetchInterval: 30000,
  });

  const clearMutation = useMutation({
    mutationFn: async (): Promise<{ message: string }> => {
      if (isMedia) {
        await clearMediaActiveContext(orgId!);
        return { message: 'Context cleared' };
      }
      return clearActiveContext(orgId!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-context', orgId] });
      queryClient.invalidateQueries({ queryKey: ['media-active-context', orgId] });
    },
  });

  const isLoading = isCollections ? cl : isMedia ? ml : false;
  const context = isCollections ? collectionsData?.context : isMedia ? mediaData?.context : null;

  if (isLoading || !context || !context.type || (!isCollections && !isMedia)) {
    return null;
  }

  const isObject = context.type === 'object';
  const isMediaWorkspace = context.type === 'media_workspace';
  const contextLabel = isObject
    ? context.object?.accession_number || 'Object'
    : context.workspace?.name || 'Workspace';

  const contextLink = isObject
    ? `/organizations/${orgId}/collections/objects/${context.object?.object_id}`
    : isMediaWorkspace
    ? `/organizations/${orgId}/media/work/workspaces/${context.workspace?.workspace_id}`
    : `/organizations/${orgId}/collections/work/workspaces/${context.workspace?.workspace_id}`;

  return (
    <div className="flex items-center gap-1">
      <Link
        to={contextLink}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded text-xs',
          isObject
            ? 'bg-forest/10 text-forest hover:bg-forest/20'
            : 'bg-bark/10 text-bark hover:bg-bark/20'
        )}
        title={`Active ${isObject ? 'object' : 'workspace'}: ${contextLabel}`}
      >
        {isObject ? <Package size={12} /> : <Layers size={12} />}
        <span className="max-w-[100px] truncate">{contextLabel}</span>
      </Link>
      <button
        onClick={() => clearMutation.mutate()}
        disabled={clearMutation.isPending}
        className="p-1 text-archive hover:text-semantic-error rounded hover:bg-semantic-error/10"
        title="Clear context"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/**
 * Mobile version for the navigation drawer
 * Styled for dark background (forest)
 */
export function MobileContextIndicator() {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const { activeProductId } = useActiveProduct();
  const queryClient = useQueryClient();

  const isCollections = activeProductId === 'collections';
  const isMedia = activeProductId === 'media';

  const { data: collectionsData, isLoading: cl } = useQuery({
    queryKey: ['active-context', orgId],
    queryFn: () => getActiveContext(orgId!),
    enabled: !!orgId && isCollections,
  });

  const { data: mediaData, isLoading: ml } = useQuery({
    queryKey: ['media-active-context', orgId],
    queryFn: () => getMediaActiveContext(orgId!),
    enabled: !!orgId && isMedia,
  });

  const clearMutation = useMutation({
    mutationFn: async (): Promise<{ message: string }> => {
      if (isMedia) {
        await clearMediaActiveContext(orgId!);
        return { message: 'Context cleared' };
      }
      return clearActiveContext(orgId!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-context', orgId] });
      queryClient.invalidateQueries({ queryKey: ['media-active-context', orgId] });
    },
  });

  const isLoading = isCollections ? cl : isMedia ? ml : false;
  const context = isCollections ? collectionsData?.context : isMedia ? mediaData?.context : null;

  if (isLoading || !context || !context.type || (!isCollections && !isMedia)) {
    return null;
  }

  const isObject = context.type === 'object';
  const isMediaWorkspace = context.type === 'media_workspace';
  const contextLabel = isObject
    ? context.object?.accession_number || 'Object'
    : context.workspace?.name || 'Workspace';

  const contextSublabel = isObject
    ? context.object?.title
    : `${getWorkspaceCount(context.workspace)} ${isMediaWorkspace ? 'assets' : 'objects'}`;

  const contextLink = isObject
    ? `/organizations/${orgId}/collections/objects/${context.object?.object_id}`
    : isMediaWorkspace
    ? `/organizations/${orgId}/media/work/workspaces/${context.workspace?.workspace_id}`
    : `/organizations/${orgId}/collections/work/workspaces/${context.workspace?.workspace_id}`;

  return (
    <div className="mx-4 mb-4 p-3 rounded-lg" style={{ backgroundColor: 'rgba(243, 236, 221, 0.1)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-parchment/60">
          {isObject ? 'Active Object' : (isMediaWorkspace ? 'Active Asset Workspace' : 'Active Workspace')}
        </div>
        <button
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          className="p-1 text-parchment/60 hover:text-parchment rounded"
          title="Clear context"
        >
          <X size={14} />
        </button>
      </div>
      <Link
        to={contextLink}
        className="flex items-center gap-2 text-parchment hover:text-parchment/80"
      >
        {isObject ? <Package size={16} /> : <Layers size={16} />}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{contextLabel}</div>
          {contextSublabel && (
            <div className="text-xs text-parchment/60 truncate">{contextSublabel}</div>
          )}
        </div>
        <ExternalLink size={14} className="text-parchment/40" />
      </Link>
    </div>
  );
}
