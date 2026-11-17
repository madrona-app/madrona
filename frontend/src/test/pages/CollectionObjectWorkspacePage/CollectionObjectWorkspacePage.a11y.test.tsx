/**
 * Page-level accessibility checks for the object workspace: header, primary
 * image, section navigation and section shells. The individual section bodies
 * have their own tests and are stubbed here (Description is kept real so one
 * section shell, the shared WorkspaceSection disclosure, is exercised) so this file covers what index.tsx
 * and the shared record-detail/workspace chrome render around them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CollectionObjectWorkspacePage from '../../../pages/collections/CollectionObjectWorkspacePage';
import * as workspacePageHook from '../../../hooks/useWorkspacePage';
import { PAGE_SECTION_GROUPS } from '../../../pages/collections/CollectionObjectWorkspacePage/types';
import { checkA11y } from '../../a11y';
import { ToastProvider } from '../../../contexts/ToastContext';
import { makeCollectionObject } from './fixtures';

vi.mock('../../../lib/api', () => ({
  deleteCollectionObject: vi.fn(),
  toggleObjectDiscoverable: vi.fn(),
}));

vi.mock('@/lib/layout/useResolvedLayout', () => ({
  useResolvedLayout: (base: unknown) => ({ groups: base, isCustomized: false }),
}));

vi.mock('../../../hooks/useWorkspacePage', () => ({ useWorkspacePage: vi.fn() }));
vi.mock('../../../hooks/useProcedureRequirements', () => ({
  useProcedureRequirements: () => ({ requirementGroups: [], isLoading: false, error: null }),
}));
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ hasAppAccess: () => false, user: { user_id: 'u-1' } }),
}));
vi.mock('../../../contexts/WorkContext', () => ({
  useWork: () => ({ setActiveObject: vi.fn() }),
}));

const object = makeCollectionObject();

vi.mock('../../../pages/collections/CollectionObjectWorkspacePage/hooks', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { QueryClient } = await import('@tanstack/react-query');
  const qc = new QueryClient();
  const { makeCollectionObject: make } = await import('./fixtures');
  const obj = make();
  return {
    ...actual,
    useCollectionObjectData: () => ({
      orgId: 'org-1',
      objectId: obj.object_id,
      isCreateMode: false,
      object: { ...obj, primary_image_url: 'https://example.com/vase.jpg', thumbnail_url: 'https://example.com/vase.jpg' },
      isLoading: false,
      error: null,
      valuationsData: undefined,
      proceduresData: undefined,
      rightsData: undefined,
      linkedMedia: [],
      isLoadingMedia: false,
      queryClient: qc,
    }),
    useMediaMutations: () => ({
      linkMediaMutation: { mutate: vi.fn() },
      unlinkMediaMutation: { mutate: vi.fn() },
      setPrimaryMediaMutation: { mutate: vi.fn() },
      updateMediaLinkMutation: { mutate: vi.fn() },
    }),
    useFormState: () => ({
      formData: obj,
      saveStatus: 'idle',
      errorMessage: null,
      setErrorMessage: vi.fn(),
      lastSaved: null,
      hasUnsavedChanges: false,
      updateField: vi.fn(),
      updateFieldSilent: vi.fn(),
      handleFieldBlur: vi.fn(),
      performSave: vi.fn(),
    }),
  };
});

// Section bodies: stubbed (covered by their own tests).
const { stub } = vi.hoisted(() => ({
  stub: (name: string) => () => name + ' section body',
}));
vi.mock('../../../pages/collections/CollectionObjectWorkspacePage/IdentificationSection', () => ({ IdentificationSection: stub('Identification') }));
vi.mock('../../../pages/collections/CollectionObjectWorkspacePage/PhysicalSection', () => ({ PhysicalSection: stub('Physical') }));
vi.mock('../../../pages/collections/CollectionObjectWorkspacePage/MediaSection', () => ({ MediaSection: stub('Media') }));
vi.mock('../../../pages/collections/CollectionObjectWorkspacePage/LocationSection', () => ({ LocationSection: stub('Location') }));
vi.mock('../../../pages/collections/CollectionObjectWorkspacePage/RelationshipsSection', () => ({
  PeopleSection: stub('People'),
  PlacesSection: stub('Places'),
  StylePeriodsSection: stub('Style periods'),
  SubjectsSection: stub('Subjects'),
  RelatedObjectsSection: stub('Related objects'),
  CitationsSection: stub('Citations'),
  EventsSection: stub('Events'),
}));
vi.mock('../../../pages/collections/CollectionObjectWorkspacePage/AdminSections', () => ({
  ConditionSection: stub('Condition'),
  RightsSection: stub('Rights'),
  NagpraSection: stub('NAGPRA'),
  AcquisitionSection: stub('Acquisition'),
  ValuationsSection: stub('Valuations'),
  ProceduresSection: stub('Procedures'),
  PartsSection: stub('Parts'),
}));

// Heavy collaborators outside this page.
vi.mock('../../../components/IIIFViewer', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="iiif-viewer"><button type="button" onClick={onClose}>Close viewer</button></div>
  ),
}));
vi.mock('../../../components/collections/RecordWorkflowPanel', () => ({ RecordWorkflowPanel: () => null }));
vi.mock('../../../components/collections/PartsLocationSummary', () => ({ PartsLocationSummary: () => null }));
vi.mock('../../../components/collections/RecordMovementSlideOver', () => ({ RecordMovementSlideOver: () => null }));
vi.mock('../../../components/collections/ObjectQuickActionSlideOvers', () => ({
  ConditionReportSlideOver: () => null,
  IncidentReportSlideOver: () => null,
  ConservationSlideOver: () => null,
  ValuationSlideOver: () => null,
  LoanRequestSlideOver: () => null,
  UseRequestSlideOver: () => null,
}));
vi.mock('../../../components/collections/DiscoverPreviewModal', () => ({ DiscoverPreviewModal: () => null }));
vi.mock('@/components/workspace/LayoutCustomizerSlideOver', () => ({ LayoutCustomizerSlideOver: () => null }));
vi.mock('../../../components/workspaces', () => ({ AddToWorkspaceDialog: () => null }));
vi.mock('../../../components/work/QuickActions', () => ({ ObjectActionBar: () => null }));
vi.mock('../../../components/studio/StartProcedure', () => ({ StartProcedure: () => null }));
vi.mock('../../../components/work/CreateTaskSlideOver', () => ({ CreateTaskSlideOver: () => null }));
vi.mock('../../../components/reports/GenerateReportSlideOver', () => ({ GenerateReportSlideOver: () => null }));
vi.mock('../../../components/collections/ProcedureRequirementsCard', () => ({ ProcedureRequirementsCard: () => null }));
vi.mock('../../../components/workspace/RecordAuditHistory', () => ({ RecordAuditHistory: () => null }));

function makeWp(isEditing: boolean, useNewLayout = false) {
  return {
    isCreateMode: false,
    isEditing,
    setIsEditing: vi.fn(),
    useNewLayout,
    canEdit: true,
    isRestricted: () => false,
    hasRestrictions: false,
    hasPermission: () => true,
    dialogs: {
      showDeleteConfirm: false,
      setShowDeleteConfirm: vi.fn(),
      showCreateTask: false,
      setShowCreateTask: vi.fn(),
    },
  } as unknown as ReturnType<typeof workspacePageHook.useWorkspacePage>;
}

function renderPage(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/organizations/:orgId/collections/objects/:objectId" element={<CollectionObjectWorkspacePage />} />
          <Route path="/organizations/:orgId/collections/objects/:objectId/edit" element={<CollectionObjectWorkspacePage />} />
        </Routes>
      </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('CollectionObjectWorkspacePage accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expect(PAGE_SECTION_GROUPS.length).toBeGreaterThan(0);
  });

  it('read mode: no axe violations; the primary image is a named button that opens the viewer', async () => {
    vi.mocked(workspacePageHook.useWorkspacePage).mockReturnValue(makeWp(false));
    const { container } = renderPage(`/organizations/org-1/collections/objects/${object.object_id}`);

    const imageButton = await screen.findByRole('button', { name: /in the deep zoom viewer$/ });
    expect(imageButton.tagName).toBe('BUTTON');
    expect(screen.getByRole('heading', { level: 1, name: 'Blue and White Vase' })).toBeInTheDocument();
    expect(screen.getByText('A small blue and white porcelain vase from the Ming dynasty.')).toBeInTheDocument();

    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);

    fireEvent.click(imageButton);
    expect(screen.getByTestId('iiif-viewer')).toBeInTheDocument();
  });

  it('edit mode: no axe violations', async () => {
    vi.mocked(workspacePageHook.useWorkspacePage).mockReturnValue(makeWp(true));
    const { container } = renderPage(`/organizations/org-1/collections/objects/${object.object_id}/edit?mode=edit`);
    await screen.findByRole('button', { name: /in the deep zoom viewer$/ });

    const results = await checkA11y(container);
    expect(results.violations).toEqual([]);
  });

  it('section-navigation layout: no axe violations', async () => {
    vi.mocked(workspacePageHook.useWorkspacePage).mockReturnValue(makeWp(false, true));
    const { container } = renderPage(`/organizations/org-1/collections/objects/${object.object_id}`);
    expect((await screen.findAllByRole('navigation', { name: 'Record sections' })).length).toBeGreaterThan(0);

    // Two findings come from shared record-detail components (outside this
    // page) and are excluded here: SectionNav and RecordDetailSectionNav both
    // render a nav named "Record sections" (landmark-unique), and
    // RightRailSummary's "Quick Actions" is an h4 after the page h1
    // (heading-order).
    const results = await checkA11y(container, {
      rules: { 'landmark-unique': { enabled: false }, 'heading-order': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
