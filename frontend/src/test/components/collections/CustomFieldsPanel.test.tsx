import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CustomFieldsPanel } from '../../../components/collections/CustomFieldsPanel';
import CustomFieldsSettingsPage from '../../../pages/collections/CustomFieldsSettingsPage';
import { ApiError } from '../../../lib/apiClient';
import { checkA11y } from '../../a11y';

const api = vi.hoisted(() => ({ listCustomFields: vi.fn(), saveObjectCustomFields: vi.fn(), createCustomField: vi.fn(),
  updateCustomField: vi.fn(), deactivateCustomField: vi.fn() }));
vi.mock('../../../lib/api/customFields', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<object>()), useParams: () => ({ orgId: 'org' }) }));

const defs = [
  { field_id: '1', key: 'braille_grade', label: 'Braille grade', help_text: 'Contracted or uncontracted', field_type: 'select',
    options: ['Grade 1', 'Grade 2'], is_required: false, is_searchable: true, is_public: true, section: null, sort_order: 0,
    is_active: true, view_roles: [], edit_roles: [], can_edit: true },
  { field_id: '2', key: 'formats', label: 'Accessible format', help_text: null, field_type: 'multi_select',
    options: ['Braille', 'Audio'], is_required: false, is_searchable: true, is_public: false, section: null, sort_order: 1,
    is_active: true, view_roles: [], edit_roles: [], can_edit: true },
  { field_id: '3', key: 'pages', label: 'Pages', help_text: null, field_type: 'number', options: [], is_required: true,
    is_searchable: true, is_public: false, section: null, sort_order: 2, is_active: true, view_roles: [], edit_roles: [], can_edit: true },
  { field_id: '4', key: 'checked', label: 'Shelf check', help_text: null, field_type: 'boolean', options: [], is_required: false,
    is_searchable: true, is_public: false, section: null, sort_order: 3, is_active: true, view_roles: [], edit_roles: ['admin'], can_edit: false },
];

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { vi.clearAllMocks(); api.listCustomFields.mockResolvedValue(defs); });

describe('CustomFieldsPanel', () => {
  it('read and edit views are labelled; read-only fields are text; no axe violations', async () => {
    const { container } = wrap(<CustomFieldsPanel orgId="org" objectId="o" canEdit values={{ braille_grade: 'Grade 2', formats: ['Audio'], checked: true }} />);
    expect(await screen.findByRole('region', { name: 'Additional fields' })).toBeInTheDocument();
    expect(screen.getByText('Grade 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit additional fields' }));
    expect(screen.getByLabelText('Braille grade')).toHaveAccessibleDescription('Contracted or uncontracted');
    expect(screen.getByRole('group', { name: 'Accessible format' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Audio' })).toBeChecked();
    expect(screen.getByLabelText(/Pages/)).toHaveAttribute('aria-required', 'true');
    expect(screen.queryByLabelText(/Shelf check/)).not.toBeInTheDocument();
    expect(screen.getByText(/read only for your role/)).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('saves only changed fields, and puts a server error on its field with focus', async () => {
    api.saveObjectCustomFields.mockRejectedValueOnce(new ApiError('Pages must be a number', 422, 'validation_error', { field: 'custom_fields.pages' }));
    wrap(<CustomFieldsPanel orgId="org" objectId="o" canEdit values={{ braille_grade: 'Grade 2' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit additional fields' }));
    fireEvent.change(screen.getByLabelText(/Pages/), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save additional fields' }));
    await waitFor(() => expect(api.saveObjectCustomFields).toHaveBeenCalledWith('org', 'o', { pages: '12' }));
    const pages = screen.getByLabelText(/Pages/);
    await waitFor(() => expect(pages).toHaveAttribute('aria-invalid', 'true'));
    expect(pages).toHaveAccessibleDescription('Pages must be a number');
    await waitFor(() => expect(pages).toHaveFocus());
  });
});

describe('CustomFieldsSettingsPage', () => {
  it('lists fields in a table and the editor is fully labelled', async () => {
    const { container } = wrap(<CustomFieldsSettingsPage />);
    expect(await screen.findByRole('rowheader', { name: 'Braille grade' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a field' }));
    expect(screen.getByLabelText('Field name')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'select' } });
    expect(screen.getByLabelText('Choices, one per line')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Who can see this field' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save field' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Give the field a name.');
    expect(screen.getByLabelText('Field name')).toHaveFocus();
    expect((await checkA11y(container)).violations).toEqual([]);
  });
});
