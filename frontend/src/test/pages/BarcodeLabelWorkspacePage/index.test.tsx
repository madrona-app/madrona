import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as apiClientModule from '../../../lib/apiClient';

vi.mock('../../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../../lib/api/admin', () => ({
  getOrganizationBranding: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../contexts/AgentChatContext', () => ({
  useAgentChatContext: () => ({
    setEntityContext: vi.fn(),
    isOpen: false,
    entityContext: null,
    openChat: vi.fn(),
    closeChat: vi.fn(),
    openChatWithMessage: vi.fn(),
    registerDispatch: vi.fn(),
  }),
}));

vi.mock('../../../contexts/PageContext', () => ({
  usePageContext: () => ({
    setPageContext: vi.fn(),
    clearEntityContext: vi.fn(),
    hasProvider: true,
  }),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), toasts: [], dismissToast: vi.fn() }),
}));

const mockHasPermission = vi.fn().mockReturnValue(true);
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: mockHasPermission,
    permissions: ['barcodes.edit'],
  }),
}));

vi.mock('../../../components/workspace', () => ({
  WorkspaceHeader: ({ title }: { title?: string }) => (
    <header data-testid="ws-header">{title}</header>
  ),
  WorkspaceErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  WorkspaceSection: ({
    id,
    title,
    children,
  }: {
    id?: string;
    title?: string;
    children?: React.ReactNode;
  }) => (
    <section data-testid={`ws-section-${id ?? 'unknown'}`} aria-label={title}>
      {children}
    </section>
  ),
  SectionGroupDivider: ({ label }: { label?: string }) => (
    <div data-testid="section-divider">{label}</div>
  ),
}));

vi.mock('../../../components/record-detail', () => ({
  SectionOrderProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RecordDetailPageWrapper: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="record-detail-wrapper">{children}</div>
  ),
  useSectionOrder: () => [{}, vi.fn(), vi.fn()],
}));

vi.mock('../../../components/work/CreateTaskSlideOver', () => ({
  CreateTaskSlideOver: () => null,
}));

vi.mock('../../../components/Checkbox', () => ({
  default: () => null,
}));

vi.mock('../../../components/ui/MadronaLoader', () => ({
  MadronaLoader: ({ label }: { label?: string }) => (
    <div role="status" aria-label="loading">{label}</div>
  ),
}));

// Mock bwip-js (canvas-rendering library) so the BarcodeVisual doesn't crash
vi.mock('bwip-js', () => ({
  default: {
    toCanvas: vi.fn(),
  },
}));

const mockApiFetch = vi.mocked(apiClientModule.apiFetch);

import BarcodeLabelWorkspacePage from '../../../pages/collections/BarcodeLabelWorkspacePage';

function renderBarcode(initialPath: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/barcodes/labels/create"
            element={<BarcodeLabelWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/barcodes/labels/:labelId"
            element={<BarcodeLabelWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const sampleLabel = {
  label_id: 'label-1',
  organization_id: 'org-1',
  entity_type: 'collection_object',
  entity_type_label: 'Collection Object',
  entity_id: 'obj-1',
  barcode_value: 'ABC123',
  label_format: 'code128',
  label_format_label: 'Code 128',
  is_printed: false,
  print_count: 0,
  last_printed_at: null,
  batch_id: null,
  status: 'active',
  status_label: 'Active',
  note: null,
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
  entity_summary: { object_number: 'OBJ-1', title: 'Vase' },
  public_url: null,
};

describe('BarcodeLabelWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
    // Default fetch handler — empty enums, empty entity search.
    mockApiFetch.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.includes('/enums')) {
        return Promise.resolve({
          entity_types: [],
          label_formats: [],
        }) as never;
      }
      return Promise.resolve({ objects: [] }) as never;
    });
  });

  describe('loading state', () => {
    it('shows the loader while fetching label', () => {
      mockApiFetch.mockImplementation(() => new Promise(() => {}));
      renderBarcode('/organizations/org-1/collections/barcodes/labels/label-1');
      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders not-found when fetch returns nothing', async () => {
      mockApiFetch.mockResolvedValue(undefined as never);
      renderBarcode('/organizations/org-1/collections/barcodes/labels/label-1');
      await waitFor(() => {
        expect(screen.getByText('Label not found')).toBeInTheDocument();
      });
    });
  });

  describe('view mode with data', () => {
    it('renders label sections', async () => {
      mockApiFetch.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.includes('/labels/label-1')) {
          return Promise.resolve(sampleLabel) as never;
        }
        return Promise.resolve({ entity_types: [], label_formats: [] }) as never;
      });
      renderBarcode('/organizations/org-1/collections/barcodes/labels/label-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-label')).toBeInTheDocument();
      });
    });
  });

  describe('create mode', () => {
    it('renders the entity selection section', async () => {
      renderBarcode('/organizations/org-1/collections/barcodes/labels/create');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-entity')).toBeInTheDocument();
      });
    });

    it('renders the format section in create mode', async () => {
      renderBarcode('/organizations/org-1/collections/barcodes/labels/create');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-format')).toBeInTheDocument();
      });
    });
  });
});
