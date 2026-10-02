import { apiFetch } from './_utils';

export interface AttentionItem {
  id: string;
  label: string;
  due_date: string | null;
  severity: string | null;
  href: string | null;
}

export interface AttentionCategory {
  total: number;
  samples: AttentionItem[];
}

export interface AttentionSummary {
  loans: AttentionCategory;
  rights: AttentionCategory;
  audits: AttentionCategory;
}

export async function getAttentionSummary(orgId: string): Promise<AttentionSummary> {
  return apiFetch<AttentionSummary>(`/organizations/${orgId}/dashboard/attention`);
}

// V2 — flat AttentionItem[] for the redesigned home screen.
export interface AttentionItemV2 {
  id: string;
  type: 'incident' | 'loan' | 'accession' | 'condition_report';
  severity: 'urgent' | 'this_week' | 'informational';
  ref_number: string;
  title: string;
  context: string;
  href: string;
}

export interface AttentionV2Response {
  items: AttentionItemV2[];
}

export async function getAttentionV2(orgId: string): Promise<AttentionV2Response> {
  return apiFetch<AttentionV2Response>(
    `/organizations/${orgId}/dashboard/attention-v2`,
  );
}

export interface PulseStat {
  value: number;
  label: string;
}

export interface PulseRecentObject {
  name: string;
  href: string;
  updated_ago: string;
}

export interface PulseResponse {
  stats: PulseStat[];
  recent_object: PulseRecentObject | null;
}

export async function getPulse(orgId: string): Promise<PulseResponse> {
  return apiFetch<PulseResponse>(`/organizations/${orgId}/dashboard/pulse`);
}

export interface WorkshopCounts {
  bridge_running: number;
  collections_records: number;
  guide_active_conversations: number;
  content_drafts: number;
  media_assets: number;
}

export async function getWorkshopCounts(orgId: string): Promise<WorkshopCounts> {
  return apiFetch<WorkshopCounts>(`/organizations/${orgId}/dashboard/workshop`);
}

export interface GreetingResponse {
  subtitle: string;
}

export async function getGreeting(orgId: string): Promise<GreetingResponse> {
  return apiFetch<GreetingResponse>(`/organizations/${orgId}/dashboard/greeting`);
}

export interface SuggestionsResponse {
  suggestions: string[];
}

export async function getSuggestions(orgId: string): Promise<SuggestionsResponse> {
  return apiFetch<SuggestionsResponse>(
    `/organizations/${orgId}/dashboard/suggestions`,
  );
}

export interface ActivityServerEntry {
  id: string;
  kind: 'self' | 'incident' | 'system';
  text: string;
  href: string | null;
  timestamp: number;
}

export interface ActivityResponse {
  entries: ActivityServerEntry[];
}

export async function getActivity(orgId: string): Promise<ActivityResponse> {
  return apiFetch<ActivityResponse>(`/organizations/${orgId}/dashboard/activity`);
}

export interface DashboardSummary {
  greeting: GreetingResponse;
  suggestions: SuggestionsResponse;
  attention: AttentionV2Response;
  pulse: PulseResponse;
  workshop: WorkshopCounts;
  activity: ActivityResponse;
}

export async function getDashboardSummary(
  orgId: string,
): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>(`/organizations/${orgId}/dashboard/summary`);
}
