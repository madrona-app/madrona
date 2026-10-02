import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceSection, SectionEmptyState } from '../../components/workspace/WorkspaceSection';

// Mock the ActiveSectionContext — WorkspaceSection uses it optionally
vi.mock('../../components/record-detail/ActiveSectionContext', () => ({
  useActiveSection: () => ({
    activeSection: null,
    setActiveSection: vi.fn(),
  }),
}));

// Mock logger
vi.mock('../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('WorkspaceSection', () => {
  const defaultProps = {
    id: 'description',
    title: 'Description',
    isExpanded: false,
    onToggle: vi.fn(),
    children: <div>Section content</div>,
  };

  describe('collapsed state', () => {
    it('renders title when collapsed', () => {
      render(<WorkspaceSection {...defaultProps} />);
      expect(screen.getByText('Description')).toBeInTheDocument();
    });

    it('does not render children when collapsed', () => {
      render(<WorkspaceSection {...defaultProps} />);
      expect(screen.queryByText('Section content')).not.toBeInTheDocument();
    });

    it('calls onToggle when collapsed card is clicked', () => {
      const onToggle = vi.fn();
      render(<WorkspaceSection {...defaultProps} onToggle={onToggle} />);
      fireEvent.click(screen.getByText('Description'));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('renders badge when provided', () => {
      render(<WorkspaceSection {...defaultProps} badge="3" />);
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('renders hint text when collapsed', () => {
      render(<WorkspaceSection {...defaultProps} hint="Oil on canvas, 1895" />);
      expect(screen.getByText('Oil on canvas, 1895')).toBeInTheDocument();
    });

    it('shows unsaved changes indicator', () => {
      render(<WorkspaceSection {...defaultProps} hasChanges />);
      expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument();
    });

    it('has aria-expanded=false on collapsed button', () => {
      render(<WorkspaceSection {...defaultProps} />);
      const button = screen.getByRole('button', { name: /Description/i });
      expect(button).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('expanded state', () => {
    it('renders children when expanded', () => {
      render(<WorkspaceSection {...defaultProps} isExpanded />);
      expect(screen.getByText('Section content')).toBeInTheDocument();
    });

    it('has aria-expanded=true when expanded', () => {
      render(<WorkspaceSection {...defaultProps} isExpanded />);
      const button = screen.getByRole('button', { expanded: true });
      expect(button).toBeInTheDocument();
    });

    it('calls onToggle when expanded header is clicked', () => {
      const onToggle = vi.fn();
      render(<WorkspaceSection {...defaultProps} isExpanded onToggle={onToggle} />);
      // The expanded header has a close button
      const buttons = screen.getAllByRole('button');
      fireEvent.click(buttons[0]); // header button
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('renders content area as clickable with role=button in view mode', () => {
      const onEdit = vi.fn();
      render(<WorkspaceSection {...defaultProps} isExpanded onEdit={onEdit} />);
      // In view mode, the content area has role="button" for click-to-edit
      const contentArea = screen.getByRole('button', { name: /Press Enter or Space to edit/i });
      expect(contentArea).toBeInTheDocument();
      expect(contentArea).toHaveAttribute('tabIndex', '0');
    });

    it('does not call onEdit when content is clicked in edit mode', () => {
      const onEdit = vi.fn();
      render(<WorkspaceSection {...defaultProps} isExpanded isEditing onEdit={onEdit} />);
      fireEvent.click(screen.getByText('Section content'));
      expect(onEdit).not.toHaveBeenCalled();
    });
  });

  describe('compact empty state', () => {
    it('renders compact button with "+ Add" when empty and collapsed', () => {
      render(<WorkspaceSection {...defaultProps} isEmpty />);
      expect(screen.getByText('+ Add')).toBeInTheDocument();
    });

    it('does not render compact state when expanded', () => {
      render(<WorkspaceSection {...defaultProps} isEmpty isExpanded />);
      expect(screen.queryByText('+ Add')).not.toBeInTheDocument();
      expect(screen.getByText('Section content')).toBeInTheDocument();
    });
  });

  describe('section element', () => {
    it('has correct section id', () => {
      const { container } = render(<WorkspaceSection {...defaultProps} />);
      expect(container.querySelector('#section-description')).toBeInTheDocument();
    });

    it('applies CSS order style', () => {
      const { container } = render(<WorkspaceSection {...defaultProps} />);
      const section = container.querySelector('section');
      expect(section).toBeInTheDocument();
    });
  });
});

describe('SectionEmptyState', () => {
  it('renders message', () => {
    render(<SectionEmptyState message="No items yet" isEditing={false} />);
    expect(screen.getByText('No items yet')).toBeInTheDocument();
  });

  it('does not render action button in view mode', () => {
    render(
      <SectionEmptyState
        message="No items"
        actionText="Add item"
        onAction={vi.fn()}
        isEditing={false}
      />
    );
    expect(screen.queryByText('Add item')).not.toBeInTheDocument();
  });

  it('renders action button in edit mode', () => {
    const onAction = vi.fn();
    render(
      <SectionEmptyState
        message="No items"
        actionText="Add item"
        onAction={onAction}
        isEditing
      />
    );
    const button = screen.getByText('Add item');
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
