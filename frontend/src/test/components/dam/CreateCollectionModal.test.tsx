import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateCollectionModal } from '../../../components/dam/CreateCollectionModal';

const { createMediaCollectionMock } = vi.hoisted(() => ({
  createMediaCollectionMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  createMediaCollection: createMediaCollectionMock,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderModal(props: Partial<Parameters<typeof CreateCollectionModal>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <CreateCollectionModal organizationId="org-1" onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

describe('CreateCollectionModal', () => {
  beforeEach(() => {
    createMediaCollectionMock.mockReset();
  });

  it('renders the title and submit button text', () => {
    renderModal();
    // Both the title heading and submit button render "Create Lightbox"
    expect(screen.getAllByText('Create Lightbox').length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole('button', { name: /Create Lightbox/, hidden: true }),
    ).toBeInTheDocument();
  });

  it('disables submit button while name is empty', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /Create Lightbox/, hidden: true })).toBeDisabled();
  });

  it('enables submit once a name is entered', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('My Lightbox'), {
      target: { value: 'Spring 2026' },
    });
    expect(screen.getByRole('button', { name: /Create Lightbox/, hidden: true })).not.toBeDisabled();
  });

  it('does NOT show consent clearance checkbox when visibility is private', () => {
    renderModal();
    expect(screen.queryByText('Require Consent Clearance')).not.toBeInTheDocument();
  });

  it('shows consent clearance checkbox when visibility is public', () => {
    renderModal();
    fireEvent.click(screen.getByDisplayValue('public'));
    expect(screen.getByText('Require Consent Clearance')).toBeInTheDocument();
  });

  it('calls createMediaCollection with the form values', async () => {
    createMediaCollectionMock.mockResolvedValue({ collection_id: 'col-1' });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    renderModal({ onClose, onCreated });
    fireEvent.change(screen.getByPlaceholderText('My Lightbox'), {
      target: { value: 'My Lightbox' },
    });
    fireEvent.change(screen.getByPlaceholderText('Optional description...'), {
      target: { value: 'A description' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create Lightbox/, hidden: true }));

    await waitFor(() =>
      expect(createMediaCollectionMock).toHaveBeenCalledWith('org-1', {
        name: 'My Lightbox',
        description: 'A description',
        visibility: 'private',
        consent_clearance_required: true,
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('col-1'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('renders the API error when creation fails', async () => {
    createMediaCollectionMock.mockRejectedValue(new Error('Server down'));
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('My Lightbox'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create Lightbox/, hidden: true }));
    await waitFor(() => expect(screen.getByText('Server down')).toBeInTheDocument());
  });

  it('Cancel triggers onClose', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
