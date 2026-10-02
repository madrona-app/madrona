import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContactSelectorDisplay } from '../../components/collections/ContactSelectorDisplay';

const { getContactMock } = vi.hoisted(() => ({
  getContactMock: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  getContact: getContactMock,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderDisplay(
  overrides: Partial<Parameters<typeof ContactSelectorDisplay>[0]> = {}
) {
  return render(
    <QueryClientProvider client={createClient()}>
      <ContactSelectorDisplay
        orgId="org-1"
        contactId={undefined}
        label="Primary contact"
        isEditing={false}
        onSelect={vi.fn()}
        onClear={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>
  );
}

describe('ContactSelectorDisplay', () => {
  beforeEach(() => {
    getContactMock.mockReset();
  });

  describe('view mode', () => {
    it('renders the label', () => {
      renderDisplay();
      expect(screen.getByText('Primary contact')).toBeInTheDocument();
    });

    it('renders "Not specified" when no contact and no fallback', () => {
      renderDisplay();
      expect(screen.getByText('Not specified')).toBeInTheDocument();
    });

    it('renders fallback name when no contact is selected but fallback given', () => {
      renderDisplay({ fallbackName: 'John Doe (deleted)' });
      expect(screen.getByText('John Doe (deleted)')).toBeInTheDocument();
      expect(screen.queryByText('Not specified')).not.toBeInTheDocument();
    });

    it('fetches and displays the contact when contactId is provided', async () => {
      getContactMock.mockResolvedValue({
        name: 'Jane Curator',
        organization_name: 'Madrona Museum',
      });
      renderDisplay({ contactId: 'c-1' });
      await waitFor(() => expect(screen.getByText('Jane Curator')).toBeInTheDocument());
      expect(getContactMock).toHaveBeenCalledWith('org-1', 'c-1');
      expect(screen.getByText('(Madrona Museum)')).toBeInTheDocument();
    });

    it('hides the organization suffix when showOrganization is false', async () => {
      getContactMock.mockResolvedValue({
        name: 'Jane Curator',
        organization_name: 'Madrona Museum',
      });
      renderDisplay({ contactId: 'c-1', showOrganization: false });
      await waitFor(() => expect(screen.getByText('Jane Curator')).toBeInTheDocument());
      expect(screen.queryByText('(Madrona Museum)')).not.toBeInTheDocument();
    });
  });

  describe('edit mode', () => {
    it('renders the empty-state search button when no contact is selected', () => {
      renderDisplay({ isEditing: true });
      expect(screen.getByRole('button', { name: /Search or create/i })).toBeInTheDocument();
    });

    it('renders the custom placeholder', () => {
      renderDisplay({ isEditing: true, placeholder: 'Find a borrower…' });
      expect(screen.getByRole('button', { name: /Find a borrower/i })).toBeInTheDocument();
    });

    it('renders the required asterisk when required', () => {
      const { container } = renderDisplay({ isEditing: true, required: true });
      const asterisk = container.querySelector('.text-semantic-error');
      expect(asterisk?.textContent).toContain('*');
    });

    it('calls onSelect when the empty-state button is clicked', () => {
      const onSelect = vi.fn();
      renderDisplay({ isEditing: true, onSelect });
      fireEvent.click(screen.getByRole('button', { name: /Search or create/i }));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('renders the selected contact with Clear and Change buttons', async () => {
      getContactMock.mockResolvedValue({
        name: 'Jane Curator',
        organization_name: 'Madrona Museum',
      });
      renderDisplay({ isEditing: true, contactId: 'c-1' });
      await waitFor(() => expect(screen.getByText('Jane Curator')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Clear Primary contact' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    });

    it('calls onClear when the clear button is clicked', async () => {
      const onClear = vi.fn();
      getContactMock.mockResolvedValue({ name: 'Jane Curator' });
      renderDisplay({ isEditing: true, contactId: 'c-1', onClear });
      await waitFor(() => expect(screen.getByText('Jane Curator')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Clear Primary contact' }));
      expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('calls onSelect when the change button is clicked on a selected contact', async () => {
      const onSelect = vi.fn();
      getContactMock.mockResolvedValue({ name: 'Jane Curator' });
      renderDisplay({ isEditing: true, contactId: 'c-1', onSelect });
      await waitFor(() => expect(screen.getByText('Jane Curator')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Change' }));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });
});
