import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BlockEditor from '../../../pages/content/components/BlockEditor';
import type { ContentBlock } from '../../../types/content';

// Mock the TipTap editor — full editor lifecycle isn't needed for these tests
vi.mock('@tiptap/react', () => ({
  useEditor: () => ({
    chain: () => ({
      focus: () => ({
        toggleBold: () => ({ run: () => {} }),
        toggleItalic: () => ({ run: () => {} }),
        toggleHeading: () => ({ run: () => {} }),
        toggleBulletList: () => ({ run: () => {} }),
        toggleOrderedList: () => ({ run: () => {} }),
        toggleBlockquote: () => ({ run: () => {} }),
        extendMarkRange: () => ({
          unsetLink: () => ({ run: () => {} }),
          setLink: () => ({ run: () => {} }),
        }),
      }),
    }),
    isActive: () => false,
    getAttributes: () => ({}),
    getHTML: () => '',
  }),
  EditorContent: () => <div data-testid="tiptap-editor" />,
}));

vi.mock('@tiptap/starter-kit', () => ({ default: {} }));
vi.mock('@tiptap/extension-link', () => ({
  default: { configure: () => ({}) },
}));

vi.mock('../../../components/content/MediaPickerModal', () => ({
  MediaPickerModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog">picker</div> : null,
}));

vi.mock('../../../components/ui/ResponsiveImage', () => ({
  ResponsiveImage: () => <img alt="" />,
}));

describe('BlockEditor', () => {
  it('shows empty state with no blocks', () => {
    render(<BlockEditor blocks={[]} onChange={vi.fn()} organizationId="o-1" />);
    expect(screen.getByText('No content blocks yet')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Add Block/i }),
    ).toBeInTheDocument();
  });

  it('opens the block-type dropdown on click', () => {
    render(<BlockEditor blocks={[]} onChange={vi.fn()} organizationId="o-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Add Block/i }));
    expect(screen.getByText('Rich Text')).toBeInTheDocument();
    expect(screen.getByText('Quote')).toBeInTheDocument();
    expect(screen.getByText('Divider')).toBeInTheDocument();
  });

  it('adds a new block when type is chosen', () => {
    const onChange = vi.fn();
    render(<BlockEditor blocks={[]} onChange={onChange} organizationId="o-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Add Block/i }));
    // Click the Quote option from the menu
    const quoteBtn = screen
      .getAllByRole('button')
      .find((b) => /^Quote/.test(b.textContent || ''));
    fireEvent.click(quoteBtn!);
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0] as ContentBlock[];
    expect(arg).toHaveLength(1);
    expect(arg[0].block_type).toBe('quote');
  });

  it('renders existing blocks (sorted)', () => {
    const blocks: ContentBlock[] = [
      {
        block_id: 'b-2',
        block_type: 'quote',
        content: { text: 'second' },
        sort_order: 1,
      },
      {
        block_id: 'b-1',
        block_type: 'divider',
        content: { style: 'line' },
        sort_order: 0,
      },
    ];
    render(<BlockEditor blocks={blocks} onChange={vi.fn()} organizationId="o-1" />);
    expect(screen.getAllByText('Divider').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Quote').length).toBeGreaterThan(0);
  });

  it('removes a block when its delete button is clicked', () => {
    const onChange = vi.fn();
    const blocks: ContentBlock[] = [
      {
        block_id: 'b-1',
        block_type: 'divider',
        content: { style: 'line' },
        sort_order: 0,
      },
    ];
    render(<BlockEditor blocks={blocks} onChange={onChange} organizationId="o-1" />);
    fireEvent.click(screen.getByTitle('Delete block'));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
