import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListDiff } from '../../../components/audit/ListDiff';

describe('ListDiff', () => {
  it('returns null for a no-op diff (identical arrays)', () => {
    const { container } = render(
      <ListDiff oldValue={['a', 'b']} newValue={['a', 'b']} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders inline + chip for an added scalar item', () => {
    render(<ListDiff oldValue={['a']} newValue={['a', 'b']} />);
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.getByText('+')).toBeInTheDocument();
  });

  it('renders inline minus chip for a removed item', () => {
    render(<ListDiff oldValue={['a', 'b']} newValue={['a']} />);
    expect(screen.getByText('b')).toBeInTheDocument();
    // Unicode minus sign U+2212
    expect(screen.getByText('−')).toBeInTheDocument();
  });

  it('shows "N added" count-only when items are unlabelable objects', () => {
    render(
      <ListDiff
        oldValue={[]}
        newValue={[{ foo: 1 }, { bar: 2 }]}
      />,
    );
    expect(screen.getByText('2 added')).toBeInTheDocument();
  });

  it('shows mixed "X added, Y removed" count-only summary for unlabelable items', () => {
    render(
      <ListDiff
        oldValue={[{ foo: 1 }]}
        newValue={[{ bar: 2 }, { baz: 3 }]}
      />,
    );
    expect(screen.getByText('2 added, 1 removed')).toBeInTheDocument();
  });

  it('renders a "+N more" toggle when items exceed preview', () => {
    const oldVal = ['a', 'b', 'c', 'd'];
    const newVal = ['e', 'f', 'g', 'h'];
    const onToggle = vi.fn();
    render(
      <ListDiff
        oldValue={oldVal}
        newValue={newVal}
        onToggleDetail={onToggle}
      />,
    );
    const moreBtn = screen.getByText(/more/);
    expect(moreBtn.tagName).toBe('BUTTON');
    expect(moreBtn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(moreBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows the detail accordion when detailOpen is true', () => {
    render(
      <ListDiff
        oldValue={['a', 'b', 'c', 'd']}
        newValue={['e', 'f', 'g', 'h']}
        detailOpen
        onToggleDetail={vi.fn()}
      />,
    );
    expect(screen.getByText('All changes in this field')).toBeInTheDocument();
    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.getByText('Removed')).toBeInTheDocument();
    expect(screen.getByText('Copy changes')).toBeInTheDocument();
    expect(screen.getByText('Hide details')).toBeInTheDocument();
  });

  it('attempts clipboard write when "Copy changes" is clicked', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <ListDiff
        oldValue={['removed-1', 'removed-2', 'removed-3', 'removed-4']}
        newValue={['added-1', 'added-2', 'added-3', 'added-4']}
        fieldName="techniques"
        detailOpen
        onToggleDetail={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Copy changes'));
    expect(writeText).toHaveBeenCalledTimes(1);
    const calledWith = writeText.mock.calls[0][0] as string;
    expect(calledWith).toContain('Techniques');
  });
});
