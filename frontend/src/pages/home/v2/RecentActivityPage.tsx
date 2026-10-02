import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock } from 'lucide-react';
import { RecentItems } from '../../../components/work/RecentItems';

/**
 * Org-level recent activity page — shows a single user's recent items across
 * every app (Collections, Media, Bridge, etc.), unfiltered by active product.
 *
 * Reachable from the home dashboard activity thread's "view all" link.
 */
export default function RecentActivityPage() {
  const { orgId } = useParams<{ orgId: string }>();

  return (
    <main className="px-8 py-6 max-w-[920px] mx-auto">
      <Link
        to={orgId ? `/organizations/${orgId}/home` : '/'}
        className="inline-flex items-center gap-1 text-xs text-archive hover:text-bark no-underline mb-4"
      >
        <ArrowLeft size={12} />
        Back to home
      </Link>
      <header className="flex items-center gap-2 mb-6">
        <Clock size={20} className="text-archive" />
        <h1 className="font-serif text-2xl text-forest m-0">Recent activity</h1>
      </header>
      <p className="text-sm text-archive m-0 mb-6 max-w-[540px]">
        Records you've opened recently — across every app.
      </p>
      <RecentItems scope="all" limit={50} />
    </main>
  );
}
