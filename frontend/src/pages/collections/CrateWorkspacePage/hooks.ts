import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import {
  createCrate,
  updateCrate,
  deleteCrate,
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
  crateId,
  isCreateMode,
  crate,
}: {
  orgId: string | undefined;
  crateId: string | undefined;
  isCreateMode: boolean;
  crate: Record<string, unknown> | undefined;
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

  // Initialize form data from fetched crate
  useEffect(() => {
    if (crate) {
      const data: FormData = {
        crate_number: (crate.crate_number as string) || '',
        description: (crate.description as string) || '',
        height_cm: (crate.height_cm as string) || '',
        width_cm: (crate.width_cm as string) || '',
        depth_cm: (crate.depth_cm as string) || '',
        weight_empty_kg: (crate.weight_empty_kg as string) || '',
        interior_height_cm: (crate.interior_height_cm as string) || '',
        interior_width_cm: (crate.interior_width_cm as string) || '',
        interior_depth_cm: (crate.interior_depth_cm as string) || '',
        materials: (crate.materials as string) || '',
        condition: (crate.condition as string) || '',
        climate_controlled: (crate.climate_controlled as boolean) || false,
        is_stackable: crate.is_stackable !== undefined ? (crate.is_stackable as boolean) : true,
        is_oversized: (crate.is_oversized as boolean) || false,
        location_id: (crate.location_id as string) || null,
        home_location_id: (crate.home_location_id as string) || null,
        is_active: crate.is_active !== undefined ? (crate.is_active as boolean) : true,
        notes: (crate.notes as string) || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [crate]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createCrate(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crates', orgId] });
      navigate(`/organizations/${orgId}/collections/crates`);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'crate'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateCrate(orgId!, crateId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crate', orgId, crateId] });
      queryClient.invalidateQueries({ queryKey: ['crates', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'crate'));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteCrate(orgId!, crateId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crates', orgId] });
      navigate(`/organizations/${orgId}/collections/crates`);
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      crate_number: fd.crate_number,
      description: fd.description || null,
      height_cm: fd.height_cm ? parseFloat(fd.height_cm) : null,
      width_cm: fd.width_cm ? parseFloat(fd.width_cm) : null,
      depth_cm: fd.depth_cm ? parseFloat(fd.depth_cm) : null,
      weight_empty_kg: fd.weight_empty_kg ? parseFloat(fd.weight_empty_kg) : null,
      interior_height_cm: fd.interior_height_cm ? parseFloat(fd.interior_height_cm) : null,
      interior_width_cm: fd.interior_width_cm ? parseFloat(fd.interior_width_cm) : null,
      interior_depth_cm: fd.interior_depth_cm ? parseFloat(fd.interior_depth_cm) : null,
      materials: fd.materials || null,
      condition: fd.condition || null,
      climate_controlled: fd.climate_controlled,
      is_stackable: fd.is_stackable,
      is_oversized: fd.is_oversized,
      location_id: fd.location_id,
      home_location_id: fd.home_location_id,
      is_active: fd.is_active,
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
      { field: 'crate_number', label: 'Crate Number', check: 'required' },
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
  };
}

// =============================================================================
// useSectionState — thin wrapper around useUnifiedSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  crateId: string | undefined;
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
  crateId,
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
      basePath: `/organizations/${orgId}/collections/crates/${crateId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['crate', orgId, crateId] }),
    },
  });
}

// =============================================================================
// useSectionSummaries
// =============================================================================

export function useSectionSummaries(formData: FormData): Record<string, string | undefined> {
  return useMemo(() => {
    const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
    const dims = (h: string, w: string, d: string) =>
      h && w && d ? `${h} \u00d7 ${w} \u00d7 ${d} cm` : undefined;
    return {
      identification: parts([formData.crate_number, formData.description]),
      condition: parts([
        formData.condition ? formData.condition.charAt(0).toUpperCase() + formData.condition.slice(1) : null,
        formData.materials,
      ]),
      exterior: dims(formData.height_cm, formData.width_cm, formData.depth_cm),
      interior: dims(formData.interior_height_cm, formData.interior_width_cm, formData.interior_depth_cm),
      locations: undefined,
      notes: formData.notes ? (formData.notes.length > 60 ? formData.notes.slice(0, 60) + '\u2026' : formData.notes) : undefined,
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    identification: !!(formData.crate_number || formData.description),
    condition: !!(formData.condition || formData.materials || formData.climate_controlled || formData.is_oversized),
    exterior: !!(formData.height_cm || formData.width_cm || formData.depth_cm || formData.weight_empty_kg),
    interior: !!(formData.interior_height_cm || formData.interior_width_cm || formData.interior_depth_cm),
    locations: !!(formData.location_id || formData.home_location_id),
    notes: !!formData.notes,
    history: true,
  }), [formData]);
}
