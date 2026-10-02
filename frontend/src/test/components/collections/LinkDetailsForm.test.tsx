import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LinkDetailsForm } from '../../../components/collections/ObjectAuthoritiesManager/LinkDetailsForm';

function defaults(overrides: Partial<Parameters<typeof LinkDetailsForm>[0]> = {}) {
  return {
    role: 'creator',
    onRoleChange: vi.fn(),
    roleQualifier: '',
    onRoleQualifierChange: vi.fn(),
    certainty: '',
    onCertaintyChange: vi.fn(),
    displayNameOverride: '',
    onDisplayNameOverrideChange: vi.fn(),
    notes: '',
    onNotesChange: vi.fn(),
    ...overrides,
  };
}

describe('LinkDetailsForm', () => {
  it('renders the role select with all options', () => {
    render(<LinkDetailsForm {...defaults()} />);
    expect(screen.getByText('Creator')).toBeInTheDocument();
    expect(screen.getByText('Donor')).toBeInTheDocument();
    expect(screen.getByText('Depicted')).toBeInTheDocument();
  });

  it('shows Attribution Qualifier when role is creator', () => {
    render(<LinkDetailsForm {...defaults({ role: 'creator' })} />);
    expect(screen.getByText('Attribution Qualifier')).toBeInTheDocument();
  });

  it('hides Attribution Qualifier when role is not creator', () => {
    render(<LinkDetailsForm {...defaults({ role: 'donor' })} />);
    expect(screen.queryByText('Attribution Qualifier')).toBeNull();
  });

  it('shows Attribution Certainty when role is creator', () => {
    render(<LinkDetailsForm {...defaults({ role: 'creator' })} />);
    expect(screen.getByText('Attribution Certainty')).toBeInTheDocument();
  });

  it('changing role triggers onRoleChange', () => {
    const onRoleChange = vi.fn();
    render(<LinkDetailsForm {...defaults({ onRoleChange })} />);
    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'donor' } });
    expect(onRoleChange).toHaveBeenCalledWith('donor');
  });

  it('typing in qualifier triggers onRoleQualifierChange', () => {
    const onChange = vi.fn();
    render(<LinkDetailsForm {...defaults({ onRoleQualifierChange: onChange })} />);
    const input = screen.getByPlaceholderText(/attributed to/);
    fireEvent.change(input, { target: { value: 'after' } });
    expect(onChange).toHaveBeenCalledWith('after');
  });

  it('typing in display name override triggers onDisplayNameOverrideChange', () => {
    const onChange = vi.fn();
    render(<LinkDetailsForm {...defaults({ onDisplayNameOverrideChange: onChange })} />);
    const input = screen.getByPlaceholderText(/Override authority name/);
    fireEvent.change(input, { target: { value: 'Custom' } });
    expect(onChange).toHaveBeenCalledWith('Custom');
  });

  it('typing in notes triggers onNotesChange', () => {
    const onChange = vi.fn();
    const { container } = render(<LinkDetailsForm {...defaults({ onNotesChange: onChange })} />);
    const ta = container.querySelector('textarea');
    expect(ta).not.toBeNull();
    fireEvent.change(ta!, { target: { value: 'A note' } });
    expect(onChange).toHaveBeenCalledWith('A note');
  });

  it('uses idPrefix to namespace datalist id', () => {
    const { container } = render(<LinkDetailsForm {...defaults({ idPrefix: 'edit-' })} />);
    expect(container.querySelector('#edit-qualifier-suggestions')).not.toBeNull();
  });

  it('renders certainty options including "Not specified"', () => {
    render(<LinkDetailsForm {...defaults()} />);
    expect(screen.getByText('Not specified')).toBeInTheDocument();
    expect(screen.getByText('Certain')).toBeInTheDocument();
    expect(screen.getByText('Probable')).toBeInTheDocument();
    expect(screen.getByText('Possible')).toBeInTheDocument();
  });
});
