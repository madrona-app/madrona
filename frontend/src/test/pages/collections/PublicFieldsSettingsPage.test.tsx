import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { checkA11y } from '../../a11y';
import * as api from '../../../lib/api/discoverPublicFields';
import type { PublicFieldSettings } from '../../../lib/api/discoverPublicFields';
import PublicFieldsSettingsPage from '../../../pages/collections/PublicFieldsSettingsPage';

vi.mock('../../../lib/api/discoverPublicFields', () => ({
  getPublicFieldSettings: vi.fn(),
  savePublicFields: vi.fn(),
}));

const permissions = { canPublish: true };
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (key: string) => (key === 'discover.publish' ? permissions.canPublish : false),
  }),
}));

const mocked = vi.mocked(api);

function settings(publicKeys: string[]): PublicFieldSettings {
  const fields = [
    { key: 'object_number', label: 'Object number', group: 'identification', description: 'Always public.', default_public: true, locked: true },
    { key: 'title', label: 'Title', group: 'identification', description: 'Always public.', default_public: true, locked: true },
    { key: 'brief_description', label: 'Brief description', group: 'description', description: 'The short summary.', default_public: true, locked: false },
    { key: 'physical_description', label: 'Physical description', group: 'description', description: 'Appearance.', default_public: false, locked: false },
    { key: 'provenance', label: 'Provenance', group: 'history', description: 'Ownership history.', default_public: true, locked: false },
  ];
  return {
    groups: [
      { key: 'identification', label: 'Identification' },
      { key: 'description', label: 'Description' },
      { key: 'history', label: 'History and credit' },
    ],
    fields: fields.map((f) => ({ ...f, public: publicKeys.includes(f.key) })),
    public_fields: publicKeys,
    default_fields: ['object_number', 'title', 'brief_description', 'provenance'],
    is_default: false,
    never_public: [{ key: 'insurance_value', label: 'Insurance value', reason: 'Financial and security information.' }],
    additional_fields: [
      { key: 'gallery_label', label: 'Gallery label', is_public: true },
      { key: 'internal_ref', label: 'Internal reference', is_public: false },
    ],
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations/org-1/collections/config/public-fields']}>
        <main>
          <h1>Collections Configuration</h1>
          <Routes>
            <Route path="/organizations/:orgId/collections/config/public-fields" element={<PublicFieldsSettingsPage />} />
          </Routes>
        </main>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PublicFieldsSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions.canPublish = true;
    mocked.getPublicFieldSettings.mockResolvedValue(
      settings(['object_number', 'title', 'brief_description', 'provenance']),
    );
  });

  it('groups labelled checkboxes in fieldsets and has no axe violations', async () => {
    const { container } = renderPage();
    const group = await screen.findByRole('group', { name: 'Description' });
    const brief = within(group).getByRole('checkbox', { name: 'Brief description' });
    expect(brief).toBeChecked();
    expect(brief).toHaveAccessibleDescription('The short summary.');
    expect(within(group).getByRole('checkbox', { name: 'Physical description' })).not.toBeChecked();
    const title = screen.getByRole('checkbox', { name: 'Title' });
    expect(title).toBeChecked();
    expect(title).toBeDisabled();
    expect(screen.getByRole('group', { name: 'History and credit' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What visitors will see' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Never published' })).toBeInTheDocument();
    expect(screen.getByText(/Insurance value/)).toBeInTheDocument();
    expect(screen.getByText('Internal reference: not public')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /additional fields page/i })).toHaveAttribute(
      'href', '/organizations/org-1/collections/config/custom-fields',
    );
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('updates the summary as fields change and saves with a status message', async () => {
    mocked.savePublicFields.mockResolvedValue(settings(['object_number', 'title', 'brief_description']));
    renderPage();
    const summary = await screen.findByRole('region', { name: 'What visitors will see' });
    expect(within(summary).getByText(/4 of 5 standard fields/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Provenance' }));
    expect(within(summary).getByText(/3 of 5 standard fields will be public when you save/)).toBeInTheDocument();
    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument();

    const save = screen.getByRole('button', { name: 'Save changes' });
    await userEvent.click(save);
    expect(mocked.savePublicFields).toHaveBeenCalledWith('org-1', ['object_number', 'title', 'brief_description']);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved. 3 of 5 standard fields are now public.'),
    );
    expect(save).toHaveFocus();
  });

  it('announces a refusal from the server', async () => {
    const { ApiError } = await import('../../../lib/apiClient');
    mocked.savePublicFields.mockRejectedValue(
      new ApiError('These fields can never be made public: Insurance value.', 422),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Physical description' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/can never be made public/));
  });

  it('is read-only without permission', async () => {
    permissions.canPublish = false;
    const { container } = renderPage();
    const brief = await screen.findByRole('checkbox', { name: 'Brief description' });
    expect(brief).toBeDisabled();
    expect(brief).toHaveAccessibleDescription(/requires permission/);
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });
});
