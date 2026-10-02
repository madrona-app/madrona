import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyInfoStrip } from '../../components/record-detail/KeyInfoStrip';

describe('KeyInfoStrip', () => {
  it('renders with minimum props (location shown as "Not set")', () => {
    render(<KeyInfoStrip />);
    expect(screen.getByText('Location')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('renders object number when provided', () => {
    render(<KeyInfoStrip objectNumber="2023.001" />);
    expect(screen.getByText('Object #')).toBeInTheDocument();
    expect(screen.getByText('2023.001')).toBeInTheDocument();
  });

  it('renders object type when provided', () => {
    render(<KeyInfoStrip objectType="painting" />);
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('painting')).toBeInTheDocument();
  });

  it('renders status with default variant', () => {
    render(<KeyInfoStrip status="Accessioned" />);
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Accessioned')).toBeInTheDocument();
  });

  it('renders actual location text when provided', () => {
    render(<KeyInfoStrip location="Gallery A" />);
    expect(screen.getByText('Gallery A')).toBeInTheDocument();
  });

  it('renders rights status label', () => {
    render(<KeyInfoStrip rightsStatus="open" />);
    expect(screen.getByText(/Rights:/)).toBeInTheDocument();
    expect(screen.getByText(/Open/)).toBeInTheDocument();
  });

  it('renders restricted rights label', () => {
    render(<KeyInfoStrip rightsStatus="restricted" />);
    expect(screen.getByText(/Restricted/)).toBeInTheDocument();
  });

  it('renders region with accessible label', () => {
    render(<KeyInfoStrip objectNumber="X.1" />);
    const region = screen.getByRole('region', { name: /Key record information/i });
    expect(region).toBeInTheDocument();
  });

  it('does not render discoverable toggle when isDiscoverable undefined', () => {
    render(<KeyInfoStrip />);
    expect(screen.queryByText('Public')).not.toBeInTheDocument();
  });

  it('renders discoverable toggle when isDiscoverable and callback provided', () => {
    render(
      <KeyInfoStrip
        isDiscoverable={false}
        onToggleDiscoverable={vi.fn()}
      />
    );
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(screen.getByLabelText('Enable public visibility')).toBeInTheDocument();
  });

  it('shows "Disable public visibility" label when currently discoverable', () => {
    render(
      <KeyInfoStrip
        isDiscoverable
        onToggleDiscoverable={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Disable public visibility')).toBeInTheDocument();
  });

  it('calls onToggleDiscoverable when toggle clicked', () => {
    const onToggle = vi.fn();
    render(
      <KeyInfoStrip
        isDiscoverable={false}
        onToggleDiscoverable={onToggle}
      />
    );
    fireEvent.click(screen.getByLabelText('Enable public visibility'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders all fields together correctly', () => {
    render(
      <KeyInfoStrip
        objectNumber="2023.001"
        objectType="painting"
        status="Active"
        statusVariant="success"
        location="Vault B"
        rightsStatus="open"
      />
    );
    expect(screen.getByText('2023.001')).toBeInTheDocument();
    expect(screen.getByText('painting')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Vault B')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<KeyInfoStrip className="custom-class" />);
    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });
});

/**
 * The strip is the narrow-viewport twin of the right rail (lg:hidden), so it
 * carries the same object assumptions and needs the same escape hatches —
 * otherwise fixing the rail just moves the bug below 1280px.
 */
describe('KeyInfoStrip — non-object records', () => {
  it('labels the identifier "Object #" by default', () => {
    render(<KeyInfoStrip objectNumber="2023.001" />);
    expect(screen.getByText('Object #')).toBeInTheDocument();
  });

  it('uses a caller-supplied identifier label instead', () => {
    render(<KeyInfoStrip objectNumber="ENT-2026.4" identifierLabel="Entry #" />);
    expect(screen.getByText('Entry #')).toBeInTheDocument();
    expect(screen.queryByText('Object #')).not.toBeInTheDocument();
  });

  it('omits the location entirely when the record has no location concept', () => {
    render(<KeyInfoStrip objectType="Person" status="Active" showLocation={false} />);
    expect(screen.queryByText('Location')).not.toBeInTheDocument();
    expect(screen.queryByText('Not set')).not.toBeInTheDocument();
  });

  it('does not double the separator when location is suppressed', () => {
    // Location is the one block with no trailing bullet, so Rights supplies
    // its own. Hiding Location must not leave "• •" behind.
    const { container } = render(
      <KeyInfoStrip objectType="Person" status="Active" showLocation={false} />
    );
    const bullets = Array.from(container.querySelectorAll('[aria-hidden="true"]'));
    expect(bullets.filter((b) => b.textContent === '•')).toHaveLength(2);
  });

  it('keeps the location shown by default', () => {
    render(<KeyInfoStrip objectNumber="2023.001" location="Vault B" />);
    expect(screen.getByText('Location')).toBeInTheDocument();
  });
});

describe('KeyInfoStrip — separators survive any combination of hidden blocks', () => {
  const bullets = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('[aria-hidden="true"]')).filter(
      (b) => b.textContent === '•'
    );

  it('omits the rights indicator when the record carries no rights', () => {
    render(<KeyInfoStrip objectType="Person" status="Active" showRights={false} />);
    expect(screen.queryByText(/^Rights:/)).not.toBeInTheDocument();
  });

  it('shows the rights indicator by default', () => {
    render(<KeyInfoStrip objectNumber="2023.001" rightsStatus="open" />);
    expect(screen.getByText('Rights: Open')).toBeInTheDocument();
  });

  it('leaves no trailing separator when location and rights are both hidden', () => {
    const { container } = render(
      <KeyInfoStrip objectType="Person" status="Active" showLocation={false} showRights={false} />
    );
    // Two items, one separator between them — and none left dangling.
    expect(bullets(container)).toHaveLength(1);
  });

  it('emits no separator for a single remaining item', () => {
    const { container } = render(
      <KeyInfoStrip status="Active" showLocation={false} showRights={false} />
    );
    expect(bullets(container)).toHaveLength(0);
  });

  it('separates every block when they all render', () => {
    const { container } = render(
      <KeyInfoStrip
        objectNumber="2023.001"
        objectType="painting"
        status="Active"
        location="Vault B"
        rightsStatus="open"
      />
    );
    // 5 items → 4 separators.
    expect(bullets(container)).toHaveLength(4);
  });

  it('does not lead with a separator when the toggle is the only thing shown', () => {
    const { container } = render(
      <KeyInfoStrip
        showLocation={false}
        showRights={false}
        isDiscoverable={false}
        onToggleDiscoverable={vi.fn()}
      />
    );
    expect(bullets(container)).toHaveLength(0);
    expect(screen.getByText('Public')).toBeInTheDocument();
  });
});
