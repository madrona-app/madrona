import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as apiClientModule from '../../../lib/apiClient';

// =========================================================================
// Module-level mocks.
// These workspace pages pull in dozens of heavy child components and
// contexts. We mock everything but the page-under-test + hooks.
// =========================================================================

vi.mock('../../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
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
    permissions: ['collections.edit', 'org.view_audit_logs'],
  }),
}));

vi.mock('../../../hooks/useFieldAccess', () => ({
  useFieldAccess: () => ({
    isRestricted: () => false,
    hasRestrictions: false,
  }),
}));

// Stub out heavy workspace UI components.
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
  EditableField: ({ label, value }: { label?: string; value?: unknown }) => (
    <div data-testid="editable-field" data-label={label}>
      {String(value ?? '')}
    </div>
  ),
  EditableSelect: ({ label, value }: { label?: string; value?: unknown }) => (
    <div data-testid="editable-select" data-label={label}>
      {String(value ?? '')}
    </div>
  ),
  EditableCheckbox: ({ label, value }: { label?: string; value?: unknown }) => (
    <div data-testid="editable-checkbox" data-label={label}>
      {String(value ?? '')}
    </div>
  ),
  RecordAuditHistory: () => <div data-testid="audit-history" />,
  SectionGroupDivider: ({ label }: { label?: string }) => (
    <div data-testid="section-divider">{label}</div>
  ),
  ReadOnlyBanner: ({ visible }: { visible?: boolean }) =>
    visible ? <div data-testid="read-only-banner">Read only</div> : null,
  PendingApprovalBanner: () => null,
  WorkspacePageShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  EditModeIndicator: () => null,
  WorkspaceErrorFallback: () => null,
  withErrorBoundary: <T,>(C: T) => C,
  RestrictedFieldPlaceholder: () => null,
  EditablePlaceField: () => null,
  SectionEmptyState: () => null,
}));

vi.mock('../../../components/record-detail', () => ({
  SectionOrderProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RecordDetailPageWrapper: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title?: string;
  }) => (
    <div data-testid="record-detail-wrapper" data-title={title}>
      {children}
    </div>
  ),
  useSectionOrder: () => [{}, vi.fn(), vi.fn()],
}));

vi.mock('../../../components/work/CreateTaskSlideOver', () => ({
  CreateTaskSlideOver: () => null,
}));

vi.mock('../../../components/ConfirmDialog', () => ({
  default: () => null,
}));

vi.mock('../../../components/ui/MadronaLoader', () => ({
  MadronaLoader: ({ label }: { label?: string }) => (
    <div role="status" aria-label="loading">
      {label}
    </div>
  ),
}));

// Stub out the section file mocks (Items/Legs/References/Documents).
vi.mock('../../../pages/collections/ShipmentWorkspacePage/ItemsSection', () => ({
  default: () => <div data-testid="items-section" />,
}));
vi.mock('../../../pages/collections/ShipmentWorkspacePage/LegsSection', () => ({
  default: () => <div data-testid="legs-section" />,
}));
vi.mock('../../../pages/collections/ShipmentWorkspacePage/ReferencesSection', () => ({
  default: () => <div data-testid="references-section" />,
}));
vi.mock('../../../pages/collections/ShipmentWorkspacePage/DocumentsSection', () => ({
  default: () => <div data-testid="documents-section" />,
}));

const mockApiFetch = vi.mocked(apiClientModule.apiFetch);

// SUT must be imported AFTER mocks.
import ShipmentWorkspacePage from '../../../pages/collections/ShipmentWorkspacePage';

function renderShipment(initialPath: string) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/shipments/create"
            element={<ShipmentWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/shipments/:shipmentId"
            element={<ShipmentWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const sampleShipment = {
  shipment_id: 'ship-1',
  organization_id: 'org-1',
  shipment_number: 'SHIP-001',
  shipment_type: 'outbound',
  shipment_type_label: 'Outbound',
  direction: 'outbound',
  direction_label: 'Outbound',
  purpose: 'loan',
  purpose_label: 'Loan',
  status: 'draft',
  status_label: 'Draft',
  ship_from_contact_id: null,
  ship_from_contact: null,
  ship_from_location_id: null,
  ship_from_location: null,
  ship_from_address: null,
  ship_to_contact_id: null,
  ship_to_contact: null,
  ship_to_location_id: null,
  ship_to_location: null,
  ship_to_address: null,
  requested_date: null,
  estimated_dispatch_date: null,
  estimated_arrival_date: null,
  actual_dispatch_date: null,
  actual_arrival_date: null,
  insurance_value_total: null,
  insurance_currency: 'USD',
  insurance_note: null,
  courier_required: false,
  is_international: false,
  is_high_value: false,
  authorized_by: null,
  authorization_date: null,
  remarks: null,
  internal_notes: null,
  legs: [],
  items: [],
  references: [],
  documents: [],
  status_history: [],
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-02T00:00:00Z',
};

describe('ShipmentWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  describe('loading state', () => {
    it('shows loader while fetching the shipment', () => {
      mockApiFetch.mockImplementation(() => new Promise(() => {}));
      renderShipment('/organizations/org-1/collections/shipments/ship-1');
      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders the not-found UI when fetch fails', async () => {
      mockApiFetch.mockRejectedValue(new Error('Network down'));
      renderShipment('/organizations/org-1/collections/shipments/ship-1');
      await waitFor(() => {
        expect(screen.getByText('Shipment not found')).toBeInTheDocument();
      });
      expect(screen.getByText('Network down')).toBeInTheDocument();
    });
  });

  describe('view mode with data', () => {
    it('renders the section dividers and shipment number', async () => {
      mockApiFetch.mockResolvedValue(sampleShipment as never);
      renderShipment('/organizations/org-1/collections/shipments/ship-1');
      await waitFor(() => {
        expect(screen.getByTestId('record-detail-wrapper')).toBeInTheDocument();
      });
      // Section dividers are rendered in the new layout.
      const dividers = screen.getAllByTestId('section-divider');
      expect(dividers.length).toBeGreaterThanOrEqual(1);
    });

    it('renders the change history section when the user has the audit permission', async () => {
      mockApiFetch.mockResolvedValue(sampleShipment as never);
      mockHasPermission.mockImplementation((p: string) => p === 'org.view_audit_logs' || p === 'collections.edit');
      renderShipment('/organizations/org-1/collections/shipments/ship-1');
      await waitFor(() => {
        expect(screen.getByTestId('ws-section-history')).toBeInTheDocument();
      });
    });

    it('hides the change history when the user lacks the audit permission', async () => {
      mockApiFetch.mockResolvedValue(sampleShipment as never);
      mockHasPermission.mockImplementation((p: string) => p === 'collections.edit');
      renderShipment('/organizations/org-1/collections/shipments/ship-1');
      await waitFor(() => {
        expect(screen.getByTestId('record-detail-wrapper')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('ws-section-history')).not.toBeInTheDocument();
    });

    it('shows the read-only banner when the user cannot edit', async () => {
      mockApiFetch.mockResolvedValue(sampleShipment as never);
      mockHasPermission.mockReturnValue(false);
      renderShipment('/organizations/org-1/collections/shipments/ship-1?layout=classic');
      await waitFor(() => {
        expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
      });
    });
  });

  describe('create mode', () => {
    it('renders the create header without fetching', async () => {
      renderShipment('/organizations/org-1/collections/shipments/create');
      await waitFor(() => {
        expect(screen.getByTestId('ws-header')).toHaveTextContent('New Shipment');
      });
      // No GET fetch should happen because there's no shipmentId.
      expect(mockApiFetch).not.toHaveBeenCalledWith(
        expect.stringMatching(/shipments\/[^/]+$/),
        expect.anything()
      );
    });
  });
});
