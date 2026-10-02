import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopBar } from '../../../../pages/home/v2/components/TopBar';

describe('TopBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the formatted date string', () => {
    vi.setSystemTime(new Date(2026, 3, 26, 9, 0, 0));
    render(<TopBar />);
    expect(screen.getByText('Sunday · 26 April')).toBeInTheDocument();
  });

  it('shows the search keyboard hint', () => {
    vi.setSystemTime(new Date(2026, 0, 1, 9, 0, 0));
    render(<TopBar />);
    expect(screen.getByText(/⌘K to search/)).toBeInTheDocument();
  });
});
