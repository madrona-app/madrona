import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CorpusGapsPanel } from '../../../components/guide/CorpusGapsPanel';
import * as api from '../../../lib/api/guideInsights';

vi.mock('../../../lib/api/guideInsights');
const getGuideInsights = vi.mocked(api.getGuideInsights);

function insights(over: Partial<api.GuideInsights> = {}): api.GuideInsights {
  return {
    period_days: 30,
    summary: { total_requests: 0, answered_rate: null, gap_count: 0, satisfaction_positive: 0, satisfaction_negative: 0 },
    corpus_gaps: [], top_questions: [], top_pages: [], daily: [], ...over,
  };
}

function renderPanel(onCover = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CorpusGapsPanel onCover={onCover} />
    </QueryClientProvider>,
  );
  return { onCover };
}

beforeEach(() => vi.clearAllMocks());

describe('CorpusGapsPanel', () => {
  it('lists gaps with their counts', async () => {
    getGuideInsights.mockResolvedValue(insights({
      corpus_gaps: [
        { question: 'where do I log a loan return?', count: 3, last_seen: null, sample_route: '/loans', sample_entity_type: null },
      ],
    }));
    renderPanel();
    expect(await screen.findByText('where do I log a loan return?')).toBeInTheDocument();
    expect(screen.getByText('3×')).toBeInTheDocument();
  });

  it('"Cover this" calls onCover (the scroll-to-uploader hook)', async () => {
    getGuideInsights.mockResolvedValue(insights({
      corpus_gaps: [
        { question: 'deaccession policy?', count: 1, last_seen: null, sample_route: null, sample_entity_type: null },
      ],
    }));
    const { onCover } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /cover this/i }));
    expect(onCover).toHaveBeenCalledTimes(1);
  });

  it('shows the win state when there are no gaps', async () => {
    getGuideInsights.mockResolvedValue(insights());
    renderPanel();
    expect(await screen.findByText(/your corpus is covering what people ask/i)).toBeInTheDocument();
  });
});
