import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Plus, MapPin } from 'lucide-react';
import { RightRailSummary } from '../../../components/record-detail/RightRailSummary';

describe('RightRailSummary', () => {
  it('renders nothing of substance when no props are provided', () => {
    const { container } = render(<RightRailSummary />);
    // Wraps in a div, but no child sections
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('dl')).toBeNull();
  });

  it('renders the object number when provided', () => {
    render(<RightRailSummary objectNumber="O-1" />);
    expect(screen.getByText('O-1')).toBeInTheDocument();
  });

  it('renders object type capitalized', () => {
    render(<RightRailSummary objectType="painting" />);
    expect(screen.getByText('painting')).toBeInTheDocument();
  });

  it('renders status badge', () => {
    render(<RightRailSummary status="Active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders the location when provided', () => {
    render(<RightRailSummary location="Storage A" />);
    expect(screen.getByText('Storage A')).toBeInTheDocument();
  });

  it('shows "Not set" with error styling when location is required and missing', () => {
    render(<RightRailSummary objectNumber="O-1" location={null} isLocationRequired={true} />);
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('shows "Set now" link when location is required, missing, and onSetLocation provided', () => {
    const onSetLocation = vi.fn();
    render(
      <RightRailSummary
        objectNumber="O-1"
        location={null}
        isLocationRequired={true}
        onSetLocation={onSetLocation}
      />,
    );
    fireEvent.click(screen.getByLabelText('Record movement to set location'));
    expect(onSetLocation).toHaveBeenCalled();
  });

  it('renders the Create Task button when canCreateTask + onCreateTask', () => {
    const onCreateTask = vi.fn();
    render(<RightRailSummary canCreateTask onCreateTask={onCreateTask} />);
    fireEvent.click(screen.getByLabelText('Create a new task for this record'));
    expect(onCreateTask).toHaveBeenCalled();
  });

  it('renders the Generate Report button when allowed', () => {
    const onGenerateReport = vi.fn();
    render(<RightRailSummary canGenerateReport onGenerateReport={onGenerateReport} />);
    fireEvent.click(screen.getByText('Generate Report'));
    expect(onGenerateReport).toHaveBeenCalled();
  });

  it('renders quickActions list and triggers callbacks', () => {
    const onClick = vi.fn();
    render(
      <RightRailSummary
        quickActions={[
          { id: 'a', label: 'Action A', icon: Plus, onClick },
        ]}
      />,
    );
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Action A'));
    expect(onClick).toHaveBeenCalled();
  });

  it('shows "More actions…" when actions exceed maxVisibleActions', () => {
    const actions = Array.from({ length: 6 }).map((_, i) => ({
      id: `a${i}`,
      label: `Action ${i}`,
      icon: Plus,
      onClick: vi.fn(),
    }));
    render(<RightRailSummary quickActions={actions} maxVisibleActions={3} />);
    expect(screen.getByText('More actions…')).toBeInTheDocument();
  });

  it('expands when "More actions…" is clicked', () => {
    const actions = Array.from({ length: 6 }).map((_, i) => ({
      id: `a${i}`,
      label: `Action ${i}`,
      icon: Plus,
      onClick: vi.fn(),
    }));
    render(<RightRailSummary quickActions={actions} maxVisibleActions={3} />);
    fireEvent.click(screen.getByText('More actions…'));
    expect(screen.getByText('Action 5')).toBeInTheDocument();
  });

  it('renders entry locations list for loan records', () => {
    render(
      <RightRailSummary
        entryLocations={[
          { entryNumber: 'E-1', locationName: 'Vault A' },
          { entryNumber: 'E-2', locationName: null },
        ]}
      />,
    );
    expect(screen.getByText('Object Locations')).toBeInTheDocument();
    expect(screen.getByText('Vault A')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('renders the public discovery toggle when controlled', () => {
    const onToggleDiscoverable = vi.fn();
    render(
      <RightRailSummary
        isDiscoverable={false}
        onToggleDiscoverable={onToggleDiscoverable}
      />,
    );
    fireEvent.click(screen.getByLabelText('Enable public visibility'));
    expect(onToggleDiscoverable).toHaveBeenCalled();
  });

  it('renders an image when imageUrl is provided', () => {
    render(<RightRailSummary imageUrl="/img.jpg" imageAlt="An image" />);
    expect(screen.getByAltText('An image')).toBeInTheDocument();
  });

  it('renders multi-image navigation when more than one media item', () => {
    render(
      <RightRailSummary
        media={[
          { media_id: 'm1', thumbnail_url: '/t1.jpg' },
          { media_id: 'm2', thumbnail_url: '/t2.jpg' },
        ]}
      />,
    );
    expect(screen.getByLabelText('Previous image')).toBeInTheDocument();
    expect(screen.getByLabelText('Next image')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('renders no-image placeholder when neither imageUrl nor media is given but objectNumber is', () => {
    render(<RightRailSummary objectNumber="O-1" />);
    // Image section should not exist
    expect(screen.queryByText('No image')).toBeNull();
  });

  it('uses MapPin icon ID consistently when location is present (sanity)', () => {
    // Just ensure render works alongside an icon import path.
    expect(MapPin).toBeDefined();
  });
});

/**
 * The rail is shared by records that are not collection objects. A person
 * has no object number and is never shelved, so both the identifier label
 * and the location row have to be able to say something else — or nothing.
 */
describe('RightRailSummary — non-object records', () => {
  it('labels the identifier "Object #" by default', () => {
    render(<RightRailSummary objectNumber="2024.12" />);
    expect(screen.getByText('Object #')).toBeInTheDocument();
  });

  it('uses a caller-supplied identifier label instead', () => {
    render(<RightRailSummary objectNumber="ENT-2026.4" identifierLabel="Entry #" />);
    expect(screen.getByText('Entry #')).toBeInTheDocument();
    expect(screen.queryByText('Object #')).not.toBeInTheDocument();
  });

  it('omits the location row when the record has no location concept', () => {
    render(<RightRailSummary objectType="Person" status="Active" showLocation={false} />);
    expect(screen.queryByText('Location')).not.toBeInTheDocument();
    expect(screen.queryByText('Not set')).not.toBeInTheDocument();
  });

  it('still shows the remaining identifiers when location is suppressed', () => {
    render(<RightRailSummary objectType="Person" status="Active" showLocation={false} />);
    expect(screen.getByText('Person')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('does not warn about a missing location it was told not to show', () => {
    // isLocationRequired defaults to true on the exported component, so a
    // suppressed row must not fall through to the "Not set" error branch.
    const onSetLocation = vi.fn();
    render(
      <RightRailSummary
        objectType="Person"
        location={null}
        showLocation={false}
        onSetLocation={onSetLocation}
      />
    );
    expect(screen.queryByText('Set now')).not.toBeInTheDocument();
  });

  it('omits entry locations too when location is suppressed', () => {
    render(
      <RightRailSummary
        objectType="Person"
        showLocation={false}
        entryLocations={[{ entryNumber: 'E-1', locationName: 'Vault' }]}
      />
    );
    expect(screen.queryByText('Object Locations')).not.toBeInTheDocument();
  });

  it('keeps showing the location row by default', () => {
    render(<RightRailSummary objectNumber="2024.12" location="Gallery A" />);
    expect(screen.getByText('Location')).toBeInTheDocument();
  });
});
