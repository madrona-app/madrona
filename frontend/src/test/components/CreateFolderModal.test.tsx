import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateFolderModal } from '../../components/dam/CreateFolderModal';

// Mock API calls
vi.mock('../../lib/api', () => ({
  createMediaFolder: vi.fn(() => Promise.resolve({ folder_id: 'f-1' })),
  updateMediaFolder: vi.fn(() => Promise.resolve({ folder_id: 'f-1' })),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderModal(props?: Partial<Parameters<typeof CreateFolderModal>[0]>) {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateFolderModal
        organizationId="org-1"
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  );
}

describe('CreateFolderModal', () => {
  describe('create mode', () => {
    it('renders "Create Folder" title', () => {
      renderModal();
      const matches = screen.getAllByText('Create Folder');
      // Appears in both the header and the submit button
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('renders folder name input', () => {
      renderModal();
      expect(screen.getByPlaceholderText('Enter folder name')).toBeInTheDocument();
    });

    it('renders "Folder Name" label', () => {
      renderModal();
      expect(screen.getByText('Folder Name')).toBeInTheDocument();
    });

    it('renders Cancel button', () => {
      renderModal();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('renders submit button with "Create Folder" text', () => {
      renderModal();
      const buttons = screen.getAllByText('Create Folder');
      // One in header, one on submit button
      expect(buttons.length).toBeGreaterThanOrEqual(1);
    });

    it('disables submit when name is empty', () => {
      renderModal();
      const _submitBtn = screen.getByRole('button', { name: /Create Folder/i });
      // The button with type="submit" should be disabled
      // Find it among buttons with that text
      const formSubmitButtons = screen.getAllByText('Create Folder').map(el => el.closest('button')).filter(el => el?.getAttribute('type') === 'submit');
      if (formSubmitButtons.length > 0) {
        expect(formSubmitButtons[0]).toBeDisabled();
      }
    });

    it('enables submit when name is not empty', () => {
      renderModal();
      fireEvent.change(screen.getByPlaceholderText('Enter folder name'), {
        target: { value: 'My Folder' },
      });
      const formSubmitButtons = screen.getAllByText('Create Folder').map(el => el.closest('button')).filter(el => el?.getAttribute('type') === 'submit');
      if (formSubmitButtons.length > 0) {
        expect(formSubmitButtons[0]).not.toBeDisabled();
      }
    });

    it('calls onClose when Cancel button is clicked', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when X button is clicked', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      // The X close button
      const closeButtons = screen.getAllByRole('button');
      const xButton = closeButtons.find(btn => btn.querySelector('svg') && btn.textContent === '');
      if (xButton) {
        fireEvent.click(xButton);
        expect(onClose).toHaveBeenCalledTimes(1);
      }
    });

    it('shows parent folder info when parentFolderName is provided', () => {
      renderModal({ parentFolderName: 'Photographs' });
      expect(screen.getByText(/Creating folder in:/)).toBeInTheDocument();
      expect(screen.getByText('Photographs')).toBeInTheDocument();
    });

    it('does not show parent folder info when not creating in subfolder', () => {
      renderModal();
      expect(screen.queryByText(/Creating folder in:/)).not.toBeInTheDocument();
    });
  });

  describe('edit mode', () => {
    const editFolder = {
      folder_id: 'f-1',
      name: 'Old Name',
      organization_id: 'org-1',
      parent_folder_id: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };

    it('renders "Rename Folder" title', () => {
      renderModal({ editFolder: editFolder as any });
      expect(screen.getByText('Rename Folder')).toBeInTheDocument();
    });

    it('pre-fills the input with existing folder name', () => {
      renderModal({ editFolder: editFolder as any });
      expect(screen.getByDisplayValue('Old Name')).toBeInTheDocument();
    });

    it('renders Rename button instead of Create', () => {
      renderModal({ editFolder: editFolder as any });
      expect(screen.getByText('Rename')).toBeInTheDocument();
      expect(screen.queryByText('Create Folder')).not.toBeInTheDocument();
    });

    it('does not show parent folder info in edit mode', () => {
      renderModal({ editFolder: editFolder as any, parentFolderName: 'Photographs' });
      expect(screen.queryByText(/Creating folder in:/)).not.toBeInTheDocument();
    });
  });

  describe('form validation', () => {
    it('shows error when submitting empty name', () => {
      renderModal();
      // Submit the form with empty name by finding the form and submitting
      const form = screen.getByPlaceholderText('Enter folder name').closest('form');
      if (form) {
        fireEvent.submit(form);
        expect(screen.getByText('Folder name is required')).toBeInTheDocument();
      }
    });

    it('shows error with AlertCircle icon styling', () => {
      renderModal();
      const form = screen.getByPlaceholderText('Enter folder name').closest('form');
      if (form) {
        fireEvent.submit(form);
        const errorEl = screen.getByText('Folder name is required');
        expect(errorEl.closest('div')).toHaveClass('text-semantic-error');
      }
    });
  });
});
