import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NameListField } from '../../../../components/collections/ObjectFieldComponents/NameListField';

function defaults(o: Partial<Parameters<typeof NameListField>[0]> = {}) {
  return {
    label: 'Authors',
    items: [],
    isEditing: false,
    onChange: vi.fn(),
    onSave: vi.fn(),
    ...o,
  };
}

describe('NameListField', () => {
  it('renders nothing in view mode when items are empty', () => {
    const { container } = render(<NameListField {...defaults()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders simple chips in view mode', () => {
    render(<NameListField {...defaults({ items: [{ name: 'Alice' }, { name: 'Bob' }] })} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders the label in view mode', () => {
    render(<NameListField {...defaults({ items: [{ name: 'X' }] })} />);
    expect(screen.getByText('Authors')).toBeInTheDocument();
  });

  it('renders complex view (border-left) when 2+ secondary fields are present', () => {
    const { container } = render(
      <NameListField
        {...defaults({
          items: [{ name: 'Alice', year: '2020', note: 'first' }],
          secondaryFields: [
            { key: 'year', label: 'Year' },
            { key: 'note', label: 'Note' },
          ],
        })}
      />,
    );
    expect(container.querySelector('.border-l-2')).not.toBeNull();
  });

  it('Add button appends a blank item with all configured keys', () => {
    const onChange = vi.fn();
    render(
      <NameListField
        {...defaults({
          isEditing: true,
          items: [],
          onChange,
          secondaryFields: [{ key: 'role', label: 'Role' }],
        })}
      />,
    );
    fireEvent.click(screen.getByText('Add'));
    expect(onChange).toHaveBeenCalledWith([{ name: '', role: '' }]);
  });

  it('typing the name updates onChange', () => {
    const onChange = vi.fn();
    render(
      <NameListField
        {...defaults({ isEditing: true, items: [{ name: 'old' }], onChange })}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('old'), { target: { value: 'new' } });
    expect(onChange).toHaveBeenCalledWith([{ name: 'new' }]);
  });

  it('blur fires onSave', () => {
    const onSave = vi.fn();
    render(
      <NameListField
        {...defaults({ isEditing: true, items: [{ name: 'a' }], onSave })}
      />,
    );
    fireEvent.blur(screen.getByDisplayValue('a'));
    expect(onSave).toHaveBeenCalled();
  });

  it('removing an item updates the list', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const { container } = render(
      <NameListField
        {...defaults({
          isEditing: true,
          items: [{ name: 'a' }, { name: 'b' }],
          onChange,
          onSave,
        })}
      />,
    );
    const buttons = Array.from(container.querySelectorAll('button')).filter(
      (b) => !b.textContent?.includes('Add'),
    );
    fireEvent.click(buttons[0]);
    expect(onChange).toHaveBeenCalledWith([{ name: 'b' }]);
  });

  it('shows custom emptyMessage', () => {
    render(
      <NameListField {...defaults({ isEditing: true, emptyMessage: 'Nope' })} />,
    );
    expect(screen.getByText('Nope')).toBeInTheDocument();
  });

  it('renders custom nameKey', () => {
    render(
      <NameListField
        {...defaults({
          nameKey: 'title',
          items: [{ title: 'Wow' }],
        })}
      />,
    );
    expect(screen.getByText('Wow')).toBeInTheDocument();
  });
});
