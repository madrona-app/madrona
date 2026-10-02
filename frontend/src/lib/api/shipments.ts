/**
 * Shipment sub-resource API functions.
 * Parent shipment CRUD is handled via apiFetch in the workspace hooks.
 */
import { apiFetch } from '../apiClient';

const base = (orgId: string, shipmentId: string) =>
  `/organizations/${orgId}/collections/shipments/${shipmentId}`;

// ---------------------------------------------------------------------------
// Crates
// ---------------------------------------------------------------------------

export async function listCrates(
  organizationId: string,
  params?: { q?: string; active?: string; limit?: number },
): Promise<{
  items: Array<{
    crate_id: string;
    crate_number: string;
    description: string | null;
    condition: string | null;
  }>;
}> {
  const query = new URLSearchParams();
  if (params?.q) query.set('q', params.q);
  if (params?.active) query.set('active', params.active);
  if (params?.limit) query.set('limit', String(params.limit));
  return apiFetch(`/organizations/${organizationId}/collections/crates?${query}`);
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function addShipmentItem(
  orgId: string,
  shipmentId: string,
  data: { object_id: string; crate_id?: string; insurance_value?: string; insurance_currency?: string; status?: string; packing_notes?: string; special_instructions?: string; condition_out_note?: string },
) {
  return apiFetch(`${base(orgId, shipmentId)}/items`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateShipmentItem(
  orgId: string,
  shipmentId: string,
  itemId: string,
  data: Record<string, unknown>,
) {
  return apiFetch(`${base(orgId, shipmentId)}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function removeShipmentItem(orgId: string, shipmentId: string, itemId: string) {
  return apiFetch(`${base(orgId, shipmentId)}/items/${itemId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------

export async function addShipmentLeg(
  orgId: string,
  shipmentId: string,
  data: { shipping_method?: string; carrier_name?: string; tracking_number?: string; departure_location?: string; departure_date?: string; arrival_location?: string; arrival_date?: string; climate_controlled?: boolean; status?: string; notes?: string },
) {
  return apiFetch(`${base(orgId, shipmentId)}/legs`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateShipmentLeg(
  orgId: string,
  shipmentId: string,
  legId: string,
  data: Record<string, unknown>,
) {
  return apiFetch(`${base(orgId, shipmentId)}/legs/${legId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function removeShipmentLeg(orgId: string, shipmentId: string, legId: string) {
  return apiFetch(`${base(orgId, shipmentId)}/legs/${legId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export async function addShipmentReference(
  orgId: string,
  shipmentId: string,
  data: { procedure_type: string; procedure_id: string; notes?: string },
) {
  return apiFetch(`${base(orgId, shipmentId)}/references`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function removeShipmentReference(orgId: string, shipmentId: string, refId: string) {
  return apiFetch(`${base(orgId, shipmentId)}/references/${refId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function addShipmentDocument(
  orgId: string,
  shipmentId: string,
  data: { media_id: string; document_type?: string; label?: string },
) {
  return apiFetch(`${base(orgId, shipmentId)}/documents`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function removeShipmentDocument(orgId: string, shipmentId: string, docId: string) {
  return apiFetch(`${base(orgId, shipmentId)}/documents/${docId}`, { method: 'DELETE' });
}
