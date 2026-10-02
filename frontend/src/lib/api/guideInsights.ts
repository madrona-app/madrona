import { apiFetch } from '../apiClient';

/** A question the assistant couldn't answer (a tool/RAG lookup returned empty). */
export interface CorpusGap {
  question: string;
  count: number;
  last_seen: string | null;
  sample_route: string | null;
  sample_entity_type: string | null;
}

/** Org-scoped Guide usage signal (no cost/provider/cross-org data). */
export interface GuideInsights {
  period_days: number;
  summary: {
    total_requests: number;
    answered_rate: number | null;
    gap_count: number;
    satisfaction_positive: number;
    satisfaction_negative: number;
  };
  corpus_gaps: CorpusGap[];
  top_questions: Array<{ question: string; count: number }>;
  top_pages: Array<{ route: string; count: number }>;
  daily: Array<{ date: string; requests: number }>;
}

export function getGuideInsights(days = 30): Promise<GuideInsights> {
  return apiFetch<GuideInsights>(`/guide/insights?days=${days}`);
}
