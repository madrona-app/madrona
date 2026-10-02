import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useLookupValues } from '../../../hooks/useLookupValues';
import {
  createUseRequest,
  updateUseRequest,
  deleteUseRequest,
  approveUseRequest,
  denyUseRequest,
  completeUseRequest,
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
  const { getLookup, getLabel } = useLookupValues({ context: 'use_requests' });

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
        request_date: (request.request_date as string) || new Date().toISOString().split('T')[0],
        use_type: (request.use_type as string) || 'research',
        use_subtype: (request.use_subtype as string) || '',
        use_purpose: (request.use_purpose as string) || '',
        use_description: (request.use_description as string) || '',
        requester_name: (request.requester_name as string) || '',
        requester_title: (request.requester_title as string) || '',
        requester_institution: (request.requester_institution as string) || '',
        requester_email: (request.requester_email as string) || '',
        requester_phone: (request.requester_phone as string) || '',
        access_date_start: (request.access_date_start as string) || '',
        access_date_end: (request.access_date_end as string) || '',
        location_required: (request.location_required as string) || '',
        project_title: (request.project_title as string) || '',
        project_description: (request.project_description as string) || '',
        project_deadline: (request.project_deadline as string) || '',
        reproduction_type: (request.reproduction_type as string) || '',
        reproduction_quantity: request.reproduction_quantity?.toString() || '',
        reproduction_format: (request.reproduction_format as string) || '',
        intended_use: (request.intended_use as string) || '',
        publication_details: (request.publication_details as string) || '',
        credit_line: (request.credit_line as string) || '',
        exhibition_title: (request.exhibition_title as string) || '',
        exhibition_venue: (request.exhibition_venue as string) || '',
        exhibition_dates: (request.exhibition_dates as string) || '',
        insurance_value: request.insurance_value?.toString() || '',
        fee_quoted: request.fee_quoted?.toString() || '',
        fee_paid: request.fee_paid?.toString() || '',
        fee_waived: (request.fee_waived as boolean) || false,
        fee_waiver_reason: (request.fee_waiver_reason as string) || '',
        approval_conditions: (request.approval_conditions as string) || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [request]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createUseRequest(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['use-requests', orgId] });
      navigate(`/organizations/${orgId}/collections/use-requests/${result.request_id}`);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'use_request'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateUseRequest(orgId!, requestId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['use-request', orgId, requestId] });
      queryClient.invalidateQueries({ queryKey: ['use-requests', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'use_request'));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteUseRequest(orgId!, requestId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['use-requests', orgId] });
      navigate(`/organizations/${orgId}/collections/use-requests`);
    },
  });

  // Workflow mutations
  const approveMutation = useMutation({
    mutationFn: () => approveUseRequest(orgId!, requestId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['use-request', orgId, requestId] });
    },
  });

  const denyMutation = useMutation({
    mutationFn: () => denyUseRequest(orgId!, requestId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['use-request', orgId, requestId] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => completeUseRequest(orgId!, requestId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['use-request', orgId, requestId] });
    },
  });

  const startReviewMutation = useMutation({
    mutationFn: () => updateUseRequest(orgId!, requestId!, { status: 'under_review' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['use-request', orgId, requestId] });
    },
  });

  const startProgressMutation = useMutation({
    mutationFn: () => updateUseRequest(orgId!, requestId!, { status: 'in_progress' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['use-request', orgId, requestId] });
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      request_date: fd.request_date || null,
      use_type: fd.use_type,
      use_subtype: fd.use_subtype || null,
      use_purpose: fd.use_purpose || null,
      use_description: fd.use_description || null,
      requester_name: fd.requester_name,
      requester_title: fd.requester_title || null,
      requester_institution: fd.requester_institution || null,
      requester_email: fd.requester_email || null,
      requester_phone: fd.requester_phone || null,
      access_date_start: fd.access_date_start || null,
      access_date_end: fd.access_date_end || null,
      location_required: fd.location_required || null,
      project_title: fd.project_title || null,
      project_description: fd.project_description || null,
      project_deadline: fd.project_deadline || null,
      reproduction_type: fd.reproduction_type || null,
      reproduction_quantity: fd.reproduction_quantity ? parseInt(fd.reproduction_quantity) : null,
      reproduction_format: fd.reproduction_format || null,
      intended_use: fd.intended_use || null,
      publication_details: fd.publication_details || null,
      credit_line: fd.credit_line || null,
      exhibition_title: fd.exhibition_title || null,
      exhibition_venue: fd.exhibition_venue || null,
      exhibition_dates: fd.exhibition_dates || null,
      insurance_value: fd.insurance_value ? parseFloat(fd.insurance_value) : null,
      fee_quoted: fd.fee_quoted ? parseFloat(fd.fee_quoted) : null,
      fee_paid: fd.fee_paid ? parseFloat(fd.fee_paid) : null,
      fee_waived: fd.fee_waived,
      fee_waiver_reason: fd.fee_waiver_reason || null,
      approval_conditions: fd.approval_conditions || null,
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
    approveMutation,
    denyMutation,
    completeMutation,
    startReviewMutation,
    startProgressMutation,
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
      requester: parts([
        formData.requester_name,
        formData.requester_institution,
        formData.requester_email,
      ]),
      details: parts([
        formData.use_type,
        formData.use_purpose ? truncate(formData.use_purpose) : undefined,
      ]),
      objects: undefined,
      access: parts([
        formData.access_date_start,
        formData.access_date_end,
        formData.location_required,
      ]),
      project: parts([
        formData.project_title ? truncate(formData.project_title) : undefined,
        formData.project_deadline,
      ]),
      reproduction: parts([
        formData.reproduction_type,
        formData.reproduction_format,
        formData.reproduction_quantity ? `Qty: ${formData.reproduction_quantity}` : undefined,
      ]),
      exhibition: parts([
        formData.exhibition_title ? truncate(formData.exhibition_title) : undefined,
        formData.exhibition_venue,
      ]),
      fees: parts([
        formData.fee_quoted ? `Quoted: ${formData.fee_quoted}` : undefined,
        formData.fee_waived ? 'Waived' : undefined,
      ]),
      approval: parts([
        formData.approval_conditions ? truncate(formData.approval_conditions) : undefined,
      ]),
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    requester: !!(formData.requester_name || formData.requester_email || formData.requester_institution),
    details: !!(formData.use_type || formData.use_purpose || formData.use_description),
    objects: false,
    access: !!(formData.access_date_start || formData.access_date_end || formData.location_required),
    project: !!(formData.project_title || formData.project_description || formData.project_deadline),
    reproduction: !!(formData.reproduction_type || formData.reproduction_format || formData.reproduction_quantity),
    exhibition: !!(formData.exhibition_title || formData.exhibition_venue || formData.exhibition_dates),
    fees: !!(formData.fee_quoted || formData.fee_paid || formData.fee_waived),
    approval: !!formData.approval_conditions,
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
      basePath: `/organizations/${orgId}/collections/use-requests/${requestId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['use-request', orgId, requestId] }),
    },
  });
}
