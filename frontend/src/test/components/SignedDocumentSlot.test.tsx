import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SignedDocumentSlot } from '../../components/collections/SignedDocumentSlot';

const { listMock, createMock, deleteMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('../../lib/api/procedure/signedDocuments', () => ({
  listSignedDocuments: listMock,
  createSignedDocument: createMock,
  deleteSignedDocument: deleteMock,
}));

vi.mock('../ConfirmDialog', () => ({
  default: ({
    isOpen,
    title,
    onConfirm,
    onClose,
  }: {
    isOpen: boolean;
    title: string;
    onConfirm: () => void;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div role="alertdialog">
        <p>{title}</p>
        <button onClick={onConfirm}>ConfirmRemove</button>
        <button onClick={onClose}>CancelRemove</button>
      </div>
    ) : null,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderSlot(props: Partial<Parameters<typeof SignedDocumentSlot>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <SignedDocumentSlot
        organizationId="org-1"
        procedureType="object_entry"
        procedureId="entry-1"
        documentType="entry_form"
        title="Signed Entry Form"
        helpText="Upload the depositor-signed entry form."
        isEditing={false}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('SignedDocumentSlot', () => {
  beforeEach(() => {
    listMock.mockReset();
    createMock.mockReset();
    deleteMock.mockReset();
  });

  it('renders the title and help text', async () => {
    listMock.mockResolvedValue({ signed_documents: [] });
    renderSlot();
    expect(screen.getByText('Signed Entry Form')).toBeInTheDocument();
    expect(screen.getByText('Upload the depositor-signed entry form.')).toBeInTheDocument();
  });

  it('shows the loading state', () => {
    listMock.mockReturnValue(new Promise(() => {}));
    renderSlot();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows the empty state when no documents are attached', async () => {
    listMock.mockResolvedValue({ signed_documents: [] });
    renderSlot();
    await waitFor(() =>
      expect(screen.getByText('No signed document attached yet.')).toBeInTheDocument(),
    );
  });

  it('renders attached documents with media filename and Open link', async () => {
    listMock.mockResolvedValue({
      signed_documents: [
        {
          signed_document_id: 'sd-1',
          procedure_type: 'object_entry',
          procedure_id: 'entry-1',
          document_type: 'entry_form',
          label: 'Signed copy',
          media_filename: 'entry_form.pdf',
          media_id: 'media-1',
          media_url: 'https://example.com/file.pdf',
          reference: null,
          created_at: '2024-04-01T10:00:00Z',
        },
      ],
    });
    renderSlot();
    await waitFor(() => expect(screen.getByText('Signed copy')).toBeInTheDocument());
    expect(screen.getByText('entry_form.pdf')).toBeInTheDocument();
    const openLink = screen.getByTitle('Open signed document');
    expect(openLink).toHaveAttribute('href', 'https://example.com/file.pdf');
    // First doc gets a "Current" badge
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('hides upload controls when not editing', async () => {
    listMock.mockResolvedValue({ signed_documents: [] });
    renderSlot();
    await waitFor(() =>
      expect(screen.getByText('No signed document attached yet.')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Upload signed file')).not.toBeInTheDocument();
  });

  it('shows upload + reference controls when editing', async () => {
    listMock.mockResolvedValue({ signed_documents: [] });
    renderSlot({ isEditing: true });
    await waitFor(() => expect(screen.getByText('Upload signed file')).toBeInTheDocument());
    expect(screen.getByPlaceholderText(/Label/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Signed form in file/)).toBeInTheDocument();
    expect(screen.getByText('Save reference')).toBeInTheDocument();
  });

  it('disables the Save reference button while reference field is empty', async () => {
    listMock.mockResolvedValue({ signed_documents: [] });
    renderSlot({ isEditing: true });
    await waitFor(() => expect(screen.getByText('Save reference')).toBeInTheDocument());
    expect(screen.getByText('Save reference').closest('button')).toBeDisabled();
  });

  it('enables Save reference once a value is entered, and submits via mutation', async () => {
    listMock.mockResolvedValue({ signed_documents: [] });
    createMock.mockResolvedValue({ signed_document_id: 'sd-new' });
    renderSlot({ isEditing: true });
    await waitFor(() => expect(screen.getByText('Save reference')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Signed form in file/), {
      target: { value: 'F-2024-001' },
    });
    const saveBtn = screen.getByText('Save reference').closest('button')!;
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        procedureType: 'object_entry',
        procedureId: 'entry-1',
        documentType: 'entry_form',
        reference: 'F-2024-001',
      }),
    );
  });

  it('renders a Generate-unsigned button when callback is provided', async () => {
    listMock.mockResolvedValue({ signed_documents: [] });
    const onGenerateUnsigned = vi.fn();
    renderSlot({
      isEditing: true,
      onGenerateUnsigned,
      generateUnsignedLabel: 'Generate receipt',
    });
    await waitFor(() => expect(screen.getByText('Generate receipt')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Generate receipt'));
    expect(onGenerateUnsigned).toHaveBeenCalledTimes(1);
  });
});
