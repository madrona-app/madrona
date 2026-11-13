/**
 * Research visit log: in-person use of objects by researchers.
 */
import { apiFetch } from '../apiClient';
import { buildQueryString } from './_utils';

export interface ResearchVisitObject {
  visit_object_id: string;
  visit_id: string;
  object_id: string;
  object_number: string | null;
  object_name: string | null;
  handling_note: string | null;
  condition_on_return: string | null;
  created_at: string | null;
}

export interface ResearchVisit {
  visit_id: string;
  organization_id: string;
  researcher_constituent_id: string | null;
  researcher_constituent_name: string | null;
  researcher_name: string;
  researcher_affiliation: string | null;
  visit_date: string;
  /** "HH:MM", 24-hour */
  arrival_time: string | null;
  departure_time: string | null;
  location: string | null;
  research_topic: string | null;
  purpose: string | null;
  supervised_by_user_id: string | null;
  supervised_by_name: string | null;
  use_request_id: string | null;
  use_request_number: string | null;
  notes: string | null;
  object_count: number;
  objects?: ResearchVisitObject[] | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ResearchVisitInput {
  researcher_constituent_id?: string | null;
  researcher_name?: string;
  researcher_affiliation?: string | null;
  visit_date?: string;
  arrival_time?: string | null;
  departure_time?: string | null;
  location?: string | null;
  research_topic?: string | null;
  purpose?: string | null;
  supervised_by_name?: string | null;
  use_request_id?: string | null;
  notes?: string | null;
}

export interface ObjectResearchVisit {
  visit_id: string;
  visit_date: string;
  researcher_name: string;
  researcher_affiliation: string | null;
  research_topic: string | null;
  handling_note: string | null;
  condition_on_return: string | null;
}

const base = (orgId: string) => `/organizations/${orgId}/collections/research-visits`;

export function getResearchVisits(
  orgId: string,
  params?: { q?: string; limit?: number; offset?: number },
): Promise<{ items: ResearchVisit[]; total: number; limit: number; offset: number }> {
  return apiFetch(`${base(orgId)}${buildQueryString(params || {})}`);
}

export function getResearchVisit(orgId: string, visitId: string): Promise<ResearchVisit> {
  return apiFetch(`${base(orgId)}/${visitId}`);
}

export function createResearchVisit(orgId: string, body: ResearchVisitInput): Promise<ResearchVisit> {
  return apiFetch(base(orgId), { method: 'POST', body: JSON.stringify(body) });
}

export function updateResearchVisit(
  orgId: string,
  visitId: string,
  body: ResearchVisitInput,
): Promise<ResearchVisit> {
  return apiFetch(`${base(orgId)}/${visitId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteResearchVisit(orgId: string, visitId: string): Promise<{ message: string }> {
  return apiFetch(`${base(orgId)}/${visitId}`, { method: 'DELETE' });
}

export function addResearchVisitObject(
  orgId: string,
  visitId: string,
  body: { object_id: string; handling_note?: string | null; condition_on_return?: string | null },
): Promise<ResearchVisitObject> {
  return apiFetch(`${base(orgId)}/${visitId}/objects`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateResearchVisitObject(
  orgId: string,
  visitId: string,
  objectId: string,
  body: { handling_note?: string | null; condition_on_return?: string | null },
): Promise<ResearchVisitObject> {
  return apiFetch(`${base(orgId)}/${visitId}/objects/${objectId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function removeResearchVisitObject(
  orgId: string,
  visitId: string,
  objectId: string,
): Promise<{ message: string }> {
  return apiFetch(`${base(orgId)}/${visitId}/objects/${objectId}`, { method: 'DELETE' });
}

export function getObjectResearchVisits(
  orgId: string,
  objectId: string,
): Promise<{ items: ObjectResearchVisit[] }> {
  return apiFetch(`/organizations/${orgId}/collections/objects/${objectId}/research-visits`);
}
