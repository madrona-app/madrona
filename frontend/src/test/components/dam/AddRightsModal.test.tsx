import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddRightsModal } from '../../../components/dam/AddRightsModal';

const { createMediaRightsMock, updateMediaRightsMock } = vi.hoisted(() => ({
  createMediaRightsMock: vi.fn(),
  updateMediaRightsMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  createMediaRights: createMediaRightsMock,
  updateMediaRights: updateMediaRightsMock,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderModal(props: Partial<Parameters<typeof AddRightsModal>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <AddRightsModal
        isOpen
        organizationId="org-1"
        mediaId="m-1"
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('AddRightsModal', () => {
  beforeEach(() => {
    createMediaRightsMock.mockReset();
    updateMediaRightsMock.mockReset();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('shows "Add Rights" title in create mode', () => {
    renderModal();
    // Both the heading and the submit button render "Add Rights"
    expect(screen.getAllByText('Add Rights').length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole('button', { name: 'Add Rights', hidden: true }),
    ).toBeInTheDocument();
  });

  it('shows "Edit Rights" title and Save Changes button in edit mode', () => {
    const existing = {
      rights_id: 'r-1',
      rights_type: 'license',
      rights_status: 'in_copyright',
      rights_holder: 'Owner',
      license_type: 'CC-BY',
      license_url: '',
      rights_statement: '',
      start_date: '',
      end_date: '',
      territory: '',
      usage_restrictions: ['No commercial use'],
      is_active: true,
    } as any;
    renderModal({ existingRights: existing });
    expect(screen.getByText('Edit Rights')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes', hidden: true })).toBeInTheDocument();
    // Pre-fills holder
    expect(screen.getByDisplayValue('Owner')).toBeInTheDocument();
    // Pre-fills usage restriction tag
    expect(screen.getByText('No commercial use')).toBeInTheDocument();
  });

  it('adds a usage restriction via the Add button', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Add a restriction...'), {
      target: { value: 'Editorial only' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add', hidden: true }));
    expect(screen.getByText('Editorial only')).toBeInTheDocument();
  });

  it('does not add an empty restriction', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Add', hidden: true }));
    // No tag should be rendered
    expect(screen.queryAllByText(/^[A-Z]/).every(el => el.tagName !== 'SPAN' || !el.textContent?.includes('×'))).toBeTruthy();
  });

  it('does not duplicate an existing restriction', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Add a restriction...'), {
      target: { value: 'No print' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add', hidden: true }));
    fireEvent.change(screen.getByPlaceholderText('Add a restriction...'), {
      target: { value: 'No print' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add', hidden: true }));
    expect(screen.getAllByText('No print').length).toBe(1);
  });

  it('submits the form via the create endpoint in create mode', async () => {
    createMediaRightsMock.mockResolvedValue({});
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.change(screen.getByPlaceholderText('Name of copyright holder or licensor'), {
      target: { value: 'Acme Museum' },
    });
    const form = document.getElementById('rights-form') as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(createMediaRightsMock).toHaveBeenCalledWith(
        'org-1',
        'm-1',
        expect.objectContaining({
          rights_type: 'copyright',
          rights_holder: 'Acme Museum',
        }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('renders the API error inline on failure', async () => {
    createMediaRightsMock.mockRejectedValue(new Error('Cannot save rights'));
    renderModal();
    const form = document.getElementById('rights-form') as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText('Cannot save rights')).toBeInTheDocument());
  });

  it('Cancel triggers onClose', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
