/**
 * MediaWorkPage - Central hub for asset-centric workflows
 *
 * DAM equivalent of WorkPage:
 * - My Tasks: Task inbox with asset linkage
 * - Recent Items: Recently accessed assets
 * - Quick Actions: Context-aware action launcher
 * - Active Asset: Persistent asset context indicator
 */

import { Link, useLocation } from 'react-router-dom';
import {
  Briefcase,
  Image,
  Clock,
  Zap,
  ChevronRight,
  Inbox,
  Layers,
  Download,
  Tag,
  FolderInput,
  FileImage,
  Shield,
} from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { useQuery } from '@tanstack/react-query';
import { getMediaActiveContext } from '../../lib/api';

export default function MediaWorkPage() {
  const { activeOrganization } = useOrganization();
  const location = useLocation();

  const orgId = activeOrganization?.organization_id;

  // Fetch DAM active context
  const { data: contextData } = useQuery({
    queryKey: ['media-active-context', orgId],
    queryFn: () => getMediaActiveContext(orgId!),
    enabled: !!orgId,
  });

  const activeContext = contextData?.context;
  const hasAssetContext = activeContext?.type === 'asset' && activeContext?.asset;
  const hasWorkspaceContext = activeContext?.type === 'media_workspace' && activeContext?.workspace;

  // Determine which view to show based on route
  const currentView = (() => {
    if (location.pathname.endsWith('/tasks')) return 'tasks';
    if (location.pathname.endsWith('/recent')) return 'recent';
    if (location.pathname.endsWith('/actions')) return 'actions';
    return 'overview';
  })();

  // Quick actions for DAM
  const quickActions = [
    {
      id: 'download',
      label: 'Download Assets',
      description: 'Download selected assets as ZIP',
      icon: Download,
      requiresContext: true,
    },
    {
      id: 'bulk-tag',
      label: 'Bulk Tag',
      description: 'Add tags to multiple assets',
      icon: Tag,
      requiresContext: true,
    },
    {
      id: 'move-to-folder',
      label: 'Move to Folder',
      description: 'Organize assets into folders',
      icon: FolderInput,
      requiresContext: true,
    },
    {
      id: 'create-renditions',
      label: 'Create Renditions',
      description: 'Generate image variants',
      icon: FileImage,
      requiresContext: true,
    },
    {
      id: 'set-rights',
      label: 'Set Rights Policy',
      description: 'Apply usage rights to assets',
      icon: Shield,
      requiresContext: true,
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Page header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-bark/10 rounded-lg">
            <Briefcase size={24} className="text-bark" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink">
              {currentView === 'tasks' ? 'My Tasks' :
               currentView === 'recent' ? 'Recent Assets' :
               currentView === 'actions' ? 'Quick Actions' :
               'Work'}
            </h1>
            <p className="text-sm text-archive">
              {currentView === 'tasks' ? 'Tasks requiring your attention' :
               currentView === 'recent' ? 'Recently accessed assets' :
               currentView === 'actions' ? 'Common workflows and actions' :
               'Your tasks, recent assets, and quick actions'}
            </p>
          </div>
        </div>
        {/* Breadcrumb for sub-views */}
        {currentView !== 'overview' && (
          <div className="flex items-center gap-2 mt-3 text-sm text-archive">
            <Link
              to={`/organizations/${orgId}/media/work`}
              className="hover:text-bark"
            >
              Work
            </Link>
            <ChevronRight size={14} />
            <span className="text-ink">
              {currentView === 'tasks' ? 'My Tasks' :
               currentView === 'recent' ? 'Recent Assets' :
               'Quick Actions'}
            </span>
          </div>
        )}
      </div>

      {/* Active Context Banner */}
      {hasAssetContext && activeContext?.asset && (
        <div className="mb-6 p-4 bg-bark/5 border border-bark/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image size={18} className="text-bark" />
              <div>
                <p className="text-sm text-archive">Working with asset</p>
                <p className="font-medium text-bark">
                  {activeContext.asset.filename || activeContext.asset.title || 'Untitled'}
                </p>
              </div>
            </div>
            <Link
              to={`/organizations/${orgId}/media/${activeContext.asset.media_id}`}
              className="text-sm text-bark hover:text-copper-dark font-medium"
            >
              View Asset →
            </Link>
          </div>
        </div>
      )}

      {hasWorkspaceContext && activeContext?.workspace && (
        <div className="mb-6 p-4 bg-bark/5 border border-bark/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Layers size={18} className="text-bark" />
              <div>
                <p className="text-sm text-archive">Working with workspace</p>
                <p className="font-medium text-bark">
                  {activeContext.workspace.name} ({activeContext.workspace.asset_count} assets)
                </p>
              </div>
            </div>
            <Link
              to={`/organizations/${orgId}/media/work/workspaces/${activeContext.workspace.workspace_id}`}
              className="text-sm text-bark hover:text-copper-dark font-medium"
            >
              View Workspace →
            </Link>
          </div>
        </div>
      )}

      {/* Main content - varies by route */}
      {currentView === 'tasks' ? (
        /* Full My Tasks view */
        <section className="bg-parchment border border-lichen rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-lichen flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox size={16} className="text-bark" />
              <h2 className="font-medium text-ink">All Tasks</h2>
            </div>
          </div>
          <div className="p-8 text-center">
            <Inbox size={32} className="mx-auto text-archive mb-3" />
            <p className="text-archive">No pending tasks</p>
            <p className="text-sm text-archive mt-1">
              Tasks assigned to you will appear here
            </p>
          </div>
        </section>
      ) : currentView === 'recent' ? (
        /* Full Recent Items view */
        <section className="bg-parchment border border-lichen rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-lichen">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-archive" />
              <h2 className="font-medium text-ink">Recent Assets</h2>
            </div>
          </div>
          <div className="p-8 text-center">
            <Clock size={32} className="mx-auto text-archive mb-3" />
            <p className="text-archive">No recent assets</p>
            <p className="text-sm text-archive mt-1">
              Assets you view or edit will appear here
            </p>
          </div>
        </section>
      ) : currentView === 'actions' ? (
        /* Full Quick Actions view */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-parchment border border-lichen rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-lichen">
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-bark" />
                <h2 className="font-medium text-ink">Quick Actions</h2>
              </div>
            </div>
            <div className="p-4 space-y-2">
              {quickActions.map((action) => {
                const Icon = action.icon;
                const isDisabled = action.requiresContext && !hasAssetContext && !hasWorkspaceContext;
                return (
                  <button
                    key={action.id}
                    disabled={isDisabled}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
                      isDisabled
                        ? 'opacity-50 cursor-not-allowed bg-stone/30'
                        : 'hover:bg-bark/5 border border-transparent hover:border-bark/20'
                    }`}
                  >
                    <div className={`p-2 rounded-lg ${isDisabled ? 'bg-stone/50' : 'bg-bark/10'}`}>
                      <Icon size={18} className={isDisabled ? 'text-archive' : 'text-bark'} />
                    </div>
                    <div>
                      <div className="font-medium text-ink">{action.label}</div>
                      <div className="text-sm text-archive">{action.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Active Context */}
          <section className="bg-parchment border border-lichen rounded-lg overflow-hidden h-fit">
            <div className="px-4 py-3 border-b border-lichen">
              <div className="flex items-center gap-2">
                <Image size={16} className="text-bark" />
                <h2 className="font-medium text-ink">Active Context</h2>
              </div>
            </div>
            <div className="p-4">
              {hasAssetContext || hasWorkspaceContext ? (
                <div className="space-y-3">
                  {hasAssetContext && activeContext?.asset && (
                    <div className="flex items-center gap-3 p-3 bg-bark/5 rounded-lg">
                      {activeContext.asset.thumbnail_url ? (
                        <img
                          src={activeContext.asset.thumbnail_url}
                          alt=""
                          className="w-12 h-12 object-cover rounded"
                        />
                      ) : (
                        <div className="w-12 h-12 bg-stone/50 rounded flex items-center justify-center">
                          <Image size={20} className="text-archive" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-ink">
                          {activeContext.asset.filename || 'Untitled'}
                        </p>
                        <p className="text-sm text-archive">Active Asset</p>
                      </div>
                    </div>
                  )}
                  {hasWorkspaceContext && activeContext?.workspace && (
                    <div className="flex items-center gap-3 p-3 bg-bark/5 rounded-lg">
                      <div className="w-12 h-12 bg-bark/10 rounded flex items-center justify-center">
                        <Layers size={20} className="text-bark" />
                      </div>
                      <div>
                        <p className="font-medium text-ink">
                          {activeContext.workspace.name}
                        </p>
                        <p className="text-sm text-archive">
                          {activeContext.workspace.asset_count} assets
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-4">
                  <Image size={24} className="mx-auto text-archive mb-2" />
                  <p className="text-sm text-archive">No context selected</p>
                  <Link
                    to={`/organizations/${orgId}/media`}
                    className="inline-flex items-center gap-1 mt-2 text-sm text-bark hover:text-copper-dark"
                  >
                    Browse Media Library
                    <ChevronRight size={14} />
                  </Link>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        /* Overview - dashboard with all sections */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: Tasks and Recent Items */}
          <div className="lg:col-span-2 space-y-6">
            {/* My Tasks Section */}
            <section className="bg-parchment border border-lichen rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-lichen flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Inbox size={16} className="text-bark" />
                  <h2 className="font-medium text-ink">My Tasks</h2>
                </div>
                <Link
                  to={`/organizations/${orgId}/media/work/tasks`}
                  className="text-sm text-bark hover:text-copper-dark"
                >
                  View all
                </Link>
              </div>
              <div className="p-6 text-center">
                <Inbox size={24} className="mx-auto text-archive mb-2" />
                <p className="text-sm text-archive">No pending tasks</p>
              </div>
            </section>

            {/* Recent Items Section */}
            <section className="bg-parchment border border-lichen rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-lichen flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-archive" />
                  <h2 className="font-medium text-ink">Recent Assets</h2>
                </div>
                <Link
                  to={`/organizations/${orgId}/media/work/recent`}
                  className="text-sm text-bark hover:text-copper-dark"
                >
                  View all
                </Link>
              </div>
              <div className="p-6 text-center">
                <Clock size={24} className="mx-auto text-archive mb-2" />
                <p className="text-sm text-archive">No recent assets</p>
              </div>
            </section>
          </div>

          {/* Right column: Quick Actions and Active Context */}
          <div className="space-y-6">
            {/* Active Context Indicator */}
            <section className="bg-parchment border border-lichen rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-lichen">
                <div className="flex items-center gap-2">
                  <Image size={16} className="text-bark" />
                  <h2 className="font-medium text-ink">Active Context</h2>
                </div>
              </div>
              <div className="p-4">
                {hasAssetContext || hasWorkspaceContext ? (
                  <div className="text-sm">
                    {hasAssetContext && activeContext?.asset && (
                      <p className="text-ink">
                        Asset: <span className="font-medium">{activeContext.asset.filename}</span>
                      </p>
                    )}
                    {hasWorkspaceContext && activeContext?.workspace && (
                      <p className="text-ink">
                        Workspace: <span className="font-medium">{activeContext.workspace.name}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-2">
                    <Image size={20} className="mx-auto text-archive mb-1" />
                    <p className="text-sm text-archive">No context</p>
                  </div>
                )}
              </div>
            </section>

            {/* Quick Actions Section */}
            <section className="bg-parchment border border-lichen rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-lichen flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap size={16} className="text-bark" />
                  <h2 className="font-medium text-ink">Quick Actions</h2>
                </div>
                <Link
                  to={`/organizations/${orgId}/media/work/actions`}
                  className="text-sm text-bark hover:text-copper-dark"
                >
                  View all
                </Link>
              </div>
              <div className="p-3 space-y-1">
                {quickActions.slice(0, 3).map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.id}
                      className="w-full flex items-center gap-2 p-2 rounded hover:bg-stone/30 text-left"
                    >
                      <Icon size={14} className="text-bark" />
                      <span className="text-sm text-ink">{action.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Context help */}
            <div className="text-xs text-archive bg-stone/30 rounded-lg p-3">
              <p className="font-medium mb-1">About asset context</p>
              <p>
                Some actions require an active asset or workspace. Navigate to an asset
                or create a workspace to set context.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
