export type AttentionItemType = 'incident' | 'loan' | 'accession' | 'condition_report';
export type AttentionSeverity = 'urgent' | 'this_week' | 'informational';

export interface AttentionItem {
  id: string;
  type: AttentionItemType;
  severity: AttentionSeverity;
  refNumber: string;
  title: string;
  context: string;
  href: string;
}

export interface PulseStat {
  value: number;
  label: string;
}

export interface PulseRecentObject {
  name: string;
  href: string;
  updatedAgo: string;
}

export interface PulseData {
  stats: PulseStat[];
  recentObject: PulseRecentObject | null;
}

export type ActivityEntryKind = 'self' | 'incident' | 'system';

export interface ActivityEntry {
  id: string;
  kind: ActivityEntryKind;
  text: string;
  href?: string;
  timestamp: number;
}

export interface AppStatus {
  key: 'bridge' | 'collections' | 'guide' | 'content' | 'media';
  name: string;
  monogram: string;
  statusLine: string;
  isActive: boolean;
  href: string;
}
