/**
 * NotFoundPublicPage — Public 404 page for the discover site.
 *
 * If custom_404_page_id is set, renders that CMS page's blocks.
 * Otherwise shows a branded fallback.
 */
import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { Search } from 'lucide-react';
import { getDiscoverInfo } from '../../lib/api/discover';
import { getPublishedPageById } from '../../lib/api/content';
import { CollectionSiteShell } from './components/CollectionSiteShell';
import { BlockRenderer } from '../content/components/BlockRenderer';

export default function NotFoundPublicPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();

  // Hide the initial loading overlay
  useEffect(() => {
    const loader = document.getElementById('initial-loader');
    if (loader) {
      loader.classList.add('fade-out');
      setTimeout(() => loader.remove(), 300);
    }
  }, []);

  const { data: info } = useQuery({
    queryKey: ['discover-info', orgSlug],
    queryFn: () => getDiscoverInfo(orgSlug!),
    enabled: !!orgSlug,
  });

  // If a custom 404 page is configured, fetch its content
  const custom404PageId = info?.custom_404_page_id;
  const { data: customPageResponse } = useQuery({
    queryKey: ['public-page-404', orgSlug, custom404PageId],
    queryFn: () => getPublishedPageById(orgSlug!, custom404PageId!),
    enabled: !!orgSlug && !!custom404PageId,
  });

  const customPage = customPageResponse?.data;

  return (
    <CollectionSiteShell info={info} orgSlug={orgSlug!}>
      <Helmet>
        <title>
          {['Page Not Found', info?.organization_name].filter(Boolean).join(' | ')}
        </title>
        <meta name="robots" content="noindex" />
      </Helmet>

      {customPage?.blocks && customPage.blocks.length > 0 ? (
        <div className="max-w-4xl mx-auto px-4 py-12">
          <BlockRenderer blocks={customPage.blocks} />
        </div>
      ) : (
        <div className="max-w-2xl mx-auto px-4 py-20 text-center">
          <h1 className="font-serif text-4xl font-light text-ink mb-4">
            Page Not Found
          </h1>
          <p className="text-archive text-lg mb-8">
            The page you're looking for doesn't exist or has been moved.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              to={`/c/${orgSlug}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-bark text-parchment rounded-lg hover:bg-copper-dark transition-colors"
            >
              <Search size={16} />
              Search the collection
            </Link>
          </div>
        </div>
      )}
    </CollectionSiteShell>
  );
}
