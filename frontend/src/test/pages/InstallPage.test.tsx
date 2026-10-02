import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import InstallPage from '../../pages/auth/InstallPage';
import * as apiClient from '../../lib/apiClient';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/install']}>
      <InstallPage />
    </MemoryRouter>
  );
}

describe('InstallPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();
  });

  it('shows the form when the instance still needs installing', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ install_required: true });

    renderPage();

    expect(await screen.findByLabelText(/organization name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your email/i)).toBeInTheDocument();
  });

  it('redirects to sign-in when the instance is already installed', async () => {
    // A stale bookmark must not present a form that can only ever 409.
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ install_required: false });

    renderPage();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/sign-in', { replace: true });
    });
  });

  it('refuses to submit when the passwords differ', async () => {
    const fetchSpy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ install_required: true });
    const user = userEvent.setup();

    renderPage();
    await screen.findByLabelText(/organization name/i);

    await user.type(screen.getByLabelText(/organization name/i), 'Museum of Somewhere');
    await user.type(screen.getByLabelText(/your email/i), 'curator@museum.org');
    await user.type(screen.getByLabelText(/^password$/i), 'a-long-enough-password');
    await user.type(screen.getByLabelText(/confirm password/i), 'a-different-password');
    await user.click(screen.getByRole('button', { name: /create organization/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    // Only the status call — nothing was posted.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('leaves sample records off unless asked', async () => {
    const fetchSpy = vi.spyOn(apiClient, 'apiFetch')
      .mockResolvedValueOnce({ install_required: true })
      .mockResolvedValueOnce({ organization_slug: 'museum-of-somewhere' });
    const user = userEvent.setup();

    renderPage();
    await screen.findByLabelText(/organization name/i);

    await user.type(screen.getByLabelText(/organization name/i), 'Museum of Somewhere');
    await user.type(screen.getByLabelText(/your email/i), 'curator@museum.org');
    await user.type(screen.getByLabelText(/^password$/i), 'a-long-enough-password');
    await user.type(screen.getByLabelText(/confirm password/i), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: /create organization/i }));

    await waitFor(() => {
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
      expect(body.with_demo_data).toBe(false);
    });
  });

  it('asks for sample records when the box is ticked', async () => {
    const fetchSpy = vi.spyOn(apiClient, 'apiFetch')
      .mockResolvedValueOnce({ install_required: true })
      .mockResolvedValueOnce({ organization_slug: 'museum-of-somewhere' });
    const user = userEvent.setup();

    renderPage();
    await screen.findByLabelText(/organization name/i);

    await user.type(screen.getByLabelText(/organization name/i), 'Museum of Somewhere');
    await user.type(screen.getByLabelText(/your email/i), 'curator@museum.org');
    await user.type(screen.getByLabelText(/^password$/i), 'a-long-enough-password');
    await user.type(screen.getByLabelText(/confirm password/i), 'a-long-enough-password');
    await user.click(screen.getByLabelText(/add sample records/i));
    await user.click(screen.getByRole('button', { name: /create organization/i }));

    await waitFor(() => {
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
      expect(body.with_demo_data).toBe(true);
    });
  });

  it('posts the install and sends the operator to sign in', async () => {
    const fetchSpy = vi.spyOn(apiClient, 'apiFetch')
      .mockResolvedValueOnce({ install_required: true })
      .mockResolvedValueOnce({ organization_slug: 'museum-of-somewhere' });
    const user = userEvent.setup();

    renderPage();
    await screen.findByLabelText(/organization name/i);

    await user.type(screen.getByLabelText(/organization name/i), 'Museum of Somewhere');
    await user.type(screen.getByLabelText(/your email/i), 'curator@museum.org');
    await user.type(screen.getByLabelText(/^password$/i), 'a-long-enough-password');
    await user.type(screen.getByLabelText(/confirm password/i), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: /create organization/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith('/install', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText(/madrona is ready/i)).toBeInTheDocument();
  });
});
