import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet-async';
import { getDiscoverInfo } from '../../../lib/api';
import { CollectionSiteShell } from '../components/CollectionSiteShell';
import { MadronaLoader } from '../../../components/ui/MadronaLoader';
import { useMemberSession } from './useMemberSession';

export const MEMBER_LINK_CLASS =
  'text-bark hover:text-copper-dark underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2';

interface MemberPageLayoutProps {
  orgSlug: string;
  /** Page name for the document title. */
  title: string;
  children: (session: ReturnType<typeof useMemberSession>) => ReactNode;
}

/**
 * Portal chrome for the member pages. While the portal does not offer saved
 * collections the page says so instead of rendering the member UI.
 */
export function MemberPageLayout({ orgSlug, title, children }: MemberPageLayoutProps) {
  const { data: info } = useQuery({
    queryKey: ['discover-info', orgSlug],
    queryFn: () => getDiscoverInfo(orgSlug),
    enabled: !!orgSlug,
  });
  const session = useMemberSession(orgSlug);

  return (
    <CollectionSiteShell info={info} orgSlug={orgSlug}>
      <Helmet>
        <title>{[title, info?.organization_name].filter(Boolean).join(' | ')}</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <main className="max-w-4xl mx-auto px-4 py-10">
        {session.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <MadronaLoader />
          </div>
        ) : !session.enabled ? (
          <>
            <h1 className="font-serif text-3xl font-light text-ink mb-4">Saved collections are not available</h1>
            <p className="text-ink mb-4">This collection does not offer saved personal collections.</p>
            <Link to={`/c/${orgSlug}`} className={MEMBER_LINK_CLASS}>
              Back to the collection
            </Link>
          </>
        ) : (
          children(session)
        )}
      </main>
    </CollectionSiteShell>
  );
}
