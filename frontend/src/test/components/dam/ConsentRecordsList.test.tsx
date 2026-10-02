import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConsentRecordsList } from '../../../components/dam/ConsentRecordsList';

const { listMediaConsentsMock, deleteMediaConsentMock, getConsentDocumentUrlMock } = vi.hoisted(() => ({
  listMediaConsentsMock: vi.fn(),
  deleteMediaConsentMock: vi.fn(),
  getConsentDocumentUrlMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  listMediaConsents: listMediaConsentsMock,
  deleteMediaConsent: deleteMediaConsentMock,
  getConsentDocumentUrl: getConsentDocumentUrlMock,
  // Stubs for the AddConsentModal/RevokeConsentModal children:
  createMediaConsent: vi.fn(),
  updateMediaConsent: vi.fn(),
  uploadConsentDocument: vi.fn(),
  revokeMediaConsent: vi.fn(),
}));

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/formatters', () => ({
  formatDateShort: (s: string) => `short:${s}`,
}));

// Stub child modals so we don't worry about their internals
vi.mock('../../../components/dam/AddConsentModal', () => ({
  AddConsentModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="add-consent-modal" /> : null,
}));

vi.mock('../../../components/dam/RevokeConsentModal', () => ({
  RevokeConsentModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="revoke-consent-modal" /> : null,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderList() {
  return render(
    <QueryClientProvider client={createClient()}>
      <ConsentRecordsList organizationId="org-1" mediaId="m-1" />
    </QueryClientProvider>,
  );
}

describe('ConsentRecordsList', () => {
  beforeEach(() => {
    listMediaConsentsMock.mockReset();
    deleteMediaConsentMock.mockReset();
    getConsentDocumentUrlMock.mockReset();
  });

  it('shows the empty state when there are no consents', async () => {
    listMediaConsentsMock.mockResolvedValue({ consent_records: [] });
    renderList();
    await waitFor(() => expect(screen.getByText('No consent records')).toBeInTheDocument());
  });

  it('renders an error state on query failure', async () => {
    listMediaConsentsMock.mockRejectedValue(new Error('500'));
    renderList();
    await waitFor(() =>
      expect(screen.getByText('Failed to load consent records')).toBeInTheDocument(),
    );
  });

  it('renders a "Valid" badge when has_valid_consent is true', async () => {
    listMediaConsentsMock.mockResolvedValue({
      has_valid_consent: true,
      consent_records: [
        {
          consent_id: 'c-1',
          subject_name: 'Jane',
          consent_type: 'photo_release',
          consent_scope: 'public',
          is_valid: true,
        },
      ],
    });
    renderList();
    await waitFor(() => expect(screen.getByText('Valid')).toBeInTheDocument());
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });

  it('renders a "Review Needed" badge when there are records but none valid', async () => {
    listMediaConsentsMock.mockResolvedValue({
      has_valid_consent: false,
      consent_records: [
        {
          consent_id: 'c-1',
          subject_name: 'Jane',
          consent_type: 'photo_release',
          consent_scope: 'public',
          is_valid: false,
        },
      ],
    });
    renderList();
    await waitFor(() => expect(screen.getByText('Review Needed')).toBeInTheDocument());
    expect(screen.getByText('Revoked')).toBeInTheDocument();
  });

  it('opens the AddConsentModal when "Add Consent" is clicked', async () => {
    listMediaConsentsMock.mockResolvedValue({ consent_records: [] });
    renderList();
    await waitFor(() => screen.getByText('Add Consent'));
    fireEvent.click(screen.getByText('Add Consent'));
    expect(screen.getByTestId('add-consent-modal')).toBeInTheDocument();
  });

  it('renders friendly consent type and scope labels', async () => {
    listMediaConsentsMock.mockResolvedValue({
      has_valid_consent: true,
      consent_records: [
        {
          consent_id: 'c-1',
          subject_name: 'Jane',
          consent_type: 'model_release',
          consent_scope: 'commercial',
          is_valid: true,
        },
      ],
    });
    renderList();
    await waitFor(() => expect(screen.getByText('Model Release')).toBeInTheDocument());
    expect(screen.getByText('Commercial Use')).toBeInTheDocument();
  });
});
