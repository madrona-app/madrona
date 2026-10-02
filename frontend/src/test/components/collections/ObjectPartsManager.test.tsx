import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ObjectPartsManager } from '../../../components/collections/ObjectPartsManager';

const {
  getObjectPartsMock,
  createObjectPartMock,
  updateObjectPartMock,
  deleteObjectPartMock,
  getMovementsMock,
} = vi.hoisted(() => ({
  getObjectPartsMock: vi.fn(),
  createObjectPartMock: vi.fn(),
  updateObjectPartMock: vi.fn(),
  deleteObjectPartMock: vi.fn(),
  getMovementsMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getObjectParts: getObjectPartsMock,
  createObjectPart: createObjectPartMock,
  updateObjectPart: updateObjectPartMock,
  deleteObjectPart: deleteObjectPartMock,
  getMovements: getMovementsMock,
}));

vi.mock('../../../components/collections/LocationPickerModal', () => ({
  LocationPickerButton: () => <button>LocationPicker</button>,
}));

vi.mock('../../../components/collections/ObjectFieldComponents', () => ({
  MOVEMENT_REASON_LABELS: {} as Record<string, string>,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderManager(props: Partial<Parameters<typeof ObjectPartsManager>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <ObjectPartsManager
          organizationId="org-1"
          objectId="obj-1"
          objectNumber="O-1"
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ObjectPartsManager', () => {
  beforeEach(() => {
    getObjectPartsMock.mockReset();
    createObjectPartMock.mockReset();
    updateObjectPartMock.mockReset();
    deleteObjectPartMock.mockReset();
    getMovementsMock.mockReset();
    getMovementsMock.mockResolvedValue({ items: [] });
  });

  it('shows loading initially', () => {
    getObjectPartsMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderManager();
    expect(container.firstChild).not.toBeNull();
  });

  it('renders movement history view for single-part objects', async () => {
    getObjectPartsMock.mockResolvedValue({
      parts: [{ part_id: 'p-1', part_number: '1', name: 'Frame' }],
      total: 1,
    });
    renderManager();
    await waitFor(() => screen.getByText('Movement History'));
    expect(screen.getByText('Movement History')).toBeInTheDocument();
  });

  it('shows "Add a part to split it" message for single-part objects', async () => {
    getObjectPartsMock.mockResolvedValue({
      parts: [{ part_id: 'p-1', part_number: '1', name: 'Frame' }],
      total: 1,
    });
    renderManager();
    await waitFor(() => screen.getByText(/tracked as a single unit/));
    expect(screen.getByText(/tracked as a single unit/)).toBeInTheDocument();
  });

  it('does not show add button when readOnly', async () => {
    getObjectPartsMock.mockResolvedValue({ parts: [] });
    renderManager({ readOnly: true });
    await waitFor(() => expect(getObjectPartsMock).toHaveBeenCalled());
    expect(screen.queryByText('Add Part')).toBeNull();
  });

  it('shows Add Part option when not readOnly', async () => {
    getObjectPartsMock.mockResolvedValue({
      parts: [{ part_id: 'p-1', part_number: '1', name: 'Frame' }],
      total: 1,
    });
    renderManager({ readOnly: false });
    await waitFor(() => screen.getByText('Add Part'));
    expect(screen.getByText('Add Part')).toBeInTheDocument();
  });

  it('renders multiple parts (2+ shows the parts list view)', async () => {
    getObjectPartsMock.mockResolvedValue({
      parts: [
        { part_id: 'p-1', part_number: '1', name: 'Frame' },
        { part_id: 'p-2', part_number: '2', name: 'Canvas' },
      ],
      total: 2,
    });
    renderManager();
    await waitFor(() => {
      const all = document.body.textContent || '';
      expect(all).toMatch(/Frame/);
      expect(all).toMatch(/Canvas/);
    });
  });

  it('passes objectId and orgId to the API', async () => {
    getObjectPartsMock.mockResolvedValue({ parts: [] });
    renderManager();
    await waitFor(() => expect(getObjectPartsMock).toHaveBeenCalledWith('org-1', 'obj-1'));
  });
});
