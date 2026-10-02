import { useParams } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { TopBar } from './components/TopBar';
import { EditorialGreeting } from './components/EditorialGreeting';
import { GuideHero } from './components/GuideHero';
import { AttentionQueue } from './components/AttentionQueue';
import { TodaysPulse } from './components/TodaysPulse';
import { ActivityThread } from './components/ActivityThread';
import { Workshop } from './components/Workshop';
import { useAttentionV2 } from './useAttentionV2';
import { useActivityV2 } from './useActivityV2';
import { usePulse } from './usePulse';
import { useWorkshop } from './useWorkshop';
import { useGreeting } from './useGreeting';
import { useSuggestions } from './useSuggestions';
import { useDashboardSummary } from './useDashboardSummary';


function firstName(name: string | undefined): string {
  if (!name) return '';
  return name.split(' ')[0] ?? '';
}

export default function HomeScreenV2() {
  const { orgId } = useParams<{ orgId: string }>();
  const { user } = useAuth();
  const name = firstName(user?.name);
  // Single round-trip that warms every per-feature dashboard cache key,
  // so the leaf hooks below resolve from cache without firing their own requests.
  useDashboardSummary(orgId);
  const { items: attentionItems } = useAttentionV2(orgId);
  const activityEntries = useActivityV2(orgId);
  const pulseData = usePulse(orgId);
  const apps = useWorkshop(orgId);
  const subtitle = useGreeting(orgId);
  const suggestions = useSuggestions(orgId);

  return (
    <main className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1140px] mx-auto">
      <TopBar />
      <EditorialGreeting name={name} subtitle={subtitle} />
      <GuideHero orgId={orgId} suggestions={suggestions} />

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 lg:gap-[18px] mb-5 lg:mb-[22px]">
        <AttentionQueue items={attentionItems} />
        <TodaysPulse pulseData={pulseData} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 lg:gap-[18px]">
        <Workshop apps={apps} />
        <ActivityThread
          entries={activityEntries}
          viewAllHref={orgId ? `/organizations/${orgId}/recent` : null}
        />
      </div>
    </main>
  );
}
