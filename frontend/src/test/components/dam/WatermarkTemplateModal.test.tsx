import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WatermarkTemplateModal } from '../../../components/dam/WatermarkTemplateModal';

vi.mock('../../../lib/api', () => ({
  createWatermarkTemplate: vi.fn(),
  uploadMedia: vi.fn(),
}));

import { createWatermarkTemplate } from '../../../lib/api';
const mockCreate = vi.mocked(createWatermarkTemplate);

function renderModal(props?: Partial<Parameters<typeof WatermarkTemplateModal>[0]>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WatermarkTemplateModal organizationId="org-1" onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

describe('WatermarkTemplateModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders title', () => {
    renderModal();
    expect(screen.getByText(/Create Watermark Template/i)).toBeInTheDocument();
  });

  it('shows text and image type toggle', () => {
    renderModal();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Image')).toBeInTheDocument();
  });

  it('starts with text watermark selected', () => {
    renderModal();
    // Text watermark fields: text, font size, font color, opacity
    expect(screen.getByText(/Watermark Text/i)).toBeInTheDocument();
  });

  it('switches to image type when Image button clicked', () => {
    renderModal();
    fireEvent.click(screen.getByText('Image'));
    // Image-related label should appear
    expect(screen.getByText(/Watermark Image/i)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('disables submit until name is provided', () => {
    renderModal();
    const create = screen.getByRole('button', { name: /Create Template/i, hidden: true });
    expect(create).toBeDisabled();
  });

  it('shows position dropdown options for text watermark', () => {
    renderModal();
    // Position select should contain bottom-right (default)
    expect(screen.getByDisplayValue('Bottom Right')).toBeInTheDocument();
  });

  it('calls createWatermarkTemplate on submit with text type', async () => {
    mockCreate.mockResolvedValue({ template_id: 'w-1' } as never);
    renderModal();
    const nameInput = screen.getByPlaceholderText('e.g., Copyright Notice');
    fireEvent.change(nameInput, { target: { value: 'Default Wm' } });
    const textInput = screen.getByPlaceholderText(/c\) 2024 Organization/i);
    fireEvent.change(textInput, { target: { value: 'Test' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Template/i, hidden: true }));
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled();
    });
  });
});
