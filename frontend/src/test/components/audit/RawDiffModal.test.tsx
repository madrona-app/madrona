import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RawDiffModal } from '../../../components/audit/RawDiffModal';

const sampleDiffs = [
  {
    field_name: 'object_title',
    old_value: 'Old Title',
    new_value: 'New Title',
  },
  {
    field_name: 'tags',
    old_value: ['a', 'b'],
    new_value: ['a', 'c'],
  },
];

describe('RawDiffModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <RawDiffModal isOpen={false} onClose={vi.fn()} diffs={sampleDiffs} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the default title when open', () => {
    render(<RawDiffModal isOpen onClose={vi.fn()} diffs={sampleDiffs} />);
    expect(screen.getByText('Raw Diff')).toBeInTheDocument();
  });

  it('renders a custom title', () => {
    render(
      <RawDiffModal
        isOpen
        onClose={vi.fn()}
        diffs={sampleDiffs}
        title="Custom Title"
      />,
    );
    expect(screen.getByText('Custom Title')).toBeInTheDocument();
  });

  it('renders one section per diff with title-cased field names', () => {
    render(<RawDiffModal isOpen onClose={vi.fn()} diffs={sampleDiffs} />);
    expect(screen.getByText('Object Title')).toBeInTheDocument();
    expect(screen.getByText('Tags')).toBeInTheDocument();
  });

  it('renders Before/After columns with JSON for each field', () => {
    render(<RawDiffModal isOpen onClose={vi.fn()} diffs={sampleDiffs} />);
    expect(screen.getAllByText('Before').length).toBe(2);
    expect(screen.getAllByText('After').length).toBe(2);
    // Old and new title appear as JSON-quoted strings
    expect(screen.getByText('"Old Title"')).toBeInTheDocument();
    expect(screen.getByText('"New Title"')).toBeInTheDocument();
  });

  it('calls onClose when the X button is clicked', () => {
    const onClose = vi.fn();
    render(<RawDiffModal isOpen onClose={onClose} diffs={sampleDiffs} />);
    // Modal renders into a portal that's aria-hidden=true. Use hidden:true.
    const buttons = screen.getAllByRole('button', { hidden: true });
    // First button is "Copy JSON", second is the close X (no text)
    const closeBtn = buttons.find((b) => !b.textContent?.includes('Copy'));
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<RawDiffModal isOpen onClose={onClose} diffs={sampleDiffs} />);
    // Modal renders into ModalPortal — backdrop has bg-ink/50
    const backdrop = document.body.querySelector('.bg-ink\\/50');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('writes JSON of all diffs to clipboard when "Copy JSON" clicked', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    render(<RawDiffModal isOpen onClose={vi.fn()} diffs={sampleDiffs} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy JSON/i, hidden: true }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const json = writeText.mock.calls[0][0] as string;
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([
      { field: 'object_title', before: 'Old Title', after: 'New Title' },
      { field: 'tags', before: ['a', 'b'], after: ['a', 'c'] },
    ]);
  });
});
