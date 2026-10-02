import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SectionCompletionBadge,
  OverallCompletionBar,
} from '../../components/collections/SectionCompletionBadge';
import type { SectionCompletion } from '../../lib/procedureValidation';

function makeCompletion(overrides: Partial<SectionCompletion> = {}): SectionCompletion {
  return {
    sectionId: 'identification',
    title: 'Identification',
    completedCount: 0,
    totalCount: 0,
    requiredComplete: true,
    percentage: 0,
    missingRequired: [],
    ...overrides,
  } as SectionCompletion;
}

describe('SectionCompletionBadge', () => {
  it('renders "Complete" when all fields are filled', () => {
    const { container } = render(
      <SectionCompletionBadge
        completion={makeCompletion({
          completedCount: 4,
          totalCount: 4,
          percentage: 100,
        })}
      />,
    );
    expect(screen.getByText('Complete')).toBeInTheDocument();
    const badge = container.querySelector('span[title]');
    expect(badge?.getAttribute('title')).toBe('All 4 fields complete');
  });

  it('shows the first missing required field name when blocked', () => {
    render(
      <SectionCompletionBadge
        completion={makeCompletion({
          completedCount: 1,
          totalCount: 4,
          requiredComplete: false,
          missingRequired: ['Object name', 'Object number', 'Acquisition method'],
        })}
      />,
    );
    expect(screen.getByText(/Object name/)).toBeInTheDocument();
    // remaining count badge: +2
    expect(screen.getByText(/\+2/)).toBeInTheDocument();
  });

  it('exposes the full missing list in the title attribute', () => {
    const { container } = render(
      <SectionCompletionBadge
        completion={makeCompletion({
          completedCount: 0,
          totalCount: 2,
          requiredComplete: false,
          missingRequired: ['Object name', 'Object number'],
        })}
      />,
    );
    const badge = container.querySelector('span[title]');
    expect(badge?.getAttribute('title')).toContain('Missing required: Object name, Object number');
  });

  it('shows count fraction when required complete but optional fields missing', () => {
    render(
      <SectionCompletionBadge
        completion={makeCompletion({
          completedCount: 3,
          totalCount: 5,
          percentage: 60,
        })}
      />,
    );
    expect(screen.getByText('3/5 fields')).toBeInTheDocument();
  });

  it('renders detail line when showDetails is set and required missing', () => {
    render(
      <SectionCompletionBadge
        completion={makeCompletion({
          completedCount: 0,
          totalCount: 4,
          requiredComplete: false,
          missingRequired: ['A', 'B', 'C', 'D'],
        })}
        showDetails
      />,
    );
    // showDetails sub-line shows "Missing: A, B +2 more"
    expect(screen.getByText(/Missing: A, B \+2 more/)).toBeInTheDocument();
  });

  it('omits detail line when no required missing even with showDetails', () => {
    render(
      <SectionCompletionBadge
        completion={makeCompletion({
          completedCount: 4,
          totalCount: 4,
          percentage: 100,
        })}
        showDetails
      />,
    );
    expect(screen.queryByText(/^Missing: /)).not.toBeInTheDocument();
  });

  it('uses larger size classes when size="md"', () => {
    const { container } = render(
      <SectionCompletionBadge
        completion={makeCompletion({
          completedCount: 4,
          totalCount: 4,
          percentage: 100,
        })}
        size="md"
      />,
    );
    const badge = container.querySelector('span[title]');
    expect(badge?.className).toContain('text-sm');
  });
});

describe('OverallCompletionBar', () => {
  it('renders the percentage and counts', () => {
    render(
      <OverallCompletionBar
        percentage={42}
        requiredComplete
        completedFields={3}
        totalFields={7}
      />,
    );
    expect(screen.getByText('3/7 fields (42%)')).toBeInTheDocument();
  });

  it('shows warning copy when required is incomplete', () => {
    render(
      <OverallCompletionBar
        percentage={30}
        requiredComplete={false}
        completedFields={3}
        totalFields={10}
      />,
    );
    expect(screen.getByText('Some required fields are missing')).toBeInTheDocument();
  });

  it('hides warning copy when required is complete', () => {
    render(
      <OverallCompletionBar
        percentage={70}
        requiredComplete
        completedFields={7}
        totalFields={10}
      />,
    );
    expect(screen.queryByText('Some required fields are missing')).not.toBeInTheDocument();
  });

  it('uses success bar color when 100%', () => {
    const { container } = render(
      <OverallCompletionBar
        percentage={100}
        requiredComplete
        completedFields={5}
        totalFields={5}
      />,
    );
    const bar = container.querySelector('div[style*="width: 100%"]');
    expect(bar?.className).toContain('bg-semantic-success');
  });

  it('uses warning bar color when required incomplete', () => {
    const { container } = render(
      <OverallCompletionBar
        percentage={20}
        requiredComplete={false}
        completedFields={2}
        totalFields={10}
      />,
    );
    const bar = container.querySelector('div[style*="width: 20%"]');
    expect(bar?.className).toContain('bg-semantic-warning');
  });
});
