import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../hooks/useAuth';
import { getProductLandingPath } from '../../../hooks/useActiveProduct';
import { getWorkshopCounts, type WorkshopCounts } from '../../../lib/api';
import type { AppStatus } from './types';

const STALE_TIME = 60 * 1000;
const CACHE_TIME = 5 * 60 * 1000;

const ORDER: Array<AppStatus['key']> = [
  'guide',
  'collections',
  'media',
  'content',
  'bridge',
];

const MONOGRAM: Record<AppStatus['key'], string> = {
  bridge: 'B',
  collections: 'C',
  guide: 'G',
  content: 'O',
  media: 'M',
};

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function statusFor(
  key: AppStatus['key'],
  counts: WorkshopCounts | undefined,
): { line: string; isActive: boolean } {
  if (!counts) return { line: '—', isActive: false };
  switch (key) {
    case 'bridge': {
      const n = counts.bridge_running;
      return {
        line: n === 0 ? 'Idle' : `${n} import${n === 1 ? '' : 's'} running`,
        isActive: n > 0,
      };
    }
    case 'collections':
      return {
        line: `${formatCount(counts.collections_records)} records`,
        isActive: false,
      };
    case 'guide': {
      const n = counts.guide_active_conversations;
      return {
        line:
          n === 0
            ? 'Ready'
            : `Handling ${n} conversation${n === 1 ? '' : 's'} now`,
        isActive: n > 0,
      };
    }
    case 'content': {
      const n = counts.content_drafts;
      return {
        line: n === 0 ? 'No drafts' : `${n} draft${n === 1 ? '' : 's'}`,
        isActive: false,
      };
    }
    case 'media':
      return {
        line: `${formatCount(counts.media_assets)} assets`,
        isActive: false,
      };
  }
}

export function useWorkshop(orgId: string | undefined): AppStatus[] {
  const { applications } = useAuth();

  const { data: counts } = useQuery({
    queryKey: ['dashboard', 'workshop', orgId],
    queryFn: () => {
      if (!orgId) throw new Error('No organization selected');
      return getWorkshopCounts(orgId);
    },
    enabled: !!orgId,
    staleTime: STALE_TIME,
    gcTime: CACHE_TIME,
  });

  return useMemo(() => {
    if (!orgId) return [];
    const enabledKeys = new Set(
      applications
        .filter((a) => a.enabled && a.status === 'active')
        .map((a) => a.key),
    );
    return ORDER.filter((key) => enabledKeys.has(key)).map<AppStatus>((key) => {
      const app = applications.find((a) => a.key === key);
      const status = statusFor(key, counts);
      return {
        key,
        name: app?.display_name ?? key,
        monogram: MONOGRAM[key],
        statusLine: status.line,
        isActive: status.isActive,
        href: getProductLandingPath(key, orgId),
      };
    });
  }, [applications, orgId, counts]);
}
