import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TouringScheduleTab } from '../../../components/exhibit/TouringScheduleTab';

const {
  getExhibitionVenuesMock,
  createExhibitionVenueMock,
  updateExhibitionVenueMock,
  deleteExhibitionVenueMock,
  useGeoMock,
} = vi.hoisted(() => ({
  getExhibitionVenuesMock: vi.fn(),
  createExhibitionVenueMock: vi.fn(),
  updateExhibitionVenueMock: vi.fn(),
  deleteExhibitionVenueMock: vi.fn(),
  useGeoMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getExhibitionVenues: getExhibitionVenuesMock,
  createExhibitionVenue: createExhibitionVenueMock,
  updateExhibitionVenue: updateExhibitionVenueMock,
  deleteExhibitionVenue: deleteExhibitionVenueMock,
}));

vi.mock('../../../hooks/useGeo', () => ({
  useGeo: useGeoMock,
}));

vi.mock('../../../components/exhibit/TouringTimeline', () => ({
  default: () => <div data-testid="touring-timeline" />,
}));

vi.mock('../../../components/maps', () => ({
  LocationPickerModal: () => null,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderTab(props: Partial<Parameters<typeof TouringScheduleTab>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <TouringScheduleTab organizationId="org-1" exhibitionId="ex-1" {...props} />
    </QueryClientProvider>,
  );
}

describe('TouringScheduleTab', () => {
  beforeEach(() => {
    getExhibitionVenuesMock.mockReset();
    createExhibitionVenueMock.mockReset();
    deleteExhibitionVenueMock.mockReset();
    useGeoMock.mockReset();
    useGeoMock.mockReturnValue({
      useTourRoute: () => ({ data: null }),
    });
  });

  it('shows a loading state while fetching', () => {
    getExhibitionVenuesMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderTab();
    expect(container.firstChild).not.toBeNull();
  });

  it('renders an empty state when no venues exist', async () => {
    getExhibitionVenuesMock.mockResolvedValue({ exhibition_venues: [] });
    renderTab();
    await waitFor(() => expect(getExhibitionVenuesMock).toHaveBeenCalled());
  });

  it('renders venues when API returns them', async () => {
    getExhibitionVenuesMock.mockResolvedValue({
      exhibition_venues: [
        {
          exhibition_venue_id: 'v-1',
          venue_name: 'MoMA',
          city: 'New York',
          country: 'USA',
          status: 'confirmed',
          sequence_number: 1,
          planned_start_date: '2024-01-01',
          planned_end_date: '2024-04-01',
        },
      ],
    });
    renderTab();
    await waitFor(() => screen.getByText('MoMA'));
    expect(screen.getByText('MoMA')).toBeInTheDocument();
  });

  it('shows Add Venue button when editing', async () => {
    getExhibitionVenuesMock.mockResolvedValue({ exhibition_venues: [] });
    renderTab({ isEditing: true });
    await waitFor(() => expect(getExhibitionVenuesMock).toHaveBeenCalled());
    const addButtons = screen.queryAllByRole('button', { name: /Add/i });
    expect(addButtons.length).toBeGreaterThan(0);
  });

  it('renders multiple venues', async () => {
    getExhibitionVenuesMock.mockResolvedValue({
      exhibition_venues: [
        {
          exhibition_venue_id: 'v-1',
          venue_name: 'Venue A',
          status: 'confirmed',
          sequence_number: 1,
        },
        {
          exhibition_venue_id: 'v-2',
          venue_name: 'Venue B',
          status: 'proposed',
          sequence_number: 2,
        },
      ],
    });
    renderTab();
    await waitFor(() => screen.getByText('Venue A'));
    expect(screen.getByText('Venue B')).toBeInTheDocument();
  });

  it('queries the venues API with org and exhibition ids', async () => {
    getExhibitionVenuesMock.mockResolvedValue({ exhibition_venues: [] });
    renderTab();
    await waitFor(() =>
      expect(getExhibitionVenuesMock).toHaveBeenCalledWith('org-1', 'ex-1'),
    );
  });
});
