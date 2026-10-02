import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProcedureGuideCard } from '../../components/collections/ProcedureGuideCard';

describe('ProcedureGuideCard', () => {
  it('starts collapsed by default', () => {
    render(<ProcedureGuideCard currentStatus="received" />);
    // Body text only appears when expanded
    expect(
      screen.queryByText(/Recording objects that enter/)
    ).not.toBeInTheDocument();
  });

  it('renders the status summary in the collapsed header', () => {
    render(<ProcedureGuideCard currentStatus="received" />);
    expect(screen.getByText(/Object Entry — Received/)).toBeInTheDocument();
  });

  it('expands when the header is clicked', () => {
    render(<ProcedureGuideCard currentStatus="received" />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(
      screen.getByText(/Recording objects that enter/)
    ).toBeInTheDocument();
  });

  it('respects defaultExpanded', () => {
    render(<ProcedureGuideCard currentStatus="pending" defaultExpanded />);
    expect(screen.getByText('Workflow Progress')).toBeInTheDocument();
  });

  it('sets aria-expanded on the toggle button', () => {
    render(<ProcedureGuideCard currentStatus="received" />);
    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders the workflow steps when expanded', () => {
    render(<ProcedureGuideCard currentStatus="received" defaultExpanded />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.getByText('Processed')).toBeInTheDocument();
  });

  it('marks the current step with a "Current" badge', () => {
    render(<ProcedureGuideCard currentStatus="received" defaultExpanded />);
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('renders related procedures only when status is "processed"', () => {
    const { rerender } = render(
      <ProcedureGuideCard currentStatus="received" defaultExpanded />
    );
    expect(screen.queryByText('Related procedures')).not.toBeInTheDocument();

    rerender(<ProcedureGuideCard currentStatus="processed" defaultExpanded />);
    expect(screen.getByText('Related procedures')).toBeInTheDocument();
    expect(screen.getByText('Acquisition')).toBeInTheDocument();
    expect(screen.getByText('Loans In')).toBeInTheDocument();
    expect(screen.getByText('Object Exit')).toBeInTheDocument();
  });

  it('calls onRelatedProcedureClick with the procedure id', () => {
    const onRelatedProcedureClick = vi.fn();
    render(
      <ProcedureGuideCard
        currentStatus="processed"
        defaultExpanded
        onRelatedProcedureClick={onRelatedProcedureClick}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Acquisition/i }));
    expect(onRelatedProcedureClick).toHaveBeenCalledWith('acquisition');
  });

  it('renders an external learn-more link by default', () => {
    render(<ProcedureGuideCard currentStatus="received" defaultExpanded />);
    const link = screen.getByRole('link', { name: /Learn more/i });
    expect(link).toHaveAttribute('href', 'https://collectionstrust.org.uk/procedure/');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('calls onLearnMore when provided, instead of rendering an external link', () => {
    const onLearnMore = vi.fn();
    render(
      <ProcedureGuideCard
        currentStatus="received"
        defaultExpanded
        onLearnMore={onLearnMore}
      />
    );
    expect(screen.queryByRole('link', { name: /Learn more/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Learn more/i }));
    expect(onLearnMore).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first workflow step when status is unknown', () => {
    // "processing" isn't in WORKFLOW_STEPS
    render(
      <ProcedureGuideCard currentStatus={'processing' as any} />
    );
    // Should still render without error, falling back to "Pending"
    expect(screen.getByText(/Object Entry — Pending/)).toBeInTheDocument();
  });
});
