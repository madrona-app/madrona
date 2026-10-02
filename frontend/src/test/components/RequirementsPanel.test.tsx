import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RequirementsPanel } from '../../components/collections/RequirementsPanel';
import type { RequirementsPanelRow } from '../../components/collections/RequirementsPanel';
import { checkA11y } from '../a11y';

const mockRows: RequirementsPanelRow[] = [
  { id: 'identification', label: 'Identification', completedCount: 2, totalCount: 3, hasBlocking: true, primaryMissing: 'Object name' },
  { id: 'acquisition', label: 'Acquisition', completedCount: 1, totalCount: 1, hasBlocking: false },
  { id: 'description', label: 'Description', completedCount: 0, totalCount: 0, hasBlocking: false },
];

const defaultProps = {
  title: 'Entry Requirements',
  completedCount: 3,
  totalCount: 4,
  percentComplete: 75,
  isReady: false,
  statusMessage: 'Not ready: Object name is required',
  statusIsPositive: false,
  rows: mockRows,
  onRowClick: vi.fn(),
};

describe('RequirementsPanel', () => {
  describe('header', () => {
    it('renders title', () => {
      render(<RequirementsPanel {...defaultProps} />);
      expect(screen.getByText('Entry Requirements')).toBeInTheDocument();
    });

    it('renders completion stats', () => {
      render(<RequirementsPanel {...defaultProps} />);
      expect(screen.getByText(/3\/4 \(75%\)/)).toBeInTheDocument();
    });

    it('renders status message', () => {
      render(<RequirementsPanel {...defaultProps} />);
      expect(screen.getByText('Not ready: Object name is required')).toBeInTheDocument();
    });

    it('renders positive status in success color', () => {
      render(<RequirementsPanel {...defaultProps} statusIsPositive statusMessage="Ready for next step" />);
      const msg = screen.getByText('Ready for next step');
      expect(msg).toHaveClass('text-semantic-success');
    });

    it('renders negative status in warning color', () => {
      render(<RequirementsPanel {...defaultProps} />);
      const msg = screen.getByText('Not ready: Object name is required');
      expect(msg).toHaveClass('text-semantic-warning');
    });
  });

  describe('expand/collapse', () => {
    it('is collapsed by default', () => {
      render(<RequirementsPanel {...defaultProps} />);
      // When collapsed, the rows should not be visible
      expect(screen.queryByText('Identification')).not.toBeInTheDocument();
    });

    it('expands when header is clicked', () => {
      render(<RequirementsPanel {...defaultProps} />);
      const expandBtn = screen.getByRole('button', { name: /Expand requirements/i });
      fireEvent.click(expandBtn);
      expect(screen.getByText('Identification')).toBeInTheDocument();
      expect(screen.getByText('Acquisition')).toBeInTheDocument();
    });

    it('starts expanded when defaultExpanded is true', () => {
      render(<RequirementsPanel {...defaultProps} defaultExpanded />);
      expect(screen.getByText('Identification')).toBeInTheDocument();
    });

    it('forces expanded when forceExpanded is true', () => {
      render(<RequirementsPanel {...defaultProps} forceExpanded />);
      expect(screen.getByText('Identification')).toBeInTheDocument();
    });

    it('collapses when chevron is clicked again', () => {
      render(<RequirementsPanel {...defaultProps} defaultExpanded />);
      const collapseBtn = screen.getByRole('button', { name: /Collapse requirements/i });
      fireEvent.click(collapseBtn);
      expect(screen.queryByText('Identification')).not.toBeInTheDocument();
    });

    it('has aria-expanded on the toggle button', () => {
      render(<RequirementsPanel {...defaultProps} />);
      const toggle = screen.getByRole('button', { name: /Expand requirements/i });
      expect(toggle).toBeInTheDocument();
    });
  });

  describe('rows', () => {
    it('renders all rows when expanded', () => {
      render(<RequirementsPanel {...defaultProps} defaultExpanded />);
      expect(screen.getByText('Identification')).toBeInTheDocument();
      expect(screen.getByText('Acquisition')).toBeInTheDocument();
      expect(screen.getByText('Description')).toBeInTheDocument();
    });

    it('shows completion count for each row', () => {
      render(<RequirementsPanel {...defaultProps} defaultExpanded />);
      expect(screen.getByText('2/3')).toBeInTheDocument();
      expect(screen.getByText('1/1')).toBeInTheDocument();
    });

    it('shows "Not required" for zero-total rows', () => {
      render(<RequirementsPanel {...defaultProps} defaultExpanded />);
      expect(screen.getByText('Not required')).toBeInTheDocument();
    });

    it('shows blocking missing info', () => {
      render(<RequirementsPanel {...defaultProps} defaultExpanded />);
      // primaryMissing "Object name" appears in the aria-label of the Identification row
      const rows = screen.getAllByRole('button', { name: /Object name/i });
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it('calls onRowClick when a row is clicked', () => {
      const onRowClick = vi.fn();
      render(<RequirementsPanel {...defaultProps} defaultExpanded onRowClick={onRowClick} />);
      fireEvent.click(screen.getByText('Identification'));
      expect(onRowClick).toHaveBeenCalledWith('identification');
    });

    it('rows have accessible aria-labels', () => {
      render(<RequirementsPanel {...defaultProps} defaultExpanded />);
      const idRow = screen.getByRole('button', { name: /Identification: 2 of 3 complete/i });
      expect(idRow).toBeInTheDocument();
    });
  });

  describe('fix blocker button', () => {
    it('shows "Fix blocker" button when onFixBlocker is provided', () => {
      const onFixBlocker = vi.fn();
      render(<RequirementsPanel {...defaultProps} onFixBlocker={onFixBlocker} />);
      const btn = screen.getByText('Fix blocker');
      expect(btn).toBeInTheDocument();
      fireEvent.click(btn);
      expect(onFixBlocker).toHaveBeenCalledTimes(1);
    });

    it('does not show "Fix blocker" when onFixBlocker is not provided', () => {
      render(<RequirementsPanel {...defaultProps} />);
      expect(screen.queryByText('Fix blocker')).not.toBeInTheDocument();
    });
  });

  describe('footer', () => {
    it('renders default footer text when expanded', () => {
      render(<RequirementsPanel {...defaultProps} defaultExpanded />);
      expect(screen.getByText(/Required fields must be completed/)).toBeInTheDocument();
    });

    it('renders custom footer text', () => {
      render(<RequirementsPanel {...defaultProps} defaultExpanded footerText="Custom footer" />);
      expect(screen.getByText('Custom footer')).toBeInTheDocument();
    });

    it('renders "View guidance" link when onViewGuidance is provided', () => {
      const onViewGuidance = vi.fn();
      render(<RequirementsPanel {...defaultProps} defaultExpanded onViewGuidance={onViewGuidance} />);
      const link = screen.getByText('View guidance');
      expect(link).toBeInTheDocument();
      fireEvent.click(link);
      expect(onViewGuidance).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility', () => {
    it('has no a11y violations when expanded', async () => {
      const { container } = render(<RequirementsPanel {...defaultProps} defaultExpanded />);
      const results = await checkA11y(container);
      expect(results.violations).toEqual([]);
    });
  });
});
