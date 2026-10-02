import { apiFetch } from '../apiClient';

/** An object visitors were curious about — questions asked + times viewed. */
export interface VisitorTopObject {
  entity_id: string;
  title: string | null;
  questions: number;
  views: number;
}

/** Org-scoped visitor curiosity signal (no cost/provider/cross-org data). */
export interface VisitorInsights {
  period_days: number;
  summary: {
    total_questions: number;
    satisfaction: { positive: number; negative: number };
    answered_rate: number | null;
    visitors: number;
    visits: number;
    qr_scan_share: number | null;
  };
  daily: Array<{ date: string; questions: number }>;
  top_objects: VisitorTopObject[];
  top_questions: Array<{ question: string; count: number }>;
  unanswered: Array<{ question: string; count: number }>;
  languages: Array<{ locale: string; visitors: number }>;
}

export function getVisitorInsights(days = 30): Promise<VisitorInsights> {
  return apiFetch<VisitorInsights>(`/guide/insights/visitors?days=${days}`);
}
