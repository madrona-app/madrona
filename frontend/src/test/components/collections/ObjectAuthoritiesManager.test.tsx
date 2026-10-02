import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ObjectAuthoritiesManager } from '../../../components/collections/ObjectAuthoritiesManager';

const { getObjectAuthoritiesMock, unlinkObjectAuthorityMock } = vi.hoisted(() => ({
  getObjectAuthoritiesMock: vi.fn(),
  unlinkObjectAuthorityMock: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({
  getObjectAuthorities: getObjectAuthoritiesMock,
  unlinkObjectAuthority: unlinkObjectAuthorityMock,
}));

vi.mock('../../../components/collections/ObjectAuthoritiesManager/AddAuthoritySlideOver', () => ({
  AddAuthoritySlideOver: () => null,
}));

vi.mock('../../../components/collections/ObjectAuthoritiesManager/EditAuthoritySlideOver', () => ({
  EditAuthoritySlideOver: () => null,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderManager(props: Partial<Parameters<typeof ObjectAuthoritiesManager>[0]> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createClient()}>
        <ObjectAuthoritiesManager organizationId="org-1" objectId="obj-1" {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ObjectAuthoritiesManager', () => {
  beforeEach(() => {
    getObjectAuthoritiesMock.mockReset();
    unlinkObjectAuthorityMock.mockReset();
  });

  it('shows a loading state', () => {
    getObjectAuthoritiesMock.mockImplementation(() => new Promise(() => {}));
    renderManager();
    expect(screen.getByText('Biographies')).toBeInTheDocument();
  });

  it('renders an empty state when no authorities exist', async () => {
    getObjectAuthoritiesMock.mockResolvedValue([]);
    renderManager();
    await waitFor(() => screen.getByText('Biographies'));
  });

  it('renders an error state when API fails', async () => {
    getObjectAuthoritiesMock.mockRejectedValue(new Error('boom'));
    renderManager();
    await waitFor(() => screen.getByText('Failed to load biographies'));
    expect(screen.getByText('Failed to load biographies')).toBeInTheDocument();
  });

  it('renders authorities grouped by role', async () => {
    getObjectAuthoritiesMock.mockResolvedValue([
      {
        link_id: 'l-1',
        role: 'creator',
        authority: { preferred_name: 'Person A', authority_id: 'a-1' },
      },
      {
        link_id: 'l-2',
        role: 'donor',
        authority: { preferred_name: 'Person B', authority_id: 'a-2' },
      },
    ]);
    renderManager();
    await waitFor(() => screen.getByText('Person A'));
    expect(screen.getByText('Person A')).toBeInTheDocument();
    expect(screen.getByText('Person B')).toBeInTheDocument();
  });

  it('embedded mode does not wrap in a card', async () => {
    getObjectAuthoritiesMock.mockResolvedValue([]);
    const { container } = renderManager({ embedded: true });
    await waitFor(() => expect(getObjectAuthoritiesMock).toHaveBeenCalled());
    expect(container.querySelector('.card')).toBeNull();
  });

  it('not embedded — wraps in card', async () => {
    getObjectAuthoritiesMock.mockResolvedValue([]);
    const { container } = renderManager({ embedded: false });
    await waitFor(() => expect(getObjectAuthoritiesMock).toHaveBeenCalled());
    expect(container.querySelector('.card')).not.toBeNull();
  });

  it('shows the Biographies header', async () => {
    getObjectAuthoritiesMock.mockResolvedValue([]);
    renderManager();
    await waitFor(() => screen.getByText('Biographies'));
    expect(screen.getByText('Biographies')).toBeInTheDocument();
  });

  it('hides Add button when readOnly', async () => {
    getObjectAuthoritiesMock.mockResolvedValue([]);
    renderManager({ readOnly: true });
    await waitFor(() => expect(getObjectAuthoritiesMock).toHaveBeenCalled());
    // No "Add Biography" or similar button
    const addBtns = screen.queryAllByRole('button', { name: /Add/i });
    expect(addBtns.length).toBe(0);
  });
});
