import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ObjectEntriesPage from '../../pages/collections/ObjectEntriesPage';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';

vi.mock('../../lib/api', () => ({
  getObjectEntries: vi.fn(),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

const mockGetObjectEntries = vi.mocked(api.getObjectEntries);
const mockUsePermissions = vi.mocked(usePermissionsHook.usePermissions);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(orgId = 'org-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[`/organizations/${orgId}/collections/entries`]}
      >
        <Routes>
          <Route
            path="/organizations/:orgId/collections/entries"
            element={<ObjectEntriesPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleEntries = {
  total: 2,
  items: [
    {
      entry_id: 'e-1',
      entry_number: 'OE-2024-001',
      entry_date: '2024-01-15',
      depositor_name: 'Jane Donor',
      reason: 'gift_offer',
      objects_count: 3,
      status: 'received',
    },
    {
      entry_id: 'e-2',
      entry_number: 'OE-2024-002',
      entry_date: '2024-02-01',
      depositor_name: null,
      reason: 'identification',
      objects_count: 1,
      status: 'pending',
    },
  ],
};

describe('ObjectEntriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(true),
      hasAnyPermission: vi.fn().mockReturnValue(true),
      hasAllPermissions: vi.fn().mockReturnValue(true),
    });
  });

  it('shows loader on initial render', () => {
    mockGetObjectEntries.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(
      screen.queryByRole('heading', { name: /object entry/i }),
    ).not.toBeInTheDocument();
  });

  it('renders heading and entry rows', async () => {
    mockGetObjectEntries.mockResolvedValue(sampleEntries as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /object entry/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('OE-2024-001')).toBeInTheDocument();
    expect(screen.getByText('OE-2024-002')).toBeInTheDocument();
  });

  it('shows total count', async () => {
    mockGetObjectEntries.mockResolvedValue(sampleEntries as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('2 entries')).toBeInTheDocument();
    });
  });

  it('renders stat cards', async () => {
    mockGetObjectEntries.mockResolvedValue(sampleEntries as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText(/pending/i).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/received/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/acquired/i).length).toBeGreaterThan(0);
  });

  it('renders error state on failure', async () => {
    mockGetObjectEntries.mockRejectedValue(new Error('entries broke'));
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText(/error loading object entries/i),
      ).toBeInTheDocument();
    });
  });

  it('shows New Entry link when permitted', async () => {
    mockGetObjectEntries.mockResolvedValue(sampleEntries as any);
    renderPage();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /new entry/i });
      expect(link).toHaveAttribute(
        'href',
        '/organizations/org-123/collections/entries/create',
      );
    });
  });

  it('disables New Entry when not permitted', async () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: vi.fn().mockReturnValue(false),
      hasAnyPermission: vi.fn().mockReturnValue(false),
      hasAllPermissions: vi.fn().mockReturnValue(false),
    });
    mockGetObjectEntries.mockResolvedValue(sampleEntries as any);
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByTitle(/requires collections.create permission/i),
      ).toBeInTheDocument();
    });
  });

  it('typing in search updates the input value', async () => {
    mockGetObjectEntries.mockResolvedValue(sampleEntries as any);
    renderPage();
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search entries/i)).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText(/search entries/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'donor' } });
    expect(input.value).toBe('donor');
  });
});
