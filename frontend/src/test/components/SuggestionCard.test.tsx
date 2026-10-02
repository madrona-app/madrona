import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SuggestionCard } from '../../components/SuggestionCard';
import type { Suggestion } from '../../types/assistance';

// Mock clipboard API
const mockWriteText = vi.fn();
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
});

describe('SuggestionCard', () => {
  const mockOnApply = vi.fn();
  const mockOnDismiss = vi.fn();
  const mockOnCopy = vi.fn();

  const baseSuggestion: Suggestion = {
    id: 'sug-1',
    type: 'summary',
    currentValue: 'Current summary text',
    proposedValue: 'Proposed improved summary text',
    createdAt: new Date('2024-01-15T10:00:00Z'),
    status: 'pending',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic rendering', () => {
    it('renders apply button', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument();
    });

    it('renders copy button', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
    });

    it('renders dismiss button', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });

    it('renders microcopy', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      expect(screen.getByText(/not applied until you approve/i)).toBeInTheDocument();
    });

    it('renders provenance toggle', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      expect(screen.getByRole('button', { name: /provenance/i })).toBeInTheDocument();
    });
  });

  describe('field suggestion (summary type)', () => {
    it('shows current and proposed labels', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      expect(screen.getByText('Current')).toBeInTheDocument();
      expect(screen.getByText('Proposed')).toBeInTheDocument();
    });

    it('shows current value', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      expect(screen.getByText('Current summary text')).toBeInTheDocument();
    });

    it('shows proposed value', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      expect(screen.getByText('Proposed improved summary text')).toBeInTheDocument();
    });

    it('shows None for empty current value', () => {
      const suggestion = { ...baseSuggestion, currentValue: '' };
      render(
        <SuggestionCard
          suggestion={suggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      expect(screen.getByText('None')).toBeInTheDocument();
    });
  });

  describe('list suggestion (subject_terms type)', () => {
    const listSuggestion: Suggestion = {
      id: 'sug-2',
      type: 'subject_terms',
      proposedList: ['Art', 'History', 'Culture'],
      createdAt: new Date('2024-01-15T10:00:00Z'),
      status: 'pending',
    };

    it('shows proposed terms label', () => {
      render(
        <SuggestionCard
          suggestion={listSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      expect(screen.getByText('Proposed terms')).toBeInTheDocument();
    });

    it('shows all proposed terms', () => {
      render(
        <SuggestionCard
          suggestion={listSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      expect(screen.getByText('Art')).toBeInTheDocument();
      expect(screen.getByText('History')).toBeInTheDocument();
      expect(screen.getByText('Culture')).toBeInTheDocument();
    });
  });

  describe('button interactions', () => {
    it('calls onApply when apply clicked', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /apply/i }));
      expect(mockOnApply).toHaveBeenCalledTimes(1);
    });

    it('calls onDismiss when dismiss clicked', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
      expect(mockOnDismiss).toHaveBeenCalledTimes(1);
    });

    it('copies to clipboard and shows confirmation', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
          onCopy={mockOnCopy}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /copy/i }));

      expect(mockWriteText).toHaveBeenCalledWith('Proposed improved summary text');
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });

    it('reverts copy button text after timeout', async () => {
      vi.useRealTimers(); // Use real timers for this test

      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /copy/i }));

      expect(screen.getByText('Copied')).toBeInTheDocument();

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 2100));

      expect(screen.getByText('Copy')).toBeInTheDocument();
    });

    it('calls onCopy callback when provided', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
          onCopy={mockOnCopy}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /copy/i }));
      expect(mockOnCopy).toHaveBeenCalledTimes(1);
    });

    it('copies list items as comma-separated string', () => {
      const listSuggestion: Suggestion = {
        id: 'sug-2',
        type: 'subject_terms',
        proposedList: ['Art', 'History', 'Culture'],
        createdAt: new Date(),
        status: 'pending',
      };
      render(
        <SuggestionCard
          suggestion={listSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /copy/i }));
      expect(mockWriteText).toHaveBeenCalledWith('Art, History, Culture');
    });
  });

  describe('provenance', () => {
    it('hides provenance details by default', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      expect(screen.queryByText(/generated/i)).not.toBeInTheDocument();
    });

    it('shows provenance when toggle clicked', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /provenance/i }));
      expect(screen.getByText(/generated/i)).toBeInTheDocument();
    });

    it('hides provenance when toggle clicked again', () => {
      render(
        <SuggestionCard
          suggestion={baseSuggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      const toggle = screen.getByRole('button', { name: /provenance/i });
      fireEvent.click(toggle); // Open
      fireEvent.click(toggle); // Close
      expect(screen.queryByText(/generated/i)).not.toBeInTheDocument();
    });

    it('shows template name when provided', () => {
      const suggestion = {
        ...baseSuggestion,
        templateName: 'Collection Summary v2',
      };
      render(
        <SuggestionCard
          suggestion={suggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /provenance/i }));
      expect(screen.getByText(/template: collection summary v2/i)).toBeInTheDocument();
    });

    it('shows template version when provided', () => {
      const suggestion = {
        ...baseSuggestion,
        templateVersion: '1.2.3',
      };
      render(
        <SuggestionCard
          suggestion={suggestion}
          onApply={mockOnApply}
          onDismiss={mockOnDismiss}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /provenance/i }));
      expect(screen.getByText(/version: 1.2.3/i)).toBeInTheDocument();
    });
  });
});
