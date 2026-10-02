import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SummaryCard } from '../../../components/workspace/SummaryCard';

describe('SummaryCard', () => {
  it('renders the title', () => {
    render(<SummaryCard id="x" title="Object Identity" onClick={() => {}} />);
    expect(screen.getByText('Object Identity')).toBeInTheDocument();
  });

  it('uses a button role', () => {
    render(<SummaryCard id="x" title="x" onClick={() => {}} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('sets the id attribute prefixed with "summary-"', () => {
    render(<SummaryCard id="custodial" title="Custodial" onClick={() => {}} />);
    expect(screen.getByRole('button').id).toBe('summary-custodial');
  });

  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    render(<SummaryCard id="x" title="t" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders the hint when present and not empty', () => {
    render(<SummaryCard id="x" title="t" hint="3 fields filled" onClick={() => {}} />);
    expect(screen.getByText('3 fields filled')).toBeInTheDocument();
  });

  it('hides the hint when isEmpty is true', () => {
    render(<SummaryCard id="x" title="t" hint="ignored" isEmpty onClick={() => {}} />);
    expect(screen.queryByText('ignored')).toBeNull();
  });

  it('shows the "+ Add" affordance when isEmpty is true', () => {
    render(<SummaryCard id="x" title="t" isEmpty onClick={() => {}} />);
    expect(screen.getByText('+ Add')).toBeInTheDocument();
  });

  it('renders an icon when supplied', () => {
    render(
      <SummaryCard
        id="x"
        title="t"
        icon={<span data-testid="icon">I</span>}
        onClick={() => {}}
      />,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('forwards a custom className to the button root', () => {
    render(<SummaryCard id="x" title="t" className="my-card" onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveClass('my-card');
  });

  it('uses empty-state styling when isEmpty is true', () => {
    render(<SummaryCard id="x" title="t" isEmpty onClick={() => {}} />);
    const heading = screen.getByText('t');
    expect(heading.className).toContain('text-archive');
  });

  it('uses filled-state styling when not empty', () => {
    render(<SummaryCard id="x" title="t" onClick={() => {}} />);
    const heading = screen.getByText('t');
    expect(heading.className).toContain('text-forest');
  });
});
