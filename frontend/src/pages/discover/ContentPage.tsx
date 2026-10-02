/**
 * ContentPage — Public CMS page rendering.
 *
 * Route: /c/:orgSlug/pages/:pageSlug
 *
 * Fetches a published page by slug and renders its content blocks
 * inside the collection site shell with header/footer branding.
 *
 * Templates:
 * - default: centered content column
 * - full_width: edge-to-edge blocks
 * - sidebar: 2-column (content 2/3 + TOC + child pages 1/3)
 * - landing: blocks in alternating full-width sections
 */

import { useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, FileX, AlertTriangle } from 'lucide-react';
import { getDiscoverInfo } from '../../lib/api/discover';
import { getPublishedPage, getPreviewPage } from '../../lib/api/content';
import { CollectionSiteShell } from './components/CollectionSiteShell';
import { BlockRenderer } from '../content/components/BlockRenderer';
import { Breadcrumbs } from './components/Breadcrumbs';
import { TableOfContents } from './components/TableOfContents';
import type { PageAncestor, PageChild, ContentBlock } from '../../types/content';
import { MadronaLoader } from '../../components/ui/MadronaLoader';

export default function ContentPage() {
  const { orgSlug, pageSlug } = useParams<{ orgSlug: string; pageSlug: string }>();
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

  // Fetch the published page (normal mode)
  const {
    data: pageResponse,
    isLoading: isLoadingPublished,
    error: publishedError,
  } = useQuery({
    queryKey: ['content-page', orgSlug, pageSlug],
    queryFn: () => getPublishedPage(orgSlug!, pageSlug!),
    enabled: !!orgSlug && !!pageSlug && !isPreviewMode,
  });

  // Fetch preview page (preview mode)
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
  const page = isPreviewMode ? previewResponse?.data : pageResponse?.data;
  const ancestors: PageAncestor[] = (page as unknown as { ancestors?: PageAncestor[] })?.ancestors ?? [];
  const children: PageChild[] = (page as unknown as { children?: PageChild[] })?.children ?? [];
  const blocks: ContentBlock[] = page?.blocks ?? [];
  const template = page?.template ?? 'default';

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
  if (error || !page) {
    return (
      <CollectionSiteShell info={info} orgSlug={orgSlug!}>
        <Helmet>
          <title>Page Not Found{info?.organization_name ? ` | ${info.organization_name}` : ''}</title>
        </Helmet>
        <div className="max-w-4xl mx-auto px-4 py-4">
          <Link
            to={`/c/${orgSlug}`}
            className="text-archive hover:text-bark text-sm flex items-center gap-1 transition-colors"
          >
            <ArrowLeft size={16} />
            Back to collection
          </Link>
        </div>
        <div className="max-w-4xl mx-auto px-4 py-16 text-center">
          <FileX className="w-12 h-12 text-archive/40 mx-auto mb-4" />
          <h1 className="text-2xl font-medium text-ink mb-2">Page Not Found</h1>
          <p className="text-archive">
            This page does not exist or has not been published yet.
          </p>
        </div>
      </CollectionSiteShell>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────
  const metaTitle = page.meta_title || page.title;
  const metaDescription = page.meta_description || page.excerpt || undefined;
  const hasBreadcrumbs = ancestors.length > 0;

  const canonicalUrl = `${window.location.origin}/c/${orgSlug}/pages/${pageSlug}`;
  const ogImageId = (page as unknown as { og_image_media_id?: string })?.og_image_media_id || page.featured_image_media_id;
  const ogImageUrl = ogImageId ? `${window.location.origin}/api/media/${ogImageId}/thumbnail?size=1200` : undefined;

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
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonicalUrl} />
        {ogImageUrl && <meta property="og:image" content={ogImageUrl} />}

        {/* Twitter Card */}
        <meta name="twitter:card" content={ogImageUrl ? 'summary_large_image' : 'summary'} />
        <meta name="twitter:title" content={metaTitle} />
        {metaDescription && <meta name="twitter:description" content={metaDescription} />}
        {ogImageUrl && <meta name="twitter:image" content={ogImageUrl} />}

        {/* JSON-LD: WebPage */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: metaTitle,
            description: metaDescription || undefined,
            url: canonicalUrl,
            ...(info?.organization_name ? { publisher: { '@type': 'Organization', name: info.organization_name } } : {}),
            ...(hasBreadcrumbs ? {
              breadcrumb: {
                '@type': 'BreadcrumbList',
                itemListElement: [
                  ...ancestors.map((a, i) => ({
                    '@type': 'ListItem',
                    position: i + 1,
                    name: a.title,
                    item: `${window.location.origin}/c/${orgSlug}/pages/${a.slug}`,
                  })),
                  {
                    '@type': 'ListItem',
                    position: ancestors.length + 1,
                    name: page.title,
                  },
                ],
              },
            } : {}),
          })}
        </script>
      </Helmet>

      {/* Preview banner */}
      {isPreviewMode && (
        <div className="bg-semantic-warning/10 border-b border-semantic-warning/20">
          <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-2 text-sm text-semantic-warning">
            <AlertTriangle size={16} />
            <span className="font-medium">Preview Mode</span>
            <span className="text-semantic-warning/70">— This page is not published</span>
          </div>
        </div>
      )}

      {/* Breadcrumbs */}
      {hasBreadcrumbs && (
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <Breadcrumbs orgSlug={orgSlug!} ancestors={ancestors} currentTitle={page.title} />
        </div>
      )}

      {/* Template rendering */}
      {template === 'landing' ? (
        <LandingLayout page={page} blocks={blocks} />
      ) : template === 'sidebar' ? (
        <SidebarLayout
          page={page}
          blocks={blocks}
          children={children}
          orgSlug={orgSlug!}
        />
      ) : template === 'full_width' ? (
        <FullWidthLayout page={page} blocks={blocks} />
      ) : (
        <DefaultLayout page={page} blocks={blocks} />
      )}
    </CollectionSiteShell>
  );
}

// =============================================================================
// Template Layouts
// =============================================================================

interface LayoutProps {
  page: { title: string; excerpt: string | null };
  blocks: ContentBlock[];
}

function DefaultLayout({ page, blocks }: LayoutProps) {
  return (
    <div className="max-w-4xl mx-auto px-4">
      <div className="py-10">
        <h1 className="font-serif text-4xl font-light text-ink mb-2">
          {page.title}
        </h1>
        {page.excerpt && (
          <p className="text-lg text-archive leading-relaxed mt-4">
            {page.excerpt}
          </p>
        )}
      </div>
      <div className="pb-16">
        {blocks.length > 0 ? (
          <BlockRenderer blocks={blocks} />
        ) : (
          <div className="py-12 text-center text-archive">
            <p>This page has no content yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FullWidthLayout({ page, blocks }: LayoutProps) {
  return (
    <div className="w-full">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <h1 className="font-serif text-4xl font-light text-ink mb-2">
          {page.title}
        </h1>
        {page.excerpt && (
          <p className="text-lg text-archive leading-relaxed mt-4">
            {page.excerpt}
          </p>
        )}
      </div>
      <div>
        {blocks.length > 0 ? (
          <BlockRenderer blocks={blocks} />
        ) : (
          <div className="py-12 text-center text-archive">
            <p>This page has no content yet.</p>
          </div>
        )}
      </div>
      <div className="pb-16" />
    </div>
  );
}

interface SidebarLayoutProps extends LayoutProps {
  children: PageChild[];
  orgSlug: string;
}

function SidebarLayout({ page, blocks, children, orgSlug }: SidebarLayoutProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      <h1 className="font-serif text-4xl font-light text-ink mb-2">
        {page.title}
      </h1>
      {page.excerpt && (
        <p className="text-lg text-archive leading-relaxed mt-4 mb-8">
          {page.excerpt}
        </p>
      )}

      <div className="flex flex-col lg:flex-row gap-10">
        {/* Content (2/3) */}
        <div className="flex-1 lg:w-2/3 min-w-0">
          {blocks.length > 0 ? (
            <BlockRenderer blocks={blocks} />
          ) : (
            <div className="py-12 text-center text-archive">
              <p>This page has no content yet.</p>
            </div>
          )}
        </div>

        {/* Sidebar (1/3) */}
        <aside className="lg:w-1/3 shrink-0 space-y-8">
          <TableOfContents blocks={blocks} />

          {/* Child pages */}
          {children.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-ink uppercase tracking-wide mb-3">
                In this section
              </h3>
              <ul className="space-y-1.5">
                {children.map((child) => (
                  <li key={child.page_id}>
                    <Link
                      to={`/c/${orgSlug}/pages/${child.slug}`}
                      className="text-sm text-bark hover:text-copper-dark transition-colors"
                    >
                      {child.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      <div className="pb-16" />
    </div>
  );
}

function LandingLayout({ page, blocks }: LayoutProps) {
  return (
    <div className="w-full">
      {/* Landing pages may skip the title if the first block is a hero */}
      {blocks.length > 0 && blocks[0].block_type !== 'hero_banner' && (
        <div className="max-w-4xl mx-auto px-4 py-10">
          <h1 className="font-serif text-4xl font-light text-ink mb-2">
            {page.title}
          </h1>
          {page.excerpt && (
            <p className="text-lg text-archive leading-relaxed mt-4">
              {page.excerpt}
            </p>
          )}
        </div>
      )}

      {blocks.length > 0 ? (
        blocks.map((block, i) => (
          <section
            key={block.block_id}
            className={`py-12 ${i % 2 === 1 ? 'bg-stone/30' : 'bg-parchment'}`}
          >
            <div className="max-w-7xl mx-auto px-4">
              <BlockRenderer blocks={[block]} />
            </div>
          </section>
        ))
      ) : (
        <div className="py-12 text-center text-archive">
          <p>This page has no content yet.</p>
        </div>
      )}

      <div className="pb-8" />
    </div>
  );
}
