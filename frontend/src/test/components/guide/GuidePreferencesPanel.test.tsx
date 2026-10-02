import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GuidePreferencesPanel } from '../../../components/guide/GuidePreferencesPanel';
import * as api from '../../../lib/api/guidePreferences';

vi.mock('../../../lib/api/guidePreferences');
const getPrefs = vi.mocked(api.getGuidePreferences);
const updatePrefs = vi.mocked(api.updateGuidePreferences);

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <GuidePreferencesPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('GuidePreferencesPanel', () => {
  it('hydrates the form from the saved preferences', async () => {
    getPrefs.mockResolvedValue({ instructions: 'Cite procedures.', verbosity: 'terse' });
    renderPanel();
    expect(await screen.findByDisplayValue('Cite procedures.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /terse/i })).toBeChecked();
  });

  it('defaults verbosity to normal when unset', async () => {
    getPrefs.mockResolvedValue({ instructions: '', verbosity: null });
    renderPanel();
    expect(await screen.findByRole('radio', { name: /normal/i })).toBeChecked();
  });

  it('Save is disabled until the form is changed', async () => {
    getPrefs.mockResolvedValue({ instructions: '', verbosity: null });
    renderPanel();
    const save = await screen.findByRole('button', { name: /save preferences/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/things to keep in mind/i), {
      target: { value: 'Be terse.' },
    });
    expect(save).toBeEnabled();
  });

  it('persists normal verbosity as null', async () => {
    getPrefs.mockResolvedValue({ instructions: '', verbosity: 'terse' });
    updatePrefs.mockResolvedValue({ instructions: '', verbosity: null });
    renderPanel();
    fireEvent.click(await screen.findByRole('radio', { name: /normal/i }));
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));
    await waitFor(() =>
      expect(updatePrefs).toHaveBeenCalledWith({ instructions: '', verbosity: null }),
    );
  });

  it('shows a retry affordance when loading fails', async () => {
    getPrefs.mockRejectedValue(new Error('boom'));
    renderPanel();
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
