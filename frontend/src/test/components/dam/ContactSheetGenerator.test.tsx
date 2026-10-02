import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContactSheetGenerator } from '../../../components/dam/ContactSheetGenerator';

vi.mock('../../../lib/api/media-dam', () => ({
  generateContactSheet: vi.fn(),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('ContactSheetGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders layout select with 3 options', () => {
    renderWithQuery(
      <ContactSheetGenerator organizationId="org-1" collectionId="col-1" />
    );
    // Find the select by its label text nearby
    const layoutLabel = screen.getByText('Layout');
    const layoutContainer = layoutLabel.closest('div')!;
    const select = within(layoutContainer).getByRole('combobox');
    expect(select.querySelectorAll('option')).toHaveLength(3);
  });

  it('renders page size select', () => {
    renderWithQuery(
      <ContactSheetGenerator organizationId="org-1" collectionId="col-1" />
    );
    expect(screen.getByText('Page Size')).toBeInTheDocument();
    // Find the page size select
    const label = screen.getByText('Page Size');
    const container = label.closest('div')!;
    const select = within(container).getByRole('combobox');
    expect(select).toBeInTheDocument();
  });

  it('disables columns input for non-grid layouts', () => {
    renderWithQuery(
      <ContactSheetGenerator organizationId="org-1" collectionId="col-1" />
    );

    // Change layout to list
    const layoutLabel = screen.getByText('Layout');
    const layoutContainer = layoutLabel.closest('div')!;
    const layoutSelect = within(layoutContainer).getByRole('combobox');
    fireEvent.change(layoutSelect, { target: { value: 'list' } });

    // Columns input should be disabled
    const columnsInput = screen.getByRole('spinbutton');
    expect(columnsInput).toBeDisabled();
  });

  it('renders generate button', () => {
    renderWithQuery(
      <ContactSheetGenerator organizationId="org-1" collectionId="col-1" />
    );
    expect(screen.getByText('Generate Contact Sheet')).toBeInTheDocument();
  });

  it('renders checkboxes for include options', () => {
    renderWithQuery(
      <ContactSheetGenerator organizationId="org-1" collectionId="col-1" />
    );
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Filename')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();
  });
});
