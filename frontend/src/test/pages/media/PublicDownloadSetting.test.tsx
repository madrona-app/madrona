import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PublicDownloadSetting } from '../../../pages/media/MediaDetailPage/PublicDownloadSetting';
import * as api from '../../../lib/api';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/api', () => ({ updateMedia: vi.fn() }));

function renderSetting(props: Partial<React.ComponentProps<typeof PublicDownloadSetting>> = {}) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PublicDownloadSetting orgId="org-1" mediaId="m-1" mediaType="image" value={null} canEdit {...props} />
    </QueryClientProvider>,
  );
}

describe('PublicDownloadSetting', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is a labelled select with help text, defaulting to not set', () => {
    renderSetting();
    const select = screen.getByRole('combobox', { name: 'What visitors can download' });
    expect(select).toHaveValue('');
    expect(select).toHaveAccessibleDescription(/public collection site/i);
    expect(screen.getByRole('option', { name: 'Not set (no public downloads)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Access copies only' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Access copies and original file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save download setting' })).toBeDisabled();
  });

  it('saves the chosen level through the media update and announces it', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateMedia).mockResolvedValue({} as never);
    renderSetting();
    await user.selectOptions(screen.getByRole('combobox', { name: 'What visitors can download' }), 'derivatives');
    expect(api.updateMedia).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save download setting' }));
    expect(api.updateMedia).toHaveBeenCalledWith('org-1', 'm-1', { public_download_level: 'derivatives' });
    expect(await screen.findByRole('status')).toHaveTextContent('Public download setting saved.');
  });

  it('sends null when cleared back to not set', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateMedia).mockResolvedValue({} as never);
    renderSetting({ value: 'originals' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'What visitors can download' }), '');
    await user.click(screen.getByRole('button', { name: 'Save download setting' }));
    expect(api.updateMedia).toHaveBeenCalledWith('org-1', 'm-1', { public_download_level: null });
  });

  it('reports a failed save as an alert tied to the select', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateMedia).mockRejectedValue(new Error('Server said no'));
    renderSetting();
    const select = screen.getByRole('combobox', { name: 'What visitors can download' });
    await user.selectOptions(select, 'originals');
    await user.click(screen.getByRole('button', { name: 'Save download setting' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved.*server said no/i);
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription(/could not be saved/i);
  });

  it('explains that audio has no access copy', () => {
    renderSetting({ mediaType: 'audio' });
    expect(screen.getByRole('combobox', { name: 'What visitors can download' }))
      .toHaveAccessibleDescription(/audio files have no access copy/i);
  });

  it('is read-only without edit permission', () => {
    renderSetting({ canEdit: false, value: 'none' });
    expect(screen.getByRole('combobox', { name: 'What visitors can download' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save download setting' })).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = renderSetting({ mediaType: 'document' });
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });
});
