import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NagpraManager } from '../../../components/collections/NagpraManager';

const {
  getObjectNagpraActionMock,
  createNagpraActionMock,
  updateNagpraActionMock,
  deleteNagpraActionMock,
  getNagpraConsultationEventsMock,
  createNagpraConsultationEventMock,
  deleteNagpraConsultationEventMock,
} = vi.hoisted(() => ({
  getObjectNagpraActionMock: vi.fn(),
  createNagpraActionMock: vi.fn(),
  updateNagpraActionMock: vi.fn(),
  deleteNagpraActionMock: vi.fn(),
  getNagpraConsultationEventsMock: vi.fn(),
  createNagpraConsultationEventMock: vi.fn(),
  deleteNagpraConsultationEventMock: vi.fn(),
}));

vi.mock('../../../lib/api/collections', () => ({
  getObjectNagpraAction: getObjectNagpraActionMock,
  createNagpraAction: createNagpraActionMock,
  updateNagpraAction: updateNagpraActionMock,
  deleteNagpraAction: deleteNagpraActionMock,
  getNagpraConsultationEvents: getNagpraConsultationEventsMock,
  createNagpraConsultationEvent: createNagpraConsultationEventMock,
  deleteNagpraConsultationEvent: deleteNagpraConsultationEventMock,
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderManager(props: Partial<Parameters<typeof NagpraManager>[0]> = {}) {
  return render(
    <QueryClientProvider client={createClient()}>
      <NagpraManager organizationId="org-1" objectId="obj-1" {...props} />
    </QueryClientProvider>,
  );
}

describe('NagpraManager', () => {
  beforeEach(() => {
    getObjectNagpraActionMock.mockReset();
    getNagpraConsultationEventsMock.mockReset();
    createNagpraActionMock.mockReset();
    updateNagpraActionMock.mockReset();
    deleteNagpraActionMock.mockReset();
  });

  it('shows a loading placeholder while fetching', () => {
    getObjectNagpraActionMock.mockImplementation(() => new Promise(() => {}));
    renderManager();
    expect(screen.getByText('Loading NAGPRA data...')).toBeInTheDocument();
  });

  it('renders the empty state when no action exists', async () => {
    getObjectNagpraActionMock.mockResolvedValue(null);
    renderManager();
    await waitFor(() => screen.getByText('No NAGPRA action on this object'));
    expect(screen.getByText('No NAGPRA action on this object')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create NAGPRA Action/i })).toBeInTheDocument();
  });

  it('hides the create button when readOnly is true', async () => {
    getObjectNagpraActionMock.mockResolvedValue(null);
    renderManager({ readOnly: true });
    await waitFor(() => screen.getByText('No NAGPRA action on this object'));
    expect(screen.queryByRole('button', { name: /Create NAGPRA Action/i })).toBeNull();
  });

  it('opens the create form when Create NAGPRA Action is clicked', async () => {
    getObjectNagpraActionMock.mockResolvedValue(null);
    renderManager();
    await waitFor(() => screen.getByText('No NAGPRA action on this object'));
    fireEvent.click(screen.getByRole('button', { name: /Create NAGPRA Action/i }));
    // Form should now appear (CreateActionForm)
    await waitFor(() => {
      const cancel = screen.queryByRole('button', { name: /Cancel/i });
      expect(cancel).not.toBeNull();
    });
  });

  it('renders action details when an action exists', async () => {
    getObjectNagpraActionMock.mockResolvedValue({
      action_id: 'act-1',
      action_number: 'NA-001',
      status: 'consultation',
      nagpra_category: 'sacred_object',
      origin_type: 'tribal_request',
      affiliation_status: 'culturally_affiliated',
      hold_active: false,
      display_consent: 'restricted',
      access_consent: 'requested',
      research_consent: 'denied',
    });
    getNagpraConsultationEventsMock.mockResolvedValue({ consultation_events: [] });
    renderManager();
    await waitFor(() => screen.getByText('NA-001'));
    expect(screen.getByText('NA-001')).toBeInTheDocument();
    // "Consultation" appears multiple times (status badge + status select option + log header)
    expect(screen.getAllByText('Consultation').length).toBeGreaterThan(0);
    expect(screen.getByText('Sacred Object')).toBeInTheDocument();
  });

  it('shows the Hold Active badge when action.hold_active is true', async () => {
    getObjectNagpraActionMock.mockResolvedValue({
      action_id: 'act-1',
      action_number: 'NA-001',
      status: 'identified',
      nagpra_category: 'undetermined',
      origin_type: 'staff_review',
      hold_active: true,
      display_consent: 'restricted',
      access_consent: 'restricted',
      research_consent: 'restricted',
    });
    getNagpraConsultationEventsMock.mockResolvedValue({ consultation_events: [] });
    renderManager();
    await waitFor(() => screen.getByText('Hold Active'));
    expect(screen.getByText('Hold Active')).toBeInTheDocument();
  });

  it('toggles the consultation log open', async () => {
    getObjectNagpraActionMock.mockResolvedValue({
      action_id: 'act-1',
      action_number: 'NA-001',
      status: 'identified',
      nagpra_category: 'undetermined',
      origin_type: 'staff_review',
      hold_active: false,
      display_consent: 'restricted',
      access_consent: 'restricted',
      research_consent: 'restricted',
    });
    getNagpraConsultationEventsMock.mockResolvedValue({ consultation_events: [] });
    renderManager();
    await waitFor(() => screen.getByText('Consultation Log'));
    fireEvent.click(screen.getByText('Consultation Log'));
    await waitFor(() => screen.getByText(/No consultation events recorded/i));
    expect(screen.getByText(/No consultation events recorded/i)).toBeInTheDocument();
  });

  it('shows the consent labels for display/access/research', async () => {
    getObjectNagpraActionMock.mockResolvedValue({
      action_id: 'act-1',
      action_number: 'NA-001',
      status: 'identified',
      nagpra_category: 'undetermined',
      origin_type: 'staff_review',
      hold_active: false,
      display_consent: 'granted',
      access_consent: 'denied',
      research_consent: 'restricted',
    });
    getNagpraConsultationEventsMock.mockResolvedValue({ consultation_events: [] });
    renderManager();
    await waitFor(() => screen.getByText('Granted'));
    expect(screen.getByText('Granted')).toBeInTheDocument();
    expect(screen.getByText('Denied')).toBeInTheDocument();
    expect(screen.getByText('Restricted')).toBeInTheDocument();
  });

  it('hides the delete button in readOnly mode', async () => {
    getObjectNagpraActionMock.mockResolvedValue({
      action_id: 'act-1',
      action_number: 'NA-001',
      status: 'identified',
      nagpra_category: 'undetermined',
      origin_type: 'staff_review',
      hold_active: false,
      display_consent: 'restricted',
      access_consent: 'restricted',
      research_consent: 'restricted',
    });
    getNagpraConsultationEventsMock.mockResolvedValue({ consultation_events: [] });
    renderManager({ readOnly: true });
    await waitFor(() => screen.getByText('NA-001'));
    expect(screen.queryByTitle('Delete NAGPRA action')).toBeNull();
  });
});
