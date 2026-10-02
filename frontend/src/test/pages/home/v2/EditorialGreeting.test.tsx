import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditorialGreeting } from '../../../../pages/home/v2/components/EditorialGreeting';

function renderAt(hour: number, props: Parameters<typeof EditorialGreeting>[0]) {
  vi.useFakeTimers();
  const fixed = new Date(2026, 3, 26, hour, 0, 0);
  vi.setSystemTime(fixed);
  return render(<EditorialGreeting {...props} />);
}

describe('EditorialGreeting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says "morning" between 5am and noon', () => {
    renderAt(9, { name: 'Alice', subtitle: 'Hi' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
      'Good morning, Alice',
    );
  });

  it('says "afternoon" between noon and 6pm', () => {
    renderAt(13, { name: 'Bob', subtitle: 'Hi' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
      'Good afternoon, Bob',
    );
  });

  it('says "evening" after 6pm', () => {
    renderAt(20, { name: 'Carol', subtitle: 'Hi' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
      'Good evening, Carol',
    );
  });

  it('treats pre-dawn (before 5am) as evening', () => {
    renderAt(2, { name: 'Dan', subtitle: 'Hi' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
      'Good evening, Dan',
    );
  });

  it('omits the comma and name when name is empty', () => {
    renderAt(10, { name: '', subtitle: 'subtitle here' });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toMatch(/^Good morning\.?$/);
    expect(heading.textContent).not.toContain(',');
  });

  it('renders the subtitle text', () => {
    renderAt(10, { name: 'Eve', subtitle: 'Subtitle copy line' });
    expect(screen.getByText('Subtitle copy line')).toBeInTheDocument();
  });
});
