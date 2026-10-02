import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecordMovementSlideOver } from '../../components/collections/RecordMovementSlideOver';

const { createMovementMock } = vi.hoisted(() => ({
  createMovementMock: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  createMovement: createMovementMock,
}));

// Stub SlideOver to render children inline; eliminates portal/animation noise.
vi.mock('../../components/ui/SlideOver', () => ({
  SlideOver: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) => (isOpen ? (
    <section data-testid="slideover">
      <h2>{title}</h2>
      <div>{children}</div>
      <div>{footer}</div>
    </section>
  ) : null),
}));

// Stub LocationPickerButton so we can drive value/onChange directly.
vi.mock('../../components/collections/LocationPickerModal', () => ({
  LocationPickerButton: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string | null;
    onChange: (id: string | null, location?: { name: string; path?: string }) => void;
    placeholder: string;
  }) => (
    <button
      data-testid="location-picker"
      onClick={() =>
        onChange('loc-99', { name: 'Storage Bay', path: 'Main > Storage Bay' })
      }
    >
      {value ? `Selected: ${value}` : placeholder}
    </button>
  ),
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderSlideOver(props: Partial<Parameters<typeof RecordMovementSlideOver>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <RecordMovementSlideOver
        isOpen
        onClose={vi.fn()}
        organizationId="org-1"
        objectId="obj-1"
        objectNumber="2024.1"
        objectTitle="Vase"
        currentLocationId="loc-1"
        currentLocationName="Gallery A"
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('RecordMovementSlideOver', () => {
  beforeEach(() => {
    createMovementMock.mockReset();
  });

  it('renders nothing when not open', () => {
    const { queryByTestId } = renderSlideOver({ isOpen: false });
    expect(queryByTestId('slideover')).toBeNull();
  });

  it('renders the title and current location label for a single-part object', () => {
    renderSlideOver();
    expect(screen.getByRole('heading', { name: 'Record Movement' })).toBeInTheDocument();
    expect(screen.getByText('Gallery A')).toBeInTheDocument();
  });

  it('does not render the part selector for a single-part object', () => {
    renderSlideOver();
    expect(screen.queryByText(/Part to Move/)).not.toBeInTheDocument();
  });

  it('renders the part selector when there are multiple parts', () => {
    renderSlideOver({
      parts: [
        {
          part_id: 'p-1',
          part_number: '1',
          name: 'Base',
          current_location_id: 'loc-1',
          current_location_name: 'Gallery A',
          current_location_path: 'Main > Gallery A',
        },
        {
          part_id: 'p-2',
          part_number: '2',
          name: 'Lid',
          current_location_id: 'loc-2',
          current_location_name: 'Storage',
          current_location_path: 'Main > Storage',
        },
      ],
    });
    expect(screen.getByText(/Part to Move/)).toBeInTheDocument();
    // The "select a part first" placeholder appears in the From Location panel
    expect(screen.getByText('Select a part first')).toBeInTheDocument();
  });

  it('disables Record Movement until a destination is picked', () => {
    renderSlideOver();
    const submit = screen.getByRole('button', { name: 'Record Movement' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByTestId('location-picker'));
    expect(screen.getByRole('button', { name: 'Record Movement' })).not.toBeDisabled();
  });

  it('calls createMovement with the gathered form data and closes on success', async () => {
    createMovementMock.mockResolvedValue({ movement_id: 'm-1' });
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    renderSlideOver({ onSuccess, onClose });
    fireEvent.click(screen.getByTestId('location-picker'));
    fireEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    await waitFor(() => expect(createMovementMock).toHaveBeenCalledTimes(1));
    expect(createMovementMock).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        object_id: 'obj-1',
        to_location_id: 'loc-99',
        reason: 'storage',
      }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an inline error and stays open if the API rejects', async () => {
    createMovementMock.mockRejectedValue(new Error('network down'));
    renderSlideOver();
    fireEvent.click(screen.getByTestId('location-picker'));
    fireEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    await waitFor(() => {
      expect(screen.getByText('network down')).toBeInTheDocument();
    });
  });

  it('Cancel button triggers onClose', () => {
    const onClose = vi.fn();
    renderSlideOver({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows "Use home location" shortcut and applies it', () => {
    renderSlideOver({
      homeLocationId: 'loc-home',
      homeLocationName: 'Home Storage',
    });
    fireEvent.click(screen.getByText('Use home location'));
    // Once selected, submit becomes enabled
    expect(screen.getByRole('button', { name: 'Record Movement' })).not.toBeDisabled();
  });

  it('lets users change the movement reason', () => {
    renderSlideOver();
    const select = screen.getByDisplayValue('Storage') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'conservation' } });
    expect(select.value).toBe('conservation');
  });

  it('rejects multi-part submit when no part is selected', () => {
    renderSlideOver({
      parts: [
        {
          part_id: 'p-1',
          part_number: '1',
          name: 'Base',
          current_location_id: 'loc-1',
          current_location_name: 'Gallery A',
          current_location_path: null,
        },
        {
          part_id: 'p-2',
          part_number: '2',
          name: 'Lid',
          current_location_id: null,
          current_location_name: null,
          current_location_path: null,
        },
      ],
    });
    // Pick a destination so the only blocker is the missing part
    fireEvent.click(screen.getByTestId('location-picker'));
    // Submit is still disabled because no part selected
    expect(screen.getByRole('button', { name: 'Record Movement' })).toBeDisabled();
  });
});
