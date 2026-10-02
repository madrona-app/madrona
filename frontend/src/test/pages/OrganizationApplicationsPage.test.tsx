import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import OrganizationApplicationsPage from '../../pages/admin/OrganizationApplicationsPage';
import * as useAuthHook from '../../hooks/useAuth';
import * as apiClient from '../../lib/apiClient';

vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('../../lib/apiClient', async () => {
  const actual = await vi.importActual<typeof apiClient>('../../lib/apiClient');
  return { ...actual, apiFetch: vi.fn() };
});

const mockUseAuth = vi.mocked(useAuthHook.useAuth);
const mockApiFetch = vi.mocked(apiClient.apiFetch);
const refreshMe = vi.fn();

const APPS = [
  {
    key: 'collections', display_name: 'Collections', description: 'Object records',
    icon: null, status: 'active', enabled: true, available: true,
    unavailable_reason: null, can_disable: false,
  },
  {
    key: 'media', display_name: 'Media', description: 'Digital assets',
    icon: null, status: 'active', enabled: true, available: true,
    unavailable_reason: null, can_disable: true,
  },
  {
    key: 'guide', display_name: 'Guide', description: 'AI assistant',
    icon: null, status: 'active', enabled: false, available: false,
    unavailable_reason: 'Requires an AI provider.', can_disable: true,
  },
  {
    // Placeholder rather than a real key: no app currently ships as
    // coming_soon, but the component still has to handle the status.
    key: 'preview-app', display_name: 'Preview App', description: 'Not yet shipped',
    icon: null, status: 'coming_soon', enabled: false, available: true,
    unavailable_reason: null, can_disable: true,
  },
];

function renderPage() {
  mockUseAuth.mockReturnValue({ refreshMe } as never);
  return render(
    <MemoryRouter initialEntries={['/organizations/org-1/admin/applications']}>
      <Routes>
        <Route
          path="/organizations/:orgId/admin/applications"
          element={<OrganizationApplicationsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OrganizationApplicationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({ applications: APPS } as never);
  });

  it('lists every application with its state', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Collections')).toBeInTheDocument());
    expect(screen.getByText('Media')).toBeInTheDocument();
    expect(screen.getByText('Guide')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Media enabled/i })).toBeChecked();
  });

  it('locks an application that cannot be disabled', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Collections')).toBeInTheDocument());
    expect(screen.getByRole('switch', { name: /Collections enabled/i })).toBeDisabled();
    expect(screen.getByText(/Required/i)).toBeInTheDocument();
  });

  it('explains why an unavailable application cannot be turned on', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Guide')).toBeInTheDocument());
    expect(screen.getByText(/Requires an AI provider/i)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Guide enabled/i })).toBeDisabled();
  });

  it('does not offer a coming-soon application', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Preview App')).toBeInTheDocument());
    expect(screen.getByRole('switch', { name: /Preview App enabled/i })).toBeDisabled();
  });

  it('toggles an application and refreshes the session', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Media')).toBeInTheDocument());

    mockApiFetch.mockResolvedValueOnce({ ...APPS[1], enabled: false } as never);
    await user.click(screen.getByRole('switch', { name: /Media enabled/i }));

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Media enabled/i })).not.toBeChecked(),
    );
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/organizations/org-1/applications/media',
      expect.objectContaining({ method: 'PUT' }),
    );
    // Nav and route guards read the app list off /me.
    expect(refreshMe).toHaveBeenCalled();
  });

  it("surfaces the server's reason when a toggle is refused", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Media')).toBeInTheDocument());

    mockApiFetch.mockRejectedValueOnce(
      new apiClient.ApiError('Conflict', 409, undefined, {
        code: 'last_application',
        message: 'At least one application must stay enabled.',
      }),
    );
    await user.click(screen.getByRole('switch', { name: /Media enabled/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /At least one application must stay enabled/i,
      ),
    );
    // The refused change must not be shown as applied.
    expect(screen.getByRole('switch', { name: /Media enabled/i })).toBeChecked();
  });
  it('lets an enabled-but-unavailable application be turned off', async () => {
    const user = userEvent.setup();
    // Guide stored as on, but the deployment has no provider.
    mockApiFetch.mockResolvedValue({
      applications: APPS.map((a) => (a.key === 'guide' ? { ...a, enabled: true } : a)),
    } as never);
    renderPage();
    await waitFor(() => expect(screen.getByText('Guide')).toBeInTheDocument());

    expect(screen.getByText(/Unavailable/i)).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: /Guide enabled/i });
    expect(sw).not.toBeDisabled();

    mockApiFetch.mockResolvedValueOnce({ ...APPS[2], enabled: false } as never);
    await user.click(sw);
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Guide enabled/i })).not.toBeChecked(),
    );
  });
});
