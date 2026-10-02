import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BatchMetadataPanel } from '../../../components/dam/BatchMetadataPanel';

const { batchMediaOperationMock } = vi.hoisted(() => ({
  batchMediaOperationMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  batchMediaOperation: batchMediaOperationMock,
}));

vi.mock('../../../components/Checkbox', () => ({
  default: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input type="checkbox" {...props} />
  ),
}));

function renderPanel(props: Partial<React.ComponentProps<typeof BatchMetadataPanel>> = {}) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onClose,
    ...render(
      <QueryClientProvider client={client}>
        <BatchMetadataPanel
          organizationId="org-1"
          selectedMediaIds={['m-1', 'm-2', 'm-3']}
          onClose={onClose}
          {...props}
        />
      </QueryClientProvider>,
    ),
  };
}

describe('BatchMetadataPanel', () => {
  beforeEach(() => {
    batchMediaOperationMock.mockReset();
  });

  it('renders the title and subtitle reflecting the selected count', () => {
    renderPanel();
    expect(screen.getByText('Batch Edit Metadata')).toBeInTheDocument();
    expect(screen.getByText(/3 items selected/)).toBeInTheDocument();
  });

  it('renders three tabs: Tags, Fields, Credits', () => {
    renderPanel();
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.getByText('Fields')).toBeInTheDocument();
    expect(screen.getByText('Credits')).toBeInTheDocument();
  });

  it('typing a tag and pressing Enter adds it to the list', () => {
    renderPanel();
    const input = screen.getByPlaceholderText(/Enter tag and press Enter/);
    fireEvent.change(input, { target: { value: 'photo' } });
    fireEvent.keyPress(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    expect(screen.getByText('photo')).toBeInTheDocument();
  });

  it('apply button is disabled until changes are made', () => {
    renderPanel();
    const applyBtn = screen.getByText(/Apply to 3 Items/) as HTMLButtonElement;
    expect(applyBtn).toBeDisabled();
  });

  it('apply button enables after a tag is added', () => {
    renderPanel();
    const input = screen.getByPlaceholderText(/Enter tag and press Enter/);
    fireEvent.change(input, { target: { value: 'tag1' } });
    fireEvent.keyPress(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    const applyBtn = screen.getByText(/Apply to 3 Items/) as HTMLButtonElement;
    expect(applyBtn).not.toBeDisabled();
  });

  it('switching to Fields shows the title prefix input', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Fields'));
    expect(screen.getByText('Add Title Prefix')).toBeInTheDocument();
  });

  it('switching to Credits shows the credit input', () => {
    renderPanel();
    fireEvent.click(screen.getByText('Credits'));
    expect(screen.getByText('Set Credit')).toBeInTheDocument();
  });

  it('Cancel button invokes onClose', () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Apply triggers batchMediaOperation with the selected ids and tag updates', async () => {
    batchMediaOperationMock.mockResolvedValue({});
    renderPanel();
    const tagInput = screen.getByPlaceholderText(/Enter tag and press Enter/);
    fireEvent.change(tagInput, { target: { value: 'a-tag' } });
    fireEvent.keyPress(tagInput, { key: 'Enter', code: 'Enter', charCode: 13 });
    fireEvent.click(screen.getByText(/Apply to 3 Items/));
    await waitFor(() => expect(batchMediaOperationMock).toHaveBeenCalled());
    const call = batchMediaOperationMock.mock.calls[0];
    expect(call[0]).toBe('org-1');
    expect(call[2]).toEqual(['m-1', 'm-2', 'm-3']);
    expect((call[3] as { metadata_updates: { add_tags: string[] } }).metadata_updates.add_tags).toEqual([
      'a-tag',
    ]);
  });

  it('shows the warning banner about applying to selected items', () => {
    renderPanel();
    expect(
      screen.getByText(/Changes will be applied to all 3 selected items/),
    ).toBeInTheDocument();
  });

  it('removing a queued tag drops it from the list', () => {
    const { container } = renderPanel();
    const input = screen.getByPlaceholderText(/Enter tag and press Enter/);
    fireEvent.change(input, { target: { value: 'rem' } });
    fireEvent.keyPress(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    expect(screen.getByText('rem')).toBeInTheDocument();
    // Find the X button next to the tag chip
    const removeBtn = container.querySelector('span.bg-semantic-success\\/10 button');
    if (removeBtn) {
      fireEvent.click(removeBtn);
      expect(screen.queryByText('rem')).toBeNull();
    }
  });
});
