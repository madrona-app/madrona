import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useLookupValues } from '../../../hooks/useLookupValues';
import {
  getConservationTreatment,
  createConservationTreatment,
  updateConservationTreatment,
  deleteConservationTreatment,
  getContact,
} from '../../../lib/api';
import { formatErrorMessage } from '../../../lib/formErrors';
import { validateCreateForm } from '../../../lib/formValidation';
import type { SaveStatus, ConservationFormData } from './types';
import { defaultFormData, SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS } from './types';

// =============================================================================
// useFormState
// =============================================================================

interface UseFormStateParams {
  orgId: string | undefined;
  conservationId: string | undefined;
  isCreateMode: boolean;
  conservation: Record<string, unknown> | null | undefined;
}

export function useFormState({
  orgId,
  conservationId,
  isCreateMode,
}: UseFormStateParams) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getLookup, getLabel } = useLookupValues({ context: 'conservation' });

  const [formData, setFormData] = useState<ConservationFormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Fetch treatment data (disabled in create mode)
  const { data: conservation, isLoading, error } = useQuery({
    queryKey: ['conservation-treatment', orgId, conservationId],
    queryFn: () => getConservationTreatment(orgId!, conservationId!),
    enabled: !isCreateMode && !!orgId && !!conservationId,
  });

  // Fetch conservator contact details when conservator_id is set
  const { data: conservatorContact } = useQuery({
    queryKey: ['contact', orgId, formData.conservator_id],
    queryFn: () => getContact(orgId!, formData.conservator_id),
    enabled: !!orgId && !!formData.conservator_id,
  });

  // Initialize form data from fetched treatment
  useEffect(() => {
    if (conservation) {
      const data: ConservationFormData = {
        object_id: conservation.object_id || '',
        conservator_id: conservation.conservator_id || '',
        treatment_type: conservation.treatment_type || 'remedial',
        proposal_date: conservation.proposal_date || new Date().toISOString().split('T')[0],
        proposal_summary: conservation.proposal_summary || '',
        proposal_document_ref: conservation.proposal_document_ref || '',
        estimated_duration_days: conservation.estimated_duration_days?.toString() || '',
        estimated_cost: conservation.estimated_cost?.toString() || '',
        estimated_cost_currency: conservation.estimated_cost_currency || 'USD',
        start_date: conservation.start_date || '',
        end_date: conservation.end_date || '',
        actual_duration_days: conservation.actual_duration_days?.toString() || '',
        actual_cost: conservation.actual_cost?.toString() || '',
        actual_cost_currency: conservation.actual_cost_currency || 'USD',
        treatment_description: conservation.treatment_description || '',
        materials_used: conservation.materials_used ? JSON.stringify(conservation.materials_used) : '',
        methods_used: conservation.methods_used || '',
        recommendations: conservation.recommendations || '',
        restrictions: conservation.restrictions || '',
        treatment_note: conservation.treatment_note || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [conservation]);

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      object_id: fd.object_id || null,
      conservator_id: fd.conservator_id || null,
      treatment_type: fd.treatment_type,
      proposal_date: fd.proposal_date || null,
      proposal_summary: fd.proposal_summary || null,
      proposal_document_ref: fd.proposal_document_ref || null,
      estimated_duration_days: fd.estimated_duration_days ? parseInt(fd.estimated_duration_days) : null,
      estimated_cost: fd.estimated_cost ? parseFloat(fd.estimated_cost) : null,
      estimated_cost_currency: fd.estimated_cost_currency,
      start_date: fd.start_date || null,
      end_date: fd.end_date || null,
      actual_duration_days: fd.actual_duration_days ? parseInt(fd.actual_duration_days) : null,
      actual_cost: fd.actual_cost ? parseFloat(fd.actual_cost) : null,
      actual_cost_currency: fd.actual_cost_currency,
      treatment_description: fd.treatment_description || null,
      materials_used: fd.materials_used ? JSON.parse(fd.materials_used) : null,
      methods_used: fd.methods_used || null,
      recommendations: fd.recommendations || null,
      restrictions: fd.restrictions || null,
      treatment_note: fd.treatment_note || null,
    };
  }, []);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createConservationTreatment(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['conservation', orgId] });
      navigate(`/organizations/${orgId}/collections/conservation/${result.treatment_id}`);
    },
    onError: (err: Error) => {
      setErrorMessage(formatErrorMessage(err.message, 'conservation'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateConservationTreatment(orgId!, conservationId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conservation', orgId] });
      queryClient.invalidateQueries({ queryKey: ['conservation-treatment', orgId, conservationId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (err: Error) => {
      setErrorMessage(formatErrorMessage(err.message, 'conservation'));
      setSaveStatus('error');
    },
  });

  // Status mutation
  const statusMutation = useMutation({
    mutationFn: (status: 'proposed' | 'approved' | 'in_progress' | 'completed' | 'cancelled') =>
      updateConservationTreatment(orgId!, conservationId!, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conservation-treatment', orgId, conservationId] });
      queryClient.invalidateQueries({ queryKey: ['conservation', orgId] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteConservationTreatment(orgId!, conservationId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conservation', orgId] });
      navigate(`/organizations/${orgId}/collections/conservation`);
    },
  });

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

  const updateField = useCallback((field: string, value: string) => {
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
    conservation,
    isLoading,
    error,
    conservatorContact,
    queryClient,
    triggerSave,
    handleCreate,
    statusMutation,
    deleteMutation,
    getLookup,
    getLabel,
  };
}

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  conservationId: string | undefined;
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
  conservationId,
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
      basePath: `/organizations/${orgId}/collections/conservation/${conservationId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['conservation-treatment', orgId, conservationId] }),
    },
  });
}

// =============================================================================
// useSectionSummaries
// =============================================================================

export function useSectionSummaries(formData: ConservationFormData): Record<string, string | undefined> {
  return useMemo(() => {
    const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
    const truncate = (s: string | undefined, max = 60) =>
      s && s.length > max ? s.slice(0, max) + '\u2026' : s;
    return {
      treatment: parts([formData.treatment_type]),
      conservator: formData.conservator_id ? 'Assigned' : undefined,
      proposal: parts([formData.proposal_date, formData.estimated_cost ? `Est. ${formData.estimated_cost} ${formData.estimated_cost_currency}` : undefined]),
      execution: parts([formData.start_date, formData.end_date]),
      actuals: parts([
        formData.actual_duration_days ? `${formData.actual_duration_days} days` : undefined,
        formData.actual_cost ? `${formData.actual_cost} ${formData.actual_cost_currency}` : undefined,
      ]),
      recommendations: truncate(formData.recommendations),
      notes: truncate(formData.treatment_note),
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: ConservationFormData): Record<string, boolean> {
  return useMemo(() => ({
    treatment: !!(formData.treatment_type || formData.object_id),
    conservator: !!formData.conservator_id,
    proposal: !!(formData.proposal_date || formData.proposal_summary || formData.estimated_cost || formData.estimated_duration_days),
    execution: !!(formData.start_date || formData.end_date || formData.treatment_description || formData.methods_used || formData.materials_used),
    actuals: !!(formData.actual_duration_days || formData.actual_cost),
    recommendations: !!(formData.recommendations || formData.restrictions),
    notes: !!formData.treatment_note,
    history: true,
  }), [formData]);
}
