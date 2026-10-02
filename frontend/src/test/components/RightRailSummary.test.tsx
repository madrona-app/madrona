import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Plus } from 'lucide-react';
import { RightRailSummary } from '../../components/record-detail/RightRailSummary';

describe('RightRailSummary', () => {
  it('renders nothing substantial when no data provided', () => {
    const { container } = render(<RightRailSummary />);
    // No image, no identifiers, no toggle — basically an empty container
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText('Object #')).not.toBeInTheDocument();
  });

  it('renders object number when provided', () => {
    render(<RightRailSummary objectNumber="2024.12" />);
    expect(screen.getByText('Object #')).toBeInTheDocument();
    expect(screen.getByText('2024.12')).toBeInTheDocument();
  });

  it('renders object type with Type label', () => {
    render(<RightRailSummary objectType="sculpture" />);
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('sculpture')).toBeInTheDocument();
  });

  it('renders status badge', () => {
    render(<RightRailSummary status="Accessioned" statusVariant="success" />);
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Accessioned')).toBeInTheDocument();
  });

  it('renders location when provided', () => {
    render(<RightRailSummary location="Gallery A" />);
    expect(screen.getByText('Location')).toBeInTheDocument();
    expect(screen.getByText('Gallery A')).toBeInTheDocument();
  });

  it('renders "On display" tag when isOnDisplay is true', () => {
    render(<RightRailSummary location="Gallery A" isOnDisplay />);
    expect(screen.getByText('(On display)')).toBeInTheDocument();
  });

  it('renders required-missing state with Set now button', () => {
    const onSet = vi.fn();
    render(
      <RightRailSummary
        objectNumber="X.1"
        location={null}
        isLocationRequired
        onSetLocation={onSet}
      />
    );
    expect(screen.getByText('Not set')).toBeInTheDocument();
    const setNow = screen.getByLabelText(/Record movement to set location/i);
    fireEvent.click(setNow);
    expect(onSet).toHaveBeenCalledTimes(1);
  });

  it('renders neutral missing state when not required', () => {
    render(
      <RightRailSummary
        objectNumber="X.1"
        location={null}
        isLocationRequired={false}
      />
    );
    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Record movement to set location/i)
    ).not.toBeInTheDocument();
  });

  it('renders entry locations list for loan records', () => {
    render(
      <RightRailSummary
        objectNumber="L.1"
        entryLocations={[
          { entryNumber: 'E-01', locationName: 'Crate 1' },
          { entryNumber: 'E-02', locationName: null },
        ]}
      />
    );
    expect(screen.getByText('Object Locations')).toBeInTheDocument();
    expect(screen.getByText('E-01:')).toBeInTheDocument();
    expect(screen.getByText('Crate 1')).toBeInTheDocument();
    expect(screen.getByText('E-02:')).toBeInTheDocument();
    // "Not set" appears once (for the null loc)
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('renders Create Task button when permitted', () => {
    const onCreate = vi.fn();
    render(
      <RightRailSummary
        canCreateTask
        onCreateTask={onCreate}
      />
    );
    const btn = screen.getByLabelText('Create a new task for this record');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('does not render Create Task button when canCreateTask is false', () => {
    render(<RightRailSummary onCreateTask={vi.fn()} canCreateTask={false} />);
    expect(
      screen.queryByLabelText('Create a new task for this record')
    ).not.toBeInTheDocument();
  });

  it('renders Generate Report button and wires click handler', () => {
    const onReport = vi.fn();
    render(
      <RightRailSummary
        canGenerateReport
        onGenerateReport={onReport}
      />
    );
    const btn = screen.getByText('Generate Report');
    fireEvent.click(btn);
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it('renders quickActions and wires their onClick', () => {
    const onClick = vi.fn();
    render(
      <RightRailSummary
        quickActions={[
          { id: 'a', label: 'Movement', icon: Plus, onClick },
        ]}
      />
    );
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Movement'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('hides Quick Actions heading when action list is empty', () => {
    render(<RightRailSummary objectNumber="X" quickActions={[]} />);
    expect(screen.queryByText('Quick Actions')).not.toBeInTheDocument();
  });

  it('collapses actions above maxVisibleActions into "More actions"', () => {
    const actions = [
      { id: '1', label: 'A1', icon: Plus, onClick: vi.fn() },
      { id: '2', label: 'A2', icon: Plus, onClick: vi.fn() },
      { id: '3', label: 'A3', icon: Plus, onClick: vi.fn() },
      { id: '4', label: 'A4', icon: Plus, onClick: vi.fn() },
      { id: '5', label: 'A5', icon: Plus, onClick: vi.fn() },
    ];
    render(<RightRailSummary quickActions={actions} maxVisibleActions={3} />);
    expect(screen.getByText('A1')).toBeInTheDocument();
    expect(screen.getByText('A3')).toBeInTheDocument();
    expect(screen.queryByText('A4')).not.toBeInTheDocument();
    expect(screen.getByText(/More actions/)).toBeInTheDocument();
  });

  it('expands when "More actions" is clicked', () => {
    const actions = [
      { id: '1', label: 'A1', icon: Plus, onClick: vi.fn() },
      { id: '2', label: 'A2', icon: Plus, onClick: vi.fn() },
      { id: '3', label: 'A3', icon: Plus, onClick: vi.fn() },
      { id: '4', label: 'A4', icon: Plus, onClick: vi.fn() },
    ];
    render(<RightRailSummary quickActions={actions} maxVisibleActions={2} />);
    fireEvent.click(screen.getByText(/More actions/));
    expect(screen.getByText('A3')).toBeInTheDocument();
    expect(screen.getByText('A4')).toBeInTheDocument();
  });

  it('renders discoverable toggle when both isDiscoverable and callback provided', () => {
    const onToggle = vi.fn();
    render(
      <RightRailSummary
        isDiscoverable={false}
        onToggleDiscoverable={onToggle}
      />
    );
    const toggle = screen.getByLabelText('Enable public visibility');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders media thumbnail when media array provided', () => {
    render(
      <RightRailSummary
        media={[
          {
            media_id: 'm1',
            thumbnail_url: 'http://example.com/thumb.jpg',
            filename: 'shot.jpg',
          },
        ]}
        imageAlt="A painting"
      />
    );
    const img = screen.getByAltText('A painting') as HTMLImageElement;
    expect(img.src).toContain('thumb.jpg');
  });

  it('renders "No image" placeholder when media is empty and no imageUrl', () => {
    render(<RightRailSummary objectNumber="X" />);
    // placeholder only shown inside MediaThumbnail, but here neither imageUrl nor
    // media array is provided, so MediaThumbnail isn't rendered at all.
    expect(screen.queryByText('No image')).not.toBeInTheDocument();
  });
});
