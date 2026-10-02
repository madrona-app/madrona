import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import {
  CountdownEditor,
  CountdownRenderer,
} from '../../../pages/content/components/blocks/CountdownBlock';

describe('CountdownEditor', () => {
  it('renders date input and CTA fields', () => {
    render(<CountdownEditor content={{}} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(/Opening Night/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Get Tickets/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g., /tickets')).toBeInTheDocument();
  });

  it('emits onChange for target date', () => {
    const onChange = vi.fn();
    const { container } = render(
      <CountdownEditor content={{}} onChange={onChange} />,
    );
    const dateInput = container.querySelector('input[type="date"]')!;
    fireEvent.change(dateInput, { target: { value: '2099-12-31' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ target_date: '2099-12-31' }),
    );
  });

  it('emits heading edits', () => {
    const onChange = vi.fn();
    render(<CountdownEditor content={{}} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/Opening Night/i), {
      target: { value: 'Gala' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ heading: 'Gala' }),
    );
  });
});

describe('CountdownRenderer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing if target_date is empty', () => {
    const { container } = render(<CountdownRenderer content={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders past-event message when target is in the past', () => {
    render(<CountdownRenderer content={{ target_date: '2020-01-01' }} />);
    expect(screen.getByText(/event has started/i)).toBeInTheDocument();
  });

  it('renders all four time segments for a future date', () => {
    render(<CountdownRenderer content={{ target_date: '2099-01-01' }} />);
    expect(screen.getByText('Days')).toBeInTheDocument();
    expect(screen.getByText('Hours')).toBeInTheDocument();
    expect(screen.getByText('Minutes')).toBeInTheDocument();
    expect(screen.getByText('Seconds')).toBeInTheDocument();
  });

  it('updates seconds after timer tick', () => {
    render(<CountdownRenderer content={{ target_date: '2099-01-01' }} />);
    const before = screen.getByText('Seconds').previousElementSibling?.textContent;
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const after = screen.getByText('Seconds').previousElementSibling?.textContent;
    expect(before).not.toBe(after);
  });

  it('renders heading and CTA when provided', () => {
    render(
      <CountdownRenderer
        content={{
          target_date: '2099-01-01',
          heading: 'Opening Night',
          cta_text: 'Buy',
          cta_url: '/buy',
        }}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Opening Night' }),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Buy' });
    expect(link).toHaveAttribute('href', '/buy');
  });
});
