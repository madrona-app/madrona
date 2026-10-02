import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FieldDiffList } from '../../../components/audit/FieldDiffList';

describe('FieldDiffList', () => {
  it('renders nothing for empty diffs', () => {
    const { container } = render(<FieldDiffList diffs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows inline value for a small list diff without clicking View details', () => {
    const diffs = [
      {
        field_name: 'techniques',
        old_value: ['Watercolor'],
        new_value: ['Watercolor', 'Impasto'],
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    // The field name should be visible
    expect(screen.getByText('Techniques')).toBeInTheDocument();

    // The inline value chip should show "Impasto" immediately without clicking anything
    expect(screen.getByText('Impasto')).toBeInTheDocument();

    // There should be a "+" symbol for the added item
    expect(screen.getByText('+')).toBeInTheDocument();

    // Should NOT show "+N more" since total changes is 1 (<=3)
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });

  it('shows +1 delta chip next to field name for list diffs', () => {
    const diffs = [
      {
        field_name: 'materials',
        old_value: ['Wood'],
        new_value: ['Wood', 'Oil on canvas'],
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    // Should show the delta chip "+1"
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('shows scalar diff inline without any expand needed', () => {
    const diffs = [
      {
        field_name: 'object_title',
        old_value: 'Untitled',
        new_value: 'Landscape at Sunset',
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    expect(screen.getByText('Object Title')).toBeInTheDocument();
    // Scalar shows old → new inline (no quotes)
    expect(screen.getByText('Untitled')).toBeInTheDocument();
    expect(screen.getByText('Landscape at Sunset')).toBeInTheDocument();
  });

  it('shows "+N more" for large list diffs and expands on click', () => {
    const diffs = [
      {
        field_name: 'other_numbers',
        old_value: [
          { type: 'accession', value: '95.PA.12' },
          { type: 'former', value: 'X-100' },
          { type: 'catalog', value: 'Z-200' },
          { type: 'inventory', value: 'W-300' },
        ],
        new_value: [
          { type: 'accession', value: '95.PA.12a' },
          { type: 'former', value: 'X-101' },
          { type: 'catalog', value: 'Z-201' },
          { type: 'inventory', value: 'W-301' },
        ],
      },
    ];

    render(<FieldDiffList diffs={diffs} showRawButton />);

    // Should show delta chips
    expect(screen.getByText('+4')).toBeInTheDocument();

    // Should show first 3 value chips inline
    // The remaining ones should be behind "+N more"
    const moreButton = screen.getByText(/more/);
    expect(moreButton).toBeInTheDocument();

    // Click "+N more" to expand
    fireEvent.click(moreButton);

    // After expanding, should show "All changes in this field" header
    expect(screen.getByText('All changes in this field')).toBeInTheDocument();

    // Should show separated sections
    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.getByText('Removed')).toBeInTheDocument();

    // Should show "Copy changes" button
    expect(screen.getByText('Copy changes')).toBeInTheDocument();
  });

  it('omits no-op list diffs where arrays are identical', () => {
    const diffs = [
      {
        field_name: 'tags',
        old_value: ['a', 'b'],
        new_value: ['a', 'b'],
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    // The row should not render since the list diff is a no-op
    // FieldDiffList returns null for empty diffs, but here diffs has 1 item
    // FieldDiffRow returns null for no-op list diffs
    // So we should not see the field name
    expect(screen.queryByText('Tags')).not.toBeInTheDocument();
  });

  it('shows "View raw diff" button when showRawButton is true', () => {
    const diffs = [
      {
        field_name: 'title',
        old_value: 'A',
        new_value: 'B',
      },
    ];

    render(<FieldDiffList diffs={diffs} showRawButton />);
    expect(screen.getByText('View raw diff')).toBeInTheDocument();
  });

  it('makes expand button keyboard-accessible with aria-expanded', () => {
    const diffs = [
      {
        field_name: 'materials',
        old_value: ['alpha', 'bravo', 'charlie', 'delta'],
        new_value: ['echo', 'foxtrot', 'golf', 'hotel'],
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    const moreButton = screen.getByText(/more/);
    expect(moreButton.tagName).toBe('BUTTON');
    expect(moreButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(moreButton);

    // After click, the "Hide details" button should have aria-expanded=true
    const hideButton = screen.getByText('Hide details');
    expect(hideButton).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows count-only summary for unreadable list items', () => {
    const diffs = [
      {
        field_name: 'metadata',
        old_value: [{ foo: 1 }],
        new_value: [{ foo: 1 }, { bar: 2 }],
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    // Should show count-only since objects have no readable labels
    expect(screen.getByText('1 added')).toBeInTheDocument();

    // Should NOT show value chips (no "+" prefix)
    expect(screen.queryByText('+')).not.toBeInTheDocument();
  });

  // =========================================================================
  // Neutral rendering tests — values shown exactly as stored
  // =========================================================================

  it('displays "?" values as-is in inline preview chips', () => {
    const diffs = [
      {
        field_name: 'other_numbers',
        old_value: [{ type: 'alternate', value: '95.PA.12' }],
        new_value: [{ type: 'alternate', value: '?' }],
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    // Both values should appear as chips — "?" is a valid value shown as stored
    // Type labels are Title Cased for display
    expect(screen.getByText('Alternate: 95.PA.12')).toBeInTheDocument();
    expect(screen.getByText('Alternate: ?')).toBeInTheDocument();
  });

  it('shows other_numbers type labels title-cased for display', () => {
    const diffs = [
      {
        field_name: 'other_numbers',
        old_value: [] as any[],
        new_value: [{ type: 'accession', value: '95.PA.12' }],
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    // Type labels are Title Cased for display
    expect(screen.getByText('Accession: 95.PA.12')).toBeInTheDocument();
  });

  it('always shows vivid delta chips regardless of content', () => {
    const diffs = [
      {
        field_name: 'techniques',
        old_value: ['Watercolor'],
        new_value: ['Watercolor', 'Impasto'],
      },
    ];

    const { container } = render(<FieldDiffList diffs={diffs} />);

    // The +1 chip should have vivid green styling (bg-semantic-success)
    const chipSpans = container.querySelectorAll('span');
    const deltaChip = Array.from(chipSpans).find(
      (s) => s.textContent?.includes('+1') && s.className.includes('rounded'),
    );
    expect(deltaChip).toBeDefined();
    expect(deltaChip?.className).toContain('bg-semantic-success');
  });

  it('shows count-only with NO toggle for structurally unlabelable objects', () => {
    const diffs = [
      {
        field_name: 'metadata',
        old_value: [] as any[],
        new_value: [{ foo: 1 }, { bar: 2 }],
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    // Should show count-only since objects have no known display keys
    expect(screen.getByText('2 added')).toBeInTheDocument();

    // Should NOT show "Show details" button — use Raw Diff for details
    expect(screen.queryByText('Show details')).not.toBeInTheDocument();
  });

  it('treats single-char and punctuation values neutrally in inline preview', () => {
    const diffs = [
      {
        field_name: 'tags',
        old_value: ['N/A'],
        new_value: ['N/A', '?', 'd'],
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    // All values shown as-is — no filtering based on content
    expect(screen.getByText('?')).toBeInTheDocument();
    expect(screen.getByText('d')).toBeInTheDocument();
  });

  // =========================================================================
  // Title-case field renderers
  // =========================================================================

  it('displays techniques with title-cased labels', () => {
    const diffs = [
      {
        field_name: 'techniques',
        old_value: [] as any[],
        new_value: ['impasto'],
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    expect(screen.getByText('Impasto')).toBeInTheDocument();
    expect(screen.queryByText('impasto')).not.toBeInTheDocument();
  });

  it('displays classifications term with title-cased labels', () => {
    const diffs = [
      {
        field_name: 'classifications',
        old_value: [] as any[],
        new_value: [{ term: 'painting' }],
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    expect(screen.getByText('Painting')).toBeInTheDocument();
    // Should NOT show JSON fallback
    expect(screen.queryByText(/\{.*term.*\}/)).not.toBeInTheDocument();
  });

  it('count-only mode shows no toggle for unlabelable objects', () => {
    const diffs = [
      {
        field_name: 'metadata',
        old_value: [] as any[],
        new_value: [{ foo: 1 }],
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    // Count-only mode should show count text only, no toggle
    expect(screen.getByText('1 added')).toBeInTheDocument();
    expect(screen.queryByText('Show details')).not.toBeInTheDocument();
    expect(screen.queryByText('Hide details')).not.toBeInTheDocument();
  });

  it('does NOT title-case generic field items', () => {
    const diffs = [
      {
        field_name: 'tags',
        old_value: [] as any[],
        new_value: ['impasto'],
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    // Generic fields use itemLabel — no title-casing
    expect(screen.getByText('impasto')).toBeInTheDocument();
    expect(screen.queryByText('Impasto')).not.toBeInTheDocument();
  });

  // =========================================================================
  // Enum label display
  // =========================================================================

  it('displays object_status enum values with human labels', () => {
    const diffs = [
      {
        field_name: 'object_status',
        old_value: 'on_loan',
        new_value: 'pending',
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    expect(screen.getByText('On Loan')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    // Raw values should not appear
    expect(screen.queryByText('on_loan')).not.toBeInTheDocument();
    expect(screen.queryByText('pending')).not.toBeInTheDocument();
  });

  it('passes through unknown object_status values unchanged', () => {
    const diffs = [
      {
        field_name: 'object_status',
        old_value: 'custom_status',
        new_value: 'another_custom',
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    expect(screen.getByText('custom_status')).toBeInTheDocument();
    expect(screen.getByText('another_custom')).toBeInTheDocument();
  });

  it('displays scalar diffs without surrounding quotes', () => {
    const diffs = [
      {
        field_name: 'object_title',
        old_value: 'Old Title',
        new_value: 'New Title',
      },
    ];

    render(<FieldDiffList diffs={diffs} />);

    expect(screen.getByText('Old Title')).toBeInTheDocument();
    expect(screen.getByText('New Title')).toBeInTheDocument();
    // No quoted versions
    expect(screen.queryByText('"Old Title"')).not.toBeInTheDocument();
    expect(screen.queryByText('"New Title"')).not.toBeInTheDocument();
  });
});
