import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Blocker } from 'react-router-dom';
import { NavigationBlockerDialog } from '../../components/NavigationBlockerDialog';

function makeBlocker(state: Blocker['state']): Blocker {
  return {
    state,
    proceed: vi.fn(),
    reset: vi.fn(),
    location: undefined as never,
  } as unknown as Blocker;
}

describe('NavigationBlockerDialog', () => {
  it('renders nothing when blocker is unblocked', () => {
    const blocker = makeBlocker('unblocked');
    const { container } = render(<NavigationBlockerDialog blocker={blocker} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the confirm dialog when blocker is blocked', () => {
    const blocker = makeBlocker('blocked');
    render(<NavigationBlockerDialog blocker={blocker} />);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(
      screen.getByText(/You have unsaved changes that will be lost/),
    ).toBeInTheDocument();
  });

  it('uses Leave / Stay button labels', () => {
    const blocker = makeBlocker('blocked');
    render(<NavigationBlockerDialog blocker={blocker} />);
    expect(screen.getByText('Leave')).toBeInTheDocument();
    expect(screen.getByText('Stay')).toBeInTheDocument();
  });

  it('uses the danger style for the Leave button', () => {
    const blocker = makeBlocker('blocked');
    render(<NavigationBlockerDialog blocker={blocker} />);
    const leaveBtn = screen.getByText('Leave');
    expect(leaveBtn.className).toContain('bg-semantic-error');
  });

  it('calls blocker.proceed when "Leave" is clicked', () => {
    const blocker = makeBlocker('blocked');
    render(<NavigationBlockerDialog blocker={blocker} />);
    fireEvent.click(screen.getByText('Leave'));
    expect(blocker.proceed).toHaveBeenCalledTimes(1);
    // ConfirmDialog also calls onClose after onConfirm — that maps to reset.
    expect(blocker.reset).toHaveBeenCalledTimes(1);
  });

  it('calls blocker.reset when "Stay" is clicked', () => {
    const blocker = makeBlocker('blocked');
    render(<NavigationBlockerDialog blocker={blocker} />);
    fireEvent.click(screen.getByText('Stay'));
    expect(blocker.reset).toHaveBeenCalledTimes(1);
  });

  it('handles blockers without proceed/reset gracefully', () => {
    const blocker = {
      state: 'blocked',
      proceed: undefined,
      reset: undefined,
    } as unknown as Blocker;
    render(<NavigationBlockerDialog blocker={blocker} />);
    // Should not throw — uses optional chaining internally
    expect(() => fireEvent.click(screen.getByText('Leave'))).not.toThrow();
    expect(() => fireEvent.click(screen.getByText('Stay'))).not.toThrow();
  });
});
