import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useLookupValues } from '../../../hooks/useLookupValues';
import {
  getDeaccession,
  createDeaccession,
  updateDeaccession,
  deleteDeaccession,
  rollbackDeaccession,
  getContact,
} from '../../../lib/api';
import { formatErrorMessage } from '../../../lib/formErrors';
import { validateCreateForm } from '../../../lib/formValidation';
import type { SaveStatus, DeaccessionFormData, DeaccessionStatus } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS } from './types';
import { DEFAULT_FORM_DATA } from './constants';

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  deaccessionId: string | undefined;
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
  deaccessionId,
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
      basePath: `/organizations/${orgId}/collections/deaccessions/${deaccessionId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['deaccession', orgId, deaccessionId] }),
    },
  });
}

// =============================================================================
// useDeaccessionForm
// =============================================================================

export function useDeaccessionForm(
  orgId: string | undefined,
  deaccessionId: string | undefined,
  isCreateMode: boolean,
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getLabel } = useLookupValues({ context: 'deaccessions' });

  const [formData, setFormData] = useState<DeaccessionFormData>({ ...DEFAULT_FORM_DATA });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  const { data: deaccession, isLoading, error } = useQuery({
    queryKey: ['deaccession', orgId, deaccessionId],
    queryFn: () => getDeaccession(orgId!, deaccessionId!),
    enabled: !isCreateMode && !!orgId && !!deaccessionId,
  });

  const { data: appraiserContact } = useQuery({
    queryKey: ['contact', orgId, formData.appraiser_id],
    queryFn: () => getContact(orgId!, formData.appraiser_id),
    enabled: !!orgId && !!formData.appraiser_id,
  });

  useEffect(() => {
    if (deaccession) {
      const data: DeaccessionFormData = {
        object_id: deaccession.object_id || '',
        proposal_date: deaccession.proposal_date || new Date().toISOString().split('T')[0],
        reason: deaccession.reason || 'outside_scope',
        reason_detail: deaccession.reason_detail || '',
        disposal_method: deaccession.disposal_method || '',
        disposal_method_detail: deaccession.disposal_method_detail || '',
        recipient_name: deaccession.recipient_name || '',
        committee_review_date: deaccession.committee_review_date || '',
        committee_recommendation: deaccession.committee_recommendation || '',
        committee_note: deaccession.committee_note || '',
        board_approval_required: deaccession.board_approval_required ?? true,
        board_approval_date: deaccession.board_approval_date || '',
        board_approval_reference: deaccession.board_approval_reference || '',
        board_note: deaccession.board_note || '',
        legal_review_date: deaccession.legal_review_date || '',
        legal_review_note: deaccession.legal_review_note || '',
        provenance_review_complete: deaccession.provenance_review_complete || false,
        provenance_review_note: deaccession.provenance_review_note || '',
        appraised_value: deaccession.appraised_value?.toString() || '',
        appraised_value_currency: deaccession.appraised_value_currency || 'USD',
        appraised_date: deaccession.appraised_date || '',
        appraiser_id: deaccession.appraiser_id || '',
        sale_price: deaccession.sale_price?.toString() || '',
        sale_currency: deaccession.sale_currency || 'USD',
        proceeds_usage: deaccession.proceeds_usage || '',
        public_notice_required: deaccession.public_notice_required || false,
        public_notice_date: deaccession.public_notice_date || '',
        public_notice_reference: deaccession.public_notice_reference || '',
        deaccession_note: deaccession.deaccession_note || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [deaccession]);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createDeaccession(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['deaccessions', orgId] });
      navigate(`/organizations/${orgId}/collections/deaccessions/${result.deaccession_id}`);
    },
    onError: (err: Error) => {
      setErrorMessage(formatErrorMessage(err.message, 'deaccession'));
      setSaveStatus('error');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateDeaccession(orgId!, deaccessionId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deaccessions', orgId] });
      queryClient.invalidateQueries({ queryKey: ['deaccession', orgId, deaccessionId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (err: Error) => {
      setErrorMessage(formatErrorMessage(err.message, 'deaccession'));
      setSaveStatus('error');
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: DeaccessionStatus) => updateDeaccession(orgId!, deaccessionId!, { status }),
    onSuccess: (updatedDeaccession) => {
      queryClient.setQueryData(['deaccession', orgId, deaccessionId], updatedDeaccession);
      queryClient.invalidateQueries({ queryKey: ['deaccessions', orgId] });
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: ({ targetStatus, reason }: { targetStatus: string; reason: string }) => rollbackDeaccession(orgId!, deaccessionId!, targetStatus, reason),
    onSuccess: (updatedDeaccession) => {
      queryClient.setQueryData(['deaccession', orgId, deaccessionId], updatedDeaccession);
      queryClient.invalidateQueries({ queryKey: ['deaccessions', orgId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDeaccession(orgId!, deaccessionId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deaccessions', orgId] });
      navigate(`/organizations/${orgId}/collections/deaccessions`);
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      object_id: fd.object_id || null,
      proposal_date: fd.proposal_date || null,
      reason: fd.reason,
      reason_detail: fd.reason_detail || null,
      disposal_method: fd.disposal_method || null,
      disposal_method_detail: fd.disposal_method_detail || null,
      recipient_name: fd.recipient_name || null,
      committee_review_date: fd.committee_review_date || null,
      committee_recommendation: fd.committee_recommendation || null,
      committee_note: fd.committee_note || null,
      board_approval_required: fd.board_approval_required,
      board_approval_date: fd.board_approval_date || null,
      board_approval_reference: fd.board_approval_reference || null,
      board_note: fd.board_note || null,
      legal_review_date: fd.legal_review_date || null,
      legal_review_note: fd.legal_review_note || null,
      provenance_review_complete: fd.provenance_review_complete,
      provenance_review_note: fd.provenance_review_note || null,
      appraised_value: fd.appraised_value ? parseFloat(fd.appraised_value) : null,
      appraised_value_currency: fd.appraised_value_currency,
      appraised_date: fd.appraised_date || null,
      appraiser_id: fd.appraiser_id || null,
      sale_price: fd.sale_price ? parseFloat(fd.sale_price) : null,
      sale_currency: fd.sale_currency,
      proceeds_usage: fd.proceeds_usage || null,
      public_notice_required: fd.public_notice_required,
      public_notice_date: fd.public_notice_date || null,
      public_notice_reference: fd.public_notice_reference || null,
      deaccession_note: fd.deaccession_note || null,
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
      { field: 'object_id', label: 'Object', check: 'required' },
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
    deaccession,
    isLoading,
    error,
    appraiserContact,
    queryClient,
    triggerSave,
    handleCreate,
    statusMutation,
    rollbackMutation,
    deleteMutation,
    getLabel,
  };
}

