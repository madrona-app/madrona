import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ResearchVisitsPage from '../../pages/collections/ResearchVisitsPage';
import ResearchVisitPage from '../../pages/collections/ResearchVisitPage';
import { ObjectResearchVisits } from '../../components/collections/research-visits/ObjectResearchVisits';
import * as visitsApi from '../../lib/api/researchVisits';
import * as api from '../../lib/api';
import * as usePermissionsHook from '../../hooks/usePermissions';
import { checkA11y } from '../a11y';
import type { ResearchVisit } from '../../lib/api/researchVisits';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { name: 'Sam Staff' }, hasAppAccess: () => true }),
}));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: vi.fn() }));
vi.mock('../../lib/api/researchVisits', () => ({
  getResearchVisits: vi.fn(),
  getResearchVisit: vi.fn(),
  createResearchVisit: vi.fn(),
  updateResearchVisit: vi.fn(),
  deleteResearchVisit: vi.fn(),
  addResearchVisitObject: vi.fn(),
  updateResearchVisitObject: vi.fn(),
  removeResearchVisitObject: vi.fn(),
  getObjectResearchVisits: vi.fn(),
}));
vi.mock('../../lib/api', () => ({
  getUseRequests: vi.fn(),
  getCollectionObjects: vi.fn(),
  getRecordAuditHistory: vi.fn(),
}));
vi.mock('../../lib/api/constituents', () => ({ getConstituents: vi.fn() }));

const v = vi.mocked(visitsApi);
const a = vi.mocked(api);
const perms = vi.mocked(usePermissionsHook.usePermissions);

function grant(keys: string[] | 'all') {
  perms.mockReturnValue({
    hasPermission: vi.fn((k: string) => keys === 'all' || keys.includes(k)),
    hasAnyPermission: vi.fn().mockReturnValue(true),
    hasAllPermissions: vi.fn().mockReturnValue(true),
  } as never);
}

const VISIT: ResearchVisit = {
  visit_id: 'v1',
  organization_id: 'org-1',
  researcher_constituent_id: null,
  researcher_constituent_name: null,
  researcher_name: 'Ada Researcher',
  researcher_affiliation: 'University of Example',
  visit_date: '2026-11-10',
  arrival_time: '09:30',
  departure_time: '15:00',
  location: 'Reading Room 2',
  research_topic: 'Early braille writing tools',
  purpose: null,
  supervised_by_user_id: null,
  supervised_by_name: 'Sam Staff',
  use_request_id: null,
  use_request_number: null,
  notes: null,
  object_count: 1,
  objects: [{
    visit_object_id: 'vo1', visit_id: 'v1', object_id: 'o1', object_number: 'RV.1',
    object_name: 'Braille slate', handling_note: 'Handled with gloves', condition_on_return: null, created_at: null,
  }],
  created_at: null,
  updated_at: null,
};

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/organizations/:orgId/collections/research-visits" element={<ResearchVisitsPage />} />
          <Route path="/organizations/:orgId/collections/research-visits/create" element={<ResearchVisitPage />} />
          <Route path="/organizations/:orgId/collections/research-visits/:visitId" element={<ResearchVisitPage />} />
          <Route path="/organizations/:orgId/collections/objects/:objectId" element={<ObjectResearchVisits organizationId="org-1" objectId="o1" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  grant('all');
  a.getUseRequests.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 } as never);
  a.getRecordAuditHistory.mockResolvedValue({ entity_type: 'research_visit', entity_id: 'v1', items: [], total: 0, limit: 20, offset: 0 });
});

describe('ResearchVisitsPage', () => {
  it('lists visits in a captioned table with row links and a labelled search', async () => {
    v.getResearchVisits.mockResolvedValue({ items: [VISIT], total: 1, limit: 25, offset: 0 });
    const { container } = renderAt('/organizations/org-1/collections/research-visits');

    const table = await screen.findByRole('table', { name: /research visits, newest first/i });
    for (const name of ['Date', 'Researcher', 'Research topic', 'Location', 'Objects used', 'Supervised by']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    expect(within(table).getByRole('link', { name: 'Ada Researcher' })).toHaveAttribute(
      'href', '/organizations/org-1/collections/research-visits/v1',
    );
    expect(within(table).getByRole('rowheader', { name: /Ada Researcher/ })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search visits' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log a visit' })).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('hides "Log a visit" without create permission', async () => {
    grant(['use_requests.view']);
    v.getResearchVisits.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
    renderAt('/organizations/org-1/collections/research-visits');
    expect(await screen.findByRole('heading', { name: 'No research visits logged yet' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Log a visit' })).not.toBeInTheDocument();
  });
});

describe('ResearchVisitPage — create', () => {
  it('labels every field, flags missing required fields, and focuses the first', async () => {
    const { container } = renderAt('/organizations/org-1/collections/research-visits/create');
    expect(await screen.findByRole('heading', { level: 1, name: 'Log a research visit' })).toBeInTheDocument();

    const name = screen.getByRole('textbox', { name: /^Name/ });
    expect(name).toHaveAttribute('aria-required', 'true');
    for (const label of ['Affiliation', 'Reading room or location', 'Supervising staff member', 'Research topic', 'Purpose of visit', 'Notes']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText(/^Date/)).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Arrival time')).toHaveAttribute('type', 'time');
    expect(screen.getByRole('combobox', { name: 'Authorising use request' })).toBeInTheDocument();
    expect(screen.getByLabelText('Supervising staff member')).toHaveValue('Sam Staff');
    expect(screen.getByRole('group', { name: 'Researcher' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Visit' })).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);

    fireEvent.change(screen.getByLabelText('Arrival time'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('Departure time'), { target: { value: '09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log visit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the researcher’s name.');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Enter the researcher’s name.');
    expect(screen.getByLabelText('Departure time')).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(name);
    expect(v.createResearchVisit).not.toHaveBeenCalled();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('submits a valid visit and opens its record', async () => {
    v.createResearchVisit.mockResolvedValue({ ...VISIT, objects: [] });
    v.getResearchVisit.mockResolvedValue({ ...VISIT, objects: [] });
    renderAt('/organizations/org-1/collections/research-visits/create');

    fireEvent.change(await screen.findByRole('textbox', { name: /^Name/ }), { target: { value: 'Ada Researcher' } });
    fireEvent.change(screen.getByLabelText('Research topic'), { target: { value: 'Braille tools' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log visit' }));

    await waitFor(() => expect(v.createResearchVisit).toHaveBeenCalled());
    expect(v.createResearchVisit.mock.calls[0][1]).toMatchObject({
      researcher_name: 'Ada Researcher', research_topic: 'Braille tools', supervised_by_name: 'Sam Staff', notes: null,
    });
    expect(await screen.findByRole('heading', { level: 1, name: /Research visit: Ada Researcher/ })).toBeInTheDocument();
    expect(screen.getAllByRole('status').some((s) => /logged/.test(s.textContent ?? ''))).toBe(true);
  });
});

describe('ResearchVisitPage — objects used', () => {
  it('shows the visit history, including objects added, as readable text', async () => {
    v.getResearchVisit.mockResolvedValue(VISIT);
    a.getRecordAuditHistory.mockResolvedValue({
      entity_type: 'research_visit', entity_id: 'v1', total: 1, limit: 20, offset: 0,
      items: [{
        event_id: 'e1', change_type: 'link_added', changed_at: '2026-11-10T09:45:00+00:00',
        changed_by: 'u1', changed_by_name: 'Sam Staff', changed_by_email: null, request_method: 'POST',
        changed_fields: ['object', 'handling_note'], summary: 'Added object: RV.1',
        child_entity_type: 'research_visit_object', child_entity_id: 'vo1', child_display_key: 'RV.1',
        field_diffs: [
          { field_name: 'object', old_value: null, new_value: 'RV.1' },
          { field_name: 'handling_note', old_value: null, new_value: 'Handled with gloves' },
        ],
      }],
    } as never);
    const { container } = renderAt('/organizations/org-1/collections/research-visits/v1');
    expect(await screen.findByRole('heading', { level: 2, name: 'Change history' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Change history, newest first' });
    expect(within(list).getByText('Added object RV.1')).toBeInTheDocument();
    expect(within(list).getByText('Handling Note: Handled with gloves.')).toBeInTheDocument();
    expect(within(list).getByText('Sam Staff')).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('shows a captioned objects table with named row actions and adds an object by search', async () => {
    v.getResearchVisit.mockResolvedValue(VISIT);
    v.addResearchVisitObject.mockResolvedValue(VISIT.objects![0]);
    a.getCollectionObjects.mockResolvedValue({
      items: [
        { object_id: 'o1', object_number: 'RV.1', object_name: 'Braille slate' },
        { object_id: 'o2', object_number: 'RV.2', object_name: 'Stylus' },
      ],
      total: 2,
    } as never);
    const { container } = renderAt('/organizations/org-1/collections/research-visits/v1');

    const table = await screen.findByRole('table', { name: /1 object used during this visit/ });
    expect(within(table).getByRole('link', { name: 'RV.1' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Remove RV.1, Braille slate from this visit' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Edit notes for RV.1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Objects used' })).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: 'Find an object by number or name' });
    fireEvent.change(screen.getByLabelText('Handling note (optional)'), { target: { value: 'Gloves' } });
    fireEvent.change(search, { target: { value: 'RV' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search objects' }));

    // RV.1 is already on the visit, so only RV.2 is offered.
    const results = await screen.findByRole('list', { name: 'Search results for objects' });
    expect(within(results).getAllByRole('listitem')).toHaveLength(1);
    expect(await screen.findByText('1 object found.')).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);

    fireEvent.click(within(results).getByRole('button', { name: 'Add RV.2, Stylus to this visit' }));
    await waitFor(() => expect(v.addResearchVisitObject).toHaveBeenCalledWith('org-1', 'v1', {
      object_id: 'o2', handling_note: 'Gloves', condition_on_return: null,
    }));
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(screen.getAllByRole('status').some((s) => s.textContent === 'Added RV.2, Stylus to this visit.')).toBe(true);
  });

  it('edits notes inline with labelled fields and returns focus to the edit button', async () => {
    v.getResearchVisit.mockResolvedValue(VISIT);
    v.updateResearchVisitObject.mockResolvedValue({ ...VISIT.objects![0], condition_on_return: 'No change' });
    renderAt('/organizations/org-1/collections/research-visits/v1');

    fireEvent.click(await screen.findByRole('button', { name: 'Edit notes for RV.1' }));
    const handling = screen.getByLabelText('Handling note for RV.1');
    await waitFor(() => expect(document.activeElement).toBe(handling));
    fireEvent.change(screen.getByLabelText('Condition on return for RV.1'), { target: { value: 'No change' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notes for RV.1' }));

    await waitFor(() => expect(v.updateResearchVisitObject).toHaveBeenCalledWith('org-1', 'v1', 'o1', {
      handling_note: 'Handled with gloves', condition_on_return: 'No change',
    }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit notes for RV.1' })));
  });

  it('is read-only without edit permission', async () => {
    grant(['use_requests.view']);
    v.getResearchVisit.mockResolvedValue(VISIT);
    const { container } = renderAt('/organizations/org-1/collections/research-visits/v1');
    await screen.findByRole('table', { name: /used during this visit/ });
    expect(screen.queryByRole('button', { name: /Remove RV.1/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: /Find an object/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });
});

describe('ObjectResearchVisits', () => {
  it('lists the visits that used an object', async () => {
    v.getObjectResearchVisits.mockResolvedValue({
      items: [{
        visit_id: 'v1', visit_date: '2026-11-10', researcher_name: 'Ada Researcher',
        researcher_affiliation: null, research_topic: 'Braille tools', handling_note: 'Gloves', condition_on_return: null,
      }],
    });
    const { container } = renderAt('/organizations/org-1/collections/objects/o1');
    const table = await screen.findByRole('table', { name: /research visits that used this object/i });
    expect(within(table).getByRole('link', { name: 'Ada Researcher' })).toHaveAttribute(
      'href', '/organizations/org-1/collections/research-visits/v1',
    );
    expect(screen.getByRole('heading', { name: 'Research visits' })).toBeInTheDocument();
    expect((await checkA11y(container)).violations).toEqual([]);
  });

  it('renders nothing and fetches nothing without permission', () => {
    grant([]);
    const { container } = renderAt('/organizations/org-1/collections/objects/o1');
    expect(container).toBeEmptyDOMElement();
    expect(v.getObjectResearchVisits).not.toHaveBeenCalled();
  });
});
