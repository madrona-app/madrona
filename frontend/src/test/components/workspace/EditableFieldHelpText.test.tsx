/**
 * Help text on workspace fields is announced with the control: it is linked
 * by aria-describedby, alongside any error message.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { checkA11y } from '../../a11y';
import { EditableField, EditableSelect, EditableCheckbox } from '../../../components/workspace/EditableField';

const noop = () => {};

describe('field help text', () => {
  it('describes an input with its help text', async () => {
    const { container } = render(
      <EditableField label="Materials Used" value="" isEditing onChange={noop} helpText="One material per line." />,
    );
    expect(screen.getByRole('textbox', { name: 'Materials Used' })).toHaveAccessibleDescription('One material per line.');
    expect(await checkA11y(container)).toHaveNoViolations();
  });

  it('describes a textarea with its help text and its error together', () => {
    render(
      <EditableField
        label="Materials Used"
        value=""
        isEditing
        multiline
        onChange={noop}
        helpText="One material per line."
        saveStatus="error"
        saveError="Could not save"
      />,
    );
    const box = screen.getByRole('textbox', { name: /Materials Used/ });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('Error: Could not save One material per line.');
  });

  it('describes a select with its help text, with and without an error', () => {
    const options = [{ value: 'gift', label: 'Gift' }];
    const { rerender } = render(
      <EditableSelect label="Method" value="" isEditing onChange={noop} options={options} helpText="How it was acquired." />,
    );
    expect(screen.getByRole('combobox', { name: 'Method' })).toHaveAccessibleDescription('How it was acquired.');
    rerender(
      <EditableSelect
        label="Method"
        value=""
        isEditing
        onChange={noop}
        options={options}
        helpText="How it was acquired."
        saveStatus="error"
      />,
    );
    expect(screen.getByRole('combobox', { name: /Method/ })).toHaveAccessibleDescription('Error How it was acquired.');
  });

  it('describes a checkbox with its description', () => {
    render(<EditableCheckbox label="Verified" value={false} isEditing onChange={noop} description="Provenance checked." />);
    expect(screen.getByRole('checkbox', { name: 'Verified' })).toHaveAccessibleDescription('Provenance checked.');
  });

  it('adds no description when there is no help text', () => {
    render(<EditableField label="Title" value="" isEditing onChange={noop} />);
    expect(screen.getByRole('textbox', { name: 'Title' })).not.toHaveAttribute('aria-describedby');
  });
});
