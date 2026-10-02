/**
 * BlogPostPage — Single blog post rendering.
 *
 * Route: /c/:orgSlug/blog/:postSlug
 *
 * Fetches a published blog post by slug and renders the article
 * header, content blocks, and navigation inside the collection
 * site shell.
 */

import { useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, FileX, Calendar, User, AlertTriangle } from 'lucide-react';
import { getDiscoverInfo } from '../../lib/api/discover';
import { getPublishedPost, getPreviewPage } from '../../lib/api/content';
import { CollectionSiteShell } from './components/CollectionSiteShell';
import { BlockRenderer } from '../content/components/BlockRenderer';
import { MadronaLoader } from '../../components/ui/MadronaLoader';
import { formatDateLong } from '@/lib/formatters';

export default function BlogPostPage() {
  const { orgSlug, postSlug } = useParams<{ orgSlug: string; postSlug: string }>();
  const [searchParams] = useSearchParams();

  // Preview mode detection
  const previewToken = searchParams.get('preview_token');
  const previewExpires = searchParams.get('preview_expires');
  const previewPageId = searchParams.get('preview_page_id');
  const isPreviewMode = !!(previewToken && previewExpires && previewPageId);

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

  // Fetch the published post (normal mode)
  const {
    data: postResponse,
    isLoading: isLoadingPublished,
    error: publishedError,
  } = useQuery({
    queryKey: ['content-post', orgSlug, postSlug],
    queryFn: () => getPublishedPost(orgSlug!, postSlug!),
    enabled: !!orgSlug && !!postSlug && !isPreviewMode,
  });

  // Fetch preview post (preview mode)
  const {
    data: previewResponse,
    isLoading: isLoadingPreview,
    error: previewError,
  } = useQuery({
    queryKey: ['content-preview', orgSlug, previewPageId],
    queryFn: () => getPreviewPage(orgSlug!, previewPageId!, previewToken!, previewExpires!),
    enabled: !!orgSlug && isPreviewMode,
  });

  const isLoading = isPreviewMode ? isLoadingPreview : isLoadingPublished;
  const error = isPreviewMode ? previewError : publishedError;
  const post = isPreviewMode ? previewResponse?.data : postResponse?.data;

  // ── Loading ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <CollectionSiteShell info={info} orgSlug={orgSlug!}>
        <div className="flex items-center justify-center py-20">
          <MadronaLoader />
        </div>
      </CollectionSiteShell>
    );
  }

  // ── 404 / Error ──────────────────────────────────────────────────────
  if (error || !post) {
    return (
      <CollectionSiteShell info={info} orgSlug={orgSlug!}>
        <Helmet>
          <title>Post Not Found{info?.organization_name ? ` | ${info.organization_name}` : ''}</title>
        </Helmet>
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Link
            to={`/c/${orgSlug}/blog`}
            className="text-archive hover:text-bark text-sm flex items-center gap-1 transition-colors"
          >
            <ArrowLeft size={16} />
            Back to blog
          </Link>
        </div>
        <div className="max-w-3xl mx-auto px-4 py-16 text-center">
          <FileX className="w-12 h-12 text-archive/40 mx-auto mb-4" />
          <h1 className="text-2xl font-medium text-ink mb-2">Post Not Found</h1>
          <p className="text-archive">
            This post does not exist or has not been published yet.
          </p>
        </div>
      </CollectionSiteShell>
    );
  }

  // ── Format metadata ──────────────────────────────────────────────────
  const publishedDate = post.published_at
    ? formatDateLong(post.published_at)
    : null;

  const metaTitle = post.meta_title || post.title;
  const metaDescription =
    post.meta_description || post.excerpt || undefined;

  const canonicalUrl = `${window.location.origin}/c/${orgSlug}/blog/${postSlug}`;
  const ogImageId = (post as unknown as { og_image_media_id?: string })?.og_image_media_id || post.featured_image_media_id;
  const ogImageUrl = ogImageId ? `${window.location.origin}/api/media/${ogImageId}/thumbnail?size=1200` : undefined;

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <CollectionSiteShell info={info} orgSlug={orgSlug!}>
      <Helmet>
        <title>
          {[metaTitle, info?.organization_name].filter(Boolean).join(' | ')}
        </title>
        {metaDescription && <meta name="description" content={metaDescription} />}
        <link rel="canonical" href={canonicalUrl} />

        {/* Open Graph */}
        <meta property="og:title" content={metaTitle} />
        {metaDescription && <meta property="og:description" content={metaDescription} />}
        <meta property="og:type" content="article" />
        <meta property="og:url" content={canonicalUrl} />
        {ogImageUrl && <meta property="og:image" content={ogImageUrl} />}

        {/* Twitter Card */}
        <meta name="twitter:card" content={ogImageUrl ? 'summary_large_image' : 'summary'} />
        <meta name="twitter:title" content={metaTitle} />
        {metaDescription && <meta name="twitter:description" content={metaDescription} />}
        {ogImageUrl && <meta name="twitter:image" content={ogImageUrl} />}

        {/* JSON-LD: Article */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: post.title,
            description: metaDescription || undefined,
            url: canonicalUrl,
            ...(post.published_at ? { datePublished: post.published_at } : {}),
            ...(post.author_name ? { author: { '@type': 'Person', name: post.author_name } } : {}),
            ...(info?.organization_name ? { publisher: { '@type': 'Organization', name: info.organization_name } } : {}),
            ...(ogImageUrl ? { image: ogImageUrl } : {}),
          })}
        </script>
      </Helmet>

      {/* Preview banner */}
      {isPreviewMode && (
        <div className="bg-semantic-warning/10 border-b border-semantic-warning/20">
          <div className="max-w-3xl mx-auto px-4 py-2 flex items-center gap-2 text-sm text-semantic-warning">
            <AlertTriangle size={16} />
            <span className="font-medium">Preview Mode</span>
            <span className="text-semantic-warning/70">— This post is not published</span>
          </div>
        </div>
      )}

      {/* Back link */}
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-2">
        <Link
          to={`/c/${orgSlug}/blog`}
          className="text-archive hover:text-bark text-sm flex items-center gap-1 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to blog
        </Link>
      </div>

      {/* Featured image */}
      {post.featured_image_media_id && (
        <div className="max-w-4xl mx-auto px-4 mt-6">
          <div className="aspect-[21/9] overflow-hidden rounded-lg bg-stone/30">
            <img
              src={`/api/media/${post.featured_image_media_id}/thumbnail?size=1200`}
              alt={post.title}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      )}

      {/* Article header */}
      <article className="max-w-3xl mx-auto px-4 py-8">
        <header className="mb-10">
          {/* Category badges */}
          {post.categories && post.categories.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {post.categories.map((cat) => (
                <Link
                  key={cat.category_id}
                  to={`/c/${orgSlug}/blog?category=${cat.slug}`}
                  className="text-xs font-medium px-2.5 py-1 rounded-full bg-bark/8 text-bark hover:bg-bark/15 transition-colors"
                >
                  {cat.name}
                </Link>
              ))}
            </div>
          )}

          {/* Title */}
          <h1 className="font-serif text-4xl md:text-5xl font-light text-ink leading-tight mb-6">
            {post.title}
          </h1>

          {/* Author and date row */}
          <div className="flex items-center gap-4 text-sm text-archive border-b border-lichen pb-6">
            <div className="flex items-center gap-1.5">
              <User size={14} />
              <span>{post.author_name || 'Staff'}</span>
            </div>
            {publishedDate && (
              <div className="flex items-center gap-1.5">
                <Calendar size={14} />
                <time dateTime={post.published_at || undefined}>
                  {publishedDate}
                </time>
              </div>
            )}
          </div>
        </header>

        {/* Post content */}
        <div className="prose-madrona">
          {post.blocks && post.blocks.length > 0 ? (
            <BlockRenderer blocks={post.blocks} />
          ) : (
            <div className="py-12 text-center text-archive">
              <p>This post has no content yet.</p>
            </div>
          )}
        </div>

        {/* Bottom navigation */}
        <footer className="mt-16 pt-8 border-t border-lichen">
          <Link
            to={`/c/${orgSlug}/blog`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-bark hover:text-copper-dark transition-colors"
          >
            <ArrowLeft size={16} />
            Back to all posts
          </Link>
        </footer>
      </article>
    </CollectionSiteShell>
  );
}
