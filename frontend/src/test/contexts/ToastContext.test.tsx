import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../../contexts/ToastContext';

// Test component to access toast context
function ToastConsumer() {
  const toast = useToast();

  return (
    <div>
      <button onClick={() => toast.showToast({ type: 'success', title: 'Success!' })}>
        Show Success
      </button>
      <button onClick={() => toast.showToast({ type: 'error', title: 'Error!', message: 'Details here' })}>
        Show Error
      </button>
      <button onClick={() => toast.showToast({ type: 'warning', title: 'Warning!' })}>
        Show Warning
      </button>
      <button onClick={() => toast.showToast({ type: 'info', title: 'Info!' })}>
        Show Info
      </button>
      <button onClick={() => toast.showToast({ type: 'success', title: 'No auto dismiss', duration: 0 })}>
        Show Persistent
      </button>
      <button onClick={() => toast.dismissAll()}>Dismiss All</button>
    </div>
  );
}

describe('ToastContext', () => {
  describe('useToast hook', () => {
    it('throws error when used outside provider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<ToastConsumer />);
      }).toThrow('useToast must be used within a ToastProvider');

      spy.mockRestore();
    });

    it('returns context when used inside provider', () => {
      render(
        <ToastProvider>
          <ToastConsumer />
        </ToastProvider>
      );

      expect(screen.getByText('Show Success')).toBeInTheDocument();
    });
  });

  describe('showToast', () => {
    it('displays success toast', () => {
      render(
        <ToastProvider>
          <ToastConsumer />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText('Show Success'));

      expect(screen.getByText('Success!')).toBeInTheDocument();
    });

    it('displays error toast with message', () => {
      render(
        <ToastProvider>
          <ToastConsumer />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText('Show Error'));

      expect(screen.getByText('Error!')).toBeInTheDocument();
      expect(screen.getByText('Details here')).toBeInTheDocument();
    });

    it('displays warning toast', () => {
      render(
        <ToastProvider>
          <ToastConsumer />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText('Show Warning'));

      expect(screen.getByText('Warning!')).toBeInTheDocument();
    });

    it('displays info toast', () => {
      render(
        <ToastProvider>
          <ToastConsumer />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText('Show Info'));

      expect(screen.getByText('Info!')).toBeInTheDocument();
    });

    it('returns toast ID', () => {
      let toastId: string | undefined;

      function TestComponent() {
        const toast = useToast();
        return (
          <button
            onClick={() => {
              toastId = toast.showToast({ type: 'success', title: 'Test' });
            }}
          >
            Show
          </button>
        );
      }

      render(
        <ToastProvider>
          <TestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText('Show'));

      expect(toastId).toBeDefined();
      expect(toastId).toMatch(/^toast-/);
    });
  });

  describe('dismissToast', () => {
    it('has dismiss button on toasts', () => {
      render(
        <ToastProvider>
          <ToastConsumer />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText('Show Persistent'));
      expect(screen.getByText('No auto dismiss')).toBeInTheDocument();

      // Dismiss button should be present
      expect(screen.getByLabelText('Dismiss notification: No auto dismiss')).toBeInTheDocument();
    });
  });

  describe('dismissAll', () => {
    it('dismisses all toasts', () => {
      render(
        <ToastProvider>
          <ToastConsumer />
        </ToastProvider>
      );

      // Show multiple toasts
      fireEvent.click(screen.getByText('Show Success'));
      fireEvent.click(screen.getByText('Show Error'));
      fireEvent.click(screen.getByText('Show Warning'));

      expect(screen.getByText('Success!')).toBeInTheDocument();
      expect(screen.getByText('Error!')).toBeInTheDocument();
      expect(screen.getByText('Warning!')).toBeInTheDocument();

      // Dismiss all
      fireEvent.click(screen.getByText('Dismiss All'));

      expect(screen.queryByText('Success!')).not.toBeInTheDocument();
      expect(screen.queryByText('Error!')).not.toBeInTheDocument();
      expect(screen.queryByText('Warning!')).not.toBeInTheDocument();
    });
  });

  describe('toast with action', () => {
    it('renders action button', () => {
      function ActionTestComponent() {
        const toast = useToast();
        return (
          <button
            onClick={() => {
              toast.showToast({
                type: 'info',
                title: 'Action Toast',
                action: { label: 'Undo', onClick: vi.fn() },
                duration: 0,
              });
            }}
          >
            Show Action Toast
          </button>
        );
      }

      render(
        <ToastProvider>
          <ActionTestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText('Show Action Toast'));

      expect(screen.getByText('Action Toast')).toBeInTheDocument();
      expect(screen.getByText('Undo')).toBeInTheDocument();
    });

    it('calls action onClick when clicked', () => {
      const actionFn = vi.fn();

      function ActionTestComponent() {
        const toast = useToast();
        return (
          <button
            onClick={() => {
              toast.showToast({
                type: 'info',
                title: 'Action Toast',
                action: { label: 'Undo', onClick: actionFn },
                duration: 0,
              });
            }}
          >
            Show Action Toast
          </button>
        );
      }

      render(
        <ToastProvider>
          <ActionTestComponent />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText('Show Action Toast'));
      fireEvent.click(screen.getByText('Undo'));

      expect(actionFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility', () => {
    // Non-urgent toasts (success, info) use role="status", which implies
    // aria-live="polite" — they announce at a natural pause without
    // interrupting the screen reader mid-sentence.
    it('success toast uses role="status" (polite announcement)', () => {
      render(
        <ToastProvider>
          <ToastConsumer />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText('Show Success'));

      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    // Urgent toasts (error, warning) use role="alert", which implies
    // aria-live="assertive" — they interrupt to convey importance.
    it('error toast uses role="alert" (assertive announcement)', () => {
      render(
        <ToastProvider>
          <ToastConsumer />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText('Show Error'));

      expect(screen.getByRole('alert')).toHaveTextContent('Error!');
    });

    // Live regions must already be in the DOM before a toast is inserted:
    // screen readers (notably JAWS) do not reliably announce a region that
    // appears together with its content.
    it('renders both live regions empty before any toast is shown', () => {
      render(
        <ToastProvider>
          <ToastConsumer />
        </ToastProvider>
      );

      const status = screen.getByRole('status');
      const alert = screen.getByRole('alert');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
      expect(status).toBeEmptyDOMElement();
      expect(alert).toBeEmptyDOMElement();

      fireEvent.click(screen.getByText('Show Success'));
      // Same node, now holding the toast.
      expect(screen.getByRole('status')).toBe(status);
      expect(status).toHaveTextContent('Success!');
      expect(alert).toBeEmptyDOMElement();
    });

    it('pauses auto-dismiss while focus is inside the toast', () => {
      vi.useFakeTimers();
      try {
        render(
          <ToastProvider>
            <ToastConsumer />
          </ToastProvider>
        );
        fireEvent.click(screen.getByText('Show Success'));
        const dismiss = screen.getByLabelText('Dismiss notification: Success!');
        fireEvent.focus(dismiss);
        act(() => {
          vi.advanceTimersByTime(10000);
        });
        expect(screen.getByText('Success!')).toBeInTheDocument();

        fireEvent.blur(dismiss);
        act(() => {
          vi.advanceTimersByTime(4500);
        });
        expect(screen.queryByText('Success!')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('routes warnings to the assertive region and info to the polite one', () => {
      render(
        <ToastProvider>
          <ToastConsumer />
        </ToastProvider>
      );

      fireEvent.click(screen.getByText('Show Warning'));
      fireEvent.click(screen.getByText('Show Info'));
      expect(screen.getByRole('alert')).toHaveTextContent('Warning!');
      expect(screen.getByRole('status')).toHaveTextContent('Info!');
    });
  });
});
