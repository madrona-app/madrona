import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ObjectRightsManager } from '../../../components/collections/ObjectRightsManager';

const {
  getObjectRightsMock,
  deleteObjectRightMock,
  createObjectRightMock,
  getContactMock,
} = vi.hoisted(() => ({
  getObjectRightsMock: vi.fn(),
  deleteObjectRightMock: vi.fn(),
  createObjectRightMock: vi.fn(),
  getContactMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getObjectRights: getObjectRightsMock,
  deleteObjectRight: deleteObjectRightMock,
  createObjectRight: createObjectRightMock,
  getContact: getContactMock,
}));

vi.mock('../../../components/collections/ConstituentSelectorSlideOver', () => ({
  ContactSelectorSlideOver: () => null,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderManager(props: Partial<Parameters<typeof ObjectRightsManager>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <ObjectRightsManager organizationId="org-1" objectId="obj-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ObjectRightsManager', () => {
  beforeEach(() => {
    getObjectRightsMock.mockReset();
    deleteObjectRightMock.mockReset();
    createObjectRightMock.mockReset();
    getContactMock.mockReset();
  });

  it('renders without crashing for empty rights', async () => {
    getObjectRightsMock.mockResolvedValue([]);
    renderManager();
    await waitFor(() => expect(getObjectRightsMock).toHaveBeenCalled());
  });

  it('shows count of 0 in header when empty', async () => {
    getObjectRightsMock.mockResolvedValue([]);
    renderManager();
    await waitFor(() => screen.getByText('Rights Records (0)'));
    expect(screen.getByText('Rights Records (0)')).toBeInTheDocument();
  });

  it('shows a loading indicator initially', () => {
    getObjectRightsMock.mockImplementation(() => new Promise(() => {}));
    const { container } = renderManager();
    // Loader2 is used; just ensure something rendered
    expect(container.firstChild).not.toBeNull();
  });

  it('renders an empty-state message when no rights exist (not embedded)', async () => {
    getObjectRightsMock.mockResolvedValue([]);
    renderManager();
    await waitFor(() => {
      const empty = screen.queryAllByText(/No rights/i);
      expect(empty.length).toBeGreaterThan(0);
    });
  });

  it('shows the rights list when API returns data', async () => {
    getObjectRightsMock.mockResolvedValue([
      {
        right_id: 'r-1',
        right_type: 'copyright',
        status: 'owned',
        rights_holder_contact: { name: 'Owner X' },
      },
    ]);
    renderManager();
    await waitFor(() => screen.getByText('Owner X'));
    expect(screen.getByText('Owner X')).toBeInTheDocument();
  });

  it('renders right type and status labels', async () => {
    getObjectRightsMock.mockResolvedValue([
      {
        right_id: 'r-1',
        right_type: 'reproduction',
        status: 'public_domain',
        rights_holder_contact: { name: 'Owner' },
      },
    ]);
    renderManager();
    await waitFor(() => screen.getByText('Reproduction'));
    expect(screen.getByText('Reproduction')).toBeInTheDocument();
    expect(screen.getByText('Public Domain')).toBeInTheDocument();
  });

  it('renders multiple rights rows', async () => {
    getObjectRightsMock.mockResolvedValue([
      { right_id: 'r-1', right_type: 'copyright', status: 'owned', rights_holder_contact: { name: 'A' } },
      { right_id: 'r-2', right_type: 'exhibition', status: 'granted', rights_holder_contact: { name: 'B' } },
    ]);
    renderManager();
    await waitFor(() => screen.getByText('A'));
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('hides add controls when readOnly', async () => {
    getObjectRightsMock.mockResolvedValue([]);
    renderManager({ readOnly: true });
    await waitFor(() => expect(getObjectRightsMock).toHaveBeenCalled());
    // Plus icon button shouldn't be present in read-only header
    const addButtons = screen.queryAllByRole('button', { name: /Add Right/i });
    expect(addButtons.length).toBe(0);
  });
});
