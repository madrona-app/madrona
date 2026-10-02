import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { apiFetch } from '../../../lib/apiClient';
import { validateCreateForm } from '../../../lib/formValidation';
import type { SaveStatus, FormData, ShipmentDetail } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS, defaultFormData } from './types';

// =============================================================================
// useFormState
// =============================================================================

export function useFormState({
  orgId,
  shipmentId,
  isCreateMode,
  shipment,
}: {
  orgId: string | undefined;
  shipmentId: string | undefined;
  isCreateMode: boolean;
  shipment: ShipmentDetail | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Initialize form data from fetched shipment
  useEffect(() => {
    if (shipment) {
      const data: FormData = {
        shipment_number: shipment.shipment_number || '',
        shipment_type: shipment.shipment_type || 'outbound',
        direction: shipment.direction || '',
        purpose: shipment.purpose || '',
        status: shipment.status || 'draft',
        estimated_dispatch_date: shipment.estimated_dispatch_date || '',
        estimated_arrival_date: shipment.estimated_arrival_date || '',
        actual_dispatch_date: shipment.actual_dispatch_date || '',
        actual_arrival_date: shipment.actual_arrival_date || '',
        requested_date: shipment.requested_date || '',
        insurance_value_total: shipment.insurance_value_total || '',
        insurance_currency: shipment.insurance_currency || 'USD',
        insurance_note: shipment.insurance_note || '',
        courier_required: shipment.courier_required,
        is_international: shipment.is_international,
        is_high_value: shipment.is_high_value,
        remarks: shipment.remarks || '',
        internal_notes: shipment.internal_notes || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [shipment]);

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    const payload: Record<string, unknown> = { ...fd };
    // Convert empty strings to null for optional fields
    for (const key of Object.keys(payload)) {
      if (payload[key] === '') payload[key] = null;
    }
    // Preserve booleans
    payload.courier_required = fd.courier_required;
    payload.is_international = fd.is_international;
    payload.is_high_value = fd.is_high_value;
    return payload;
  }, []);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<ShipmentDetail>(
        `/organizations/${orgId}/collections/shipments`,
        { method: 'POST', body: JSON.stringify(buildPayload()) }
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['shipments', orgId] });
      navigate(`/organizations/${orgId}/collections/shipments/${data.shipment_id}`, { replace: true });
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: () =>
      apiFetch<ShipmentDetail>(
        `/organizations/${orgId}/collections/shipments/${shipmentId}`,
        { method: 'PATCH', body: JSON.stringify(buildPayload()) }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipment', orgId, shipmentId] });
      queryClient.invalidateQueries({ queryKey: ['shipments', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        `/organizations/${orgId}/collections/shipments/${shipmentId}`,
        { method: 'DELETE' }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipments', orgId] });
      navigate(`/organizations/${orgId}/collections/shipments`, { replace: true });
    },
  });

  const performSave = useCallback(() => {
    if (isCreateMode) return;
    const currentHasChanges = JSON.stringify(formDataRef.current) !== originalDataRef.current;
    if (!currentHasChanges) return;
    setSaveStatus('saving');
    setErrorMessage(null);
    updateMutation.mutate();
  }, [updateMutation, isCreateMode]);

  const handleCreate = useCallback(() => {
    const validationError = validateCreateForm(formDataRef.current as unknown as Record<string, unknown>, [
      { field: 'shipment_type', label: 'Shipment Type', check: 'required' },
    ]);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setSaveStatus('saving');
    setErrorMessage(null);
    createMutation.mutate();
  }, [createMutation]);

  const updateField = useCallback((field: string, value: string | boolean) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      setHasUnsavedChanges(JSON.stringify(next) !== originalDataRef.current);
      return next;
    });
    if (!isCreateMode) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => { performSave(); }, 1000);
    }
  }, [isCreateMode, performSave]);

  // Warn on unsaved changes before unload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  return {
    formData,
    updateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    queryClient,
    performSave,
    handleCreate,
    deleteMutation,
  };
}

// =============================================================================
// useSectionState — thin wrapper around useUnifiedSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  shipmentId: string | undefined;
  isCreateMode: boolean;
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
  canEdit: boolean;
  hasUnsavedChanges: boolean;
  performSave: () => void;
  queryClient: ReturnType<typeof useQueryClient>;
}

export function useSectionState({
  orgId,
  shipmentId,
  isCreateMode,
  isEditing,
  setIsEditing,
  canEdit,
  hasUnsavedChanges,
  performSave,
  queryClient,
}: UseSectionStateParams) {
  return useUnifiedSectionState({
    sectionGroups: SECTION_GROUPS,
    groupOrder: GROUP_ORDER,
    initialExpandedSections: INITIAL_EXPANDED_SECTIONS,
    editMode: {
      basePath: `/organizations/${orgId}/collections/shipments/${shipmentId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['shipment', orgId, shipmentId] }),
    },
  });
}

// =============================================================================
// useSectionSummaries
// =============================================================================

export function useSectionSummaries(
  formData: FormData,
  shipment: ShipmentDetail | undefined,
): Record<string, string | undefined> {
  return useMemo(() => {
    const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
    const truncate = (s: string | undefined, max = 60) =>
      s && s.length > max ? s.slice(0, max) + '\u2026' : s;
    return {
      details: parts([
        formData.shipment_type,
        formData.direction || undefined,
        formData.purpose || undefined,
        formData.status,
      ]),
      insurance: parts([
        formData.insurance_value_total ? `${formData.insurance_value_total} ${formData.insurance_currency}` : undefined,
      ]),
      legs: shipment?.legs?.length ? `${shipment.legs.length} leg${shipment.legs.length !== 1 ? 's' : ''}` : undefined,
      items: shipment?.items?.length ? `${shipment.items.length} item${shipment.items.length !== 1 ? 's' : ''}` : undefined,
      references: shipment?.references?.length ? `${shipment.references.length} linked` : undefined,
      documents: shipment?.documents?.length ? `${shipment.documents.length} document${shipment.documents.length !== 1 ? 's' : ''}` : undefined,
      notes: truncate(formData.remarks || formData.internal_notes || undefined),
      statusHistory: shipment?.status_history?.length ? `${shipment.status_history.length} entries` : undefined,
      history: undefined,
    };
  }, [formData, shipment]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(
  formData: FormData,
  shipment: ShipmentDetail | undefined,
): Record<string, boolean> {
  return useMemo(() => ({
    details: !!(formData.shipment_type || formData.direction || formData.purpose || formData.status),
    insurance: !!(formData.insurance_value_total || formData.insurance_note),
    legs: !!(shipment?.legs && shipment.legs.length > 0),
    items: !!(shipment?.items && shipment.items.length > 0),
    references: !!(shipment?.references && shipment.references.length > 0),
    documents: !!(shipment?.documents && shipment.documents.length > 0),
    notes: !!(formData.remarks || formData.internal_notes),
    statusHistory: !!(shipment?.status_history && shipment.status_history.length > 0),
    history: true,
  }), [formData, shipment]);
}
