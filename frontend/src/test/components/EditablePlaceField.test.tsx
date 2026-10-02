import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditablePlaceField } from '../../components/workspace/EditablePlaceField';

// Mock AuthorityAutocomplete since it has complex internal state
vi.mock('../../components/collections/AuthorityAutocomplete', () => ({
  AuthorityAutocomplete: ({ placeholder, onChange }: {
    placeholder?: string;
    onChange: (val: unknown) => void;
    fieldType: string;
    value: unknown;
    showVerifiedBadge: boolean;
  }) => (
    <input
      placeholder={placeholder}
      data-testid="authority-autocomplete"
      onChange={(e) => {
        // Simulate selecting a TGN result
        onChange({
          value: e.target.value,
          authorities: [{ source: 'TGN', uri: `http://vocab.getty.edu/tgn/7008038` }],
        });
      }}
    />
  ),
}));

describe('EditablePlaceField', () => {
  const defaultProps = {
    label: 'Place of Origin',
    value: '',
    isEditing: false,
    onChange: vi.fn(),
  };

  describe('view mode', () => {
    it('renders "Not specified" when value is empty', () => {
      render(<EditablePlaceField {...defaultProps} />);
      expect(screen.getByText('Place of Origin')).toBeInTheDocument();
      expect(screen.getByText('Not specified')).toBeInTheDocument();
    });

    it('renders place name when value is present', () => {
      render(<EditablePlaceField {...defaultProps} value="Florence" />);
      expect(screen.getByText('Florence')).toBeInTheDocument();
    });

    it('renders Getty TGN link when tgnId is present', () => {
      render(<EditablePlaceField {...defaultProps} value="Florence" tgnId="7000457" />);
      const link = screen.getByText('Getty TGN');
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute('href', 'http://vocab.getty.edu/tgn/7000457');
      expect(link.closest('a')).toHaveAttribute('target', '_blank');
    });

    it('does not render Getty TGN link when tgnId is absent', () => {
      render(<EditablePlaceField {...defaultProps} value="Unknown Place" />);
      expect(screen.queryByText('Getty TGN')).not.toBeInTheDocument();
    });
  });

  describe('edit mode — with existing value', () => {
    it('renders current value with Change and Clear buttons', () => {
      render(<EditablePlaceField {...defaultProps} isEditing value="Florence" />);
      expect(screen.getByText('Florence')).toBeInTheDocument();
      expect(screen.getByText('Change')).toBeInTheDocument();
      expect(screen.getByTitle('Clear')).toBeInTheDocument();
    });

    it('shows TGN Linked badge when tgnId is present', () => {
      render(<EditablePlaceField {...defaultProps} isEditing value="Florence" tgnId="7000457" />);
      expect(screen.getByText('TGN Linked')).toBeInTheDocument();
    });

    it('clears value and triggers onChange when Clear is clicked', () => {
      const onChange = vi.fn();
      const onSave = vi.fn();
      render(
        <EditablePlaceField
          {...defaultProps}
          isEditing
          value="Florence"
          tgnId="7000457"
          onChange={onChange}
          onSave={onSave}
        />
      );
      fireEvent.click(screen.getByTitle('Clear'));
      expect(onChange).toHaveBeenCalledWith('', null);
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('shows autocomplete search when Change is clicked', () => {
      render(<EditablePlaceField {...defaultProps} isEditing value="Florence" />);
      fireEvent.click(screen.getByText('Change'));
      expect(screen.getByTestId('authority-autocomplete')).toBeInTheDocument();
    });

    it('shows cancel button with current value when searching', () => {
      render(<EditablePlaceField {...defaultProps} isEditing value="Florence" />);
      fireEvent.click(screen.getByText('Change'));
      expect(screen.getByText(/Cancel \(keep "Florence"\)/)).toBeInTheDocument();
    });
  });

  describe('edit mode — empty value', () => {
    it('renders autocomplete search directly when value is empty', () => {
      render(<EditablePlaceField {...defaultProps} isEditing />);
      expect(screen.getByTestId('authority-autocomplete')).toBeInTheDocument();
    });

    it('renders custom placeholder', () => {
      render(
        <EditablePlaceField
          {...defaultProps}
          isEditing
          placeholder="Find a place..."
        />
      );
      expect(screen.getByPlaceholderText('Find a place...')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('renders label element in view mode', () => {
      render(<EditablePlaceField {...defaultProps} value="Florence" />);
      expect(screen.getByText('Place of Origin')).toBeInTheDocument();
    });

    it('renders label element in edit mode', () => {
      render(<EditablePlaceField {...defaultProps} isEditing />);
      expect(screen.getByText('Place of Origin')).toBeInTheDocument();
    });
  });
});
