import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StringListField } from '../../../../components/collections/ObjectFieldComponents/StringListField';

function defaults(o: Partial<Parameters<typeof StringListField>[0]> = {}) {
  return {
    label: 'Tags',
    items: [],
    isEditing: false,
    onChange: vi.fn(),
    onSave: vi.fn(),
    ...o,
  };
}

describe('StringListField', () => {
  it('renders nothing in view mode when items are empty', () => {
    const { container } = render(<StringListField {...defaults()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders items as chips in view mode', () => {
    render(<StringListField {...defaults({ items: ['red', 'blue'] })} />);
    expect(screen.getByText('red')).toBeInTheDocument();
    expect(screen.getByText('blue')).toBeInTheDocument();
  });

  it('renders the label in view mode', () => {
    render(<StringListField {...defaults({ items: ['x'] })} />);
    expect(screen.getByText('Tags')).toBeInTheDocument();
  });

  it('shows the Add button in edit mode', () => {
    render(<StringListField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('Add')).toBeInTheDocument();
  });

  it('Add button appends an empty string to the list', () => {
    const onChange = vi.fn();
    render(<StringListField {...defaults({ isEditing: true, items: ['a'], onChange })} />);
    fireEvent.click(screen.getByText('Add'));
    expect(onChange).toHaveBeenCalledWith(['a', '']);
  });

  it('renders one input per item in edit mode', () => {
    const { container } = render(
      <StringListField {...defaults({ isEditing: true, items: ['a', 'b'] })} />,
    );
    expect(container.querySelectorAll('input').length).toBe(2);
  });

  it('typing in an input triggers onChange', () => {
    const onChange = vi.fn();
    render(
      <StringListField
        {...defaults({ isEditing: true, items: ['hello'], onChange })}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('hello'), { target: { value: 'world' } });
    expect(onChange).toHaveBeenCalledWith(['world']);
  });

  it('blurring an input triggers onSave', () => {
    const onSave = vi.fn();
    render(<StringListField {...defaults({ isEditing: true, items: ['a'], onSave })} />);
    fireEvent.blur(screen.getByDisplayValue('a'));
    expect(onSave).toHaveBeenCalled();
  });

  it('shows custom emptyMessage when provided in edit mode', () => {
    render(
      <StringListField
        {...defaults({ isEditing: true, emptyMessage: 'Nothing here yet' })}
      />,
    );
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('falls back to default empty message based on label', () => {
    render(<StringListField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('No tags added')).toBeInTheDocument();
  });

  it('removing an item calls onChange with the filtered list', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const { container } = render(
      <StringListField
        {...defaults({ isEditing: true, items: ['a', 'b'], onChange, onSave })}
      />,
    );
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[1]); // first "remove" button
    expect(onChange).toHaveBeenCalledWith(['b']);
    expect(onSave).toHaveBeenCalled();
  });

  it('uses custom placeholder', () => {
    render(
      <StringListField
        {...defaults({ isEditing: true, items: [''], placeholder: 'Type something' })}
      />,
    );
    expect(screen.getByPlaceholderText('Type something')).toBeInTheDocument();
  });
});
