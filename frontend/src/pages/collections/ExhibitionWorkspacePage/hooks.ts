import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import {
  createExhibition,
  updateExhibition,
  deleteExhibition,
} from '../../../lib/api';
import type { Exhibition } from '../../../lib/api';
import type { SaveStatus, FormData } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS, defaultFormData, EXHIBITION_TYPES, STATUS_OPTIONS } from './types';

// =============================================================================
// useSectionSummaries
// =============================================================================

const truncate = (s: string, max = 60) => s.length > max ? s.slice(0, max) + '\u2026' : s;

export function useSectionSummaries(formData: FormData): Record<string, string | undefined> {
  return useMemo(() => {
    const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
    const typeLabel = EXHIBITION_TYPES.find(t => t.value === formData.exhibition_type)?.label;
    const statusLabel = STATUS_OPTIONS.find(s => s.value === formData.status)?.label;
    return {
      details: parts([formData.title ? truncate(formData.title) : null, typeLabel, statusLabel]),
      dates: parts([
        formData.planned_start_date ? `Start: ${formData.planned_start_date}` : null,
        formData.planned_end_date ? `End: ${formData.planned_end_date}` : null,
      ]),
      objects: undefined,
      labels: undefined,
      interpretive: undefined,
      touring: undefined,
      authorization: parts([
        formData.authorization_date ? `Authorized: ${formData.authorization_date}` : null,
        formData.provisos ? truncate(formData.provisos) : null,
      ]),
      checklist: undefined,
      budget: undefined,
      logistics: undefined,
      loans: undefined,
      public: parts([formData.is_public ? 'Published' : null, formData.public_url_slug ? truncate(formData.public_url_slug) : null]),
      exports: undefined,
      notes: parts([formData.curator_notes ? truncate(formData.curator_notes) : null, formData.outcome ? truncate(formData.outcome) : null]),
      discussion: undefined,
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    details: !!(formData.title || formData.exhibition_number || formData.description),
    dates: !!(formData.planned_start_date || formData.planned_end_date || formData.actual_start_date || formData.actual_end_date),
    objects: false,
    labels: false,
    interpretive: false,
    touring: false,
    authorization: !!(formData.provisos || formData.authorization_date),
    checklist: false,
    budget: false,
    logistics: false,
    loans: false,
    public: !!(formData.is_public || formData.public_url_slug),
    exports: false,
    notes: !!(formData.curator_notes || formData.outcome),
    discussion: false,
    history: false,
  }), [formData]);
}

// =============================================================================
// useFormState
// =============================================================================

interface UseFormStateParams {
  orgId: string | undefined;
  exhibitionId: string | undefined;
  isCreateMode: boolean;
  exhibition: Exhibition | null | undefined;
}

export function useFormState({
  orgId,
  exhibitionId,
  isCreateMode,
  exhibition,
}: UseFormStateParams) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef<FormData>(formData);
  formDataRef.current = formData;

  // Load exhibition data into form
  useEffect(() => {
    if (exhibition) {
      const newFormData: FormData = {
        title: exhibition.title || '',
        exhibition_number: exhibition.exhibition_number || '',
        description: exhibition.description || '',
        curator_notes: exhibition.curator_notes || '',
        exhibition_type: exhibition.exhibition_type || 'temporary',
        status: exhibition.status || 'proposed',
        provisos: exhibition.provisos || '',
        outcome: exhibition.outcome || '',
        planned_start_date: exhibition.planned_start_date || '',
        planned_end_date: exhibition.planned_end_date || '',
        actual_start_date: exhibition.actual_start_date || '',
        actual_end_date: exhibition.actual_end_date || '',
        venue_id: exhibition.venue_id || '',
        is_public: exhibition.is_public || false,
        public_url_slug: exhibition.public_url_slug || '',
        authorization_date: exhibition.authorization_date || '',
        authorizer_name: '',
      };
      setFormData(newFormData);
      formDataRef.current = newFormData;
      originalDataRef.current = JSON.stringify(newFormData);
    }
  }, [exhibition]);

  // Check for unsaved changes
  useEffect(() => {
    const currentData = JSON.stringify(formData);
    setHasUnsavedChanges(currentData !== originalDataRef.current);
  }, [formData]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Partial<FormData>) => createExhibition(orgId!, data),
    onSuccess: (response: { exhibition_id: string }) => {
      queryClient.invalidateQueries({ queryKey: ['exhibitions', orgId] });
      navigate(`/organizations/${orgId}/collections/exhibitions/${response.exhibition_id}`);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Partial<FormData>) => updateExhibition(orgId!, exhibitionId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exhibition', orgId, exhibitionId] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: () => {
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteExhibition(orgId!, exhibitionId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exhibitions', orgId] });
      navigate(`/organizations/${orgId}/collections/exhibitions`);
    },
  });

  // Status mutation
  const statusMutation = useMutation({
    mutationFn: (data: Partial<FormData>) => updateExhibition(orgId!, exhibitionId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exhibition', orgId, exhibitionId] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
    },
  });

  // Auto-save logic (for existing records)
  const performSave = useCallback(() => {
    if (!exhibitionId || isCreateMode) return;
    if (JSON.stringify(formDataRef.current) === originalDataRef.current) return;

    setSaveStatus('saving');
    updateMutation.mutate(formDataRef.current);
  }, [exhibitionId, isCreateMode, updateMutation]);

  const scheduleAutoSave = useCallback((isEditing: boolean) => {
    if (!isEditing || isCreateMode) return;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(performSave, 1500);
  }, [isCreateMode, performSave]);

  // Update form field
  const updateField = useCallback((field: keyof FormData, value: string | boolean, isEditing: boolean) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      formDataRef.current = updated;
      return updated;
    });
    scheduleAutoSave(isEditing);
  }, [scheduleAutoSave]);

  // Handle create
  const handleCreate = useCallback(() => {
    if (!formData.title.trim() || !formData.exhibition_number.trim()) return;
    createMutation.mutate(formData);
  }, [formData, createMutation]);

  return {
    formData,
    updateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    queryClient,
    performSave,
    handleCreate,
    createMutation,
    deleteMutation,
    statusMutation,
  };
}

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  exhibitionId: string | undefined;
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
  exhibitionId,
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
      basePath: `/organizations/${orgId}/collections/exhibitions/${exhibitionId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['exhibition', orgId, exhibitionId] }),
    },
  });
}
