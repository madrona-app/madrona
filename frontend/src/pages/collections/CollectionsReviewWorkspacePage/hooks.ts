import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useLookupValues } from '../../../hooks/useLookupValues';
import {
  createCollectionsReview,
  updateCollectionsReview,
  deleteCollectionsReview,
  approveCollectionsReview,
  startCollectionsReview,
  completeCollectionsReview,
} from '../../../lib/api';
import { formatErrorMessage } from '../../../lib/formErrors';
import { validateCreateForm } from '../../../lib/formValidation';
import type { SaveStatus, FormData } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS, defaultFormData } from './types';

// =============================================================================
// useSectionSummaries
// =============================================================================

const truncate = (s: string, max = 60) => s.length > max ? s.slice(0, max) + '\u2026' : s;

export function useSectionSummaries(formData: FormData): Record<string, string | undefined> {
  return useMemo(() => {
    const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
    return {
      info: parts([formData.title ? truncate(formData.title) : null, formData.review_type]),
      timeline: parts([
        formData.planned_start_date ? `Start: ${formData.planned_start_date}` : null,
        formData.planned_end_date ? `End: ${formData.planned_end_date}` : null,
      ]),
      methodology: parts([formData.methodology ? truncate(formData.methodology) : null]),
      progress: parts([formData.objects_total && formData.objects_total !== '0' ? `${formData.objects_total} objects` : null]),
      assessments: undefined,
      findings: parts([formData.findings_summary ? truncate(formData.findings_summary) : null]),
      team: undefined,
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    info: !!(formData.title || formData.scope_description),
    timeline: !!(formData.planned_start_date || formData.planned_end_date),
    methodology: !!(formData.methodology || formData.scoring_guidance),
    progress: !!(formData.objects_total && formData.objects_total !== '0'),
    assessments: false,
    findings: !!(formData.findings_summary || formData.recommendations),
    team: false,
    history: false,
  }), [formData]);
}

// =============================================================================
// useFormState
// =============================================================================

export function useFormState({
  orgId,
  reviewId,
  isCreateMode,
  review,
}: {
  orgId: string | undefined;
  reviewId: string | undefined;
  isCreateMode: boolean;
  review: Record<string, unknown> | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getLookup, getLabel } = useLookupValues({ context: 'reviews' });

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Initialize form data from fetched review
  useEffect(() => {
    if (review) {
      const data: FormData = {
        title: (review.title as string) || '',
        review_type: (review.review_type as string) || 'significance',
        review_reason: (review.review_reason as string) || '',
        scope_description: (review.scope_description as string) || '',
        methodology: (review.methodology as string) || '',
        scoring_guidance: (review.scoring_guidance as string) || '',
        planned_start_date: (review.planned_start_date as string) || '',
        planned_end_date: (review.planned_end_date as string) || '',
        objects_total: review.objects_total?.toString() || '0',
        findings_summary: (review.findings_summary as string) || '',
        recommendations: (review.recommendations as string) || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [review]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createCollectionsReview(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['collections-reviews', orgId] });
      navigate(`/organizations/${orgId}/collections/reviews/${result.review_id}`);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'collections_review'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateCollectionsReview(orgId!, reviewId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections-review', orgId, reviewId] });
      queryClient.invalidateQueries({ queryKey: ['collections-reviews', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'collections_review'));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteCollectionsReview(orgId!, reviewId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections-reviews', orgId] });
      navigate(`/organizations/${orgId}/collections/reviews`);
    },
  });

  // Status mutations
  const approveMutation = useMutation({
    mutationFn: () => approveCollectionsReview(orgId!, reviewId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections-review', orgId, reviewId] });
    },
  });

  const startMutation = useMutation({
    mutationFn: () => startCollectionsReview(orgId!, reviewId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections-review', orgId, reviewId] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => completeCollectionsReview(orgId!, reviewId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections-review', orgId, reviewId] });
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      title: fd.title,
      review_type: fd.review_type,
      review_reason: fd.review_reason || null,
      scope_description: fd.scope_description || null,
      methodology: fd.methodology || null,
      scoring_guidance: fd.scoring_guidance || null,
      planned_start_date: fd.planned_start_date || null,
      planned_end_date: fd.planned_end_date || null,
      objects_total: parseInt(fd.objects_total) || 0,
      findings_summary: fd.findings_summary || null,
      recommendations: fd.recommendations || null,
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
    queryClient,
    triggerSave,
    handleCreate,
    deleteMutation,
    approveMutation,
    startMutation,
    completeMutation,
    getLookup,
    getLabel,
  };
}

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  reviewId: string | undefined;
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
  reviewId,
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
      basePath: `/organizations/${orgId}/collections/reviews/${reviewId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['collections-review', orgId, reviewId] }),
    },
  });
}
