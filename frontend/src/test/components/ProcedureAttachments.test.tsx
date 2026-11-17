import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProcedureAttachments } from '../../components/collections/ProcedureAttachments';
import { attachmentSizeLabel, attachmentTypeLabel } from '../../lib/attachmentLabels';
import { checkA11y } from '../a11y';

const { listMock, createMock, deleteMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('../../lib/api/procedure/signedDocuments', () => ({
  ATTACHMENT_DOCUMENT_TYPE: 'attachment',
  listSignedDocuments: listMock,
  createSignedDocument: createMock,
  deleteSignedDocument: deleteMock,
  signedDocumentDownloadUrl: (org: string, id: string) =>
    `/api/organizations/${org}/signed-documents/${id}/download`,
}));

function doc(overrides: Record<string, unknown> = {}) {
  return {
    signed_document_id: 'att-1',
    organization_id: 'org-1',
    procedure_type: 'acquisition',
    procedure_id: 'acq-1',
    document_type: 'attachment',
    label: 'Purchase invoice',
    description: 'Dealer invoice, March 2026',
    media_id: 'media-1',
    media_filename: 'invoice.pdf',
    media_mime_type: 'application/pdf',
    media_url: 'https://s3/x',
    media_file_size: 120 * 1024,
    download_url: '/api/organizations/org-1/signed-documents/att-1/download',
    reference: null,
    esign_provider: null,
    esign_envelope_id: null,
    esign_status: null,
    esign_recipients: null,
    esign_sent_at: null,
    esign_completed_at: null,
    created_at: '2026-11-01T12:00:00Z',
    created_by: null,
    updated_at: null,
    version: 1,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof ProcedureAttachments>[0]> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <main>
        <ProcedureAttachments
          organizationId="org-1"
          procedureType="acquisition"
          procedureId="acq-1"
          canManage
          {...props}
        />
      </main>
    </QueryClientProvider>,
  );
}

describe('ProcedureAttachments', () => {
  beforeEach(() => {
    listMock.mockReset();
    createMock.mockReset();
    deleteMock.mockReset();
  });

  it('lists attachments with named download links and asks only for attachments', async () => {
    listMock.mockResolvedValue({
      signed_documents: [
        doc(),
        doc({
          signed_document_id: 'att-2',
          label: 'Braille copy',
          description: null,
          media_filename: 'invoice.brf',
          media_mime_type: 'application/x-brf',
          media_file_size: 2048,
        }),
      ],
      count: 2,
    });
    const { container } = renderPanel();

    const link = await screen.findByRole('link', { name: 'Download Purchase invoice (PDF, 120 KB)' });
    expect(link).toHaveAttribute('href', '/api/organizations/org-1/signed-documents/att-1/download');
    expect(screen.getByRole('link', { name: 'Download Braille copy (BRF, 2 KB)' })).toBeInTheDocument();
    expect(screen.getByText('Dealer invoice, March 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete attachment Purchase invoice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete attachment Braille copy' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /Attached files/ })).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith('org-1', 'acquisition', 'acq-1', 'attachment');

    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('read-only mode hides upload and delete controls', async () => {
    listMock.mockResolvedValue({ signed_documents: [doc()], count: 1 });
    const { container } = renderPanel({
      canManage: false,
      readOnlyHint: 'Switch to edit mode to add or delete attachments.',
    });
    await screen.findByRole('link', { name: /Download Purchase invoice/ });
    expect(screen.queryByLabelText('File')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete attachment/ })).not.toBeInTheDocument();
    expect(screen.getByText('Switch to edit mode to add or delete attachments.')).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('shows the empty state and an accessible upload form', async () => {
    listMock.mockResolvedValue({ signed_documents: [], count: 0 });
    const { container } = renderPanel();
    expect(await screen.findByText('No attachments yet.')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Add an attachment' })).toBeInTheDocument();
    expect(screen.getByLabelText('File')).toHaveAttribute('type', 'file');
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Description (optional)')).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('validates missing file and title with described errors and focus', async () => {
    listMock.mockResolvedValue({ signed_documents: [], count: 0 });
    renderPanel();
    await screen.findByText('No attachments yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Upload attachment' }));
    const fileInput = screen.getByLabelText('File');
    expect(fileInput).toHaveAttribute('aria-invalid', 'true');
    expect(fileInput).toHaveAccessibleDescription(/Choose a file to attach\./);
    expect(fileInput).toHaveFocus();
    expect(createMock).not.toHaveBeenCalled();

    const file = new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    // Title is suggested from the file name; clearing it triggers the title error.
    const title = screen.getByLabelText('Title');
    expect(title).toHaveValue('invoice');
    fireEvent.change(title, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload attachment' }));
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAccessibleDescription('Enter a title for the attachment.');
    expect(title).toHaveFocus();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('uploads, announces, and moves focus to the new attachment', async () => {
    listMock.mockResolvedValueOnce({ signed_documents: [], count: 0 });
    renderPanel();
    await screen.findByText('No attachments yet.');

    const created = doc();
    createMock.mockResolvedValue(created);
    listMock.mockResolvedValue({ signed_documents: [created], count: 1 });

    const file = new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Purchase invoice' } });
    fireEvent.change(screen.getByLabelText('Description (optional)'), {
      target: { value: 'Dealer invoice, March 2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload attachment' }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith('org-1', {
        procedureType: 'acquisition',
        procedureId: 'acq-1',
        documentType: 'attachment',
        label: 'Purchase invoice',
        description: 'Dealer invoice, March 2026',
        file,
      }),
    );
    const link = await screen.findByRole('link', { name: 'Download Purchase invoice (PDF, 120 KB)' });
    await waitFor(() => expect(link).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Uploaded Purchase invoice.');
    expect(screen.getByLabelText('Title')).toHaveValue('');
  });

  it('reports upload failures in an alert', async () => {
    listMock.mockResolvedValue({ signed_documents: [], count: 0 });
    createMock.mockRejectedValue(new Error('Unsupported file type: application/x-msdownload'));
    renderPanel();
    await screen.findByText('No attachments yet.');
    const file = new File(['MZ'], 'tool.exe', { type: 'application/x-msdownload' });
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload attachment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not upload tool: Unsupported file type: application/x-msdownload',
    );
  });

  it('deletes after confirmation, announces, and focuses the next attachment', async () => {
    const first = doc();
    const second = doc({ signed_document_id: 'att-2', label: 'Correspondence', media_filename: 'letter.docx', media_mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    listMock.mockResolvedValueOnce({ signed_documents: [first, second], count: 2 });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Delete attachment Purchase invoice' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete Purchase invoice?')).toBeInTheDocument();

    deleteMock.mockResolvedValue({ success: true });
    listMock.mockResolvedValue({ signed_documents: [second], count: 1 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete attachment' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('org-1', 'att-1'));
    const nextLink = await screen.findByRole('link', { name: /Download Correspondence \(DOCX/ });
    await waitFor(() => expect(nextLink).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Deleted Purchase invoice.');
    expect(screen.queryByRole('link', { name: /Purchase invoice/ })).not.toBeInTheDocument();
  });

  it('focuses the list heading after deleting the last attachment', async () => {
    listMock.mockResolvedValueOnce({ signed_documents: [doc()], count: 1 });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete attachment Purchase invoice' }));
    deleteMock.mockResolvedValue({ success: true });
    listMock.mockResolvedValue({ signed_documents: [], count: 0 });
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete attachment' }));
    await screen.findByText('No attachments yet.');
    await waitFor(() => expect(screen.getByRole('heading', { name: /Attached files/ })).toHaveFocus());
  });
});

describe('attachment labels', () => {
  it('derives type from file name, then MIME type', () => {
    expect(attachmentTypeLabel({ media_filename: 'a.brf', media_mime_type: null })).toBe('BRF');
    expect(attachmentTypeLabel({ media_filename: 'noext', media_mime_type: 'application/pdf' })).toBe('PDF');
    expect(attachmentTypeLabel({ media_filename: null, media_mime_type: null })).toBe('file');
  });

  it('formats sizes', () => {
    expect(attachmentSizeLabel(500)).toBe('500 bytes');
    expect(attachmentSizeLabel(120 * 1024)).toBe('120 KB');
    expect(attachmentSizeLabel(3.4 * 1024 * 1024)).toBe('3.4 MB');
    expect(attachmentSizeLabel(null)).toBeNull();
  });
});
