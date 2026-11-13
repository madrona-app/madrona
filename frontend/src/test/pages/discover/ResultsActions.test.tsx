import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ResultsActions, DISCOVER_EXPORT_CAP } from '../../../pages/discover/components/ResultsActions';
import { checkA11y } from '../../a11y';

const baseProps = {
  noun: ['result', 'results'] as [string, string],
  permalink: '/c/museum?q=vase',
  csvUrl: '/api/discover/museum/search/export?q=vase&format=csv',
  jsonUrl: '/api/discover/museum/search/export?q=vase&format=json',
};

describe('ResultsActions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the downloads by count and format and states the cap', () => {
    render(<ResultsActions {...baseProps} total={42} />);
    const csv = screen.getByRole('link', { name: 'Download these 42 results as CSV' });
    expect(csv).toHaveAttribute('href', baseProps.csvUrl);
    expect(csv).toHaveAttribute('download');
    expect(screen.getByRole('link', { name: 'Download these 42 results as JSON' })).toHaveAttribute(
      'href',
      baseProps.jsonUrl,
    );
    expect(csv).toHaveAccessibleDescription(/up to 500 records/);
  });

  it('says when the export is capped', () => {
    render(<ResultsActions {...baseProps} total={1234} />);
    expect(
      screen.getByRole('link', { name: `Download the first ${DISCOVER_EXPORT_CAP} of 1,234 results as CSV` }),
    ).toBeInTheDocument();
    expect(screen.getByText(/500 of 1,234 here/)).toBeInTheDocument();
  });

  it('uses the singular for one record and hides downloads for none', () => {
    const { rerender } = render(<ResultsActions {...baseProps} total={1} />);
    expect(screen.getByRole('link', { name: 'Download this 1 result as CSV' })).toBeInTheDocument();
    rerender(<ResultsActions {...baseProps} total={0} />);
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy link to these results' })).toBeInTheDocument();
  });

  it('copies the absolute permalink and announces it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ResultsActions {...baseProps} total={3} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link to these results' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/c/museum?q=vase`);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Link copied to clipboard.'));
  });

  it('announces the link itself when copying fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(false);
    render(<ResultsActions {...baseProps} total={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link to these results' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Could not copy automatically\. The link is http/),
    );
  });

  it('has no axe violations', async () => {
    const { container } = render(<ResultsActions {...baseProps} total={42} />);
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });
});
