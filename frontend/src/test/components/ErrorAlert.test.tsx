import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ApiError } from '../../lib/api';

// Mock the api module
vi.mock('../../lib/api', () => ({
  getFriendlyErrorMessage: vi.fn((error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    }
    return 'An unexpected error occurred';
  }),
  ApiError: class MockApiError extends Error {
    status: number;
    statusText: string;
    constructor(status: number, statusText: string, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.statusText = statusText;
    }
  },
}));

// Get the mocked ApiError class
const MockApiError = ApiError;

describe('ErrorAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic rendering', () => {
    it('renders error message', () => {
      render(<ErrorAlert error={new Error('Test error message')} />);
      expect(screen.getByText('Test error message')).toBeInTheDocument();
    });

    it('renders error heading', () => {
      render(<ErrorAlert error={new Error('Test')} />);
      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('has alert role', () => {
      render(<ErrorAlert error={new Error('Test')} />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('renders error icon', () => {
      const { container } = render(<ErrorAlert error={new Error('Test')} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('ApiError handling', () => {
    it('shows status code for ApiError', () => {
      const error = new MockApiError(404, 'Not Found', 'Resource not found');
      render(<ErrorAlert error={error} />);
      expect(screen.getByText('Error (404)')).toBeInTheDocument();
    });

    it('shows status 500 in heading', () => {
      const error = new MockApiError(500, 'Server Error', 'Internal server error');
      render(<ErrorAlert error={error} />);
      expect(screen.getByText('Error (500)')).toBeInTheDocument();
    });

    it('shows generic heading for status 0', () => {
      const error = new MockApiError(0, '', 'Network error');
      render(<ErrorAlert error={error} />);
      expect(screen.getByText('Error')).toBeInTheDocument();
    });
  });

  describe('retry functionality', () => {
    it('shows retry button when onRetry provided', () => {
      const onRetry = vi.fn();
      render(<ErrorAlert error={new Error('Test')} onRetry={onRetry} />);
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    it('calls onRetry when retry button clicked', () => {
      const onRetry = vi.fn();
      render(<ErrorAlert error={new Error('Test')} onRetry={onRetry} />);

      fireEvent.click(screen.getByText('Try Again'));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows retry button for 500+ status errors', () => {
      const error = new MockApiError(503, 'Service Unavailable', 'Server error');
      render(<ErrorAlert error={error} />);
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    it('hides retry button for 4xx errors without onRetry', () => {
      const error = new MockApiError(404, 'Not Found', 'Resource not found');
      render(<ErrorAlert error={error} />);
      expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
    });
  });

  describe('custom className', () => {
    it('applies custom className', () => {
      const { container } = render(<ErrorAlert error={new Error('Test')} className="custom-class" />);
      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('preserves default classes', () => {
      const { container } = render(<ErrorAlert error={new Error('Test')} className="custom-class" />);
      expect(container.firstChild).toHaveClass('bg-semantic-error/10');
      expect(container.firstChild).toHaveClass('border');
    });
  });

  describe('non-Error objects', () => {
    it('handles plain string error', () => {
      render(<ErrorAlert error="Something went wrong" />);
      expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
    });

    it('handles null error', () => {
      render(<ErrorAlert error={null} />);
      expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
    });

    it('handles undefined error', () => {
      render(<ErrorAlert error={undefined} />);
      expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('has red background', () => {
      const { container } = render(<ErrorAlert error={new Error('Test')} />);
      expect(container.firstChild).toHaveClass('bg-semantic-error/10');
    });

    it('has red border', () => {
      const { container } = render(<ErrorAlert error={new Error('Test')} />);
      expect(container.firstChild).toHaveClass('border-semantic-error/30');
    });

    it('has rounded corners', () => {
      const { container } = render(<ErrorAlert error={new Error('Test')} />);
      expect(container.firstChild).toHaveClass('rounded-md');
    });
  });
});
