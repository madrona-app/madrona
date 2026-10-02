import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MaterialsField } from '../../../../components/collections/ObjectFieldComponents/MaterialsField';

vi.mock(
  '../../../../components/collections/AuthorityAutocomplete',
  () => ({
    AuthorityAutocomplete: (props: {
      value: { value: string } | null;
      onChange: (v: { value: string } | null) => void;
      placeholder?: string;
    }) => (
      <input
        data-testid="authority-autocomplete"
        value={props.value?.value || ''}
        onChange={(e) => props.onChange({ value: e.target.value })}
        placeholder={props.placeholder}
      />
    ),
  }),
);

function defaults(o: Partial<Parameters<typeof MaterialsField>[0]> = {}) {
  return {
    materials: [],
    isEditing: false,
    onChange: vi.fn(),
    onAdd: vi.fn(),
    onSave: vi.fn(),
    ...o,
  };
}

describe('MaterialsField', () => {
  it('renders nothing in view mode when empty', () => {
    const { container } = render(<MaterialsField {...defaults()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders materials joined with commas in view mode', () => {
    render(
      <MaterialsField
        {...defaults({
          materials: [
            { name: 'oil paint', part: 'surface', vocabulary_term_id: null },
            { name: 'canvas', part: null, vocabulary_term_id: null },
          ],
        })}
      />,
    );
    expect(screen.getByText(/oil paint/)).toBeInTheDocument();
    expect(screen.getByText(/canvas/)).toBeInTheDocument();
    expect(screen.getByText(/\(surface\)/)).toBeInTheDocument();
  });

  it('renders the heading in view mode when items present', () => {
    render(
      <MaterialsField
        {...defaults({ materials: [{ name: 'a', part: null, vocabulary_term_id: null }] })}
      />,
    );
    expect(screen.getByText('Materials')).toBeInTheDocument();
  });

  it('renders Add material button in edit mode', () => {
    render(<MaterialsField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('Add material')).toBeInTheDocument();
  });

  it('Add button calls onAdd', () => {
    const onAdd = vi.fn();
    render(<MaterialsField {...defaults({ isEditing: true, onAdd })} />);
    fireEvent.click(screen.getByText('Add material'));
    expect(onAdd).toHaveBeenCalled();
  });

  it('shows empty-state copy in edit mode', () => {
    render(<MaterialsField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('No materials added')).toBeInTheDocument();
  });

  it('renders one autocomplete per material', () => {
    render(
      <MaterialsField
        {...defaults({
          isEditing: true,
          materials: [
            { name: 'a', part: null, vocabulary_term_id: null },
            { name: 'b', part: null, vocabulary_term_id: null },
          ],
        })}
      />,
    );
    expect(screen.getAllByTestId('authority-autocomplete')).toHaveLength(2);
  });

  it('typing into the part input fires onChange', () => {
    const onChange = vi.fn();
    render(
      <MaterialsField
        {...defaults({
          isEditing: true,
          materials: [{ name: 'oil', part: '', vocabulary_term_id: null }],
          onChange,
        })}
      />,
    );
    const partInput = screen.getByPlaceholderText('Part (optional)');
    fireEvent.change(partInput, { target: { value: 'top' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('removing a material updates list', () => {
    const onChange = vi.fn();
    const { container } = render(
      <MaterialsField
        {...defaults({
          isEditing: true,
          materials: [
            { name: 'a', part: null, vocabulary_term_id: null },
            { name: 'b', part: null, vocabulary_term_id: null },
          ],
          onChange,
        })}
      />,
    );
    const removeButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => !b.textContent?.includes('Add material'),
    );
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith([
      { name: 'b', part: null, vocabulary_term_id: null },
    ]);
  });
});
