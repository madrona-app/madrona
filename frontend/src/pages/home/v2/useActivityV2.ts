import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWork, type RecentItem, type RecordType } from '../../../contexts/WorkContext';
import { getActivity } from '../../../lib/api';
import type { ActivityEntry, ActivityEntryKind } from './types';

/** Verbs by record type. Past-tense, sentence form. */
const VERB_BY_TYPE: Record<string, string> = {
  object: 'opened',
  condition_report: 'opened condition report',
  loan_in: 'opened incoming loan',
  loan_out: 'opened outgoing loan',
  acquisition: 'opened acquisition',
  movement: 'opened movement',
  conservation: 'opened conservation treatment',
  incident: 'opened incident',
  use_request: 'opened use request',
  exhibition: 'opened exhibition',
  valuation: 'opened valuation',
  object_entry: 'opened entry',
  object_exit: 'opened exit',
  deaccession: 'opened deaccession',
  media_asset: 'opened media asset',
  media_collection: 'opened media collection',
};

const INCIDENT_TYPES: ReadonlyArray<RecordType> = ['incident'];

function kindForType(type: RecordType): ActivityEntryKind {
  if (INCIDENT_TYPES.includes(type)) return 'incident';
  return 'self';
}

function entryText(item: RecentItem): string {
  const verb = VERB_BY_TYPE[item.type] ?? 'opened';
  const label = item.label || 'a record';
  return `You ${verb} ${label}`;
}

/**
 * Activity thread blends two sources:
 *   1. Current user's recent navigation (localStorage RecentItems tracker)
 *   2. Org-wide events synthesized server-side (incidents filed, acquisitions
 *      drafted, condition reports opened, recently-updated objects)
 *
 * Server entries arrive with hrefs relative to the org (e.g. /collections/...);
 * we prefix `/organizations/{orgId}` so they're routable. Both streams are
 * merged, deduped by id, sorted by timestamp desc, and capped at 8.
 */
export function useActivityV2(orgId?: string): ActivityEntry[] {
  const { recentItems } = useWork();

  const { data: serverData } = useQuery({
    queryKey: ['dashboard', 'activity', orgId],
    queryFn: () => {
      if (!orgId) throw new Error('No organization selected');
      return getActivity(orgId);
    },
    enabled: !!orgId,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    // Local view-history → ActivityEntry[]
    const fromHistory: ActivityEntry[] = recentItems
      .filter((i) => i.path && i.path.startsWith('/organizations/'))
      .map((item) => ({
        id: `view-${item.type}-${item.id}-${item.timestamp}`,
        kind: kindForType(item.type),
        text: entryText(item),
        href: item.path,
        timestamp: item.timestamp,
      }));

    // Server entries → ActivityEntry[]; prefix orgId on hrefs
    const fromServer: ActivityEntry[] = (serverData?.entries ?? []).map((e) => ({
      id: `org-${e.id}`,
      kind: e.kind,
      text: e.text,
      href: orgId && e.href ? `/organizations/${orgId}${e.href}` : undefined,
      timestamp: e.timestamp,
    }));

    const merged = [...fromHistory, ...fromServer];
    merged.sort((a, b) => b.timestamp - a.timestamp);

    // De-dupe by id (defensive — keys are namespaced, but belt + suspenders)
    const seen = new Set<string>();
    const unique = merged.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    return unique.slice(0, 8);
  }, [recentItems, serverData, orgId]);
}
