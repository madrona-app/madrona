import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useLookupValues } from '../../../hooks/useLookupValues';
import {
  createDocumentationPlan,
  updateDocumentationPlan,
  deleteDocumentationPlan,
  approveDocumentationPlan,
  startDocumentationPlan,
  completeDocumentationPlan,
} from '../../../lib/api';
import { formatErrorMessage } from '../../../lib/formErrors';
import type { SaveStatus, FormData, Milestone } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS, defaultFormData } from './types';
import type { DocumentationPlan } from '../../../lib/schemas';

// =============================================================================
// useSectionSummaries
// =============================================================================

const truncate = (s: string, max = 60) => s.length > max ? s.slice(0, max) + '\u2026' : s;

export function useSectionSummaries(formData: FormData): Record<string, string | undefined> {
  return useMemo(() => {
    const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
    return {
      basic: parts([formData.title ? truncate(formData.title) : null, formData.plan_type]),
      content: parts([
        formData.objectives ? truncate(formData.objectives) : null,
        formData.actions?.length ? `${formData.actions.length} actions` : null,
      ]),
      timeline: parts([
        formData.start_date ? `Start: ${formData.start_date}` : null,
        formData.end_date ? `End: ${formData.end_date}` : null,
      ]),
      resources: parts([formData.resources_required ? truncate(formData.resources_required) : null]),
      notes: parts([formData.notes ? truncate(formData.notes) : null]),
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    basic: !!(formData.title || formData.plan_type),
    content: !!(formData.objectives || (formData.measurable_results && formData.measurable_results.length > 0) || (formData.actions && formData.actions.length > 0)),
    timeline: !!(formData.start_date || formData.end_date || formData.review_frequency || formData.next_review_date),
    resources: !!formData.resources_required,
    notes: !!formData.notes,
    history: false,
  }), [formData]);
}

// =============================================================================
// useFormState
// =============================================================================

export function useFormState({
  orgId,
  planId,
  isCreateMode,
  plan,
}: {
  orgId: string | undefined;
  planId: string | undefined;
  isCreateMode: boolean;
  plan: DocumentationPlan | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getLookup, getLabel } = useLookupValues({ context: 'documentation_plans' });

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // New item state for list fields
  const [newResult, setNewResult] = useState('');
  const [newAction, setNewAction] = useState('');
  const [newMilestone, setNewMilestone] = useState<Milestone>({ date: '', description: '' });

  // Initialize form data from fetched plan
  useEffect(() => {
    if (plan) {
      const data: FormData = {
        title: plan.title || '',
        plan_type: plan.plan_type || 'cataloging_plan',
        objectives: plan.objectives || '',
        measurable_results: plan.measurable_results || [],
        actions: plan.actions || [],
        milestones: plan.milestones || [],
        resources_required: plan.resources_required || '',
        start_date: plan.start_date || '',
        end_date: plan.end_date || '',
        review_frequency: plan.review_frequency || '',
        next_review_date: plan.next_review_date || '',
        notes: plan.notes || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [plan]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Partial<DocumentationPlan>) => createDocumentationPlan(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['documentation-plans', orgId] });
      navigate(`/organizations/${orgId}/collections/documentation-plans/${result.plan_id}`);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'documentation_plan'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Partial<DocumentationPlan>) => updateDocumentationPlan(orgId!, planId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentation-plan', orgId, planId] });
      queryClient.invalidateQueries({ queryKey: ['documentation-plans', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'documentation_plan'));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteDocumentationPlan(orgId!, planId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentation-plans', orgId] });
      navigate(`/organizations/${orgId}/collections/documentation-plans`);
    },
  });

  // Status mutations
  const approveMutation = useMutation({
    mutationFn: () => approveDocumentationPlan(orgId!, planId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentation-plan', orgId, planId] });
      queryClient.invalidateQueries({ queryKey: ['documentation-plans', orgId] });
    },
  });

  const startMutation = useMutation({
    mutationFn: () => startDocumentationPlan(orgId!, planId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentation-plan', orgId, planId] });
      queryClient.invalidateQueries({ queryKey: ['documentation-plans', orgId] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => completeDocumentationPlan(orgId!, planId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentation-plan', orgId, planId] });
      queryClient.invalidateQueries({ queryKey: ['documentation-plans', orgId] });
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      ...fd,
      measurable_results: fd.measurable_results?.length ? fd.measurable_results : null,
      actions: fd.actions?.length ? fd.actions : null,
      milestones: fd.milestones?.length ? fd.milestones : null,
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
    setSaveStatus('saving');
    setErrorMessage(null);

    if (!formDataRef.current.title?.trim()) {
      setErrorMessage('Title is required');
      setSaveStatus('error');
      return;
    }

    createMutation.mutate(buildPayload());
  }, [createMutation, buildPayload]);

  const updateField = useCallback((field: string, value: string | string[] | Milestone[]) => {
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

  // List field helpers
  const handleAddResult = useCallback(() => {
    if (newResult.trim()) {
      updateField('measurable_results', [...(formDataRef.current.measurable_results || []), newResult.trim()]);
      setNewResult('');
    }
  }, [newResult, updateField]);

  const handleRemoveResult = useCallback((index: number) => {
    updateField('measurable_results', formDataRef.current.measurable_results?.filter((_: string, i: number) => i !== index) || []);
  }, [updateField]);

  const handleAddAction = useCallback(() => {
    if (newAction.trim()) {
      updateField('actions', [...(formDataRef.current.actions || []), newAction.trim()]);
      setNewAction('');
    }
  }, [newAction, updateField]);

  const handleRemoveAction = useCallback((index: number) => {
    updateField('actions', formDataRef.current.actions?.filter((_: string, i: number) => i !== index) || []);
  }, [updateField]);

  const handleAddMilestone = useCallback(() => {
    if (newMilestone.description.trim()) {
      updateField('milestones', [...(formDataRef.current.milestones || []), { ...newMilestone }]);
      setNewMilestone({ date: '', description: '' });
    }
  }, [newMilestone, updateField]);

  const handleRemoveMilestone = useCallback((index: number) => {
    updateField('milestones', formDataRef.current.milestones?.filter((_: Milestone, i: number) => i !== index) || []);
  }, [updateField]);

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
    // List field state & handlers
    newResult,
    setNewResult,
    newAction,
    setNewAction,
    newMilestone,
    setNewMilestone,
    handleAddResult,
    handleRemoveResult,
    handleAddAction,
    handleRemoveAction,
    handleAddMilestone,
    handleRemoveMilestone,
  };
}

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  planId: string | undefined;
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
  planId,
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
      basePath: `/organizations/${orgId}/collections/documentation-plans/${planId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['documentation-plan', orgId, planId] }),
    },
  });
}
