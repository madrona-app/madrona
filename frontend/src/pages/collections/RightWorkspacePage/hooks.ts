import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useLookupValues } from '../../../hooks/useLookupValues';
import {
  createObjectRight,
  updateObjectRight,
  deleteObjectRight,
} from '../../../lib/api';
import type { ObjectRight } from '../../../lib/schemas';
import { formatErrorMessage } from '../../../lib/formErrors';
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
      object: parts([formData.object_id ? `Object: ${formData.object_id.slice(0, 8)}` : null]),
      details: parts([formData.right_type, formData.right_subtype, formData.status]),
      holder: parts([formData.rights_holder_contact_id ? `Contact: ${formData.rights_holder_contact_id.slice(0, 8)}` : null]),
      duration: parts([
        formData.is_perpetual ? 'Perpetual' : null,
        formData.start_date ? `From: ${formData.start_date}` : null,
        formData.territory ? truncate(formData.territory) : null,
      ]),
      license: parts([formData.license_type, formData.license_reference ? truncate(formData.license_reference) : null]),
      fees: parts([
        formData.fee_required ? 'Fee required' : null,
        formData.fee_amount ? `${formData.fee_amount} ${formData.fee_currency}` : null,
      ]),
      orphan: parts([
        formData.is_orphan_work ? 'Orphan work' : null,
        formData.due_diligence_conducted ? 'Due diligence done' : null,
      ]),
      notes: parts([formData.right_note ? truncate(formData.right_note) : null, formData.agreement_reference ? truncate(formData.agreement_reference) : null]),
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    object: !!formData.object_id,
    details: !!(formData.right_type || formData.right_subtype || formData.status),
    holder: !!formData.rights_holder_contact_id,
    duration: !!(formData.start_date || formData.end_date || formData.is_perpetual || formData.territory),
    license: !!(formData.license_type || formData.license_reference || formData.license_url || formData.usage_conditions),
    fees: !!(formData.fee_required || formData.fee_amount),
    orphan: !!(formData.is_orphan_work || formData.due_diligence_conducted),
    notes: !!(formData.right_note || formData.internal_note || formData.agreement_reference),
    history: false,
  }), [formData]);
}

// =============================================================================
// useFormState
// =============================================================================

export function useFormState({
  orgId,
  rightId,
  isCreateMode,
  right,
}: {
  orgId: string | undefined;
  rightId: string | undefined;
  isCreateMode: boolean;
  right: Record<string, unknown> | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getLookup, getLabel } = useLookupValues({ context: 'rights' });

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Initialize form data from fetched right
  useEffect(() => {
    if (right) {
      const data: FormData = {
        object_id: (right.object_id as string) || '',
        right_type: (right.right_type as string) || 'copyright',
        right_subtype: (right.right_subtype as string) || '',
        rights_holder_contact_id: (right.rights_holder_contact_id as string) || '',
        status: (right.status as string) || 'unknown',
        start_date: (right.start_date as string) || '',
        end_date: (right.end_date as string) || '',
        is_perpetual: (right.is_perpetual as boolean) || false,
        territory: (right.territory as string) || '',
        territory_note: (right.territory_note as string) || '',
        license_type: (right.license_type as string) || '',
        license_reference: (right.license_reference as string) || '',
        license_url: (right.license_url as string) || '',
        usage_conditions: (right.usage_conditions as string) || '',
        restrictions: (right.restrictions as string) || '',
        fee_required: (right.fee_required as boolean) || false,
        fee_amount: right.fee_amount?.toString() || '',
        fee_currency: (right.fee_currency as string) || 'USD',
        fee_note: (right.fee_note as string) || '',
        is_orphan_work: (right.is_orphan_work as boolean) || false,
        due_diligence_conducted: (right.due_diligence_conducted as boolean) || false,
        due_diligence_date: (right.due_diligence_date as string) || '',
        orphan_works_license_number: (right.orphan_works_license_number as string) || '',
        orphan_works_license_date: (right.orphan_works_license_date as string) || '',
        orphan_works_license_expiry: (right.orphan_works_license_expiry as string) || '',
        agreement_reference: (right.agreement_reference as string) || '',
        next_review_date: (right.next_review_date as string) || '',
        right_note: (right.right_note as string) || '',
        internal_note: (right.internal_note as string) || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [right]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Partial<ObjectRight>) =>
      createObjectRight(orgId!, formDataRef.current.object_id, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['rights', orgId] });
      queryClient.invalidateQueries({ queryKey: ['object-rights', orgId, formDataRef.current.object_id] });
      navigate(`/organizations/${orgId}/collections/rights/${result.right_id}`);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'right'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Partial<ObjectRight>) => updateObjectRight(orgId!, rightId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['right', orgId, rightId] });
      queryClient.invalidateQueries({ queryKey: ['rights', orgId] });
      queryClient.invalidateQueries({ queryKey: ['object-rights', orgId, formDataRef.current.object_id] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'right'));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteObjectRight(orgId!, rightId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rights', orgId] });
      navigate(`/organizations/${orgId}/collections/rights`);
    },
  });

  const buildPayload = useCallback((): Partial<ObjectRight> => {
    const fd = formDataRef.current;
    return {
      right_type: fd.right_type,
      right_subtype: fd.right_subtype || undefined,
      rights_holder_contact_id: fd.rights_holder_contact_id || null,
      status: fd.status,
      start_date: fd.start_date || undefined,
      end_date: fd.end_date || undefined,
      is_perpetual: fd.is_perpetual,
      territory: fd.territory || undefined,
      territory_note: fd.territory_note || undefined,
      license_type: fd.license_type || undefined,
      license_reference: fd.license_reference || undefined,
      license_url: fd.license_url || undefined,
      usage_conditions: fd.usage_conditions || undefined,
      restrictions: fd.restrictions || undefined,
      fee_required: fd.fee_required,
      fee_amount: fd.fee_amount ? parseFloat(fd.fee_amount) : undefined,
      fee_currency: fd.fee_currency || undefined,
      fee_note: fd.fee_note || undefined,
      is_orphan_work: fd.is_orphan_work,
      due_diligence_conducted: fd.due_diligence_conducted,
      due_diligence_date: fd.due_diligence_date || undefined,
      orphan_works_license_number: fd.orphan_works_license_number || undefined,
      orphan_works_license_date: fd.orphan_works_license_date || undefined,
      orphan_works_license_expiry: fd.orphan_works_license_expiry || undefined,
      agreement_reference: fd.agreement_reference || undefined,
      next_review_date: fd.next_review_date || undefined,
      right_note: fd.right_note || undefined,
      internal_note: fd.internal_note || undefined,
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
    if (!formDataRef.current.object_id) {
      setErrorMessage('Please select an object');
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
    getLookup,
    getLabel,
  };
}

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  rightId: string | undefined;
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
  rightId,
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
      basePath: `/organizations/${orgId}/collections/rights/${rightId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['right', orgId, rightId] }),
    },
  });
}
