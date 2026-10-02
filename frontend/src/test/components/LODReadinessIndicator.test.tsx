import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  LODReadinessIndicator,
  LODScoreBadge,
  LODReadinessSummary,
  InlineFieldHint,
} from '../../components/collections/LODReadiness/LODReadinessIndicator';
import type { LODHint, LODReadinessResult } from '../../components/collections/LODReadiness/types';

function makeHint(overrides: Partial<LODHint> = {}): LODHint {
  return {
    id: 'hint-1',
    category: 'authority',
    impact: 'high',
    message: 'Link this creator to an authority record.',
    suggestion: 'Search for "Pablo Picasso" in authorities.',
    fields: ['creator'],
    autoFixable: true,
    ...overrides,
  };
}

function makeResult(overrides: Partial<LODReadinessResult> = {}): LODReadinessResult {
  return {
    score: 0.65,
    level: 'good',
    levelMessage: 'Object is reasonably linked-data ready.',
    hints: [],
    hintsByCategory: {},
    hintsByImpact: {},
    strengths: [],
    totalHints: 0,
    ...overrides,
  };
}

describe('LODScoreBadge', () => {
  it('renders the percentage and level label', () => {
    render(<LODScoreBadge score={0.83} level="good" />);
    expect(screen.getByText('83%')).toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
  });

  it('uses level color classes', () => {
    const { container } = render(<LODScoreBadge score={0.95} level="excellent" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('text-semantic-success');
  });

  it('respects size prop', () => {
    const { container } = render(<LODScoreBadge score={0.5} level="fair" size="lg" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('text-base');
  });
});

describe('LODReadinessIndicator (compact)', () => {
  it('renders the score badge and suggestion count when compact', () => {
    render(
      <LODReadinessIndicator
        result={makeResult({ hints: [makeHint(), makeHint({ id: 'h-2' })] })}
        compact
      />,
    );
    expect(screen.getByText('65%')).toBeInTheDocument();
    expect(screen.getByText('2 suggestions')).toBeInTheDocument();
  });

  it('hides suggestion count in compact mode when there are no active hints', () => {
    render(<LODReadinessIndicator result={makeResult()} compact />);
    expect(screen.queryByText(/suggestion/)).not.toBeInTheDocument();
  });

  it('singularises "suggestion" for single hint', () => {
    render(<LODReadinessIndicator result={makeResult({ hints: [makeHint()] })} compact />);
    expect(screen.getByText('1 suggestion')).toBeInTheDocument();
  });
});

describe('LODReadinessIndicator (full)', () => {
  it('renders header level message', () => {
    render(<LODReadinessIndicator result={makeResult()} />);
    expect(screen.getByText('Object is reasonably linked-data ready.')).toBeInTheDocument();
  });

  it('shows "all good" empty state when there are no hints', () => {
    render(<LODReadinessIndicator result={makeResult()} />);
    expect(
      screen.getByText('Great job! This record is well-prepared for Linked Data sharing.'),
    ).toBeInTheDocument();
  });

  it('renders strengths chips when provided and showStrengths is true', () => {
    render(
      <LODReadinessIndicator
        result={makeResult({ strengths: ['Has title', 'Has creator'] })}
      />,
    );
    expect(screen.getByText("What's working well:")).toBeInTheDocument();
    expect(screen.getByText('✓ Has title')).toBeInTheDocument();
    expect(screen.getByText('✓ Has creator')).toBeInTheDocument();
  });

  it('hides strengths section when showStrengths is false', () => {
    render(
      <LODReadinessIndicator
        result={makeResult({ strengths: ['Has title'] })}
        showStrengths={false}
      />,
    );
    expect(screen.queryByText("What's working well:")).not.toBeInTheDocument();
  });

  it('groups hints by category and shows count', () => {
    render(
      <LODReadinessIndicator
        result={makeResult({
          hints: [
            makeHint({ id: 'h-1', category: 'authority' }),
            makeHint({ id: 'h-2', category: 'authority' }),
            makeHint({ id: 'h-3', category: 'identifier' }),
          ],
        })}
      />,
    );
    expect(screen.getByText('Authority Links')).toBeInTheDocument();
    expect(screen.getByText('Identification')).toBeInTheDocument();
    // The count chip "2" appears alongside Authority Links
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('expands hints in a category when its header is clicked', () => {
    const hint = makeHint({ message: 'Add author authority link' });
    render(<LODReadinessIndicator result={makeResult({ hints: [hint] })} />);
    // Hint message is hidden until category is expanded
    expect(screen.queryByText('Add author authority link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Authority Links'));
    expect(screen.getByText('Add author authority link')).toBeInTheDocument();
  });

  it('filters out dismissed hints', () => {
    render(
      <LODReadinessIndicator
        result={makeResult({
          hints: [makeHint({ id: 'h-1' }), makeHint({ id: 'h-2', message: 'Other hint' })],
        })}
        dismissedHints={['h-1']}
      />,
    );
    // Only the non-dismissed hint contributes to the suggestion count
    expect(screen.getByText('1 suggestion')).toBeInTheDocument();
  });

  it('calls onDismissHint when the dismiss button is clicked', () => {
    const onDismissHint = vi.fn();
    render(
      <LODReadinessIndicator
        result={makeResult({ hints: [makeHint({ id: 'h-1' })] })}
        onDismissHint={onDismissHint}
      />,
    );
    fireEvent.click(screen.getByText('Authority Links'));
    fireEvent.click(screen.getByTitle('Dismiss this suggestion'));
    expect(onDismissHint).toHaveBeenCalledWith('h-1');
  });

  it('calls onAutoFix when the Suggest button is clicked', () => {
    const onAutoFix = vi.fn();
    render(
      <LODReadinessIndicator
        result={makeResult({ hints: [makeHint({ id: 'h-1', autoFixable: true })] })}
        onAutoFix={onAutoFix}
      />,
    );
    fireEvent.click(screen.getByText('Authority Links'));
    fireEvent.click(screen.getByText('Suggest'));
    expect(onAutoFix).toHaveBeenCalledWith('h-1');
  });

  it('omits the Suggest button for non-autoFixable hints', () => {
    render(
      <LODReadinessIndicator
        result={makeResult({ hints: [makeHint({ id: 'h-1', autoFixable: false })] })}
        onAutoFix={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Authority Links'));
    expect(screen.queryByText('Suggest')).not.toBeInTheDocument();
  });
});

describe('InlineFieldHint', () => {
  it('renders the suggestion', () => {
    render(<InlineFieldHint hint={makeHint({ suggestion: 'Add a Wikidata link' })} />);
    expect(screen.getByText('Add a Wikidata link')).toBeInTheDocument();
  });

  it('shows "Find matches" CTA only when autoFixable', () => {
    const { rerender } = render(
      <InlineFieldHint hint={makeHint({ autoFixable: true })} />,
    );
    expect(screen.getByText('Find matches')).toBeInTheDocument();
    rerender(<InlineFieldHint hint={makeHint({ autoFixable: false })} />);
    expect(screen.queryByText('Find matches')).not.toBeInTheDocument();
  });
});

describe('LODReadinessSummary', () => {
  it('renders aggregate percentage and object count', () => {
    render(
      <LODReadinessSummary
        averageScore={0.72}
        objectCount={5}
        levelDistribution={{ excellent: 2, good: 1, fair: 1, basic: 1, minimal: 0 }}
      />,
    );
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('Based on 5 objects')).toBeInTheDocument();
  });

  it('uses singular "object" when count is 1', () => {
    render(
      <LODReadinessSummary
        averageScore={0.5}
        objectCount={1}
        levelDistribution={{ excellent: 0, good: 1, fair: 0, basic: 0, minimal: 0 }}
      />,
    );
    expect(screen.getByText('Based on 1 object')).toBeInTheDocument();
  });

  it('renders level distribution legend', () => {
    render(
      <LODReadinessSummary
        averageScore={0.6}
        objectCount={4}
        levelDistribution={{ excellent: 1, good: 2, fair: 1, basic: 0, minimal: 0 }}
      />,
    );
    expect(screen.getByText('Excellent: 1')).toBeInTheDocument();
    expect(screen.getByText('Good: 2')).toBeInTheDocument();
  });
});
