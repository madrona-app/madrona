import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditableField, EditableSelect, EditableCheckbox, RestrictedFieldPlaceholder } from '../../components/workspace/EditableField';
import { checkA11y } from '../a11y';

describe('EditableField', () => {
  const defaultProps = {
    value: 'Test Value',
    label: 'Title',
    isEditing: false,
    onChange: vi.fn(),
  };

  describe('view mode', () => {
    it('renders label and value as text', () => {
      render(<EditableField {...defaultProps} />);
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Test Value')).toBeInTheDocument();
    });

    it('renders empty state when value is empty', () => {
      render(<EditableField {...defaultProps} value="" />);
      expect(screen.getByText('Title')).toBeInTheDocument();
      // default emptyText is em-dash
      expect(screen.getByText('\u2014')).toBeInTheDocument();
    });

    it('renders custom empty text', () => {
      render(<EditableField {...defaultProps} value="" emptyText="Not provided" />);
      expect(screen.getByText('Not provided')).toBeInTheDocument();
    });

    it('renders value as badge when badge prop is true', () => {
      render(<EditableField {...defaultProps} badge />);
      const badge = screen.getByText('Test Value');
      expect(badge.tagName).toBe('SPAN');
      expect(badge).toHaveClass('badge');
    });

    it('renders multiline value with whitespace-pre-wrap', () => {
      render(<EditableField {...defaultProps} multiline value={'Line 1\nLine 2'} />);
      const span = screen.getByText((_, el) =>
        el?.tagName === 'SPAN' && el?.classList.contains('whitespace-pre-wrap') || false
      );
      expect(span).toHaveClass('whitespace-pre-wrap');
    });
  });

  describe('edit mode', () => {
    it('renders input when editing', () => {
      render(<EditableField {...defaultProps} isEditing />);
      const input = screen.getByRole('textbox');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue('Test Value');
    });

    it('renders textarea when multiline', () => {
      render(<EditableField {...defaultProps} isEditing multiline />);
      const textarea = screen.getByRole('textbox');
      expect(textarea.tagName).toBe('TEXTAREA');
    });

    it('calls onChange when typing', () => {
      const onChange = vi.fn();
      render(<EditableField {...defaultProps} isEditing onChange={onChange} />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New Value' } });
      expect(onChange).toHaveBeenCalledWith('New Value');
    });

    it('calls onSave on blur', () => {
      const onSave = vi.fn();
      render(<EditableField {...defaultProps} isEditing onSave={onSave} />);
      fireEvent.blur(screen.getByRole('textbox'));
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('renders label associated with input via htmlFor', () => {
      render(<EditableField {...defaultProps} isEditing />);
      const input = screen.getByRole('textbox');
      expect(input.id).toBeTruthy();
      const label = screen.getByText('Title');
      expect(label.closest('label')?.getAttribute('for')).toBe(input.id);
    });

    it('shows required asterisk when required', () => {
      render(<EditableField {...defaultProps} isEditing required />);
      expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('shows help text', () => {
      render(<EditableField {...defaultProps} isEditing helpText="Enter a title" />);
      expect(screen.getByText('Enter a title')).toBeInTheDocument();
    });

    it('renders placeholder', () => {
      render(<EditableField {...defaultProps} isEditing value="" placeholder="Type here..." />);
      expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument();
    });
  });

  describe('save status indicators', () => {
    it('shows "Saving" text when saving', () => {
      render(<EditableField {...defaultProps} isEditing saveStatus="saving" />);
      expect(screen.getByText('Saving')).toBeInTheDocument();
    });

    it('shows "Saved" text when saved', () => {
      render(<EditableField {...defaultProps} isEditing saveStatus="saved" />);
      expect(screen.getByText('Saved')).toBeInTheDocument();
    });

    it('shows error text and sets aria-invalid when error', () => {
      render(<EditableField {...defaultProps} isEditing saveStatus="error" saveError="Network failure" />);
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
      const errorEl = screen.getByRole('alert');
      expect(errorEl).toBeInTheDocument();
    });

    it('does not show status when idle', () => {
      render(<EditableField {...defaultProps} isEditing saveStatus="idle" />);
      expect(screen.queryByText('Saving')).not.toBeInTheDocument();
      expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    });
  });

  describe('restricted mode', () => {
    it('renders restricted placeholder instead of field', () => {
      render(<EditableField {...defaultProps} restricted />);
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Restricted')).toBeInTheDocument();
      expect(screen.queryByText('Test Value')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has no a11y violations in edit mode', async () => {
      const { container } = render(<EditableField {...defaultProps} isEditing />);
      const results = await checkA11y(container);
      expect(results.violations).toEqual([]);
    });
  });
});

describe('EditableSelect', () => {
  const options = [
    { value: 'a', label: 'Option A' },
    { value: 'b', label: 'Option B' },
  ];

  const defaultProps = {
    value: 'a',
    label: 'Category',
    isEditing: false,
    onChange: vi.fn(),
    options,
  };

  it('renders display value in view mode', () => {
    render(<EditableSelect {...defaultProps} />);
    expect(screen.getByText('Option A')).toBeInTheDocument();
  });

  it('renders empty state when value is empty', () => {
    render(<EditableSelect {...defaultProps} value="" />);
    expect(screen.getByText('\u2014')).toBeInTheDocument();
  });

  it('renders select element in edit mode', () => {
    render(<EditableSelect {...defaultProps} isEditing />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('a');
  });

  it('calls onChange and onSave on selection', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(<EditableSelect {...defaultProps} isEditing onChange={onChange} onSave={onSave} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows restricted placeholder when restricted', () => {
    render(<EditableSelect {...defaultProps} restricted />);
    expect(screen.getByText('Restricted')).toBeInTheDocument();
  });
});

describe('EditableCheckbox', () => {
  const defaultProps = {
    value: false,
    label: 'Active',
    isEditing: false,
    onChange: vi.fn(),
  };

  it('renders "No" in view mode when unchecked', () => {
    render(<EditableCheckbox {...defaultProps} />);
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('renders "Yes" badge in view mode when checked', () => {
    render(<EditableCheckbox {...defaultProps} value />);
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });

  it('renders checkbox in edit mode', () => {
    render(<EditableCheckbox {...defaultProps} isEditing />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it('calls onChange and onSave when checkbox is toggled', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(<EditableCheckbox {...defaultProps} isEditing onChange={onChange} onSave={onSave} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows description text in edit mode', () => {
    render(<EditableCheckbox {...defaultProps} isEditing description="Mark as active" />);
    expect(screen.getByText('Mark as active')).toBeInTheDocument();
  });

  it('shows restricted placeholder when restricted', () => {
    render(<EditableCheckbox {...defaultProps} restricted />);
    expect(screen.getByText('Restricted')).toBeInTheDocument();
  });
});

describe('RestrictedFieldPlaceholder', () => {
  it('renders label and restricted text', () => {
    render(<RestrictedFieldPlaceholder label="Secret Field" />);
    expect(screen.getByText('Secret Field')).toBeInTheDocument();
    expect(screen.getByText('Restricted')).toBeInTheDocument();
  });
});
