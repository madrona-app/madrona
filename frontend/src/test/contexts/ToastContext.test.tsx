import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
      expect(screen.getByLabelText('Dismiss')).toBeInTheDocument();
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

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
