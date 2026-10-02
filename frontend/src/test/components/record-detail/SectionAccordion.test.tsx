import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tag } from 'lucide-react';
import {
  SectionAccordion,
  SectionEmptyState,
} from '../../../components/record-detail/SectionAccordion';

describe('SectionAccordion', () => {
  it('renders the title and content when expanded', () => {
    render(
      <SectionAccordion id="sec" title="Identification" isExpanded onToggle={vi.fn()}>
        <p>Inner content</p>
      </SectionAccordion>,
    );
    expect(screen.getByText('Identification')).toBeInTheDocument();
    expect(screen.getByText('Inner content')).toBeInTheDocument();
  });

  it('hides content via height/opacity styles when collapsed but still mounts it', () => {
    render(
      <SectionAccordion id="sec" title="Acquisition" isExpanded={false} onToggle={vi.fn()}>
        <p data-testid="hidden-child">Inner</p>
      </SectionAccordion>,
    );
    // Children remain mounted (animation collapses via styles)
    expect(screen.getByTestId('hidden-child')).toBeInTheDocument();
    const region = screen.getByRole('region');
    expect(region).toHaveStyle({ opacity: '0' });
  });

  it('toggles aria-expanded based on isExpanded', () => {
    const { rerender } = render(
      <SectionAccordion id="sec" title="X" isExpanded={false} onToggle={vi.fn()}>
        <p>x</p>
      </SectionAccordion>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    rerender(
      <SectionAccordion id="sec" title="X" isExpanded onToggle={vi.fn()}>
        <p>x</p>
      </SectionAccordion>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('calls onToggle when the header button is clicked', () => {
    const onToggle = vi.fn();
    render(
      <SectionAccordion id="sec" title="Title" isExpanded={false} onToggle={onToggle}>
        <p>x</p>
      </SectionAccordion>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders the badge text when provided', () => {
    render(
      <SectionAccordion
        id="sec"
        title="Media"
        badge="3 items"
        isExpanded={false}
        onToggle={vi.fn()}
      >
        <p>x</p>
      </SectionAccordion>,
    );
    expect(screen.getByText('3 items')).toBeInTheDocument();
  });

  it('renders the hint text only when collapsed', () => {
    const { rerender } = render(
      <SectionAccordion
        id="sec"
        title="T"
        hint="3 fields filled"
        isExpanded={false}
        onToggle={vi.fn()}
      >
        <p>x</p>
      </SectionAccordion>,
    );
    expect(screen.getByText('3 fields filled')).toBeInTheDocument();
    rerender(
      <SectionAccordion
        id="sec"
        title="T"
        hint="3 fields filled"
        isExpanded
        onToggle={vi.fn()}
      >
        <p>x</p>
      </SectionAccordion>,
    );
    expect(screen.queryByText('3 fields filled')).not.toBeInTheDocument();
  });

  it('renders the icon when provided', () => {
    render(
      <SectionAccordion
        id="sec"
        title="Tagged"
        icon={Tag}
        isExpanded
        onToggle={vi.fn()}
      >
        <p>x</p>
      </SectionAccordion>,
    );
    // Lucide icons render <svg>; finding by parent button structure works
    const headerBtn = screen.getByRole('button');
    expect(headerBtn.querySelector('svg')).toBeTruthy();
  });

  it('renders an unsaved-changes dot when hasChanges is true', () => {
    render(
      <SectionAccordion id="sec" title="T" isExpanded onToggle={vi.fn()} hasChanges>
        <p>x</p>
      </SectionAccordion>,
    );
    expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument();
  });

  it('renders the completeness indicator when completeness is provided', () => {
    render(
      <SectionAccordion
        id="sec"
        title="T"
        isExpanded
        onToggle={vi.fn()}
        completeness="required-missing"
      >
        <p>x</p>
      </SectionAccordion>,
    );
    expect(
      screen.getByTitle('Required — needs attention'),
    ).toBeInTheDocument();
  });

  it('passes the section element to sectionRef', () => {
    const refFn = vi.fn();
    render(
      <SectionAccordion id="sec" title="T" isExpanded onToggle={vi.fn()} sectionRef={refFn}>
        <p>x</p>
      </SectionAccordion>,
    );
    expect(refFn).toHaveBeenCalled();
    expect(refFn.mock.calls[0]?.[0]).toBeInstanceOf(HTMLElement);
  });
});

describe('SectionEmptyState', () => {
  it('renders the empty message', () => {
    render(<SectionEmptyState message="Nothing here yet" />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('does not render the action when not in edit mode', () => {
    render(
      <SectionEmptyState message="Empty" actionText="Add" onAction={vi.fn()} />,
    );
    expect(screen.queryByText('Add')).not.toBeInTheDocument();
  });

  it('renders the action when isEditing is true and calls onAction', () => {
    const onAction = vi.fn();
    render(
      <SectionEmptyState
        message="Empty"
        actionText="Add Material"
        onAction={onAction}
        isEditing
      />,
    );
    fireEvent.click(screen.getByText('Add Material'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders the icon when provided', () => {
    const { container } = render(
      <SectionEmptyState message="Empty" icon={Tag} />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
