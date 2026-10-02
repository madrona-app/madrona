/**
 * PagesListPage -- List view for CMS pages (page_type='page').
 *
 * When no search is active, displays pages as an indented tree.
 * When searching, shows a flat filtered list.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { listPages, getPageTree } from '../../lib/api/content';
import type { PageStatus, PageTreeNode } from '../../types/content';
import { AccessDeniedState, isForbidden } from '../../components/ui/AccessDeniedState';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateShort } from '@/lib/formatters';

// =============================================================================
// Constants
// =============================================================================

const STATUS_TABS: Array<{ value: PageStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

const STATUS_BADGE: Record<PageStatus, string> = {
  draft: 'bg-semantic-warning/10 text-semantic-warning',
  published: 'bg-semantic-success/10 text-semantic-success',
  archived: 'bg-stone text-archive',
};

const TEMPLATE_LABEL: Record<string, string> = {
  default: 'Default',
  full_width: 'Full Width',
  sidebar: 'Sidebar',
  landing: 'Landing',
};

const PAGE_SIZE = 20;

// =============================================================================
// Tree Row
// =============================================================================

interface TreeRowProps {
  node: PageTreeNode;
  orgId: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}

function TreeRow({ node, orgId, expanded, onToggle }: TreeRowProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.page_id);
  const depth = node.depth;

  return (
    <>
      <tr className="hover:bg-stone/20 transition-colors">
        <td className="px-6 py-3">
          <div className="flex items-center" style={{ paddingLeft: `${depth * 24}px` }}>
            {hasChildren ? (
              <button
                onClick={() => onToggle(node.page_id)}
                className="mr-2 p-0.5 text-archive hover:text-ink transition-colors"
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="mr-2 w-5" />
            )}
            <div>
              <Link
                to={`/organizations/${orgId}/content/pages/${node.page_id}`}
                className="text-sm font-medium text-bark hover:text-copper-dark transition-colors"
              >
                {node.title || 'Untitled'}
              </Link>
              <p className="text-xs text-archive mt-0.5 font-mono">
                /{node.slug}
              </p>
            </div>
          </div>
        </td>
        <td className="px-6 py-3 whitespace-nowrap">
          <span
            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
              STATUS_BADGE[node.status as PageStatus] ?? 'bg-stone text-archive'
            }`}
          >
            {node.status}
          </span>
        </td>
        <td className="px-6 py-3 whitespace-nowrap hidden md:table-cell">
          <span className="text-sm text-archive">
            {TEMPLATE_LABEL[node.template ?? 'default'] ?? node.template ?? 'Default'}
          </span>
        </td>
        <td className="px-6 py-3 whitespace-nowrap hidden lg:table-cell">
          <span className="text-sm text-archive">
            {node.updated_at
              ? formatDateShort(node.updated_at)
              : '--'}
          </span>
        </td>
      </tr>
      {hasChildren && isExpanded &&
        node.children.map((child) => (
          <TreeRow
            key={child.page_id}
            node={child}
            orgId={orgId}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))
      }
    </>
  );
}

// =============================================================================
// Component
// =============================================================================

export default function PagesListPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();

  // Filters
  const [statusFilter, setStatusFilter] = useState<PageStatus | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Tree expand state
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Debounce search input 300ms
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setOffset(0);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  // Reset offset when filter changes
  const handleStatusChange = useCallback((status: PageStatus | 'all') => {
    setStatusFilter(status);
    setOffset(0);
  }, []);

  const isSearching = !!debouncedSearch || statusFilter !== 'all';

  // Tree query (when not searching)
  const { data: treeData, isLoading: isLoadingTree, error: treeError } = useQuery({
    queryKey: ['content-page-tree', orgId],
    queryFn: () => getPageTree(orgId!),
    enabled: !!orgId && !isSearching,
  });

  // Flat query (when searching/filtering)
  const queryParams = useMemo(
    () => ({
      page_type: 'page' as const,
      status: statusFilter === 'all' ? undefined : statusFilter,
      search: debouncedSearch || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [statusFilter, debouncedSearch, offset],
  );

  const { data: flatData, isLoading: isLoadingFlat, error: flatError } = useQuery({
    queryKey: ['content-pages', orgId, queryParams],
    queryFn: () => listPages(orgId!, queryParams),
    enabled: !!orgId && isSearching,
  });

  const isLoading = isSearching ? isLoadingFlat : isLoadingTree;
  // A forbidden fetch must not fall through to the empty state: "No pages
  // yet" tells the reader the collection is empty when they are simply not
  // allowed to see it.
  const accessDenied = isForbidden(isSearching ? flatError : treeError);
  const tree = treeData?.data ?? [];
  const flatPages = flatData?.items ?? [];
  const total = flatData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  // Toggle tree node
  const toggleNode = useCallback((pageId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  }, []);

  // Expand all / collapse all
  const expandAll = useCallback(() => {
    const ids = new Set<string>();
    function collect(nodes: PageTreeNode[]) {
      for (const n of nodes) {
        if (n.children.length > 0) {
          ids.add(n.page_id);
          collect(n.children);
        }
      }
    }
    collect(tree);
    setExpanded(ids);
  }, [tree]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  // Navigation
  const handleNewPage = useCallback(() => {
    navigate(`/organizations/${orgId}/content/pages/create`);
  }, [navigate, orgId]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText className="w-7 h-7 text-forest" />
          <h1 className="text-2xl font-semibold text-ink">Pages</h1>
        </div>
        <button
          onClick={handleNewPage}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark transition-colors focus-visible:ring-2 ring-bark/30 ring-offset-2"
        >
          <Plus size={16} />
          New Page
        </button>
      </div>

      {/* Search + Status Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-archive"
          />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search pages..."
            className="w-full pl-9 pr-3 py-2 border border-lichen rounded-lg text-sm text-ink placeholder:text-archive/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2 focus-visible:border-bark"
          />
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 border border-lichen rounded-lg p-0.5 bg-stone/30">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => handleStatusChange(tab.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                statusFilter === tab.value
                  ? 'bg-parchment text-ink shadow-sm'
                  : 'text-archive hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Expand/Collapse (tree mode only) */}
        {!isSearching && tree.length > 0 && (
          <div className="flex items-center gap-1">
            <button
              onClick={expandAll}
              className="p-1.5 text-archive hover:text-ink transition-colors"
              title="Expand all"
            >
              <ChevronDown size={16} />
            </button>
            <button
              onClick={collapseAll}
              className="p-1.5 text-archive hover:text-ink transition-colors"
              title="Collapse all"
            >
              <ChevronUp size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <MadronaLoader variant="dots" />
        </div>
      ) : accessDenied ? (
        <AccessDeniedState what="pages" requires="content.view" />
      ) : !isSearching && tree.length === 0 ? (
        <EmptyState onNewPage={handleNewPage} />
      ) : isSearching && flatPages.length === 0 ? (
        <EmptyState onNewPage={handleNewPage} hasSearch={!!debouncedSearch} />
      ) : !isSearching ? (
        /* Tree view */
        <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-lichen">
            <thead className="bg-stone/30">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                  Title
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider hidden md:table-cell">
                  Template
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider hidden lg:table-cell">
                  Last Updated
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-lichen">
              {tree.map((node) => (
                <TreeRow
                  key={node.page_id}
                  node={node}
                  orgId={orgId!}
                  expanded={expanded}
                  onToggle={toggleNode}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Flat search results */
        <>
          <div className="bg-parchment border border-lichen rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-lichen">
              <thead className="bg-stone/30">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider hidden md:table-cell">
                    Template
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider hidden lg:table-cell">
                    Last Updated
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-ink uppercase tracking-wider hidden lg:table-cell">
                    Author
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-lichen">
                {flatPages.map((page) => (
                  <tr
                    key={page.page_id}
                    className="hover:bg-stone/20 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <Link
                        to={`/organizations/${orgId}/content/pages/${page.page_id}`}
                        className="text-sm font-medium text-bark hover:text-copper-dark transition-colors"
                      >
                        {page.title || 'Untitled'}
                      </Link>
                      <p className="text-xs text-archive mt-0.5 font-mono">
                        /{page.slug}
                      </p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
                          STATUS_BADGE[page.status] ?? 'bg-stone text-archive'
                        }`}
                      >
                        {page.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap hidden md:table-cell">
                      <span className="text-sm text-archive">
                        {TEMPLATE_LABEL[page.template ?? 'default'] ?? page.template ?? 'Default'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap hidden lg:table-cell">
                      <span className="text-sm text-archive">
                        {page.updated_at
                          ? formatDateShort(page.updated_at)
                          : '--'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap hidden lg:table-cell">
                      <span className="text-sm text-archive">
                        {page.created_by
                          ? page.created_by.slice(0, 8) + '...'
                          : '--'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm text-archive">
                Page {currentPage} of {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                  className="px-3 py-1.5 text-sm border border-lichen rounded hover:bg-stone/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
                >
                  <ChevronLeft size={16} />
                  Previous
                </button>
                <button
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total}
                  className="px-3 py-1.5 text-sm border border-lichen rounded hover:bg-stone/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 transition-colors"
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================
// Empty State
// =============================================================================

function EmptyState({
  onNewPage,
  hasSearch,
}: {
  onNewPage: () => void;
  hasSearch?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 border border-dashed border-lichen rounded-lg">
      <FileText size={40} className="text-archive/40 mb-3" />
      <p className="text-sm font-medium text-ink mb-4">
        {hasSearch ? 'No pages match your search.' : 'No pages yet.'}
      </p>
      {!hasSearch && (
        <button
          onClick={onNewPage}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-dashed border-lichen text-archive rounded-lg hover:border-bark hover:text-bark transition-colors"
        >
          <Plus size={16} />
          New Page
        </button>
      )}
    </div>
  );
}
