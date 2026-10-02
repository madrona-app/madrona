import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreatorsField } from '../../../../components/collections/ObjectFieldComponents/CreatorsField';

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

function defaults(o: Partial<Parameters<typeof CreatorsField>[0]> = {}) {
  return {
    creators: [],
    isEditing: false,
    onChange: vi.fn(),
    onAdd: vi.fn(),
    onSave: vi.fn(),
    ...o,
  };
}

describe('CreatorsField', () => {
  it('renders nothing in view mode when empty', () => {
    const { container } = render(<CreatorsField {...defaults()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders creators in view mode', () => {
    render(
      <CreatorsField
        {...defaults({
          creators: [
            { name: 'Vincent van Gogh', role: 'painter', role_qualifier: null, ulan_id: '500115588', authority_id: null },
          ],
        })}
      />,
    );
    expect(screen.getByText('Vincent van Gogh')).toBeInTheDocument();
    expect(screen.getByText('(painter)')).toBeInTheDocument();
  });

  it('renders ULAN link for ULAN-backed creators', () => {
    const { container } = render(
      <CreatorsField
        {...defaults({
          creators: [
            { name: 'Vincent', role: null, role_qualifier: null, ulan_id: '500115588', authority_id: null },
          ],
        })}
      />,
    );
    const ulanLink = container.querySelector('a[href*="ulan"]');
    expect(ulanLink).not.toBeNull();
  });

  it('shows the empty creator state in edit mode', () => {
    render(<CreatorsField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('No creators added yet')).toBeInTheDocument();
  });

  it('Add creator button calls onAdd', () => {
    const onAdd = vi.fn();
    render(<CreatorsField {...defaults({ isEditing: true, onAdd })} />);
    fireEvent.click(screen.getAllByText(/Add creator/)[0]);
    expect(onAdd).toHaveBeenCalled();
  });

  it('renders a "Linked to Getty ULAN" indicator for ULAN-linked creators', () => {
    render(
      <CreatorsField
        {...defaults({
          isEditing: true,
          creators: [
            { name: 'V', role: null, role_qualifier: null, ulan_id: '12345', authority_id: null },
          ],
        })}
      />,
    );
    expect(screen.getByText('Linked to Getty ULAN')).toBeInTheDocument();
  });

  it('removing a creator updates the list', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const { container } = render(
      <CreatorsField
        {...defaults({
          isEditing: true,
          creators: [
            { name: 'A', role: null, role_qualifier: null, ulan_id: null, authority_id: null },
            { name: 'B', role: null, role_qualifier: null, ulan_id: null, authority_id: null },
          ],
          onChange,
          onSave,
        })}
      />,
    );
    const removeButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => !b.textContent?.includes('Add creator'),
    );
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalled();
    expect((onChange.mock.calls[0][0] as Array<{ name: string }>)[0].name).toBe('B');
  });

  it('changing the role select fires onChange and onSave', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(
      <CreatorsField
        {...defaults({
          isEditing: true,
          creators: [
            { name: 'X', role: null, role_qualifier: null, ulan_id: null, authority_id: null },
          ],
          onChange,
          onSave,
        })}
      />,
    );
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'painter' } });
    expect(onChange).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalled();
  });
});
