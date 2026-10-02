import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  StatusBadge,
  getStatusMessage,
  canExecute,
  canRepublish,
  isFailedStatus,
} from '../../components/StatusBadge';
import type { RunStatus } from '../../lib/schemas';

describe('StatusBadge', () => {
  describe('StatusBadge component', () => {
    const statuses: RunStatus[] = [
      'pending',
      'queued',
      'running',
      'publishing',
      'success',
      'warning',
      'failed',
      'failed_publish',
      'failed_finalize',
      'canceled',
    ];

    it.each(statuses)('renders badge for status: %s', (status) => {
      const { container } = render(<StatusBadge status={status} />);
      // Should render without crashing
      expect(container.querySelector('span')).toBeInTheDocument();
    });

    it('displays correct label for success', () => {
      render(<StatusBadge status="success" />);
      expect(screen.getByText('Success')).toBeInTheDocument();
    });

    it('displays correct label for running', () => {
      render(<StatusBadge status="running" />);
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('displays correct label for failed statuses', () => {
      render(<StatusBadge status="failed" />);
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('displays correct label for pending', () => {
      render(<StatusBadge status="pending" />);
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('displays correct label for canceled', () => {
      render(<StatusBadge status="canceled" />);
      expect(screen.getByText('Canceled')).toBeInTheDocument();
    });

    it('includes friendly message in title attribute', () => {
      render(<StatusBadge status="success" />);
      expect(screen.getByTitle('Run complete')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(<StatusBadge status="success" className="custom-class" />);
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('getStatusMessage', () => {
    it('returns friendly message for success', () => {
      expect(getStatusMessage('success')).toBe('Run complete');
    });

    it('returns friendly message for running', () => {
      expect(getStatusMessage('running')).toBe('Extracting from source');
    });

    it('returns friendly message for failed', () => {
      expect(getStatusMessage('failed')).toBe('Error extracting from source');
    });

    it('returns friendly message for failed_publish', () => {
      expect(getStatusMessage('failed_publish')).toBe('Error publishing to spreadsheet');
    });

    it('returns friendly message for pending', () => {
      expect(getStatusMessage('pending')).toBe('Waiting to start');
    });

    it('returns friendly message for canceled', () => {
      expect(getStatusMessage('canceled')).toBe('Run was canceled');
    });
  });

  describe('canExecute', () => {
    it('returns true for pending', () => {
      expect(canExecute('pending')).toBe(true);
    });

    it('returns true for queued', () => {
      expect(canExecute('queued')).toBe(true);
    });

    it('returns false for running', () => {
      expect(canExecute('running')).toBe(false);
    });

    it('returns false for success', () => {
      expect(canExecute('success')).toBe(false);
    });

    it('returns false for failed', () => {
      expect(canExecute('failed')).toBe(false);
    });
  });

  describe('canRepublish', () => {
    it('returns true for failed_publish', () => {
      expect(canRepublish('failed_publish')).toBe(true);
    });

    it('returns true for publishing', () => {
      expect(canRepublish('publishing')).toBe(true);
    });

    it('returns true for failed_finalize', () => {
      expect(canRepublish('failed_finalize')).toBe(true);
    });

    it('returns false for success', () => {
      expect(canRepublish('success')).toBe(false);
    });

    it('returns false for failed', () => {
      expect(canRepublish('failed')).toBe(false);
    });

    it('returns false for running', () => {
      expect(canRepublish('running')).toBe(false);
    });
  });

  describe('isFailedStatus', () => {
    it('returns true for failed', () => {
      expect(isFailedStatus('failed')).toBe(true);
    });

    it('returns true for failed_publish', () => {
      expect(isFailedStatus('failed_publish')).toBe(true);
    });

    it('returns true for failed_finalize', () => {
      expect(isFailedStatus('failed_finalize')).toBe(true);
    });

    it('returns false for success', () => {
      expect(isFailedStatus('success')).toBe(false);
    });

    it('returns false for running', () => {
      expect(isFailedStatus('running')).toBe(false);
    });

    it('returns false for warning', () => {
      expect(isFailedStatus('warning')).toBe(false);
    });
  });
});
