import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateChecklistModal } from '../../../components/exhibit/ExhibitionChecklistTab/CreateChecklistModal';

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
}));

vi.mock('../../../lib/apiClient', () => ({
  apiFetch: apiFetchMock,
}));

vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn() },
}));

function renderModal(extra: Partial<Parameters<typeof CreateChecklistModal>[0]> = {}) {
  const onClose = vi.fn();
  const onCreateFromTemplate = vi.fn().mockResolvedValue(undefined);
  const onCreateBlank = vi.fn().mockResolvedValue(undefined);
  return {
    onClose,
    onCreateFromTemplate,
    onCreateBlank,
    ...render(
      <CreateChecklistModal
        isOpen
        onClose={onClose}
        onCreateFromTemplate={onCreateFromTemplate}
        onCreateBlank={onCreateBlank}
        organizationId="org-1"
        {...extra}
      />,
    ),
  };
}

describe('CreateChecklistModal', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({ templates: [] });
  });

  it('renders nothing when not open', () => {
    const { container } = render(
      <CreateChecklistModal
        isOpen={false}
        onClose={() => {}}
        onCreateFromTemplate={async () => {}}
        onCreateBlank={async () => {}}
        organizationId="o"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the heading', async () => {
    renderModal();
    expect(screen.getByText('Create Checklist')).toBeInTheDocument();
  });

  it('shows the empty templates state when none returned', async () => {
    renderModal();
    expect(await screen.findByText(/No published templates available/)).toBeInTheDocument();
  });

  it('renders templates returned from the API', async () => {
    apiFetchMock.mockResolvedValue({
      templates: [
        {
          template_id: 't-1',
          name: 'Standard Exhibition',
          description: 'A standard checklist',
          exhibition_type: 'standard',
          published_version_id: 'v-1',
          published_version_number: 3,
        },
      ],
    });
    renderModal();
    expect(await screen.findByText('Standard Exhibition')).toBeInTheDocument();
    expect(screen.getByText('A standard checklist')).toBeInTheDocument();
    expect(screen.getByText('Version 3')).toBeInTheDocument();
  });

  it('clicking a template fires onCreateFromTemplate and onClose', async () => {
    apiFetchMock.mockResolvedValue({
      templates: [
        { template_id: 't-1', name: 'X', description: null, exhibition_type: '', published_version_id: 'v-1', published_version_number: 1 },
      ],
    });
    const { onCreateFromTemplate, onClose } = renderModal();
    fireEvent.click(await screen.findByText('X'));
    await waitFor(() => expect(onCreateFromTemplate).toHaveBeenCalledWith('t-1'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('switches to blank mode and shows the Name input', async () => {
    renderModal();
    fireEvent.click(screen.getByText('Blank Checklist'));
    expect(screen.getByText('Checklist Name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Exhibition Checklist')).toBeInTheDocument();
  });

  it('clicking Create on blank uses the typed name', async () => {
    const { onCreateBlank } = renderModal();
    fireEvent.click(screen.getByText('Blank Checklist'));
    fireEvent.change(screen.getByPlaceholderText('Exhibition Checklist'), {
      target: { value: 'My Custom Checklist' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Checklist' }));
    await waitFor(() => expect(onCreateBlank).toHaveBeenCalledWith('My Custom Checklist'));
  });

  it('falls back to default name when blank name is empty', async () => {
    const { onCreateBlank } = renderModal();
    fireEvent.click(screen.getByText('Blank Checklist'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Checklist' }));
    await waitFor(() => expect(onCreateBlank).toHaveBeenCalledWith('Exhibition Checklist'));
  });

  it('Cancel button calls onClose', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('hits the templates API with the right URL', async () => {
    renderModal();
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/organizations/org-1/exhibit/checklist-templates?published_only=true',
      ),
    );
  });
});
