import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as api from '../../../lib/api';
import type { RecordAuditEvent } from '../../../lib/api';
import { checkA11y } from '../../a11y';

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return {
    ...actual,
    getCrate: vi.fn(),
    getRecordAuditHistory: vi.fn(),
  };
});

vi.mock('../../../contexts/AgentChatContext', () => ({
  useAgentChatContext: () => ({
    setEntityContext: vi.fn(), isOpen: false, entityContext: null, openChat: vi.fn(),
    closeChat: vi.fn(), openChatWithMessage: vi.fn(), registerDispatch: vi.fn(),
  }),
}));
vi.mock('../../../contexts/PageContext', () => ({
  usePageContext: () => ({ setPageContext: vi.fn(), clearEntityContext: vi.fn(), hasProvider: true }),
}));
vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), toasts: [], dismissToast: vi.fn() }),
}));

const mockHasPermission = vi.fn().mockReturnValue(true);
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission, permissions: ['collections.edit', 'org.view_audit_logs'] }),
}));
vi.mock('../../../hooks/useFieldAccess', () => ({
  useFieldAccess: () => ({ isRestricted: () => false, hasRestrictions: false }),
}));

// Sections render as plain labelled regions with a heading; the history panel
// is the real component, so this exercises what staff hear and see.
vi.mock('../../../components/workspace', async () => {
  const history = await vi.importActual<typeof import('../../../components/workspace/RecordAuditHistory')>(
    '../../../components/workspace/RecordAuditHistory',
  );
  return {
    WorkspaceHeader: ({ title }: { title?: string }) => <header><h1>{title}</h1></header>,
    WorkspaceErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    WorkspaceSection: ({ id, title, children }: { id?: string; title?: string; children?: React.ReactNode }) => (
      <section data-testid={`ws-section-${id ?? 'unknown'}`} aria-labelledby={`h-${id}`}>
        <h2 id={`h-${id}`}>{title}</h2>
        {children}
      </section>
    ),
    EditableField: () => null,
    EditableSelect: () => null,
    EditableCheckbox: () => null,
    RecordAuditHistory: history.RecordAuditHistory,
    SectionGroupDivider: () => null,
    ReadOnlyBanner: () => null,
  };
});
vi.mock('../../../components/record-detail', () => ({
  SectionOrderProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RecordDetailPageWrapper: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  useSectionOrder: () => [{}, vi.fn(), vi.fn()],
}));
vi.mock('../../../components/work/CreateTaskSlideOver', () => ({ CreateTaskSlideOver: () => null }));
vi.mock('../../../components/collections/LocationPickerModal', () => ({ LocationPickerButton: () => null }));
vi.mock('../../../components/ConfirmDialog', () => ({ default: () => null }));
vi.mock('../../../components/ui/MadronaLoader', () => ({
  MadronaLoader: () => <div role="status" aria-label="loading" />,
}));
vi.mock('../../../hooks/useUnifiedSectionState', () => ({
  useUnifiedSectionState: () => ({
    expandedSections: new Proxy({}, { get: () => true }),
    toggleSection: vi.fn(),
    expandAll: vi.fn(),
    collapseAll: vi.fn(),
    getSectionOrder: () => 0,
    expandedGroups: new Proxy({}, { get: () => true }),
    toggleGroup: vi.fn(),
  }),
}));

import CrateWorkspacePage from '../../../pages/collections/CrateWorkspacePage';

const mocked = vi.mocked(api);

const EVENTS: RecordAuditEvent[] = [
  {
    event_id: 'e2', change_type: 'updated', changed_at: '2026-11-13T15:00:00+00:00',
    changed_by: 'u1', changed_by_name: 'Ada Registrar', changed_by_email: 'ada@example.org',
    changed_fields: ['location_id'], summary: 'Updated location_id', request_method: 'PATCH',
    field_diffs: [{ field_name: 'location_id', old_value: 'DOCK', new_value: 'ST-2' }],
  },
  {
    event_id: 'e1', change_type: 'created', changed_at: '2026-11-12T10:00:00+00:00',
    changed_by: 'u1', changed_by_name: 'Ada Registrar', changed_by_email: 'ada@example.org',
    changed_fields: [], summary: 'Created crate', request_method: 'POST', field_diffs: [],
  },
];

function renderCrate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/organizations/org-1/collections/crates/crate-1']}>
        <Routes>
          <Route path="/organizations/:orgId/collections/crates/:crateId" element={<CrateWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CrateWorkspacePage change history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasPermission.mockReturnValue(true);
    mocked.getCrate.mockResolvedValue({
      crate_id: 'crate-1', organization_id: 'org-1', crate_number: 'CR-7', is_active: true,
      climate_controlled: false, is_stackable: true, is_oversized: false,
    } as never);
    mocked.getRecordAuditHistory.mockResolvedValue({
      entity_type: 'crate', entity_id: 'crate-1', items: EVENTS, total: 2, limit: 20, offset: 0,
    });
  });

  it('loads the crate’s history and lists it newest first', async () => {
    const { container } = renderCrate();
    const section = await screen.findByTestId('ws-section-history');
    const list = await within(section).findByRole('list', { name: 'Change History, newest first' });
    expect(mocked.getRecordAuditHistory).toHaveBeenCalledWith('org-1', 'crate', 'crate-1', expect.any(Object));
    const entries = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list);
    expect(entries).toHaveLength(2);
    expect(within(entries[1]).getByText('Created crate')).toBeInTheDocument();
    expect(within(section).queryByRole('alert')).toBeNull();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('hides the history without audit-log permission', async () => {
    mockHasPermission.mockImplementation((p: string) => p === 'collections.edit');
    renderCrate();
    await screen.findByTestId('ws-section-identification');
    expect(screen.queryByTestId('ws-section-history')).toBeNull();
    expect(mocked.getRecordAuditHistory).not.toHaveBeenCalled();
  });
});
