import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DocumentationPlanWorkspacePage from '../../../pages/collections/DocumentationPlanWorkspacePage';
import * as api from '../../../lib/api';

// jsdom polyfill
if (!Element.prototype.scrollIntoView) {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  Element.prototype.scrollIntoView = function () {};
}

// ----------------------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------------------

const { mockHasPermission, mockSetEntityContext, mockSetPageContext, mockClearEntityContext } =
  vi.hoisted(() => ({
    mockHasPermission: vi.fn().mockReturnValue(true),
    mockSetEntityContext: vi.fn(),
    mockSetPageContext: vi.fn(),
    mockClearEntityContext: vi.fn(),
  }));

vi.mock('../../../lib/api', () => ({
  getDocumentationPlan: vi.fn(),
  createDocumentationPlan: vi.fn(),
  updateDocumentationPlan: vi.fn(),
  deleteDocumentationPlan: vi.fn(),
  approveDocumentationPlan: vi.fn(),
  startDocumentationPlan: vi.fn(),
  completeDocumentationPlan: vi.fn(),
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(() => ({
    hasPermission: mockHasPermission,
    hasAnyPermission: vi.fn().mockReturnValue(true),
    hasAllPermissions: vi.fn().mockReturnValue(true),
  })),
}));

vi.mock('../../../hooks/useFieldAccess', () => ({
  useFieldAccess: vi.fn(() => ({
    isRestricted: () => false,
    hasRestrictions: false,
  })),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: { user_id: 'u-1', email: 'test@example.com' },
    activeOrganizationId: 'org-1',
    isLoading: false,
    isAuthenticated: true,
  })),
}));

vi.mock('../../../hooks/useLookupValues', () => ({
  useLookupValues: vi.fn(() => ({
    getLookup: vi.fn(() => [{ value: 'cataloging_plan', label: 'Cataloging Plan' }]),
    getLabel: vi.fn((_ctx: string, val: string) => val),
    isLoading: false,
    error: null,
  })),
  default: vi.fn(() => ({
    getLookup: vi.fn(() => []),
    getLabel: vi.fn((_ctx: string, val: string) => val),
    isLoading: false,
    error: null,
  })),
}));

vi.mock('../../../hooks/useProcedureRequirements', () => ({
  useProcedureRequirements: vi.fn(() => ({
    requirementGroups: [],
    statusOrder: ['draft', 'approved', 'in_progress', 'completed'],
    isLoading: false,
    error: null,
  })),
}));

vi.mock('../../../contexts/AgentChatContext', () => ({
  useAgentChatContext: vi.fn(() => ({
    setEntityContext: mockSetEntityContext,
    isOpen: false,
    entityContext: null,
    openChat: vi.fn(),
    closeChat: vi.fn(),
    openChatWithMessage: vi.fn(),
    registerDispatch: vi.fn(),
  })),
}));

vi.mock('../../../contexts/PageContext', () => ({
  usePageContext: vi.fn(() => ({
    pageContext: {},
    pageContextRef: { current: {} },
    setPageContext: mockSetPageContext,
    clearEntityContext: mockClearEntityContext,
    hasProvider: true,
  })),
}));

vi.mock('../../../components/workspace/RecordAuditHistory', () => ({
  RecordAuditHistory: () => <div data-testid="record-audit-history" />,
}));

vi.mock('../../../components/work/CreateTaskSlideOver', () => ({
  CreateTaskSlideOver: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="create-task-slideover" /> : null,
}));

vi.mock('../../../components/collections/ProcedureRequirementsCard', () => ({
  ProcedureRequirementsCard: () => <div data-testid="procedure-requirements-card" />,
}));

vi.mock('../../../components/record-detail', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../components/record-detail'
  );
  return {
    ...actual,
    RecordDetailPageWrapper: ({
      children,
      callbacks,
    }: {
      children: React.ReactNode;
      callbacks?: { onDelete?: () => void; onCreateTask?: () => void };
    }) => (
      <div data-testid="record-detail-wrapper">
        <button data-testid="trigger-delete" onClick={() => callbacks?.onDelete?.()}>
          trigger-delete
        </button>
        <button data-testid="trigger-create-task" onClick={() => callbacks?.onCreateTask?.()}>
          trigger-create-task
        </button>
        {children}
      </div>
    ),
  };
});

const mockGetDocumentationPlan = vi.mocked(api.getDocumentationPlan);
const mockCreateDocumentationPlan = vi.mocked(api.createDocumentationPlan);
const mockUpdateDocumentationPlan = vi.mocked(api.updateDocumentationPlan);
const mockDeleteDocumentationPlan = vi.mocked(api.deleteDocumentationPlan);
const mockApproveDocumentationPlan = vi.mocked(api.approveDocumentationPlan);
const mockStartDocumentationPlan = vi.mocked(api.startDocumentationPlan);
const mockCompleteDocumentationPlan = vi.mocked(api.completeDocumentationPlan);

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage({
  orgId = 'org-1',
  planId = 'plan-1',
  layout = 'classic',
}: {
  orgId?: string;
  planId?: string | null;
  layout?: 'classic' | 'new';
} = {}) {
  const qc = createTestQueryClient();
  const path = planId
    ? `/organizations/${orgId}/collections/documentation-plans/${planId}${layout === 'classic' ? '?layout=classic' : ''}`
    : `/organizations/${orgId}/collections/documentation-plans/create`;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/organizations/:orgId/collections/documentation-plans/create"
            element={<DocumentationPlanWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/documentation-plans/:planId"
            element={<DocumentationPlanWorkspacePage />}
          />
          <Route
            path="/organizations/:orgId/collections/documentation-plans"
            element={<div>Documentation Plans</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const fixturePlan = {
  plan_id: 'plan-1',
  plan_number: 'DP-2024-001',
  title: 'Annual Cataloging Plan',
  plan_type: 'cataloging_plan',
  objectives: 'Catalog all 19th-century textiles',
  measurable_results: ['1000 records cataloged'],
  actions: ['Train catalogers', 'Build photo workflow'],
  milestones: [{ date: '2024-06-30', description: 'Mid-year review' }],
  resources_required: '2 catalogers, 1 photographer',
  start_date: '2024-01-01',
  end_date: '2024-12-31',
  review_frequency: 'monthly',
  next_review_date: '2024-02-01',
  notes: 'Curator notes',
  status: 'draft',
  approved_by: null,
  approval_date: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-02-01T00:00:00Z',
};

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('DocumentationPlanWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
  });

  describe('loading & error', () => {
    it('shows loader while fetching plan', () => {
      mockGetDocumentationPlan.mockImplementation(() => new Promise(() => {}));
      renderPage();
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('shows not-found message on API error', async () => {
      mockGetDocumentationPlan.mockRejectedValue(new Error('plan boom'));
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/Documentation Plan not found/i)).toBeInTheDocument();
      });
      expect(screen.getByText('plan boom')).toBeInTheDocument();
    });
  });

  describe('view mode (classic layout)', () => {
    it('renders the plan title', async () => {
      mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Annual Cataloging Plan')).toBeInTheDocument();
      });
    });

    it('shows plan number in header', async () => {
      mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('DP-2024-001')).toBeInTheDocument();
      });
    });

    it('shows status badge for draft', async () => {
      mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Draft')).toBeInTheDocument();
      });
    });

    it('shows Approve button when status=draft', async () => {
      mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      });
    });

    it('shows Start button when status=approved', async () => {
      mockGetDocumentationPlan.mockResolvedValue({
        ...fixturePlan,
        status: 'approved',
      } as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^start/i })).toBeInTheDocument();
      });
    });

    it('shows Complete button when status=in_progress', async () => {
      mockGetDocumentationPlan.mockResolvedValue({
        ...fixturePlan,
        status: 'in_progress',
      } as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /complete/i })).toBeInTheDocument();
      });
    });
  });

  describe('workflow actions', () => {
    it('calls approveDocumentationPlan when Approve clicked', async () => {
      mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
      mockApproveDocumentationPlan.mockResolvedValue(fixturePlan as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /approve/i }));
      await waitFor(() => {
        expect(mockApproveDocumentationPlan).toHaveBeenCalledWith('org-1', 'plan-1');
      });
    });

    it('calls startDocumentationPlan when Start clicked', async () => {
      mockGetDocumentationPlan.mockResolvedValue({
        ...fixturePlan,
        status: 'approved',
      } as never);
      mockStartDocumentationPlan.mockResolvedValue(fixturePlan as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^start/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /^start/i }));
      await waitFor(() => {
        expect(mockStartDocumentationPlan).toHaveBeenCalledWith('org-1', 'plan-1');
      });
    });

    it('calls completeDocumentationPlan when Complete clicked', async () => {
      mockGetDocumentationPlan.mockResolvedValue({
        ...fixturePlan,
        status: 'in_progress',
      } as never);
      mockCompleteDocumentationPlan.mockResolvedValue(fixturePlan as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /complete/i })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /complete/i }));
      await waitFor(() => {
        expect(mockCompleteDocumentationPlan).toHaveBeenCalledWith('org-1', 'plan-1');
      });
    });
  });

  describe('create mode', () => {
    it('renders New Documentation Plan title', async () => {
      renderPage({ planId: null });
      await waitFor(() => {
        expect(screen.getByText('New Documentation Plan')).toBeInTheDocument();
      });
      expect(mockGetDocumentationPlan).not.toHaveBeenCalled();
    });

    it('shows Create Plan button', async () => {
      renderPage({ planId: null });
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create plan/i })
        ).toBeInTheDocument();
      });
    });

    it('blocks create when title is empty', async () => {
      renderPage({ planId: null });
      await waitFor(() => {
        expect(screen.getByText('New Documentation Plan')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: /create plan/i }));
      await waitFor(() => {
        expect(screen.getByText(/Title is required/i)).toBeInTheDocument();
      });
      expect(mockCreateDocumentationPlan).not.toHaveBeenCalled();
    });

    it('calls createDocumentationPlan with payload when title set', async () => {
      mockCreateDocumentationPlan.mockResolvedValue({
        ...fixturePlan,
        plan_id: 'new-plan',
      } as never);
      renderPage({ planId: null });
      await waitFor(() => {
        expect(screen.getByText('New Documentation Plan')).toBeInTheDocument();
      });
      const input = screen.getByPlaceholderText(/Photography Digitisation Plan/i);
      fireEvent.change(input, { target: { value: 'My New Plan' } });
      fireEvent.click(screen.getByRole('button', { name: /create plan/i }));
      await waitFor(() => {
        expect(mockCreateDocumentationPlan).toHaveBeenCalled();
      });
      const payload = mockCreateDocumentationPlan.mock.calls[0][1];
      expect(payload.title).toBe('My New Plan');
      expect(payload.plan_type).toBe('cataloging_plan');
    });
  });

  describe('section editing & autosave', () => {
    it('saves on field edit (debounced)', async () => {
      vi.useFakeTimers();
      try {
        mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
        mockUpdateDocumentationPlan.mockResolvedValue(fixturePlan as never);

        renderPage();
        await act(async () => {
          await vi.runAllTimersAsync();
        });

        const inputs = screen.getAllByDisplayValue('Annual Cataloging Plan');
        fireEvent.change(inputs[0], { target: { value: 'Updated Plan' } });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(1100);
        });

        expect(mockUpdateDocumentationPlan).toHaveBeenCalled();
        const payload = mockUpdateDocumentationPlan.mock.calls[0][2];
        expect(payload.title).toBe('Updated Plan');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('list field operations', () => {
    it('adds a measurable_result via Enter key', async () => {
      vi.useFakeTimers();
      try {
        mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
        mockUpdateDocumentationPlan.mockResolvedValue(fixturePlan as never);

        renderPage();
        await act(async () => {
          await vi.runAllTimersAsync();
        });

        const addResultInput = screen.getByPlaceholderText('Add measurable result...');
        fireEvent.change(addResultInput, { target: { value: 'New result' } });
        fireEvent.keyDown(addResultInput, { key: 'Enter' });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(1100);
        });

        expect(mockUpdateDocumentationPlan).toHaveBeenCalled();
        const lastCall = mockUpdateDocumentationPlan.mock.calls[
          mockUpdateDocumentationPlan.mock.calls.length - 1
        ];
        expect(lastCall[2].measurable_results).toContain('New result');
      } finally {
        vi.useRealTimers();
      }
    });

    it('adds an action via the Add button', async () => {
      vi.useFakeTimers();
      try {
        mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
        mockUpdateDocumentationPlan.mockResolvedValue(fixturePlan as never);

        renderPage();
        await act(async () => {
          await vi.runAllTimersAsync();
        });

        const addActionInput = screen.getByPlaceholderText('Add action...');
        fireEvent.change(addActionInput, { target: { value: 'Audit storage' } });
        fireEvent.keyDown(addActionInput, { key: 'Enter' });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(1100);
        });

        expect(mockUpdateDocumentationPlan).toHaveBeenCalled();
        const lastCall = mockUpdateDocumentationPlan.mock.calls[
          mockUpdateDocumentationPlan.mock.calls.length - 1
        ];
        expect(lastCall[2].actions).toContain('Audit storage');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('delete flow', () => {
    it('opens dialog and calls deleteDocumentationPlan on confirm', async () => {
      mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
      mockDeleteDocumentationPlan.mockResolvedValue({} as never);

      renderPage({ layout: 'new' });

      await waitFor(() => {
        expect(screen.getByTestId('record-detail-wrapper')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('trigger-delete'));

      const confirmBtn = await screen.findByText((content, el) => {
        return el?.tagName === 'BUTTON' && content.trim() === 'Delete';
      });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockDeleteDocumentationPlan).toHaveBeenCalledWith('org-1', 'plan-1');
      });
    });
  });

  describe('permissions', () => {
    it('shows view-only banner when user lacks edit permission', async () => {
      mockHasPermission.mockImplementation(
        (perm: string) => perm !== 'documentation_plans.edit'
      );
      mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Annual Cataloging Plan')).toBeInTheDocument();
      });
      expect(screen.getByText(/view only/i)).toBeInTheDocument();
    });

    it('hides Change History when audit_logs perm missing', async () => {
      mockHasPermission.mockImplementation((perm: string) => perm !== 'org.view_audit_logs');
      mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Annual Cataloging Plan')).toBeInTheDocument();
      });
      expect(screen.queryByText('Change History')).not.toBeInTheDocument();
    });
  });

  describe('section content', () => {
    it('renders objectives in content section', async () => {
      mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
      renderPage();
      await waitFor(() => {
        expect(
          screen.getByDisplayValue('Catalog all 19th-century textiles')
        ).toBeInTheDocument();
      });
    });

    it('renders timeline section with start/end dates when expanded', async () => {
      mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Annual Cataloging Plan')).toBeInTheDocument();
      });
      const timelineToggle = screen.getByRole('button', { name: /^timeline/i });
      fireEvent.click(timelineToggle);
      await waitFor(() => {
        expect(screen.getByDisplayValue('2024-01-01')).toBeInTheDocument();
      });
      expect(screen.getByDisplayValue('2024-12-31')).toBeInTheDocument();
    });

    it('renders ProcedureRequirementsCard in view mode', async () => {
      mockGetDocumentationPlan.mockResolvedValue(fixturePlan as never);
      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('procedure-requirements-card')).toBeInTheDocument();
      });
    });
  });
});
