import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import * as apiClientModule from '../../../lib/apiClient';

vi.mock('../../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

const mockApiFetch = vi.mocked(apiClientModule.apiFetch);

import {
  useFormState,
  useSectionSummaries,
  useHasContent,
} from '../../../pages/collections/ShipmentWorkspacePage/hooks';
import type { ShipmentDetail, FormData as ShipmentFormData } from '../../../pages/collections/ShipmentWorkspacePage/types';
import { defaultFormData } from '../../../pages/collections/ShipmentWorkspacePage/types';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

const baseShipment: ShipmentDetail = {
  shipment_id: 'ship-1',
  organization_id: 'org-1',
  department_id: null,
  shipment_number: 'SHIP-001',
  shipment_type: 'outbound',
  shipment_type_label: 'Outbound',
  direction: 'outbound',
  direction_label: 'Outbound',
  purpose: 'loan',
  purpose_label: 'Loan',
  status: 'draft',
  status_label: 'Draft',
  ship_from_contact_id: null,
  ship_from_contact: null,
  ship_from_location_id: null,
  ship_from_location: null,
  ship_from_address: null,
  ship_to_contact_id: null,
  ship_to_contact: null,
  ship_to_location_id: null,
  ship_to_location: null,
  ship_to_address: null,
  requested_date: null,
  estimated_dispatch_date: null,
  estimated_arrival_date: null,
  actual_dispatch_date: null,
  actual_arrival_date: null,
  insurance_value_total: '5000',
  insurance_currency: 'USD',
  insurance_note: 'Standard coverage',
  courier_required: true,
  is_international: false,
  is_high_value: true,
  authorized_by: null,
  authorization_date: null,
  remarks: 'Hello',
  internal_notes: '',
  legs: [
    {
      leg_id: 'leg-1',
      leg_number: 1,
      shipping_method: 'truck',
      shipping_method_label: 'Truck',
      carrier_name: null,
      tracking_number: null,
      departure_location: null,
      departure_date: null,
      arrival_location: null,
      arrival_date: null,
      status: 'planned',
      status_label: 'Planned',
    },
  ],
  items: [
    {
      shipment_item_id: 'item-1',
      object_id: 'obj-1',
      object_number: 'OBJ-1',
      object_title: 'Vase',
      crate_id: null,
      crate_number: null,
      status: 'packed',
      status_label: 'Packed',
      packing_notes: null,
    },
  ],
  references: [
    {
      reference_id: 'ref-1',
      procedure_type: 'loan_out',
      procedure_type_label: 'Loan Out',
      procedure_id: 'loan-1',
      notes: null,
    },
  ],
  documents: [
    {
      document_id: 'doc-1',
      media_id: 'media-1',
      document_type: 'invoice',
      document_type_label: 'Invoice',
      label: null,
    },
  ],
  status_history: [
    {
      history_id: 'hist-1',
      status: 'draft',
      status_label: 'Draft',
      notes: null,
      changed_at: '2026-04-01T00:00:00Z',
    },
  ],
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-02T00:00:00Z',
};

describe('ShipmentWorkspacePage hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useFormState', () => {
    it('starts with default form data when no shipment is provided', () => {
      const { result } = renderHook(
        () =>
          useFormState({
            orgId: 'org-1',
            shipmentId: undefined,
            isCreateMode: true,
            shipment: undefined,
          }),
        { wrapper: createWrapper() }
      );
      expect(result.current.formData.shipment_type).toBe(defaultFormData.shipment_type);
      expect(result.current.hasUnsavedChanges).toBe(false);
      expect(result.current.saveStatus).toBe('idle');
    });

    it('hydrates form data from a fetched shipment', async () => {
      const { result } = renderHook(
        () =>
          useFormState({
            orgId: 'org-1',
            shipmentId: 'ship-1',
            isCreateMode: false,
            shipment: baseShipment,
          }),
        { wrapper: createWrapper() }
      );
      await waitFor(() => {
        expect(result.current.formData.shipment_number).toBe('SHIP-001');
      });
      expect(result.current.formData.insurance_value_total).toBe('5000');
      expect(result.current.formData.courier_required).toBe(true);
      expect(result.current.formData.is_high_value).toBe(true);
    });

    it('marks form dirty when a field is updated in create mode', async () => {
      const { result } = renderHook(
        () =>
          useFormState({
            orgId: 'org-1',
            shipmentId: undefined,
            isCreateMode: true,
            shipment: undefined,
          }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.updateField('shipment_number', 'NEW-001');
      });

      expect(result.current.formData.shipment_number).toBe('NEW-001');
      // Dirty flag is set whenever the JSON differs from the stored
      // original snapshot.
      expect(result.current.hasUnsavedChanges).toBe(true);
    });

    it('emits a validation error if shipment_type is missing on create', () => {
      const { result } = renderHook(
        () =>
          useFormState({
            orgId: 'org-1',
            shipmentId: undefined,
            isCreateMode: true,
            shipment: undefined,
          }),
        { wrapper: createWrapper() }
      );

      // Empty out the required field then attempt create.
      act(() => {
        result.current.updateField('shipment_type', '');
      });
      act(() => {
        result.current.handleCreate();
      });

      expect(result.current.errorMessage).toBeTruthy();
    });

    it('triggers a POST with the form payload on successful create', async () => {
      mockApiFetch.mockResolvedValue({ ...baseShipment, shipment_id: 'new-1' } as never);

      const { result } = renderHook(
        () =>
          useFormState({
            orgId: 'org-1',
            shipmentId: undefined,
            isCreateMode: true,
            shipment: undefined,
          }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.updateField('shipment_number', 'SHIP-NEW');
      });

      act(() => {
        result.current.handleCreate();
      });

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/organizations/org-1/collections/shipments',
          expect.objectContaining({ method: 'POST' })
        );
      });
      const callArgs = mockApiFetch.mock.calls[0][1];
      const body = JSON.parse((callArgs as { body: string }).body);
      expect(body.shipment_number).toBe('SHIP-NEW');
      expect(body.shipment_type).toBe('outbound');
      // Optional empty strings should serialize to null per buildPayload.
      expect(body.direction).toBeNull();
    });

    it('preserves boolean values in the create payload', async () => {
      mockApiFetch.mockResolvedValue({ ...baseShipment } as never);

      const { result } = renderHook(
        () =>
          useFormState({
            orgId: 'org-1',
            shipmentId: undefined,
            isCreateMode: true,
            shipment: undefined,
          }),
        { wrapper: createWrapper() }
      );

      act(() => {
        result.current.updateField('courier_required', true);
        result.current.updateField('is_international', false);
      });
      act(() => {
        result.current.handleCreate();
      });

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalled();
      });
      const body = JSON.parse(mockApiFetch.mock.calls[0][1]?.body as string);
      expect(body.courier_required).toBe(true);
      expect(body.is_international).toBe(false);
    });

    it('does not call performSave when there are no changes', () => {
      const { result } = renderHook(
        () =>
          useFormState({
            orgId: 'org-1',
            shipmentId: 'ship-1',
            isCreateMode: false,
            shipment: baseShipment,
          }),
        { wrapper: createWrapper() }
      );
      mockApiFetch.mockClear();
      act(() => {
        result.current.performSave();
      });
      expect(mockApiFetch).not.toHaveBeenCalled();
    });
  });

  describe('useSectionSummaries', () => {
    it('produces a summary that joins detail fields', () => {
      const formData: ShipmentFormData = {
        ...defaultFormData,
        shipment_type: 'outbound',
        direction: 'outbound',
        purpose: 'loan',
        status: 'draft',
        insurance_value_total: '5000',
        insurance_currency: 'USD',
        remarks: 'Some remarks',
      };

      const { result } = renderHook(() => useSectionSummaries(formData, baseShipment));
      expect(result.current.details).toContain('outbound');
      expect(result.current.details).toContain('draft');
      expect(result.current.insurance).toContain('5000');
      expect(result.current.legs).toBe('1 leg');
      expect(result.current.items).toBe('1 item');
      expect(result.current.references).toBe('1 linked');
      expect(result.current.documents).toBe('1 document');
      expect(result.current.statusHistory).toBe('1 entries');
    });

    it('returns undefined for empty collections', () => {
      const empty: ShipmentDetail = {
        ...baseShipment,
        legs: [],
        items: [],
        references: [],
        documents: [],
        status_history: [],
      };
      const { result } = renderHook(() => useSectionSummaries(defaultFormData, empty));
      expect(result.current.legs).toBeUndefined();
      expect(result.current.items).toBeUndefined();
      expect(result.current.references).toBeUndefined();
      expect(result.current.documents).toBeUndefined();
      expect(result.current.statusHistory).toBeUndefined();
    });
  });

  describe('useHasContent', () => {
    it('flags sections that contain data', () => {
      const formData: ShipmentFormData = {
        ...defaultFormData,
        insurance_value_total: '500',
        remarks: 'note',
      };
      const { result } = renderHook(() => useHasContent(formData, baseShipment));
      expect(result.current.details).toBe(true);
      expect(result.current.insurance).toBe(true);
      expect(result.current.legs).toBe(true);
      expect(result.current.items).toBe(true);
      expect(result.current.references).toBe(true);
      expect(result.current.documents).toBe(true);
      expect(result.current.notes).toBe(true);
      expect(result.current.statusHistory).toBe(true);
      expect(result.current.history).toBe(true);
    });

    it('reports empty sections when neither form nor shipment data exist', () => {
      const empty: ShipmentDetail = {
        ...baseShipment,
        legs: [],
        items: [],
        references: [],
        documents: [],
        status_history: [],
      };
      const formData: ShipmentFormData = {
        ...defaultFormData,
        shipment_type: '',
        direction: '',
        purpose: '',
        status: '',
        insurance_value_total: '',
        insurance_note: '',
        remarks: '',
        internal_notes: '',
      };
      const { result } = renderHook(() => useHasContent(formData, empty));
      expect(result.current.details).toBe(false);
      expect(result.current.insurance).toBe(false);
      expect(result.current.legs).toBe(false);
      expect(result.current.items).toBe(false);
      expect(result.current.references).toBe(false);
      expect(result.current.documents).toBe(false);
      expect(result.current.notes).toBe(false);
      expect(result.current.statusHistory).toBe(false);
    });
  });
});
