import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InscriptionsField } from '../../../../components/collections/ObjectFieldComponents/InscriptionsField';

function defaults(overrides: Partial<Parameters<typeof InscriptionsField>[0]> = {}) {
  return {
    inscriptions: [],
    isEditing: false,
    onChange: vi.fn(),
    onAdd: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

describe('InscriptionsField', () => {
  it('renders nothing in view mode when there are no inscriptions', () => {
    const { container } = render(<InscriptionsField {...defaults()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders inscription text wrapped in quotes in view mode', () => {
    render(<InscriptionsField {...defaults({ inscriptions: ['Made in Italy', 'Verso: 1898'] })} />);
    expect(screen.getByText(/Made in Italy/)).toBeInTheDocument();
    expect(screen.getByText(/Verso: 1898/)).toBeInTheDocument();
  });

  it('renders the label and Add button in edit mode', () => {
    render(<InscriptionsField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('Inscriptions')).toBeInTheDocument();
    expect(screen.getByText('Add inscription')).toBeInTheDocument();
  });

  it('shows empty-state hint in edit mode when there are no inscriptions', () => {
    render(<InscriptionsField {...defaults({ isEditing: true })} />);
    expect(screen.getByText('No inscriptions recorded')).toBeInTheDocument();
  });

  it('Add button calls onAdd', () => {
    const onAdd = vi.fn();
    render(<InscriptionsField {...defaults({ isEditing: true, onAdd })} />);
    fireEvent.click(screen.getByText('Add inscription'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('renders one textarea per inscription in edit mode', () => {
    const props = defaults({ isEditing: true, inscriptions: ['a', 'b', 'c'] });
    const { container } = render(<InscriptionsField {...props} />);
    expect(container.querySelectorAll('textarea').length).toBe(3);
  });

  it('typing into a textarea calls onChange with the updated array', () => {
    const onChange = vi.fn();
    render(
      <InscriptionsField
        {...defaults({ isEditing: true, inscriptions: ['old'], onChange })}
      />,
    );
    const ta = screen.getByDisplayValue('old');
    fireEvent.change(ta, { target: { value: 'new' } });
    expect(onChange).toHaveBeenCalledWith(['new']);
  });

  it('blurring a textarea triggers onSave', () => {
    const onSave = vi.fn();
    render(
      <InscriptionsField
        {...defaults({ isEditing: true, inscriptions: ['x'], onSave })}
      />,
    );
    fireEvent.blur(screen.getByDisplayValue('x'));
    expect(onSave).toHaveBeenCalled();
  });

  it('removing an inscription calls onChange and onSave', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const { container } = render(
      <InscriptionsField
        {...defaults({ isEditing: true, inscriptions: ['a', 'b'], onChange, onSave })}
      />,
    );
    const removeButtons = container.querySelectorAll('button');
    // First button is "Add inscription", subsequent are remove buttons
    fireEvent.click(removeButtons[1]);
    expect(onChange).toHaveBeenCalledWith(['b']);
    expect(onSave).toHaveBeenCalled();
  });
});
