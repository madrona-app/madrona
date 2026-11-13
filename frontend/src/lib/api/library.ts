/**
 * Library catalog: bibliographic records, holdings and items.
 */
import { apiFetch } from '../apiClient';
import { buildQueryString } from './_utils';

export const RECORD_TYPES = [
  { value: 'book', label: 'Book' },
  { value: 'serial', label: 'Serial' },
  { value: 'pamphlet', label: 'Pamphlet' },
  { value: 'braille', label: 'Braille' },
  { value: 'large_print', label: 'Large print' },
  { value: 'audio', label: 'Audio' },
  { value: 'video', label: 'Video' },
  { value: 'manuscript', label: 'Manuscript' },
  { value: 'other', label: 'Other' },
] as const;
export type RecordType = (typeof RECORD_TYPES)[number]['value'];

export const ITEM_STATUSES = [
  { value: 'available', label: 'Available' },
  { value: 'on_loan', label: 'On loan' },
  { value: 'missing', label: 'Missing' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'in_processing', label: 'In processing' },
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number]['value'];

export const NAME_ROLES = [
  { value: 'author', label: 'Author' },
  { value: 'editor', label: 'Editor' },
  { value: 'translator', label: 'Translator' },
  { value: 'illustrator', label: 'Illustrator' },
  { value: 'narrator', label: 'Narrator' },
  { value: 'transcriber', label: 'Transcriber' },
  { value: 'compiler', label: 'Compiler' },
  { value: 'contributor', label: 'Contributor' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'other', label: 'Other' },
] as const;
export type NameRole = (typeof NAME_ROLES)[number]['value'];

const labelFrom = (list: readonly { value: string; label: string }[], value: string | null | undefined) =>
  list.find((o) => o.value === value)?.label ?? value ?? '';
export const recordTypeLabel = (v: string | null | undefined) => labelFrom(RECORD_TYPES, v);
export const itemStatusLabel = (v: string | null | undefined) => labelFrom(ITEM_STATUSES, v);
export const nameRoleLabel = (v: string | null | undefined) => labelFrom(NAME_ROLES, v);

export interface BibItem {
  item_id: string;
  holding_id: string;
  barcode: string | null;
  copy_number: string | null;
  enumeration: string | null;
  chronology: string | null;
  status: ItemStatus;
  condition_note: string | null;
  collection_object_id: string | null;
  collection_object_number: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface BibHolding {
  holding_id: string;
  bib_record_id: string;
  location_id: string | null;
  location_name: string | null;
  call_number: string | null;
  holdings_statement: string | null;
  shelving_notes: string | null;
  public_note: string | null;
  staff_note: string | null;
  items: BibItem[];
  created_at: string | null;
  updated_at: string | null;
}

export interface BibSubject {
  link_id: string;
  subject_authority_id: string;
  preferred_term: string | null;
  lcsh_id: string | null;
  display_order: number;
}

export interface BibName {
  link_id: string;
  constituent_id: string;
  name: string | null;
  role: NameRole;
  display_order: number;
}

export interface BibRecordFields {
  record_type: RecordType;
  title: string;
  subtitle: string | null;
  statement_of_responsibility: string | null;
  edition: string | null;
  place: string | null;
  publisher: string | null;
  date_display: string | null;
  date_earliest: number | null;
  date_latest: number | null;
  extent: string | null;
  series_statement: string | null;
  language: string | null;
  isbn: string | null;
  issn: string | null;
  lccn: string | null;
  oclc_number: string | null;
  call_number: string | null;
  format_notes: string | null;
  notes: string | null;
}

/** Fields may be absent when a field-level policy hides them from the caller. */
export interface BibRecord extends Partial<BibRecordFields> {
  bib_record_id: string;
  organization_id: string;
  holding_count: number;
  item_count: number;
  holdings?: BibHolding[];
  subjects?: BibSubject[];
  names?: BibName[];
  created_at?: string | null;
  updated_at?: string | null;
  _restricted_fields?: string[];
}

export type BibRecordInput = Partial<BibRecordFields>;

export interface BibHoldingInput {
  location_id?: string | null;
  call_number?: string | null;
  holdings_statement?: string | null;
  shelving_notes?: string | null;
  public_note?: string | null;
  staff_note?: string | null;
}

export interface BibItemInput {
  barcode?: string | null;
  copy_number?: string | null;
  enumeration?: string | null;
  chronology?: string | null;
  status?: ItemStatus;
  condition_note?: string | null;
  collection_object_id?: string | null;
}

const base = (orgId: string) => `/organizations/${orgId}/collections/library/records`;
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

export function getBibRecords(
  orgId: string,
  params?: { q?: string; record_type?: string; limit?: number; offset?: number },
): Promise<{ items: BibRecord[]; total: number; limit: number; offset: number }> {
  return apiFetch(`${base(orgId)}${buildQueryString(params || {})}`);
}

export function getBibRecord(orgId: string, recordId: string): Promise<BibRecord> {
  return apiFetch(`${base(orgId)}/${recordId}`);
}

export function createBibRecord(orgId: string, body: BibRecordInput): Promise<BibRecord> {
  return apiFetch(base(orgId), json('POST', body));
}

export function updateBibRecord(orgId: string, recordId: string, body: BibRecordInput): Promise<BibRecord> {
  return apiFetch(`${base(orgId)}/${recordId}`, json('PATCH', body));
}

export function deleteBibRecord(orgId: string, recordId: string): Promise<{ message: string }> {
  return apiFetch(`${base(orgId)}/${recordId}`, { method: 'DELETE' });
}

export function addBibHolding(orgId: string, recordId: string, body: BibHoldingInput): Promise<BibHolding> {
  return apiFetch(`${base(orgId)}/${recordId}/holdings`, json('POST', body));
}

export function updateBibHolding(
  orgId: string, recordId: string, holdingId: string, body: BibHoldingInput,
): Promise<BibHolding> {
  return apiFetch(`${base(orgId)}/${recordId}/holdings/${holdingId}`, json('PATCH', body));
}

export function deleteBibHolding(orgId: string, recordId: string, holdingId: string): Promise<{ message: string }> {
  return apiFetch(`${base(orgId)}/${recordId}/holdings/${holdingId}`, { method: 'DELETE' });
}

export function addBibItem(
  orgId: string, recordId: string, holdingId: string, body: BibItemInput,
): Promise<BibItem> {
  return apiFetch(`${base(orgId)}/${recordId}/holdings/${holdingId}/items`, json('POST', body));
}

export function updateBibItem(
  orgId: string, recordId: string, holdingId: string, itemId: string, body: BibItemInput,
): Promise<BibItem> {
  return apiFetch(`${base(orgId)}/${recordId}/holdings/${holdingId}/items/${itemId}`, json('PATCH', body));
}

export function deleteBibItem(
  orgId: string, recordId: string, holdingId: string, itemId: string,
): Promise<{ message: string }> {
  return apiFetch(`${base(orgId)}/${recordId}/holdings/${holdingId}/items/${itemId}`, { method: 'DELETE' });
}

export function addBibSubject(orgId: string, recordId: string, subjectAuthorityId: string): Promise<BibSubject> {
  return apiFetch(`${base(orgId)}/${recordId}/subjects`, json('POST', { subject_authority_id: subjectAuthorityId }));
}

export function removeBibSubject(orgId: string, recordId: string, linkId: string): Promise<{ message: string }> {
  return apiFetch(`${base(orgId)}/${recordId}/subjects/${linkId}`, { method: 'DELETE' });
}

export function addBibName(
  orgId: string, recordId: string, constituentId: string, role: NameRole,
): Promise<BibName> {
  return apiFetch(`${base(orgId)}/${recordId}/names`, json('POST', { constituent_id: constituentId, role }));
}

export function removeBibName(orgId: string, recordId: string, linkId: string): Promise<{ message: string }> {
  return apiFetch(`${base(orgId)}/${recordId}/names/${linkId}`, { method: 'DELETE' });
}
