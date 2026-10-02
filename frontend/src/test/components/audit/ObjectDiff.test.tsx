import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObjectDiff } from '../../../components/audit/ObjectDiff';

describe('ObjectDiff', () => {
  it('reports zero changes when both objects are equal', () => {
    render(<ObjectDiff oldValue={{ a: 1, b: 2 }} newValue={{ a: 1, b: 2 }} />);
    expect(screen.getByText(/0 fields changed/)).toBeInTheDocument();
  });

  it('counts a single changed field correctly with singular grammar', () => {
    render(<ObjectDiff oldValue={{ a: 1 }} newValue={{ a: 2 }} />);
    expect(screen.getByText('1 field changed')).toBeInTheDocument();
  });

  it('uses plural grammar when more than one field changed', () => {
    render(<ObjectDiff oldValue={{ a: 1, b: 2 }} newValue={{ a: 9, b: 9 }} />);
    expect(screen.getByText('2 fields changed')).toBeInTheDocument();
  });

  it('counts a newly added key as a change', () => {
    render(<ObjectDiff oldValue={{ a: 1 }} newValue={{ a: 1, b: 2 }} />);
    expect(screen.getByText('1 field changed')).toBeInTheDocument();
  });

  it('counts a removed key as a change', () => {
    render(<ObjectDiff oldValue={{ a: 1, b: 2 }} newValue={{ a: 1 }} />);
    expect(screen.getByText('1 field changed')).toBeInTheDocument();
  });

  it('handles null on the old side as zero old keys', () => {
    render(<ObjectDiff oldValue={null} newValue={{ a: 1, b: 2 }} />);
    expect(screen.getByText('2 fields changed')).toBeInTheDocument();
  });

  it('does not render a "View details" button when no callback is provided', () => {
    render(<ObjectDiff oldValue={{ a: 1 }} newValue={{ a: 2 }} />);
    expect(screen.queryByRole('button', { name: 'View details' })).not.toBeInTheDocument();
  });

  it('renders "View details" and invokes the callback when provided', () => {
    const onView = vi.fn();
    render(
      <ObjectDiff
        oldValue={{ a: 1 }}
        newValue={{ a: 2 }}
        onViewDetails={onView}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('treats arrays as having zero own keys (returns 0 fields)', () => {
    render(<ObjectDiff oldValue={[1, 2, 3]} newValue={[4, 5]} />);
    expect(screen.getByText('0 fields changed')).toBeInTheDocument();
  });
});
