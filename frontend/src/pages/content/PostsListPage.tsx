/**
 * PostsListPage -- List view for CMS blog posts (page_type='post').
 *
 * Same layout as PagesListPage but scoped to posts, with "New Post" CTA
 * and navigation to the post editor.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Newspaper,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { listPages } from '../../lib/api/content';
import type { PageStatus } from '../../types/content';
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
};

const PAGE_SIZE = 20;

// =============================================================================
// Component
// =============================================================================

export default function PostsListPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();

  // Filters
  const [statusFilter, setStatusFilter] = useState<PageStatus | 'all'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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

  // Query
  const queryParams = useMemo(
    () => ({
      page_type: 'post' as const,
      status: statusFilter === 'all' ? undefined : statusFilter,
      search: debouncedSearch || undefined,
      limit: PAGE_SIZE,
      offset,
    }),
    [statusFilter, debouncedSearch, offset],
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['content-posts', orgId, queryParams],
    queryFn: () => listPages(orgId!, queryParams),
    enabled: !!orgId,
  });

  const posts = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  // Navigation
  const handleNewPost = useCallback(() => {
    navigate(`/organizations/${orgId}/content/posts/create`);
  }, [navigate, orgId]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Newspaper className="w-7 h-7 text-forest" />
          <h1 className="text-2xl font-semibold text-ink">Blog Posts</h1>
        </div>
        <button
          onClick={handleNewPost}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-bark text-parchment rounded-lg hover:bg-copper-dark transition-colors focus-visible:ring-2 ring-bark/30 ring-offset-2"
        >
          <Plus size={16} />
          New Post
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
            placeholder="Search posts..."
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
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <MadronaLoader variant="dots" />
        </div>
      ) : isForbidden(error) ? (
        <AccessDeniedState what="posts" requires="content.view" />
      ) : isError ? (
        <div className="text-center py-12 text-semantic-error text-sm">
          Failed to load posts. Please try again.
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border border-dashed border-lichen rounded-lg">
          <Newspaper size={40} className="text-archive/40 mb-3" />
          <p className="text-sm font-medium text-ink mb-4">
            {debouncedSearch ? 'No posts match your search.' : 'No posts yet.'}
          </p>
          {!debouncedSearch && (
            <button
              onClick={handleNewPost}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-dashed border-lichen text-archive rounded-lg hover:border-bark hover:text-bark transition-colors"
            >
              <Plus size={16} />
              New Post
            </button>
          )}
        </div>
      ) : (
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
                {posts.map((post) => (
                  <tr
                    key={post.page_id}
                    className="hover:bg-stone/20 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <Link
                        to={`/organizations/${orgId}/content/posts/${post.page_id}`}
                        className="text-sm font-medium text-bark hover:text-copper-dark transition-colors"
                      >
                        {post.title || 'Untitled'}
                      </Link>
                      <p className="text-xs text-archive mt-0.5 font-mono">
                        /{post.slug}
                      </p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
                          STATUS_BADGE[post.status] ?? 'bg-stone text-archive'
                        }`}
                      >
                        {post.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap hidden md:table-cell">
                      <span className="text-sm text-archive">
                        {TEMPLATE_LABEL[post.template ?? 'default'] ?? post.template ?? 'Default'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap hidden lg:table-cell">
                      <span className="text-sm text-archive">
                        {post.updated_at
                          ? formatDateShort(post.updated_at)
                          : '--'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap hidden lg:table-cell">
                      <span className="text-sm text-archive">
                        {post.created_by
                          ? post.created_by.slice(0, 8) + '...'
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
