/**
 * BlogListPage — Public blog listing page.
 *
 * Route: /c/:orgSlug/blog
 *
 * Displays a paginated grid of published blog posts with category
 * filtering. Renders inside the collection site shell.
 */

import { useEffect, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Calendar,
} from 'lucide-react';
import { getDiscoverInfo } from '../../lib/api/discover';
import { getPublishedPosts, getPublicCategories } from '../../lib/api/content';
import type { ContentPage, ContentCategory } from '../../types/content';
import { CollectionSiteShell } from './components/CollectionSiteShell';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateLong } from '@/lib/formatters';

// =============================================================================
// Constants
// =============================================================================

const POSTS_PER_PAGE = 12;

// =============================================================================
// Sub-components
// =============================================================================

function CategoryPills({
  categories,
  activeCategory,
  orgSlug,
}: {
  categories: ContentCategory[];
  activeCategory: string | null;
  orgSlug: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        to={`/c/${orgSlug}/blog`}
        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
          !activeCategory
            ? 'bg-bark text-parchment'
            : 'bg-stone/50 text-archive hover:bg-stone hover:text-ink'
        }`}
      >
        All
      </Link>
      {categories.map((cat) => (
        <Link
          key={cat.category_id}
          to={`/c/${orgSlug}/blog?category=${cat.slug}`}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            activeCategory === cat.slug
              ? 'bg-bark text-parchment'
              : 'bg-stone/50 text-archive hover:bg-stone hover:text-ink'
          }`}
        >
          {cat.name}
        </Link>
      ))}
    </div>
  );
}

function PostCard({ post, orgSlug }: { post: ContentPage; orgSlug: string }) {
  const publishedDate = post.published_at
    ? formatDateLong(post.published_at)
    : null;

  return (
    <Link
      to={`/c/${orgSlug}/blog/${post.slug}`}
      className="group flex flex-col bg-parchment border border-lichen rounded-lg overflow-hidden hover:border-bark/30 hover:shadow-sm transition-all"
    >
      {/* Featured image or placeholder */}
      <div className="aspect-[16/10] overflow-hidden bg-stone/30">
        {post.featured_image_media_id ? (
          <img
            src={`/api/media/${post.featured_image_media_id}/thumbnail?size=640`}
            alt={post.title}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-forest/5 to-bark/5">
            <FileText className="w-10 h-10 text-archive/20" />
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="flex flex-col flex-1 p-5">
        {/* Category badges */}
        {post.categories && post.categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {post.categories.map((cat) => (
              <span
                key={cat.category_id}
                className="text-xs font-medium px-2 py-0.5 rounded bg-bark/8 text-bark"
              >
                {cat.name}
              </span>
            ))}
          </div>
        )}

        {/* Title */}
        <h2 className="text-lg font-medium text-ink group-hover:text-bark transition-colors mb-2 line-clamp-2">
          {post.title}
        </h2>

        {/* Excerpt */}
        {post.excerpt && (
          <p className="text-sm text-archive leading-relaxed line-clamp-3 mb-4 flex-1">
            {post.excerpt}
          </p>
        )}

        {/* Date */}
        {publishedDate && (
          <div className="flex items-center gap-1.5 text-xs text-archive mt-auto pt-3 border-t border-lichen">
            <Calendar size={12} />
            <time dateTime={post.published_at || undefined}>{publishedDate}</time>
          </div>
        )}
      </div>
    </Link>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-4 pt-8">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-ink border border-lichen rounded-lg hover:bg-stone/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft size={16} />
        Previous
      </button>
      <span className="text-sm text-archive">
        Page {currentPage} of {totalPages}
      </span>
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-ink border border-lichen rounded-lg hover:bg-stone/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Next
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function BlogListPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeCategory = searchParams.get('category');
  const currentPage = Math.max(1, Number(searchParams.get('page') || '1'));
  const offset = (currentPage - 1) * POSTS_PER_PAGE;

  // Hide the initial loading overlay
  useEffect(() => {
    const loader = document.getElementById('initial-loader');
    if (loader) {
      loader.classList.add('fade-out');
      setTimeout(() => loader.remove(), 300);
    }
  }, []);

  // Fetch collection info for the shell
  const { data: info } = useQuery({
    queryKey: ['discover-info', orgSlug],
    queryFn: () => getDiscoverInfo(orgSlug!),
    enabled: !!orgSlug,
  });

  // Fetch categories
  const { data: categoriesResponse } = useQuery({
    queryKey: ['content-categories', orgSlug],
    queryFn: () => getPublicCategories(orgSlug!),
    enabled: !!orgSlug,
  });

  // Fetch posts with pagination and category filter
  const {
    data: postsResponse,
    isLoading,
  } = useQuery({
    queryKey: ['content-posts', orgSlug, offset, activeCategory],
    queryFn: () =>
      getPublishedPosts(orgSlug!, {
        limit: POSTS_PER_PAGE,
        offset,
        ...(activeCategory ? { category: activeCategory } : {}),
      }),
    enabled: !!orgSlug,
  });

  const posts = postsResponse?.data || [];
  const totalPosts = postsResponse?.total || 0;
  const totalPages = Math.ceil(totalPosts / POSTS_PER_PAGE);
  const categories = categoriesResponse?.data || [];

  const handlePageChange = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams);
      if (page <= 1) {
        params.delete('page');
      } else {
        params.set('page', String(page));
      }
      setSearchParams(params, { replace: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [searchParams, setSearchParams],
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <CollectionSiteShell info={info} orgSlug={orgSlug!}>
      <Helmet>
        <title>
          {['Blog', info?.organization_name].filter(Boolean).join(' | ')}
        </title>
        <meta name="description" content={`Latest news and articles from ${info?.organization_name || 'the collection'}.`} />
        <link rel="alternate" type="application/rss+xml" title={`${info?.organization_name || 'Blog'} RSS Feed`} href={`/api/content/${orgSlug}/feed.xml`} />

        {/* Open Graph */}
        <meta property="og:title" content={`Blog | ${info?.organization_name || 'Collection'}`} />
        <meta property="og:description" content={`Latest news and articles from ${info?.organization_name || 'the collection'}.`} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`${window.location.origin}/c/${orgSlug}/blog`} />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={`Blog | ${info?.organization_name || 'Collection'}`} />
        <meta name="twitter:description" content={`Latest news and articles from ${info?.organization_name || 'the collection'}.`} />
      </Helmet>

      <div className="max-w-7xl mx-auto px-4 py-10">
        {/* Page heading */}
        <div className="mb-8">
          <h1 className="font-serif text-4xl font-light text-ink mb-2">Blog</h1>
          <p className="text-archive">
            News, stories, and insights from {info?.organization_name || 'the collection'}.
          </p>
        </div>

        {/* Category filters */}
        {categories.length > 0 && (
          <div className="mb-8">
            <CategoryPills
              categories={categories}
              activeCategory={activeCategory}
              orgSlug={orgSlug!}
            />
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <MadronaLoader />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && posts.length === 0 && (
          <div className="py-16 text-center">
            <FileText className="w-12 h-12 text-archive/30 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-ink mb-2">No posts yet</h2>
            <p className="text-archive">
              {activeCategory
                ? 'No posts found in this category. Try removing the filter.'
                : 'Check back soon for new articles.'}
            </p>
          </div>
        )}

        {/* Post grid */}
        {!isLoading && posts.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {posts.map((post) => (
                <PostCard key={post.page_id} post={post} orgSlug={orgSlug!} />
              ))}
            </div>

            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </>
        )}
      </div>
    </CollectionSiteShell>
  );
}
