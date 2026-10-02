import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassificationsField } from '../../../../components/collections/ObjectFieldComponents/ClassificationsField';

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

function defaults(o: Partial<Parameters<typeof ClassificationsField>[0]> = {}) {
  return {
    classifications: [],
    isEditing: false,
    onChange: vi.fn(),
    onAdd: vi.fn(),
    onSave: vi.fn(),
    ...o,
  };
}

describe('ClassificationsField', () => {
  it('renders nothing in view mode when empty', () => {
    const { container } = render(<ClassificationsField {...defaults()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders classifications as chips in view mode', () => {
    render(
      <ClassificationsField
        {...defaults({
          classifications: [
            {
              term: 'Painting',
              is_primary: true,
              classification_system: 'Nomenclature',
              vocabulary_term_id: 'urn:1',
              value_key: null,
            },
            {
              term: 'Oil',
              is_primary: false,
              classification_system: 'AAT',
              vocabulary_term_id: 'urn:2',
              value_key: null,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Painting')).toBeInTheDocument();
    expect(screen.getByText('Oil')).toBeInTheDocument();
  });

  it('renders the heading in view mode when items present', () => {
    render(
      <ClassificationsField
        {...defaults({
          classifications: [
            {
              term: 'X',
              is_primary: false,
              classification_system: 'Nomenclature',
              vocabulary_term_id: null,
              value_key: null,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Classifications')).toBeInTheDocument();
  });

  it('renders Add button in edit mode', () => {
    render(<ClassificationsField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('Add classification')).toBeInTheDocument();
  });

  it('Add button calls onAdd', () => {
    const onAdd = vi.fn();
    render(<ClassificationsField {...defaults({ isEditing: true, onAdd })} />);
    fireEvent.click(screen.getByText('Add classification'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('shows empty state in edit mode', () => {
    render(<ClassificationsField {...defaults({ isEditing: true })} />);
    expect(screen.getByText(/No classifications/)).toBeInTheDocument();
  });

  it('renders one autocomplete per classification in edit mode', () => {
    render(
      <ClassificationsField
        {...defaults({
          isEditing: true,
          classifications: [
            {
              term: 'a',
              is_primary: false,
              classification_system: 'Nomenclature',
              vocabulary_term_id: null,
              value_key: null,
            },
            {
              term: 'b',
              is_primary: false,
              classification_system: 'Nomenclature',
              vocabulary_term_id: null,
              value_key: null,
            },
          ],
        })}
      />,
    );
    expect(screen.getAllByTestId('authority-autocomplete')).toHaveLength(2);
  });

  it('removing a classification fires onChange with the filtered list', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const { container } = render(
      <ClassificationsField
        {...defaults({
          isEditing: true,
          classifications: [
            {
              term: 'a',
              is_primary: false,
              classification_system: 'Nomenclature',
              vocabulary_term_id: null,
              value_key: null,
            },
            {
              term: 'b',
              is_primary: false,
              classification_system: 'Nomenclature',
              vocabulary_term_id: null,
              value_key: null,
            },
          ],
          onChange,
          onSave,
        })}
      />,
    );
    const removeButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => !b.textContent?.includes('Add classification'),
    );
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalled();
    expect((onChange.mock.calls[0][0] as Array<{ term: string }>)[0].term).toBe('b');
  });
});
