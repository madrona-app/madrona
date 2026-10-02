import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EntityDetailPage from '../../pages/shared/EntityDetailPage';
import * as api from '../../lib/api';
import * as useOrganizationHook from '../../contexts/useOrganization';
import * as useProjectionConfigHook from '../../hooks/useProjectionConfig';
import * as projectionResolver from '../../lib/projectionResolver';

vi.mock('../../lib/api', () => ({
  getEntity: vi.fn(),
}));

vi.mock('../../contexts/useOrganization', () => ({
  useOrganization: vi.fn(),
}));

vi.mock('../../hooks/useProjectionConfig', () => ({
  useProjectionConfig: vi.fn(),
}));

vi.mock('../../lib/projectionResolver', () => ({
  resolveEntityDisplayFields: vi.fn(),
}));

vi.mock('../../components/EntityHistoryTab', () => ({
  EntityHistoryTab: () => <div data-testid="history-tab">history</div>,
}));

vi.mock('../../components/EntityRelationshipsTab', () => ({
  EntityRelationshipsTab: () => <div data-testid="relationships-tab">relationships</div>,
}));

const mockGetEntity = vi.mocked(api.getEntity);
const mockUseOrganization = vi.mocked(useOrganizationHook.useOrganization);
const mockUseProjectionConfig = vi.mocked(useProjectionConfigHook.useProjectionConfig);
const mockResolve = vi.mocked(projectionResolver.resolveEntityDisplayFields);

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderPage(orgId = 'org-1', entityKey = 'ent-1') {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={[`/organizations/${orgId}/bridge/entities/${entityKey}`]}>
        <Routes>
          <Route
            path="/organizations/:orgId/bridge/entities/:entityKey"
            element={<EntityDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('EntityDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrganization.mockReturnValue({
      activeOrganizationId: 'org-1',
    } as never);
    mockUseProjectionConfig.mockReturnValue({ config: null } as never);
    mockResolve.mockReturnValue({
      title: 'Sample Entity',
      subtitle: 'A description',
      thumbnailUrl: null,
    } as never);
  });

  it('shows loader while entity is fetching', () => {
    mockGetEntity.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('renders entity title once loaded', async () => {
    mockGetEntity.mockResolvedValue({
      entity_key: 'ent-1',
      payload: { id: 'ent-1', label: 'Sample Entity' },
      fields: {},
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sample Entity' })).toBeInTheDocument();
    });
    expect(screen.getByText(/A description/)).toBeInTheDocument();
  });

  it('renders Entity Key text', async () => {
    mockGetEntity.mockResolvedValue({
      entity_key: 'ent-1',
      payload: {},
      fields: {},
    } as never);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Entity Key:/)).toBeInTheDocument();
    });
  });

  it('renders three tabs (Canonical JSON / History / Relationships)', async () => {
    mockGetEntity.mockResolvedValue({
      entity_key: 'ent-1',
      payload: { id: 'ent-1' },
      fields: {},
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /canonical json/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /history/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /relationships/i })).toBeInTheDocument();
  });

  it('shows the canonical JSON tab by default', async () => {
    mockGetEntity.mockResolvedValue({
      entity_key: 'ent-1',
      payload: { id: 'ent-1', custom: 'value' },
      fields: {},
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/"custom":/)).toBeInTheDocument();
    });
  });

  it('switches to history tab', async () => {
    mockGetEntity.mockResolvedValue({
      entity_key: 'ent-1',
      payload: {},
      fields: {},
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^history$/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^history$/i }));
    expect(screen.getByTestId('history-tab')).toBeInTheDocument();
  });

  it('switches to relationships tab', async () => {
    mockGetEntity.mockResolvedValue({
      entity_key: 'ent-1',
      payload: {},
      fields: {},
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /relationships/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /relationships/i }));
    expect(screen.getByTestId('relationships-tab')).toBeInTheDocument();
  });

  it('renders identifiers when present', async () => {
    mockGetEntity.mockResolvedValue({
      entity_key: 'ent-1',
      payload: {
        id: 'ent-1',
        identifiers: [{ scheme: 'isbn', value: '1234567890' }],
      },
      fields: {},
    } as never);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('isbn:')).toBeInTheDocument();
      expect(screen.getByText('1234567890')).toBeInTheDocument();
    });
  });

  it('renders View Original Source link when canonical_url present', async () => {
    mockGetEntity.mockResolvedValue({
      entity_key: 'ent-1',
      payload: {},
      fields: {},
      canonical_url: 'https://example.com/source',
    } as never);

    renderPage();

    await waitFor(() => {
      const link = screen.getByRole('link', { name: /view original source/i });
      expect(link).toHaveAttribute('href', 'https://example.com/source');
    });
  });
});
