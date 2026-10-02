/**
 * WorkPage - Central hub for object-centric workflows
 *
 * Per specification:
 * - My Tasks: Task inbox with object linkage
 * - Recent Items: Navigational memory
 * - Quick Actions: Context-aware action launcher
 * - Active Object: Persistent object context indicator
 */

import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Briefcase,
  Package,
  Clock,
  Zap,
  ChevronRight,
  Inbox,
} from 'lucide-react';
import { useOrganization } from '../../contexts/useOrganization';
import { useWork } from '../../contexts/WorkContext';
import { MyTasks, TaskCountBadge } from '../../components/work/MyTasks';
import { RecentItems } from '../../components/work/RecentItems';
import { QuickActions } from '../../components/work/QuickActions';
import { ActiveObjectIndicator } from '../../components/work/ActiveObjectIndicator';
import { ObjectSearchDialog } from '../../components/work/ObjectSearchDialog';

export default function WorkPage() {
  const { activeOrganization } = useOrganization();
  const { hasObjectContext, activeObject } = useWork();
  const [showSearchDialog, setShowSearchDialog] = useState(false);
  const location = useLocation();

  const orgId = activeOrganization?.organization_id;

  // Determine which view to show based on route
  const currentView = (() => {
    if (location.pathname.endsWith('/tasks')) return 'tasks';
    if (location.pathname.endsWith('/recent')) return 'recent';
    if (location.pathname.endsWith('/actions')) return 'actions';
    return 'overview';
  })();

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
               currentView === 'recent' ? 'Recent Items' :
               currentView === 'actions' ? 'Quick Actions' :
               'Work'}
            </h1>
            <p className="text-sm text-archive">
              {currentView === 'tasks' ? 'Tasks requiring your attention' :
               currentView === 'recent' ? 'Recently accessed items' :
               currentView === 'actions' ? 'Common workflows and actions' :
               'Your tasks, recent items, and quick actions'}
            </p>
          </div>
        </div>
        {/* Breadcrumb for sub-views */}
        {currentView !== 'overview' && (
          <div className="flex items-center gap-2 mt-3 text-sm text-archive">
            <Link
              to={`/organizations/${orgId}/collections/work`}
              className="hover:text-bark"
            >
              Work
            </Link>
            <ChevronRight size={14} />
            <span className="text-ink">
              {currentView === 'tasks' ? 'My Tasks' :
               currentView === 'recent' ? 'Recent Items' :
               'Quick Actions'}
            </span>
          </div>
        )}
      </div>

      {/* Active Object Context Banner */}
      {hasObjectContext && activeObject && (
        <div className="mb-6 p-4 bg-bark/5 border border-bark/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Package size={18} className="text-bark" />
              <div>
                <p className="text-sm text-archive">Working with object</p>
                <p className="font-medium text-bark">
                  {activeObject.accession_number} — {activeObject.title}
                </p>
              </div>
            </div>
            <Link
              to={`/organizations/${orgId}/collections/objects/${activeObject.object_id}`}
              className="text-sm text-bark hover:text-copper-dark font-medium"
            >
              View Object →
            </Link>
          </div>
        </div>
      )}

      {/* Object Search Dialog */}
      <ObjectSearchDialog
        isOpen={showSearchDialog}
        onClose={() => setShowSearchDialog(false)}
        title="Select Object for Context"
      />

      {/* Main content - varies by route */}
      {currentView === 'tasks' ? (
        /* Full My Tasks view */
        <section className="bg-parchment border border-lichen rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-lichen flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox size={16} className="text-bark" />
              <h2 className="font-medium text-ink">All Tasks</h2>
              <TaskCountBadge />
            </div>
          </div>
          <div className="p-4">
            <MyTasks variant="cards" showFilters allowAssignment />
          </div>
        </section>
      ) : currentView === 'recent' ? (
        /* Full Recent Items view */
        <section className="bg-parchment border border-lichen rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-lichen">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-archive" />
              <h2 className="font-medium text-ink">Recent Items</h2>
            </div>
          </div>
          <div className="p-4">
            <RecentItems limit={50} />
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
            <div className="p-4">
              <QuickActions
                variant="cards"
                onObjectSelectionRequired={() => setShowSearchDialog(true)}
              />
            </div>
          </section>

          {/* Active Object */}
          <section className="bg-parchment border border-lichen rounded-lg overflow-hidden h-fit">
            <div className="px-4 py-3 border-b border-lichen">
              <div className="flex items-center gap-2">
                <Package size={16} className="text-bark" />
                <h2 className="font-medium text-ink">Active Object</h2>
              </div>
            </div>
            <div className="p-4">
              {hasObjectContext ? (
                <ActiveObjectIndicator
                  showChangeOption
                  onChangeRequest={() => setShowSearchDialog(true)}
                />
              ) : (
                <div className="text-center py-4">
                  <Package size={24} className="mx-auto text-archive mb-2" />
                  <p className="text-sm text-archive">No object selected</p>
                  <button
                    onClick={() => setShowSearchDialog(true)}
                    className="inline-flex items-center gap-1 mt-2 text-sm text-bark hover:text-copper-dark"
                  >
                    Search objects
                    <ChevronRight size={14} />
                  </button>
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
                  <TaskCountBadge />
                </div>
                <Link
                  to={`/organizations/${orgId}/collections/work/tasks`}
                  className="text-sm text-bark hover:text-copper-dark"
                >
                  View all
                </Link>
              </div>
              <div className="p-4">
                <MyTasks limit={5} variant="cards" />
              </div>
            </section>

            {/* Recent Items Section */}
            <section className="bg-parchment border border-lichen rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-lichen flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-archive" />
                  <h2 className="font-medium text-ink">Recent Items</h2>
                </div>
                <Link
                  to={`/organizations/${orgId}/collections/work/recent`}
                  className="text-sm text-bark hover:text-copper-dark"
                >
                  View all
                </Link>
              </div>
              <div className="p-4">
                <RecentItems limit={8} />
              </div>
            </section>
          </div>

          {/* Right column: Quick Actions and Active Object */}
          <div className="space-y-6">
            {/* Active Object Indicator */}
            <section className="bg-parchment border border-lichen rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-lichen">
                <div className="flex items-center gap-2">
                  <Package size={16} className="text-bark" />
                  <h2 className="font-medium text-ink">Active Object</h2>
                </div>
              </div>
              <div className="p-4">
                {hasObjectContext ? (
                  <ActiveObjectIndicator
                    showChangeOption
                    onChangeRequest={() => setShowSearchDialog(true)}
                  />
                ) : (
                  <div className="text-center py-4">
                    <Package size={24} className="mx-auto text-archive mb-2" />
                    <p className="text-sm text-archive">No object selected</p>
                    <button
                      onClick={() => setShowSearchDialog(true)}
                      className="inline-flex items-center gap-1 mt-2 text-sm text-bark hover:text-copper-dark"
                    >
                      Search objects
                      <ChevronRight size={14} />
                    </button>
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
                  to={`/organizations/${orgId}/collections/work/actions`}
                  className="text-sm text-bark hover:text-copper-dark"
                >
                  View all
                </Link>
              </div>
              <div className="p-4">
                <QuickActions
                  variant="compact"
                  onObjectSelectionRequired={() => setShowSearchDialog(true)}
                />
              </div>
            </section>

            {/* Context help */}
            <div className="text-xs text-archive bg-stone/30 rounded-lg p-3">
              <p className="font-medium mb-1">About object context</p>
              <p>
                Some actions require an active object. Navigate to an object detail page
                to set context, or select an object from search results.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
