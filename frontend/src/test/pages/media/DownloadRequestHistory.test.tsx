import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DownloadRequestWorkspacePage from '../../../pages/media/DownloadRequestWorkspacePage';
import * as api from '../../../lib/api';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return {
    ...actual,
    getDownloadRequest: vi.fn(),
    getDownloadRequestLinks: vi.fn(),
    getRecordAuditHistory: vi.fn(),
  };
});
vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn(), toasts: [] }),
}));

const mocked = vi.mocked(api);

describe('Download request change history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getDownloadRequest.mockResolvedValue({
      request_id: 'dr-1', organization_id: 'org-1', request_number: 'DR-0007', status: 'approved',
      requester_id: 'u2', requester_name: 'Sam Researcher', requester_email: 'sam@example.org',
      purpose: 'research', intended_use: 'Thesis figures', items: [],
      created_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-11T10:00:00Z',
    } as unknown as Awaited<ReturnType<typeof api.getDownloadRequest>>);
    mocked.getDownloadRequestLinks.mockResolvedValue({ links: [] } as unknown as Awaited<ReturnType<typeof api.getDownloadRequestLinks>>);
    mocked.getRecordAuditHistory.mockResolvedValue({
      entity_type: 'media_download_request', entity_id: 'dr-1', total: 1, limit: 20, offset: 0,
      items: [{
        event_id: 'e1', change_type: 'updated', changed_at: '2026-11-11T10:00:00+00:00',
        changed_by: 'u1', changed_by_name: 'Pat Registrar', changed_by_email: 'pat@example.org',
        changed_fields: ['status'], summary: 'Updated status', request_method: 'POST',
        child_entity_type: null, child_entity_id: null, child_display_key: null,
        field_diffs: [{ field_name: 'status', old_value: 'pending', new_value: 'approved' }],
      }],
    } as Awaited<ReturnType<typeof api.getRecordAuditHistory>>);
  });

  it('shows who reviewed the request', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/organizations/org-1/media/download-requests/dr-1']}>
          <Routes>
            <Route path="/organizations/:orgId/media/download-requests/:requestId" element={<DownloadRequestWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { level: 2, name: 'Change History' })).toBeInTheDocument();
    expect(await screen.findByText('Pat Registrar')).toBeInTheDocument();
    expect(mocked.getRecordAuditHistory).toHaveBeenCalledWith('org-1', 'media_download_request', 'dr-1', expect.anything());
    expect((await checkA11y(container)).violations).toEqual([]);
  });
});
