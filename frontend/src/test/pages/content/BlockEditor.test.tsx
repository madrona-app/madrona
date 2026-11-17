import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BlockEditor from '../../../pages/content/components/BlockEditor';
import type { ContentBlock } from '../../../types/content';
import { checkA11y, formatViolations } from '../../a11y';

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

  describe('accessibility', () => {
    const ALL_TYPES = [
      'rich_text', 'image', 'hero_banner', 'gallery', 'video', 'divider', 'quote', 'html',
      'call_to_action', 'collection_grid', 'object_spotlight', 'exhibition_preview',
      'staff_grid', 'event_list', 'map', 'accordion', 'columns', 'newsletter_signup',
      'membership_cta', 'venue_card', 'exhibition_grid', 'event_calendar', 'testimonial',
      'social_embed', 'sponsor_grid', 'countdown', 'tabs', 'form',
    ] as const;

    it('has no axe violations with one of every block editor expanded', async () => {
      const blocks: ContentBlock[] = ALL_TYPES.map((t, i) => ({
        block_id: `b-${t}`,
        block_type: t as ContentBlock['block_type'],
        content:
          t === 'form'
            ? { fields: [{ label: 'Email', type: 'email', required: true }] }
            : t === 'tabs'
              ? { tabs: [{ label: 'One', blocks: [] }] }
              : t === 'membership_cta'
                ? { tiers: [{ name: 'Individual', price: '$75', benefits: ['Free entry'] }] }
                : {},
        sort_order: i,
      }));
      const { container } = render(
        <BlockEditor blocks={blocks} onChange={vi.fn()} organizationId="o-1" />,
      );
      const results = await checkA11y(container);
      expect(results.violations, formatViolations(results)).toEqual([]);
      // axe over thirty expanded editors runs past the 5s default under full-suite load.
    }, 30_000);

    it('names each block control after its block and exposes expand state', () => {
      const blocks: ContentBlock[] = [
        { block_id: 'b-1', block_type: 'quote', content: { text: 'a' }, sort_order: 0 },
        { block_id: 'b-2', block_type: 'divider', content: { style: 'line' }, sort_order: 1 },
      ];
      render(<BlockEditor blocks={blocks} onChange={vi.fn()} organizationId="o-1" />);
      expect(screen.getByRole('button', { name: 'Move Quote block 1 down' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Move Quote block 1 up' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Drag to reorder Divider block 2' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Collapse Quote block 1' })).toHaveAttribute('aria-expanded', 'true');
      // Divider style options are toggle buttons in a labelled group
      const group = screen.getByRole('group', { name: 'Style' });
      expect(group).toBeInTheDocument();
    });

    it('moves a block down with the keyboard-accessible button', () => {
      const onChange = vi.fn();
      const blocks: ContentBlock[] = [
        { block_id: 'b-1', block_type: 'quote', content: { text: 'a' }, sort_order: 0 },
        { block_id: 'b-2', block_type: 'divider', content: { style: 'line' }, sort_order: 1 },
      ];
      render(<BlockEditor blocks={blocks} onChange={onChange} organizationId="o-1" />);
      fireEvent.click(screen.getByRole('button', { name: 'Move Quote block 1 down' }));
      const arg = onChange.mock.calls[0][0] as ContentBlock[];
      expect(arg.map((b) => b.block_id)).toEqual(['b-2', 'b-1']);
    });

    it('Add Block disclosure exposes aria-expanded and closes on Escape', () => {
      render(<BlockEditor blocks={[]} onChange={vi.fn()} organizationId="o-1" />);
      const trigger = screen.getByRole('button', { name: /Add Block/i });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      fireEvent.keyDown(screen.getByText('Quote'), { key: 'Escape' });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });
});
