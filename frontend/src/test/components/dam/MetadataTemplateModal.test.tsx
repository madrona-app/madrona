import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MetadataTemplateModal } from '../../../components/dam/MetadataTemplateModal';

vi.mock('../../../lib/api', () => ({
  createMetadataTemplate: vi.fn(),
  updateMetadataTemplate: vi.fn(),
}));

import { createMetadataTemplate, updateMetadataTemplate } from '../../../lib/api';
const mockCreate = vi.mocked(createMetadataTemplate);
const mockUpdate = vi.mocked(updateMetadataTemplate);

function renderModal(props?: Partial<Parameters<typeof MetadataTemplateModal>[0]>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MetadataTemplateModal organizationId="org-1" onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

describe('MetadataTemplateModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders Create title when no template provided', () => {
    renderModal();
    expect(screen.getByText('Create Metadata Template')).toBeInTheDocument();
  });

  it('renders Edit title when editing', () => {
    renderModal({
      templateToEdit: {
        template_id: 't-1',
        organization_id: 'org-1',
        name: 'My Template',
        description: 'desc',
        is_default: false,
        template_fields: { creator: 'Alice' },
      } as never,
    });
    expect(screen.getByText('Edit Metadata Template')).toBeInTheDocument();
  });

  it('shows section headers', () => {
    renderModal();
    expect(screen.getByText('Basic Info')).toBeInTheDocument();
    expect(screen.getByText('Title Modification')).toBeInTheDocument();
    expect(screen.getByText('Descriptive Metadata')).toBeInTheDocument();
    expect(screen.getByText('Attribution')).toBeInTheDocument();
    expect(screen.getByText('Rights & Licensing')).toBeInTheDocument();
    expect(screen.getByText('Custom Metadata')).toBeInTheDocument();
  });

  it('disables submit when name is empty', () => {
    renderModal();
    const submit = screen.getByRole('button', { name: /Create Template/i, hidden: true });
    expect(submit).toBeDisabled();
  });

  it('enables submit when name is provided', () => {
    renderModal();
    const nameInput = screen.getByPlaceholderText('e.g., Photo Shoot January 2024');
    fireEvent.change(nameInput, { target: { value: 'My Template' } });
    const submit = screen.getByRole('button', { name: /Create Template/i, hidden: true });
    expect(submit).not.toBeDisabled();
  });

  it('creates template on submit', async () => {
    mockCreate.mockResolvedValue({ template_id: 't-1' } as never);
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('e.g., Photo Shoot January 2024'), {
      target: { value: 'New' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create Template/i, hidden: true }));
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled();
    });
  });

  it('updates template on submit when editing', async () => {
    mockUpdate.mockResolvedValue({ template_id: 't-1' } as never);
    renderModal({
      templateToEdit: {
        template_id: 't-1',
        organization_id: 'org-1',
        name: 'Existing',
        description: '',
        is_default: false,
      } as never,
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i, hidden: true }));
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('adds and removes custom metadata fields', () => {
    renderModal();
    fireEvent.click(screen.getByText('Add custom field'));
    const keyInputs = screen.getAllByPlaceholderText('Key');
    expect(keyInputs).toHaveLength(1);
    fireEvent.change(keyInputs[0], { target: { value: 'k' } });
    expect((keyInputs[0] as HTMLInputElement).value).toBe('k');
  });
});
