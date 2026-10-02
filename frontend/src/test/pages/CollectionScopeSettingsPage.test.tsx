import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CollectionScopeSettingsPage from '../../pages/collections/CollectionScopeSettingsPage';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getCollectionProfile: vi.fn(),
  updateCollectionProfile: vi.fn(),
}));

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: () => ({ activeOrganizationId: 'org-123' }),
}));

const getMock = vi.mocked(api.getCollectionProfile);
const updateMock = vi.mocked(api.updateCollectionProfile);

function renderPage(orgId = 'org-123') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/collections/config/scope`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/config/scope"
            element={<CollectionScopeSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CollectionScopeSettingsPage', () => {
  it('loads and renders the existing profile', async () => {
    getMock.mockResolvedValue({
      organization_id: 'org-123',
      scope_note: 'Regional fine art.',
      coverage: { date_range: '1850-1950', record_types: ['paintings', 'prints'] },
      completeness: 'partial',
      extent_note: null,
      known_gaps: 'Works on paper not digitized.',
      digitization_status: 'partial',
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByDisplayValue('Regional fine art.')).toBeInTheDocument(),
    );
    // Coverage array rendered as comma-joined text.
    expect(screen.getByDisplayValue('paintings, prints')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Works on paper not digitized.')).toBeInTheDocument();
  });

  it('saves edited values via updateCollectionProfile', async () => {
    getMock.mockResolvedValue({ organization_id: 'org-123' });
    updateMock.mockResolvedValue({ organization_id: 'org-123', completeness: 'partial' });

    renderPage();

    // Save is disabled until something changes.
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeDisabled());

    fireEvent.change(screen.getByLabelText(/Known gaps/i), {
      target: { value: 'No WWII-era provenance.' },
    });
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0][0]).toBe('org-123');
    expect(updateMock.mock.calls[0][1]).toMatchObject({ known_gaps: 'No WWII-era provenance.' });
  });
});
