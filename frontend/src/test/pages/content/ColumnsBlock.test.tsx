import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ColumnsEditor,
  ColumnsRenderer,
} from '../../../pages/content/components/blocks/ColumnsBlock';

vi.mock('../../../lib/sanitize', () => ({
  sanitizeRichHtml: (s: string) => s,
}));

describe('ColumnsEditor', () => {
  it('renders 2 columns by default', () => {
    render(<ColumnsEditor content={{}} onChange={vi.fn()} />);
    expect(screen.getByText('Column 1')).toBeInTheDocument();
    expect(screen.getByText('Column 2')).toBeInTheDocument();
    expect(screen.queryByText('Column 3')).toBeNull();
  });

  it('switches to 3 columns', () => {
    const onChange = vi.fn();
    render(<ColumnsEditor content={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '3 Columns' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ column_count: 3 }),
    );
  });

  it('adds a text block to a column', () => {
    const onChange = vi.fn();
    render(
      <ColumnsEditor
        content={{ column_count: 2, column_blocks: [[], []] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /Add text block/i })[0]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        column_blocks: [
          [{ block_type: 'rich_text', content: { html: '' } }],
          [],
        ],
      }),
    );
  });
});

describe('ColumnsRenderer', () => {
  it('renders nothing when no column blocks', () => {
    const { container } = render(<ColumnsRenderer content={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders divider blocks', () => {
    const { container } = render(
      <ColumnsRenderer
        content={{
          column_count: 2,
          column_blocks: [
            [{ block_type: 'divider', content: {} }],
            [],
          ],
        }}
      />,
    );
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('renders quote blocks with attribution', () => {
    render(
      <ColumnsRenderer
        content={{
          column_count: 2,
          column_blocks: [
            [
              {
                block_type: 'quote',
                content: { text: 'one', attribution: 'two' },
              },
            ],
            [],
          ],
        }}
      />,
    );
    expect(screen.getByText(/one/)).toBeInTheDocument();
    expect(screen.getByText(/two/)).toBeInTheDocument();
  });
});
