import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FieldDiffRow } from '../../../components/audit/FieldDiffRow';

describe('FieldDiffRow', () => {
  it('renders a scalar diff with field name and arrow', () => {
    render(
      <FieldDiffRow
        diff={{ field_name: 'object_title', old_value: 'A', new_value: 'B' }}
      />,
    );
    // Field name is title-cased
    expect(screen.getByText('Object Title')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('renders nothing for a no-op list diff', () => {
    const { container } = render(
      <FieldDiffRow
        diff={{
          field_name: 'tags',
          old_value: ['a', 'b'],
          new_value: ['a', 'b'],
        }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders +N delta chip for a list diff with additions', () => {
    render(
      <FieldDiffRow
        diff={{
          field_name: 'materials',
          old_value: ['Wood'],
          new_value: ['Wood', 'Oil on canvas'],
        }}
      />,
    );
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('Materials')).toBeInTheDocument();
  });

  it('renders both +N and -N chips when items added and removed', () => {
    render(
      <FieldDiffRow
        diff={{
          field_name: 'tags',
          old_value: ['a', 'b'],
          new_value: ['b', 'c', 'd'],
        }}
      />,
    );
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('−1')).toBeInTheDocument();
  });

  it('renders an object diff with "View details" when onViewRaw provided', () => {
    const onViewRaw = vi.fn();
    render(
      <FieldDiffRow
        diff={{
          field_name: 'meta',
          old_value: { a: 1 },
          new_value: { a: 2 },
        }}
        onViewRaw={onViewRaw}
      />,
    );
    expect(screen.getByText('Meta')).toBeInTheDocument();
    expect(screen.getByText('1 field changed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(onViewRaw).toHaveBeenCalledTimes(1);
    expect(onViewRaw).toHaveBeenCalledWith({
      field_name: 'meta',
      old_value: { a: 1 },
      new_value: { a: 2 },
    });
  });

  it('does not render "View details" for an object diff when onViewRaw is not provided', () => {
    render(
      <FieldDiffRow
        diff={{
          field_name: 'meta',
          old_value: { a: 1 },
          new_value: { a: 2 },
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'View details' })).not.toBeInTheDocument();
  });

  it('passes detailOpen state through to ListDiff', () => {
    render(
      <FieldDiffRow
        diff={{
          field_name: 'tags',
          old_value: ['a', 'b', 'c', 'd'],
          new_value: ['e', 'f', 'g', 'h'],
        }}
        detailOpen
        onToggleDetail={vi.fn()}
      />,
    );
    expect(screen.getByText('Hide details')).toBeInTheDocument();
  });
});
