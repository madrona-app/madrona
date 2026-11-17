import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VocabularyValidationSettingsPage from '../../pages/collections/VocabularyValidationSettingsPage';
import * as apiClientModule from '../../lib/apiClient';
import { checkA11y } from '../a11y';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

const permissions = { canManage: true };
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (key: string) => key === 'org.manage_settings' && permissions.canManage,
  }),
}));

const mockApiFetch = vi.mocked(apiClientModule.apiFetch);

const fields = [
  { key: 'materials', label: 'Materials', description: 'Must be a term from your vocabulary or Getty AAT.', strict: false },
  { key: 'subjects', label: 'Subjects', description: 'Must be a term from your vocabulary or subject list.', strict: true },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations/org-1/collections/config/vocabulary-validation']}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/config/vocabulary-validation"
            element={<VocabularyValidationSettingsPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VocabularyValidationSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions.canManage = true;
  });

  it('lists each field with a labelled switch reflecting its state', async () => {
    mockApiFetch.mockResolvedValue({ fields });
    renderPage();
    const materials = await screen.findByRole('switch', { name: 'Materials' });
    const subjects = screen.getByRole('switch', { name: 'Subjects' });
    expect(materials).not.toBeChecked();
    expect(subjects).toBeChecked();
    expect(materials).toHaveAccessibleDescription(/Getty AAT/);
    expect(screen.getByRole('heading', { name: /vocabulary validation/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /strict vocabulary validation by field/i })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    mockApiFetch.mockResolvedValue({ fields });
    const { container } = renderPage();
    await screen.findByRole('switch', { name: 'Materials' });
    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('saves a toggle and announces the change', async () => {
    mockApiFetch.mockResolvedValueOnce({ fields });
    mockApiFetch.mockResolvedValueOnce({
      fields: fields.map((f) => (f.key === 'materials' ? { ...f, strict: true } : f)),
    });
    renderPage();
    const materials = await screen.findByRole('switch', { name: 'Materials' });
    fireEvent.click(materials);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/settings/vocabulary-validation',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ materials: true }) }),
      );
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Materials: strict validation on.');
    expect(screen.getByRole('switch', { name: 'Materials' })).toBeChecked();
  });

  it('reports a failed save in an alert', async () => {
    mockApiFetch.mockResolvedValueOnce({ fields });
    mockApiFetch.mockRejectedValueOnce(new Error('Forbidden'));
    renderPage();
    fireEvent.click(await screen.findByRole('switch', { name: 'Materials' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not change Materials: Forbidden');
    });
  });

  it('is read-only without permission to manage settings', async () => {
    permissions.canManage = false;
    mockApiFetch.mockResolvedValue({ fields });
    renderPage();
    const materials = await screen.findByRole('switch', { name: 'Materials' });
    expect(materials).toBeDisabled();
    expect(materials).toHaveAccessibleDescription(/requires permission to manage organization settings/);
  });
});
