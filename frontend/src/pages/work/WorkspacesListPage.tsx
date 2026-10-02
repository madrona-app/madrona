/**
 * WorkspacesListPage - Unified Work Sets hub
 *
 * Work Sets are operational groupings for bulk operations and team collaboration.
 * This page displays work sets filtered by the current app context by default
 * (Collections or Media), with the ability to view all or filter by type.
 *
 * Lives in global shell at /organizations/:orgId/work/workspaces
 */

import { useState, useEffect, useCallback } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Layers,
  Plus,
  Search,
  Globe,
  Lock,
  Users,
  MoreHorizontal,
  Trash2,
  Edit2,
  Package,
  Image,
  User,
  Loader2,
  LayoutGrid,
  Grid2x2,
  Grid3x3,
} from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { useActiveProduct } from '../../hooks/useActiveProduct';
import { cn } from '../../lib/utils';
import {
  listWorkspaces,
  deleteWorkspace,
  deleteMediaWorkspace,
  setWorkspaceContext,
  setMediaWorkspaceContext,
} from '../../lib/api';
import type { Workspace } from '../../lib/schemas';
import { logger } from '@/lib/logger';

type WorkspaceType = 'all' | 'collections' | 'media';

// Unified workspace item for display
interface UnifiedWorkspace {
  id: string;
  name: string;
  description?: string;
  visibility: string;
  item_count: number;
  is_owner: boolean;
  owner_name?: string;
  type: 'collections' | 'media';
  is_dynamic?: boolean | null;
  cover_thumbnail_url?: string;
}

export default function WorkspacesListPage() {
  const { activeOrganization } = useOrganization();
  const orgId = activeOrganization?.organization_id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeProductId } = useActiveProduct();

  const [ownershipFilter, setOwnershipFilter] = useState<'all' | 'owned' | 'shared'>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UnifiedWorkspace | null>(null);
  const [gridSize, setGridSize] = useState<2 | 4 | 6>(() => {
    try {
      const saved = localStorage.getItem('madrona.worksetGridSize');
      if (saved === '2' || saved === '4' || saved === '6') return Number(saved) as 2 | 4 | 6;
    } catch {
      // ignore
    }
    return 6;
  });

  const setGridSizePersisted = (size: 2 | 4 | 6) => {
    setGridSize(size);
    try {
      localStorage.setItem('madrona.worksetGridSize', String(size));
    } catch {
      // ignore
    }
  };

  const gridClass =
    gridSize === 2
      ? 'grid grid-cols-1 sm:grid-cols-2 gap-4'
      : gridSize === 4
        ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'
        : 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3';

  // When product-scoped, lock the type filter to the current product
  const isProductScoped = activeProductId === 'collections' || activeProductId === 'media';
  const workSegment = activeProductId === 'media' ? 'media' : 'collections';

  // Type filter from URL, or default to active product context
  const typeParam = searchParams.get('type');
  const getDefaultTypeFilter = (): WorkspaceType => {
    if (activeProductId === 'collections') return 'collections';
    if (activeProductId === 'media') return 'media';
    return 'all';
  };
  const typeFilter: WorkspaceType = isProductScoped
    ? (activeProductId as WorkspaceType)
    : typeParam
      ? (typeParam === 'collections' || typeParam === 'media') ? typeParam : 'all'
      : getDefaultTypeFilter();

  const setTypeFilter = (type: WorkspaceType) => {
    if (type === 'all') {
      searchParams.delete('type');
    } else {
      searchParams.set('type', type);
    }
    setSearchParams(searchParams);
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch collections workspaces (pass type filter to avoid fetching media workspaces from unified endpoint)
  const collectionsTypeFilter = typeFilter === 'media' ? undefined : 'collections' as const;
  const { data: collectionsData, isLoading: collectionsLoading, isFetching: collectionsFetching } = useQuery({
    queryKey: ['workspaces', orgId, ownershipFilter, debouncedSearch, collectionsTypeFilter],
    queryFn: () => listWorkspaces(orgId!, { filter: ownershipFilter, search: debouncedSearch || undefined, type: collectionsTypeFilter }),
    enabled: !!orgId && (typeFilter === 'all' || typeFilter === 'collections'),
    placeholderData: (prev) => prev,
  });

  // Fetch media workspaces via unified endpoint with type=media
  const { data: mediaData, isLoading: mediaLoading, isFetching: mediaFetching } = useQuery({
    queryKey: ['media-workspaces', orgId, ownershipFilter, debouncedSearch],
    queryFn: () => listWorkspaces(orgId!, { filter: ownershipFilter, type: 'media', search: debouncedSearch || undefined }),
    enabled: !!orgId && (typeFilter === 'all' || typeFilter === 'media'),
    placeholderData: (prev) => prev,
  });

  const isLoading = collectionsLoading || mediaLoading;
  const isFetching = collectionsFetching || mediaFetching;

  // Delete mutations
  const deleteCollectionsMutation = useMutation({
    mutationFn: (workspaceId: string) => deleteWorkspace(orgId!, workspaceId),
    onMutate: async (workspaceId) => {
      await queryClient.cancelQueries({ queryKey: ['workspaces'] });
      const snapshot = queryClient.getQueriesData({ queryKey: ['workspaces'] });
      queryClient.setQueriesData<any>({ queryKey: ['workspaces'] }, (old: any) => {
        if (!old?.items) return old;
        return { ...old, items: old.items.filter((w: any) => w.workspace_id !== workspaceId) };
      });
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      context?.snapshot?.forEach(([key, data]: [any, any]) => queryClient.setQueryData(key, data));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });

  const deleteMediaMutation = useMutation({
    mutationFn: (workspaceId: string) => deleteMediaWorkspace(orgId!, workspaceId),
    onMutate: async (workspaceId) => {
      await queryClient.cancelQueries({ queryKey: ['media-workspaces'] });
      const snapshot = queryClient.getQueriesData({ queryKey: ['media-workspaces'] });
      queryClient.setQueriesData<any>({ queryKey: ['media-workspaces'] }, (old: any) => {
        if (!old?.items) return old;
        return { ...old, items: old.items.filter((w: any) => w.workspace_id !== workspaceId) };
      });
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      context?.snapshot?.forEach(([key, data]: [any, any]) => queryClient.setQueryData(key, data));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });

  // Set context mutations
  const setCollectionsContextMutation = useMutation({
    mutationFn: (workspaceId: string) => setWorkspaceContext(orgId!, workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-context'] });
    },
  });

  const setMediaContextMutation = useMutation({
    mutationFn: (workspaceId: string) => setMediaWorkspaceContext(orgId!, workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media-active-context'] });
    },
  });

  // Combine and normalize workspaces
  // Use actual workspace_type from API and client-side filter as safety net
  const collectionsWorkspaces: UnifiedWorkspace[] = (collectionsData?.items ?? [])
    .filter((w: Workspace) => {
      // When product-scoped, enforce client-side filter in case backend returns mixed types
      if (isProductScoped && activeProductId === 'collections') {
        return !w.workspace_type || w.workspace_type === 'collections';
      }
      return true;
    })
    .map((w: Workspace) => ({
      id: w.workspace_id,
      name: w.name,
      description: w.description ?? undefined,
      visibility: w.visibility,
      item_count: w.object_count ?? 0,
      is_owner: w.is_owner,
      owner_name: w.owner_name ?? undefined,
      type: (w.workspace_type || 'collections') as 'collections' | 'media',
      is_dynamic: w.is_dynamic,
      cover_thumbnail_url: w.cover_thumbnail_url ?? undefined,
    }));

  const mediaWorkspaces: UnifiedWorkspace[] = (mediaData?.items ?? [])
    .filter((w: Workspace) => !w.workspace_type || w.workspace_type === 'media')
    .map((w: Workspace) => ({
      id: w.workspace_id,
      name: w.name,
      description: w.description ?? undefined,
      visibility: w.visibility,
      item_count: w.asset_count ?? w.object_count ?? 0,
      is_owner: w.is_owner,
      owner_name: w.owner_name ?? undefined,
      type: 'media' as const,
      cover_thumbnail_url: w.cover_thumbnail_url ?? undefined,
    }));

  // Filter by type
  let workspaces: UnifiedWorkspace[] = [];
  if (typeFilter === 'all') {
    workspaces = [...collectionsWorkspaces, ...mediaWorkspaces];
  } else if (typeFilter === 'collections') {
    workspaces = collectionsWorkspaces;
  } else {
    workspaces = mediaWorkspaces;
  }

  // Sort by name
  workspaces.sort((a, b) => a.name.localeCompare(b.name));

  const getVisibilityIcon = (visibility: string) => {
    switch (visibility) {
      case 'private':
        return <Lock size={14} className="text-archive" />;
      case 'shared':
        return <Users size={14} className="text-bark" />;
      case 'org':
        return <Globe size={14} className="text-semantic-success" />;
      default:
        return null;
    }
  };

  const getVisibilityLabel = (visibility: string) => {
    switch (visibility) {
      case 'private':
        return 'Private';
      case 'shared':
        return 'Shared';
      case 'org':
        return 'Organization';
      default:
        return visibility;
    }
  };

  const handleDelete = (workspace: UnifiedWorkspace) => {
    setMenuOpenId(null);
    setDeleteTarget(workspace);
  };

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'collections') {
      deleteCollectionsMutation.mutate(deleteTarget.id);
    } else {
      deleteMediaMutation.mutate(deleteTarget.id);
    }
    setDeleteTarget(null);
  }, [deleteTarget, deleteCollectionsMutation, deleteMediaMutation]);

  const handleSetContext = (workspace: UnifiedWorkspace) => {
    logger.info('[handleSetContext]', workspace.type, workspace.id, workspace.name);
    if (workspace.type === 'media') {
      setMediaContextMutation.mutate(workspace.id);
    } else {
      setCollectionsContextMutation.mutate(workspace.id);
    }
    setMenuOpenId(null);
  };

  const getWorkspacePath = (workspace: UnifiedWorkspace) => {
    const seg = workspace.type === 'media' ? 'media' : 'collections';
    return `/organizations/${orgId}/${seg}/work/workspaces/${workspace.id}`;
  };

  const getWorkspaceEditPath = (workspace: UnifiedWorkspace) => {
    const seg = workspace.type === 'media' ? 'media' : 'collections';
    return `/organizations/${orgId}/${seg}/work/workspaces/${workspace.id}/edit`;
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-stone/50 rounded w-1/4" />
          <div className="h-4 bg-stone/50 rounded w-1/3" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-stone/50 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-bark/10 rounded-lg">
            <Layers size={24} className="text-bark" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink">Work Sets</h1>
            <p className="text-sm text-archive">
              Group records for bulk operations and team collaboration
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate(`/organizations/${orgId}/${workSegment}/work/workspaces/new`)}
          className="flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment transition-colors"
        >
          <Plus size={18} />
          New Work Set
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6">
        {/* Search */}
        <div className="relative flex-1 max-w-md w-full">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-archive" />
          <input
            type="text"
            placeholder="Search work sets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-10 py-2 border border-lichen rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />
          {isFetching && (
            <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-archive animate-spin" />
          )}
        </div>

        {/* Type filter - hidden when product-scoped */}
        {!isProductScoped && (
          <div className="flex items-center gap-1 bg-stone/30 rounded-lg p-1">
            {(['all', 'collections', 'media'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                  typeFilter === t
                    ? 'bg-parchment text-ink shadow-sm'
                    : 'text-archive hover:text-ink'
                )}
              >
                {t === 'collections' && <Package size={14} />}
                {t === 'media' && <Image size={14} />}
                {t === 'all' ? 'All' : t === 'collections' ? 'Objects' : 'Media'}
              </button>
            ))}
          </div>
        )}

        {/* Ownership filter */}
        <div className="flex items-center gap-1 bg-stone/30 rounded-lg p-1">
          {(['all', 'owned', 'shared'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setOwnershipFilter(f)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                ownershipFilter === f
                  ? 'bg-parchment text-ink shadow-sm'
                  : 'text-archive hover:text-ink'
              )}
            >
              {f === 'all' ? 'All' : f === 'owned' ? 'Mine' : 'Shared'}
            </button>
          ))}
        </div>

        {/* Grid size toggle */}
        <div className="flex items-center gap-1 bg-stone/30 rounded-lg p-1 ml-auto">
          {([
            { size: 2 as const, Icon: LayoutGrid, label: '2 columns' },
            { size: 4 as const, Icon: Grid2x2, label: '4 columns' },
            { size: 6 as const, Icon: Grid3x3, label: '6 columns' },
          ]).map(({ size, Icon, label }) => (
            <button
              key={size}
              onClick={() => setGridSizePersisted(size)}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                gridSize === size
                  ? 'bg-parchment text-ink shadow-sm'
                  : 'text-archive hover:text-ink'
              )}
              title={label}
              aria-label={label}
              aria-pressed={gridSize === size}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {workspaces.length === 0 ? (
        <div className="text-center py-16 bg-parchment border border-lichen rounded-lg">
          <Layers size={48} className="mx-auto text-archive mb-4" />
          <h3 className="text-lg font-medium text-ink mb-6">No work sets yet.</h3>
          <button
            onClick={() => navigate(`/organizations/${orgId}/${workSegment}/work/workspaces/new`)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-bark text-parchment rounded-lg hover:bg-copper-dark hover:text-parchment transition-colors"
          >
            <Plus size={18} />
            Create your first work set
          </button>
        </div>
      ) : (
        /* Workspace grid */
        <div className={gridClass}>
          {workspaces.map((workspace) => (
            <div
              key={`${workspace.type}-${workspace.id}`}
              className="bg-parchment border border-lichen rounded-lg p-3 hover:border-bark/30 transition-colors group"
            >
              {/* Cover image */}
              {workspace.cover_thumbnail_url && (
                <Link to={getWorkspacePath(workspace)} className="block -mx-3 -mt-3 mb-2">
                  <img
                    src={workspace.cover_thumbnail_url}
                    alt=""
                    className="w-full h-24 object-cover rounded-t-lg"
                  />
                </Link>
              )}

              {/* Header row */}
              <div className="flex items-start justify-between mb-2">
                <Link
                  to={getWorkspacePath(workspace)}
                  className="flex-1 min-w-0"
                >
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-ink group-hover:text-bark truncate">
                      {workspace.name}
                    </h3>
                  </div>
                </Link>
                <div className="relative ml-2">
                  <button
                    onClick={() => setMenuOpenId(
                      menuOpenId === workspace.id ? null : workspace.id
                    )}
                    className="p-1 rounded hover:bg-stone/50"
                  >
                    <MoreHorizontal size={16} className="text-archive" />
                  </button>
                  {menuOpenId === workspace.id && (
                    <div className="absolute right-0 top-8 w-48 bg-parchment border border-lichen rounded-lg shadow-lg py-1 z-10">
                      <button
                        onClick={() => handleSetContext(workspace)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-stone/30"
                      >
                        <Layers size={14} />
                        Set as Active Context
                      </button>
                      {workspace.is_owner && (
                        <>
                          <Link
                            to={getWorkspaceEditPath(workspace)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-stone/30"
                          >
                            <Edit2 size={14} />
                            Edit Work Set
                          </Link>
                          <button
                            onClick={() => handleDelete(workspace)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-semantic-error hover:bg-semantic-error/10"
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              {workspace.description && (
                <p className="text-xs text-archive mb-2 line-clamp-2">
                  {workspace.description}
                </p>
              )}

              {/*
                Item counts were removed here on purpose. For dynamic
                collection worksets, an accurate count requires running the
                saved search query per card, and the pinned-only count is
                misleading. The detail page shows accurate breakdowns; list
                cards only surface type, visibility, and ownership.
              */}
              <div className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  {getVisibilityIcon(workspace.visibility)}
                  <span className="text-archive">{getVisibilityLabel(workspace.visibility)}</span>
                </div>
              </div>

              {/* Type badge and owner */}
              <div className="flex items-center gap-2 mt-2">
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  workspace.type === 'collections' ? 'bg-forest/10 text-forest' : 'bg-bark/10 text-bark'
                )}>
                  {workspace.type === 'collections' ? 'Collections' : 'Media'}
                </span>
                {!workspace.is_owner && workspace.owner_name && (
                  <div className="flex items-center gap-1 text-xs text-archive">
                    <User size={12} />
                    <span>{workspace.owner_name}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Click outside to close menu */}
      {menuOpenId && (
        <div
          className="fixed inset-0 z-5"
          onClick={() => setMenuOpenId(null)}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete Work Set"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmText="Delete"
        confirmStyle="danger"
      />
    </div>
  );
}
