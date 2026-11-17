import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HistoryPage from '../../../pages/media/MediaDetailPage/HistoryPage';
import * as api from '../../../lib/api';
import type { RecordAuditEvent } from '../../../lib/api';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return { ...actual, getRecordAuditHistory: vi.fn() };
});
vi.mock('../../../components/dam', () => ({
  ProcessingHistoryTab: () => <p>Processing jobs</p>,
  VersionHistoryTab: () => <p>Versions list</p>,
}));

const mocked = vi.mocked(api);

const TAG_CHANGED: RecordAuditEvent = {
  event_id: 'e1',
  change_type: 'link_updated',
  changed_at: '2026-11-14T10:00:00+00:00',
  changed_by: 'u1',
  changed_by_name: 'Pat Registrar',
  changed_by_email: 'pat@example.org',
  changed_fields: ['tag_value'],
  summary: 'Updated tag: Note',
  request_method: 'PUT',
  child_entity_type: 'media_tag',
  child_entity_id: 't1',
  child_display_key: 'Caption written',
  field_diffs: [{ field_name: 'tag_value', old_value: 'Needs a caption', new_value: 'Caption written' }],
};

function Shell() {
  return <Outlet context={{ organizationId: 'org-1', mediaId: 'm-1', media: { current_version: 1, media_type: 'image' } }} />;
}

function renderHistory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/m/history']}>
        <Routes>
          <Route path="/m" element={<Shell />}>
            <Route path="history" element={<HistoryPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Media history: record changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getRecordAuditHistory.mockResolvedValue({
      entity_type: 'media', entity_id: 'm-1', items: [TAG_CHANGED], total: 1, limit: 20, offset: 0,
    } as Awaited<ReturnType<typeof api.getRecordAuditHistory>>);
  });

  it('shows the media record history (tags included) behind a pressed toggle', async () => {
    const user = userEvent.setup();
    const { container } = renderHistory();
    const group = screen.getByRole('group', { name: 'History sections' });
    const changes = within(group).getByRole('button', { name: 'Record changes' });
    expect(changes).toHaveAttribute('aria-pressed', 'false');
    expect(within(group).getByRole('button', { name: 'Processing' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(changes);
    expect(changes).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('heading', { level: 2, name: 'Record changes' })).toBeInTheDocument();
    expect(mocked.getRecordAuditHistory).toHaveBeenCalledWith('org-1', 'media', 'm-1', expect.anything());
    expect(await screen.findByText(/Changed tag “Caption written”/)).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });
});
