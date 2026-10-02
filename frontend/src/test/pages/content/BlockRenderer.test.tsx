import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BlockRenderer from '../../../pages/content/components/BlockRenderer';
import type { ContentBlock } from '../../../types/content';

vi.mock('../../../lib/sanitize', () => ({
  sanitizeRichHtml: (s: string) => s,
}));

vi.mock('../../../components/ui/ResponsiveImage', () => ({
  ResponsiveImage: (props: { src: string; alt: string }) => (
    <img src={props.src} alt={props.alt} />
  ),
}));

describe('BlockRenderer', () => {
  it('returns null for empty block list', () => {
    const { container } = render(<BlockRenderer blocks={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a Quote block with text', () => {
    const blocks: ContentBlock[] = [
      {
        block_id: 'b-1',
        block_type: 'quote',
        content: { text: 'be the change', attribution: 'Gandhi' },
        sort_order: 0,
      },
    ];
    render(<BlockRenderer blocks={blocks} />);
    expect(screen.getByText(/be the change/)).toBeInTheDocument();
    expect(screen.getByText(/Gandhi/)).toBeInTheDocument();
  });

  it('orders blocks by sort_order', () => {
    const blocks: ContentBlock[] = [
      {
        block_id: 'second',
        block_type: 'quote',
        content: { text: 'second-text' },
        sort_order: 1,
      },
      {
        block_id: 'first',
        block_type: 'quote',
        content: { text: 'first-text' },
        sort_order: 0,
      },
    ];
    const { container } = render(<BlockRenderer blocks={blocks} />);
    const quotes = container.querySelectorAll('blockquote');
    expect(quotes[0].textContent).toContain('first-text');
    expect(quotes[1].textContent).toContain('second-text');
  });

  it('skips unknown block types gracefully', () => {
    // Cast to bypass type for the test scenario — block type from server we do not yet handle
    const blocks = [
      {
        block_id: 'b-1',
        block_type: 'definitely_not_a_block' as unknown as ContentBlock['block_type'],
        content: {},
        sort_order: 0,
      },
    ];
    const { container } = render(<BlockRenderer blocks={blocks as ContentBlock[]} />);
    // Outer wrapper exists, but the renderer returns null for unknown
    expect(container.querySelector('blockquote')).toBeNull();
  });
});
