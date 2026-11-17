import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import LookupValuesPage from '../../pages/collections/LookupValuesPage';
import { ApiError } from '../../lib/apiClient';
import { checkA11y } from '../a11y';

const api = vi.hoisted(() => ({
  getAllLookups: vi.fn(),
  createLookupValue: vi.fn(),
  updateLookupValue: vi.fn(),
  deleteLookupValue: vi.fn(),
  toggleHideLookupValue: vi.fn(),
  updateLookupSortOrder: vi.fn(),
}));
vi.mock('../../lib/api', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<object>()), useParams: () => ({ orgId: 'org' }) }));

const categories = [
  {
    category_id: 'c1',
    category_key: 'object_status',
    display_name: 'Object Status',
    description: 'Status of collection object',
    applicable_contexts: ['objects'],
    supports_icons: false,
    values: [
      {
        value_id: 'v1', category_id: 'c1', organization_id: null, value_key: 'accessioned', label: 'Accessioned',
        description: null, icon_name: null, sort_order: 0, is_active: true, is_hidden: false, is_system: true,
      },
    ],
  },
];

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LookupValuesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getAllLookups.mockResolvedValue(categories);
});

describe('LookupValuesPage', () => {
  it('announces a refused addition next to the form', async () => {
    api.createLookupValue.mockRejectedValueOnce(
      new ApiError(
        "Values in 'object_status' drive record workflow and cannot be added to. You can rename or hide the existing values.",
        400,
        'fixed_lookup_category',
      ),
    );
    const { container } = wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Add value to Object Status' }));
    const label = screen.getByLabelText(/Label/);
    fireEvent.change(label, { target: { value: 'In storage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(api.createLookupValue).toHaveBeenCalledWith('org', 'object_status', expect.objectContaining({ value_key: 'in_storage' })),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('cannot be added to');
    expect(label).toHaveAttribute('aria-invalid', 'true');
    expect(label).toHaveAccessibleDescription(/cannot be added to/);
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('clears the error when the form is opened again', async () => {
    api.createLookupValue.mockRejectedValueOnce(new ApiError('Refused', 400, 'fixed_lookup_category'));
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Add value to Object Status' }));
    fireEvent.change(screen.getByLabelText(/Label/), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refused');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing value' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add value to Object Status' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Label/)).not.toHaveAttribute('aria-invalid');
  });
});
