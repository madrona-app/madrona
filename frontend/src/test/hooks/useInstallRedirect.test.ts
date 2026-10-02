import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useInstallRedirect } from '../../hooks/useInstallRedirect';
import * as apiClient from '../../lib/apiClient';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

describe('useInstallRedirect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();
  });

  it('redirects to the wizard when the instance is uninstalled', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ install_required: true });

    renderHook(() => useInstallRedirect());

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/install', { replace: true });
    });
  });

  it('leaves an installed instance alone', async () => {
    const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue({ install_required: false });

    renderHook(() => useInstallRedirect());

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('stays quiet when the check itself fails', async () => {
    // Backend down, or an older build with no such route. Showing the sign-in
    // form is the right fallback; a redirect loop or a crash is not.
    const spy = vi.spyOn(apiClient, 'apiFetch').mockRejectedValue(new Error('network'));

    renderHook(() => useInstallRedirect());

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('makes no request when disabled', () => {
    const spy = vi.spyOn(apiClient, 'apiFetch');

    renderHook(() => useInstallRedirect(false));

    expect(spy).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
