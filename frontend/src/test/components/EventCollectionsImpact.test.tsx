import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EventCollectionsImpact } from '../../components/collections/EventCollectionsImpact';

const { getCollectionsImpactMock } = vi.hoisted(() => ({
  getCollectionsImpactMock: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  getCollectionsImpact: getCollectionsImpactMock,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderImpact(props: Partial<Parameters<typeof EventCollectionsImpact>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <EventCollectionsImpact organizationId="org-1" eventId="evt-1" {...props} />
    </QueryClientProvider>,
  );
}

function makeImpact(overrides: Record<string, unknown> = {}) {
  return {
    total_objects: 0,
    needs_movement_plan: false,
    needs_condition_checks: false,
    needs_rights_verification: false,
    objects_needing_movement: [],
    objects_needing_condition_check: [],
    objects_needing_rights_check: [],
    ...overrides,
  };
}

describe('EventCollectionsImpact', () => {
  beforeEach(() => {
    getCollectionsImpactMock.mockReset();
  });

  it('shows the loading state', () => {
    getCollectionsImpactMock.mockReturnValue(new Promise(() => {}));
    renderImpact();
    expect(screen.getByText('Analyzing collections impact...')).toBeInTheDocument();
  });

  it('shows the error message on failure', async () => {
    getCollectionsImpactMock.mockRejectedValue(new Error('boom'));
    renderImpact();
    await waitFor(() =>
      expect(screen.getByText(/Failed to load collections impact: boom/)).toBeInTheDocument(),
    );
  });

  it('shows the empty message when no objects are linked', async () => {
    getCollectionsImpactMock.mockResolvedValue(makeImpact({ total_objects: 0 }));
    renderImpact();
    await waitFor(() =>
      expect(screen.getByText('No objects linked to this event.')).toBeInTheDocument(),
    );
  });

  it('shows "no procedures required" when there are objects but no impact flags', async () => {
    getCollectionsImpactMock.mockResolvedValue(makeImpact({ total_objects: 3 }));
    renderImpact();
    await waitFor(() =>
      expect(
        screen.getByText('No collections procedures required for this event.'),
      ).toBeInTheDocument(),
    );
  });

  it('renders impact cards for each flagged need with object count and links', async () => {
    getCollectionsImpactMock.mockResolvedValue(
      makeImpact({
        total_objects: 2,
        needs_movement_plan: true,
        needs_condition_checks: true,
        objects_needing_movement: [
          {
            object_id: 'o-1',
            object_number: 'OBJ.001',
            title: 'Vase',
            planned_use: 'display',
            role: 'highlight',
          },
        ],
        objects_needing_condition_check: [
          {
            object_id: 'o-2',
            object_number: 'OBJ.002',
            title: 'Painting',
            planned_use: 'handling',
            role: 'feature',
          },
        ],
      }),
    );
    renderImpact();
    await waitFor(() =>
      expect(screen.getByText('Movement Plan Required')).toBeInTheDocument(),
    );
    expect(screen.getByText('Condition Checks Required')).toBeInTheDocument();
    // Object link uses object_number and title
    const link = screen.getByText('OBJ.001 - Vase').closest('a');
    expect(link).toHaveAttribute('href', '/organizations/org-1/collections/objects/o-1');
    expect(screen.getByText('(display)')).toBeInTheDocument();
  });

  it('truncates object lists to 5 with overflow text', async () => {
    const objects = Array.from({ length: 7 }, (_, i) => ({
      object_id: `o-${i}`,
      object_number: `OBJ.${i}`,
      title: `Object ${i}`,
      planned_use: 'display',
      role: 'feature',
    }));
    getCollectionsImpactMock.mockResolvedValue(
      makeImpact({
        total_objects: 7,
        needs_movement_plan: true,
        objects_needing_movement: objects,
      }),
    );
    renderImpact();
    await waitFor(() =>
      expect(screen.getByText('Movement Plan Required')).toBeInTheDocument(),
    );
    expect(screen.getByText('and 2 more...')).toBeInTheDocument();
  });

  it('uses singular "object" when total_objects is 1', async () => {
    getCollectionsImpactMock.mockResolvedValue(
      makeImpact({
        total_objects: 1,
        needs_rights_verification: true,
        objects_needing_rights_check: [
          {
            object_id: 'o-1',
            object_number: 'OBJ.001',
            title: null,
            planned_use: 'reproduction',
            role: 'feature',
          },
        ],
      }),
    );
    renderImpact();
    await waitFor(() => {
      expect(screen.getByText(/Based on the planned use of 1 object,/)).toBeInTheDocument();
    });
  });
});
