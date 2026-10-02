import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiClient from '../../lib/apiClient';
import {
  getEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  getEventObjects,
  addEventObject,
  updateEventObject,
  removeEventObject,
  getEventParticipants,
  addEventParticipant,
  removeEventParticipant,
  getObjectEvents,
  getCollectionsImpact,
} from '../../lib/api/events';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  getCsrfToken: vi.fn(),
  getFriendlyErrorMessage: vi.fn(),
  API_BASE_URL: '/api',
}));

const validEvent = {
  event_id: 'evt-1',
  organization_id: 'org-1',
  event_reference_number: 'EVT-001',
  title: 'Class Visit',
  event_type: 'teaching_session',
  status: 'scheduled',
};

const validLink = {
  event_object_id: 'eo-1',
  organization_id: 'org-1',
  event_id: 'evt-1',
  object_id: 'obj-1',
  role: 'primary',
  planned_use: 'display',
  display_order: 0,
};

const validParticipant = {
  participant_id: 'p-1',
  organization_id: 'org-1',
  event_id: 'evt-1',
  contact_id: 'c-1',
};

describe('api/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getEvents', () => {
    it('serializes filter params', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        limit: 10,
        offset: 0,
      });
      await getEvents('org-1', { event_type: 'program', limit: 10 });
      const url = vi.mocked(apiClient.apiFetch).mock.calls[0][0] as string;
      expect(url).toContain('event_type=program');
      expect(url).toContain('limit=10');
    });
  });

  describe('getEvent', () => {
    it('GETs a single event', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validEvent);
      const result = await getEvent('org-1', 'evt-1');
      expect(result.event_id).toBe('evt-1');
    });
  });

  describe('createEvent', () => {
    it('POSTs new event', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validEvent);
      await createEvent('org-1', { title: 'X' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/events',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('updateEvent', () => {
    it('PATCHes updates', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validEvent);
      await updateEvent('org-1', 'evt-1', { description: 'd' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/events/evt-1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  describe('deleteEvent', () => {
    it('DELETEs', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);
      await deleteEvent('org-1', 'evt-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/events/evt-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('getEventObjects', () => {
    it('GETs event objects', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ objects: [], total: 0 });
      await getEventObjects('org-1', 'evt-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/events/evt-1/objects',
      );
    });
  });

  describe('addEventObject', () => {
    it('POSTs new event-object link', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLink);
      await addEventObject('org-1', 'evt-1', { object_id: 'obj-1', planned_use: 'display' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/events/evt-1/objects',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('updateEventObject', () => {
    it('PATCHes the link', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validLink);
      await updateEventObject('org-1', 'evt-1', 'eo-1', { display_order: 5 });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/events/evt-1/objects/eo-1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  describe('removeEventObject', () => {
    it('DELETEs the link', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);
      await removeEventObject('org-1', 'evt-1', 'eo-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/events/evt-1/objects/eo-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('getEventParticipants', () => {
    it('GETs participants', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        participants: [],
        total: 0,
      });
      await getEventParticipants('org-1', 'evt-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/events/evt-1/participants',
      );
    });
  });

  describe('addEventParticipant', () => {
    it('POSTs new participant', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(validParticipant);
      await addEventParticipant('org-1', 'evt-1', { contact_id: 'c-1' });
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/events/evt-1/participants',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('removeEventParticipant', () => {
    it('DELETEs the participant', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(undefined);
      await removeEventParticipant('org-1', 'evt-1', 'p-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/events/evt-1/participants/p-1',
        { method: 'DELETE' },
      );
    });
  });

  describe('getObjectEvents', () => {
    it('GETs object events reverse lookup', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ events: [], total: 0 });
      await getObjectEvents('org-1', 'obj-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/objects/obj-1/events',
      );
    });
  });

  describe('getCollectionsImpact', () => {
    it('GETs collections impact', async () => {
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        needs_movement_plan: false,
        needs_condition_checks: false,
        needs_rights_verification: false,
        objects_needing_movement: [],
        objects_needing_condition_check: [],
        objects_needing_rights_check: [],
        event_status: 'scheduled',
        total_objects: 0,
      });
      await getCollectionsImpact('org-1', 'evt-1');
      expect(apiClient.apiFetch).toHaveBeenCalledWith(
        '/organizations/org-1/collections/events/evt-1/collections-impact',
      );
    });
  });
});
