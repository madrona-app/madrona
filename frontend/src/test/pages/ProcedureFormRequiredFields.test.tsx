/**
 * Every procedure form that organizations can add required fields to
 * (see backend procedure_required_fields._entity_models) marks an org-added
 * field required on the real form, and marks it invalid when the server
 * refuses a status change for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentType } from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { checkA11y } from '../a11y';
import { ApiError } from '../../lib/apiClient';
import * as procedureHook from '../../hooks/useProcedureRequirements';
import * as workspacePageHook from '../../hooks/useWorkspacePage';
import * as lookupHook from '../../hooks/useLookupValues';
import AcquisitionWorkspacePage from '../../pages/collections/AcquisitionWorkspacePage';
import LoanOutWorkspacePage from '../../pages/collections/LoanOutWorkspacePage';
import LoanInWorkspacePage from '../../pages/collections/LoanInWorkspacePage';
import ObjectEntryWorkspacePage from '../../pages/collections/ObjectEntryWorkspacePage';
import ConservationWorkspacePage from '../../pages/collections/ConservationWorkspacePage';
import ObjectExitWorkspacePage from '../../pages/collections/ObjectExitWorkspacePage';
import DeaccessionWorkspacePage from '../../pages/collections/DeaccessionWorkspacePage';

vi.mock('../../lib/api');

vi.mock('../../hooks/useProcedureRequirements', () => ({
  useProcedureRequirements: vi.fn(),
}));

vi.mock('../../hooks/useWorkspacePage', () => ({
  useWorkspacePage: vi.fn(),
}));

vi.mock('../../hooks/useLookupValues', () => ({
  useLookupValues: vi.fn(),
  default: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { user_id: 'u-1', email: 'tester@example.com', is_platform_admin: false },
    activeOrganizationId: 'org-1',
    isPlatformAdmin: false,
    roleOverride: null,
    isAuthenticated: true,
    isLoading: false,
    hasAppAccess: () => true,
  }),
}));

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true, permissions: [], isLoading: false }),
}));

vi.mock('../../components/collections/ConstituentSelectorSlideOver', () => ({
  ContactSelectorSlideOver: () => null,
}));
vi.mock('../../components/reports/GenerateReportSlideOver', () => ({
  GenerateReportSlideOver: () => null,
}));
vi.mock('../../components/work/CreateTaskSlideOver', () => ({
  CreateTaskSlideOver: () => null,
}));
vi.mock('../../components/workspace/RecordAuditHistory', () => ({
  RecordAuditHistory: () => null,
}));

const mockUseProcedure = vi.mocked(procedureHook.useProcedureRequirements);
const mockUseWorkspacePage = vi.mocked(workspacePageHook.useWorkspacePage);
const mockUseLookups = vi.mocked(lookupHook.useLookupValues);

interface Case {
  procedureType: string;
  Page: ComponentType;
  field: string;
  label: string;
  role: 'textbox' | 'combobox';
  /** Section to open first, when the field is not in the first one. */
  expand?: string;
}

// One field per form that an organization can add, rendered on create.
const CASES: Case[] = [
  { procedureType: 'acquisition', Page: AcquisitionWorkspacePage, field: 'acquisition_reason', label: 'Acquisition Reason', role: 'textbox' },
  { procedureType: 'loan_out', Page: LoanOutWorkspacePage, field: 'exhibition_title', label: 'Exhibition Title', role: 'textbox' },
  { procedureType: 'loan_in', Page: LoanInWorkspacePage, field: 'loan_conditions', label: 'Loan Conditions', role: 'textbox' },
  { procedureType: 'object_entry', Page: ObjectEntryWorkspacePage, field: 'receipt_reference', label: 'Receipt Reference', role: 'textbox' },
  { procedureType: 'conservation', Page: ConservationWorkspacePage, field: 'proposal_summary', label: 'Proposal Summary', role: 'textbox', expand: 'Treatment Proposal' },
  { procedureType: 'object_exit', Page: ObjectExitWorkspacePage, field: 'exit_method', label: 'Exit Method', role: 'combobox' },
  { procedureType: 'deaccession', Page: DeaccessionWorkspacePage, field: 'reason_detail', label: 'Reason Detail', role: 'textbox' },
];

function setup(c: Case) {
  mockUseProcedure.mockImplementation((type: string) => ({
    requirementGroups: [],
    statusOrder: [],
    procedureLabel: '',
    enforcementEnabled: true,
    orgRequiredFields: type === c.procedureType ? [{ field: c.field, label: c.label }] : [],
    isLoading: false,
    error: null,
  }));
  mockUseWorkspacePage.mockReturnValue({
    isCreateMode: true,
    isEditing: true,
    setIsEditing: vi.fn(),
    useNewLayout: false,
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
  } as never);
  mockUseLookups.mockReturnValue({
    getLookup: () => [{ value: 'other', label: 'Other' }],
    getLabel: (_f: string, v: string) => v,
    isLoading: false,
    error: null,
  } as never);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations/org-1/procedure/create']}>
        <Routes>
          <Route path="/organizations/:orgId/procedure/create" element={<c.Page />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  if (c.expand) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(c.expand) }));
  }
  return { ...utils, qc };
}

function findField(c: Case) {
  const matches = screen.getAllByRole(c.role, { name: new RegExp(`^${c.label}\\s*\\*?$`) });
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe.each(CASES)('$procedureType form', (c) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks the org-added field required', async () => {
    const { container } = setup(c);
    const field = await waitFor(() => findField(c));
    expect(mockUseProcedure).toHaveBeenCalledWith(c.procedureType, 'org-1');
    expect(field).toHaveAttribute('aria-required', 'true');
    expect(field).toBeRequired();
    const label = container.querySelector(`label[for="${field.id}"]`);
    expect(label?.textContent).toMatch(/\*/);

    // The field and its label carry no axe violations.
    expect(await checkA11y(field.closest('div')!)).toHaveNoViolations();
  });

  it('marks the field invalid and focuses the error summary when the server refuses', async () => {
    const { qc } = setup(c);
    const field = await waitFor(() => findField(c));
    const error = new ApiError('unmet', 422, 'procedure_requirements_not_met', {
      procedure_type: c.procedureType,
      target_status: 'approved',
      missing_requirements: [{ id: `org:${c.field}`, label: c.label, fields: [c.field], source: 'org' }],
      missing_fields: [c.field],
    });
    await act(async () => {
      await qc
        .getMutationCache()
        .build(qc, { mutationFn: () => Promise.reject(error) })
        .execute(undefined)
        .catch(() => {});
    });

    const summary = await screen.findByRole('region', { name: /1 required field is missing/ });
    await waitFor(() => expect(summary).toHaveFocus());
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(`${c.label} is required before the status can change to approved.`);
    expect(await checkA11y(summary)).toHaveNoViolations();
  });
});

describe('contact picker fields', () => {
  it('marks an org-added conservator required and invalid on the conservation form', async () => {
    const c: Case = {
      procedureType: 'conservation',
      Page: ConservationWorkspacePage,
      field: 'conservator_id',
      label: 'Conservator',
      role: 'textbox',
    };
    const { qc, container } = setup(c);
    const group = await screen.findByRole('group', { name: /^Conservator\s*\(required\)$/ });
    const search = screen.getByRole('button', { name: /Search or create conservator/ });
    expect(group).toContainElement(search);

    const error = new ApiError('unmet', 422, 'procedure_requirements_not_met', {
      procedure_type: 'conservation',
      target_status: 'approved',
      missing_requirements: [{ id: 'org:conservator_id', label: 'Conservator', fields: ['conservator_id'], source: 'org' }],
      missing_fields: ['conservator_id'],
    });
    await act(async () => {
      await qc.getMutationCache().build(qc, { mutationFn: () => Promise.reject(error) }).execute(undefined).catch(() => {});
    });
    expect(search).toHaveAccessibleDescription('Conservator is required before the status can change to approved.');
    fireEvent.click(screen.getByRole('button', { name: 'Conservator' }));
    expect(search).toHaveFocus();
    expect(await checkA11y(container.querySelector('#section-conservator')!)).toHaveNoViolations();
  });
});
