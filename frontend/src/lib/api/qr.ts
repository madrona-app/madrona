/**
 * QR entry-kit API client.
 *
 * Museum-level site QR (image blob) and batch object-label PDF generation.
 * apiFetch returns a Blob automatically for image/* and application/pdf
 * responses, so these helpers just forward the request.
 */

import { apiFetch } from '../apiClient';

export type QrImageFormat = 'png' | 'svg';
export type LabelLayout = '4up' | '6up';

/** Max object_ids the batch label endpoint accepts per request. */
export const MAX_LABELS_PER_BATCH = 100;

/** Fetch the museum-level site QR as an image blob. */
export async function getSiteQr(
  organizationId: string,
  format: QrImageFormat,
): Promise<Blob> {
  return await apiFetch<Blob>(
    `/organizations/${organizationId}/qr/site?format=${format}`,
  );
}

/** Generate a printable PDF label sheet for the given discoverable objects. */
export async function generateLabelPdf(
  organizationId: string,
  objectIds: string[],
  layout: LabelLayout,
): Promise<Blob> {
  return await apiFetch<Blob>(
    `/organizations/${organizationId}/qr/labels`,
    {
      method: 'POST',
      body: JSON.stringify({ object_ids: objectIds, layout }),
    },
  );
}
