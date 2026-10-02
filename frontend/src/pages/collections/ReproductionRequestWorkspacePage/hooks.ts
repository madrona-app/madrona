import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useLookupValues } from '../../../hooks/useLookupValues';
import {
  createReproductionRequest,
  updateReproductionRequest,
  deleteReproductionRequest,
  clearReproductionRights,
  deliverReproduction,
} from '../../../lib/api';
import { formatErrorMessage } from '../../../lib/formErrors';
import { validateCreateForm } from '../../../lib/formValidation';
import type { SaveStatus, FormData } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS, defaultFormData } from './types';

// =============================================================================
// useFormState
// =============================================================================

export function useFormState({
  orgId,
  requestId,
  isCreateMode,
  request,
}: {
  orgId: string | undefined;
  requestId: string | undefined;
  isCreateMode: boolean;
  request: Record<string, unknown> | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getLookup, getLabel } = useLookupValues({ context: 'reproductions' });

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Initialize form data from fetched request
  useEffect(() => {
    if (request) {
      const data: FormData = {
        request_number: (request.request_number as string) || '',
        reproduction_type: (request.reproduction_type as string) || 'photograph',
        reproduction_purpose: (request.reproduction_purpose as string) || '',
        quantity: request.quantity?.toString() || '',
        format_requested: (request.format_requested as string) || '',
        dimensions_requested: (request.dimensions_requested as string) || '',
        intended_use: (request.intended_use as string) || '',
        requester_name: (request.requester_name as string) || '',
        requester_institution: (request.requester_institution as string) || '',
        requester_email: (request.requester_email as string) || '',
        requester_phone: (request.requester_phone as string) || '',
        object_id: (request.object_id as string) || '',
        rights_cleared: (request.rights_cleared as boolean) || false,
        rights_check_date: (request.rights_check_date as string)?.split('T')[0] || '',
        rights_restrictions: (request.rights_restrictions as string) || '',
        credit_line_required: (request.credit_line_required as string) || '',
        fee_type: (request.fee_type as string) || '',
        fee_amount: request.fee_amount?.toString() || '',
        fee_currency: (request.fee_currency as string) || 'USD',
        fee_paid: (request.fee_paid as boolean) || false,
        payment_date: (request.payment_date as string)?.split('T')[0] || '',
        delivery_method: (request.delivery_method as string) || '',
        delivery_date: (request.delivery_date as string)?.split('T')[0] || '',
        master_file_reference: (request.master_file_reference as string) || '',
        quality_approved: (request.quality_approved as boolean) || false,
        notes: (request.notes as string) || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [request]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createReproductionRequest(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['reproduction-requests', orgId] });
      navigate(`/organizations/${orgId}/collections/reproduction-requests/${result.reproduction_id}`);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'reproduction_request'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateReproductionRequest(orgId!, requestId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reproduction-request', orgId, requestId] });
      queryClient.invalidateQueries({ queryKey: ['reproduction-requests', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'reproduction_request'));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteReproductionRequest(orgId!, requestId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reproduction-requests', orgId] });
      navigate(`/organizations/${orgId}/collections/reproduction-requests`);
    },
  });

  // Workflow mutations
  const clearRightsMutation = useMutation({
    mutationFn: () => clearReproductionRights(orgId!, requestId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reproduction-request', orgId, requestId] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => updateReproductionRequest(orgId!, requestId!, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reproduction-request', orgId, requestId] });
    },
  });

  const deliverMutation = useMutation({
    mutationFn: () => deliverReproduction(orgId!, requestId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reproduction-request', orgId, requestId] });
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      request_number: fd.request_number,
      reproduction_type: fd.reproduction_type,
      reproduction_purpose: fd.reproduction_purpose || null,
      quantity: fd.quantity ? parseInt(fd.quantity) : null,
      format_requested: fd.format_requested || null,
      dimensions_requested: fd.dimensions_requested || null,
      intended_use: fd.intended_use || null,
      requester_name: fd.requester_name,
      requester_institution: fd.requester_institution || null,
      requester_email: fd.requester_email || null,
      requester_phone: fd.requester_phone || null,
      object_id: fd.object_id || null,
      rights_cleared: fd.rights_cleared,
      rights_check_date: fd.rights_check_date || null,
      rights_restrictions: fd.rights_restrictions || null,
      credit_line_required: fd.credit_line_required || null,
      fee_type: fd.fee_type || null,
      fee_amount: fd.fee_amount ? parseFloat(fd.fee_amount) : null,
      fee_currency: fd.fee_currency,
      fee_paid: fd.fee_paid,
      payment_date: fd.payment_date || null,
      delivery_method: fd.delivery_method || null,
      delivery_date: fd.delivery_date || null,
      master_file_reference: fd.master_file_reference || null,
      quality_approved: fd.quality_approved,
      notes: fd.notes || null,
    };
  }, []);

  const triggerSave = useCallback(() => {
    if (isCreateMode) return;
    const currentHasChanges = JSON.stringify(formDataRef.current) !== originalDataRef.current;
    if (!currentHasChanges) return;
    setSaveStatus('saving');
    setErrorMessage(null);
    updateMutation.mutate(buildPayload());
  }, [updateMutation, isCreateMode, buildPayload]);

  const handleCreate = useCallback(() => {
    const validationError = validateCreateForm(formDataRef.current as unknown as Record<string, unknown>, [
      { field: 'title', label: 'Title', check: 'required' },
    ]);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setSaveStatus('saving');
    setErrorMessage(null);
    createMutation.mutate(buildPayload());
  }, [createMutation, buildPayload]);

  const updateField = useCallback((field: string, value: string | boolean) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      setHasUnsavedChanges(JSON.stringify(next) !== originalDataRef.current);
      return next;
    });
    if (!isCreateMode) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => { triggerSave(); }, 1000);
    }
  }, [isCreateMode, triggerSave]);

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
    triggerSave,
    handleCreate,
    deleteMutation,
    clearRightsMutation,
    statusMutation,
    deliverMutation,
    getLookup,
    getLabel,
  };
}

// =============================================================================
// useSectionSummaries
// =============================================================================

const truncate = (s: string, max = 60) => s.length > max ? s.slice(0, max) + '\u2026' : s;

export function useSectionSummaries(formData: FormData): Record<string, string | undefined> {
  return useMemo(() => {
    const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
    return {
      details: parts([
        formData.reproduction_type,
        formData.format_requested,
        formData.quantity ? `Qty: ${formData.quantity}` : undefined,
      ]),
      requester: parts([
        formData.requester_name,
        formData.requester_institution,
        formData.requester_email,
      ]),
      linkedObject: formData.object_id ? 'Object linked' : undefined,
      rights: parts([
        formData.rights_cleared ? 'Cleared' : undefined,
        formData.rights_check_date,
        formData.credit_line_required ? truncate(formData.credit_line_required) : undefined,
      ]),
      fees: parts([
        formData.fee_type,
        formData.fee_amount ? `${formData.fee_currency} ${formData.fee_amount}` : undefined,
        formData.fee_paid ? 'Paid' : undefined,
      ]),
      fulfillment: parts([
        formData.delivery_method,
        formData.delivery_date,
        formData.quality_approved ? 'Quality approved' : undefined,
      ]),
      notes: formData.notes ? truncate(formData.notes) : undefined,
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    details: !!(formData.reproduction_type || formData.format_requested || formData.quantity || formData.intended_use),
    requester: !!(formData.requester_name || formData.requester_email || formData.requester_institution),
    linkedObject: !!formData.object_id,
    rights: !!(formData.rights_cleared || formData.rights_check_date || formData.rights_restrictions || formData.credit_line_required),
    fees: !!(formData.fee_type || formData.fee_amount || formData.fee_paid),
    fulfillment: !!(formData.delivery_method || formData.delivery_date || formData.master_file_reference || formData.quality_approved),
    notes: !!formData.notes,
    history: false,
  }), [formData]);
}

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  requestId: string | undefined;
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
  requestId,
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
      basePath: `/organizations/${orgId}/collections/reproduction-requests/${requestId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['reproduction-request', orgId, requestId] }),
    },
  });
}
