import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubjectsField } from '../../../../components/collections/ObjectFieldComponents/SubjectsField';

vi.mock(
  '../../../../components/collections/AuthorityAutocomplete',
  () => ({
    AuthorityAutocomplete: (props: {
      value: { value: string } | null;
      onChange: (v: { value: string; subjectType?: string } | null) => void;
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

function defaults(o: Partial<Parameters<typeof SubjectsField>[0]> = {}) {
  return {
    subjects: [],
    isEditing: false,
    onChange: vi.fn(),
    onAdd: vi.fn(),
    onSave: vi.fn(),
    ...o,
  };
}

describe('SubjectsField', () => {
  it('renders nothing in view mode when empty', () => {
    const { container } = render(<SubjectsField {...defaults()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders subjects as chips in view mode', () => {
    render(
      <SubjectsField
        {...defaults({
          subjects: [{ term: 'landscape', type: 'topic', vocabulary_term_id: null }],
        })}
      />,
    );
    expect(screen.getByText('landscape')).toBeInTheDocument();
    expect(screen.getByText('(topic)')).toBeInTheDocument();
  });

  it('renders Add subject button in edit mode', () => {
    render(<SubjectsField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('Add subject')).toBeInTheDocument();
  });

  it('Add button calls onAdd', () => {
    const onAdd = vi.fn();
    render(<SubjectsField {...defaults({ isEditing: true, onAdd })} />);
    fireEvent.click(screen.getByText('Add subject'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('shows empty-state copy in edit mode', () => {
    render(<SubjectsField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('No subjects added')).toBeInTheDocument();
  });

  it('renders one autocomplete per subject', () => {
    render(
      <SubjectsField
        {...defaults({
          isEditing: true,
          subjects: [
            { term: 'a', type: null, vocabulary_term_id: null },
            { term: 'b', type: null, vocabulary_term_id: null },
          ],
        })}
      />,
    );
    expect(screen.getAllByTestId('authority-autocomplete')).toHaveLength(2);
  });

  it('changing the type select fires onChange + onSave', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(
      <SubjectsField
        {...defaults({
          isEditing: true,
          subjects: [{ term: 'x', type: null, vocabulary_term_id: null }],
          onChange,
          onSave,
        })}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'place' } });
    expect(onChange).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalled();
  });

  it('removing a subject fires onChange with filtered list', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const { container } = render(
      <SubjectsField
        {...defaults({
          isEditing: true,
          subjects: [
            { term: 'a', type: null, vocabulary_term_id: null },
            { term: 'b', type: null, vocabulary_term_id: null },
          ],
          onChange,
          onSave,
        })}
      />,
    );
    const removeButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => !b.textContent?.includes('Add subject'),
    );
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith([
      { term: 'b', type: null, vocabulary_term_id: null },
    ]);
    expect(onSave).toHaveBeenCalled();
  });
});
