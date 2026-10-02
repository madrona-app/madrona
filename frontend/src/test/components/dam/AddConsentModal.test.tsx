import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddConsentModal } from '../../../components/dam/AddConsentModal';

const { createMediaConsentMock, updateMediaConsentMock, uploadConsentDocumentMock } = vi.hoisted(() => ({
  createMediaConsentMock: vi.fn(),
  updateMediaConsentMock: vi.fn(),
  uploadConsentDocumentMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  createMediaConsent: createMediaConsentMock,
  updateMediaConsent: updateMediaConsentMock,
  uploadConsentDocument: uploadConsentDocumentMock,
}));

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderModal(props: Partial<Parameters<typeof AddConsentModal>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <AddConsentModal
        isOpen
        organizationId="org-1"
        mediaId="m-1"
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('AddConsentModal', () => {
  beforeEach(() => {
    createMediaConsentMock.mockReset();
    updateMediaConsentMock.mockReset();
    uploadConsentDocumentMock.mockReset();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('shows "Add Consent Record" title and Add Consent button in create mode', () => {
    renderModal();
    expect(screen.getByText('Add Consent Record')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Consent', hidden: true })).toBeInTheDocument();
  });

  it('disables submit when subject name is empty', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Add Consent', hidden: true })).toBeDisabled();
  });

  it('enables submit once a subject name is entered', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Name of person granting consent'), {
      target: { value: 'Jane' },
    });
    expect(screen.getByRole('button', { name: 'Add Consent', hidden: true })).not.toBeDisabled();
  });

  it('shows "Edit Consent Record" title and Save Changes in edit mode', () => {
    const existing = {
      consent_id: 'c-1',
      subject_name: 'John',
      subject_role: 'Visitor',
      consent_type: 'photo_release',
      consent_scope: 'public',
      consent_date: '2026-01-01T00:00:00Z',
      expiry_date: '2027-01-01T00:00:00Z',
      notes: 'Pre-existing',
    } as any;
    renderModal({ existingConsent: existing });
    expect(screen.getByText('Edit Consent Record')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Changes', hidden: true })).toBeInTheDocument();
    expect(screen.getByDisplayValue('John')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Visitor')).toBeInTheDocument();
    // Document upload not shown when editing
    expect(screen.queryByText('Click to upload signed consent form')).not.toBeInTheDocument();
  });

  it('submits via createMediaConsent and closes', async () => {
    createMediaConsentMock.mockResolvedValue({ consent_id: 'c-9' });
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.change(screen.getByPlaceholderText('Name of person granting consent'), {
      target: { value: 'Jane' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Consent', hidden: true }));
    await waitFor(() =>
      expect(createMediaConsentMock).toHaveBeenCalledWith(
        'org-1',
        'm-1',
        expect.objectContaining({ subject_name: 'Jane' }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('renders inline error if API fails', async () => {
    createMediaConsentMock.mockRejectedValue(new Error('fail!'));
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Name of person granting consent'), {
      target: { value: 'Jane' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Consent', hidden: true }));
    await waitFor(() => expect(screen.getByText('fail!')).toBeInTheDocument());
  });

  it('Cancel triggers onClose', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
