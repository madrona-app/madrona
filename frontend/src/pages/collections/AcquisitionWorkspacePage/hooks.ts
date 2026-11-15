import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { getAcquisition, createAcquisition, updateAcquisition, deleteAcquisition, rollbackAcquisition, approveAcquisition, completeAcquisition, getObjectEntry } from '../../../lib/api';
import { validateCreateForm } from '../../../lib/formValidation';
import type { SaveStatus, FormData } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS } from './types';

// =============================================================================
// useSectionState — thin wrapper around useUnifiedSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  acquisitionId: string | undefined;
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
  acquisitionId,
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
      basePath: `/organizations/${orgId}/collections/acquisitions/${acquisitionId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['acquisition', orgId, acquisitionId] }),
    },
  });
}

// =============================================================================
// useAcquisitionForm
// =============================================================================

export function useAcquisitionForm(
  orgId: string | undefined,
  acquisitionId: string | undefined,
  isCreateMode: boolean,
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<FormData>(() =>
    isCreateMode ? {
      acquisition_method: 'gift',
      acquisition_date: '',
      source_id: '',
      source_type: '',
      authorization_date: '',
      authorization_note: '',
      funding_source: '',
      funding_account: '',
      funding_note: '',
      cost: '',
      cost_currency: 'USD',
      appraised_value: '',
      appraised_value_currency: 'USD',
      appraised_date: '',
      appraiser_name: '',
      legal_status: 'clear',
      legal_note: '',
      provenance_verified: false,
      provenance_note: '',
      provisos: '',
      donor_restrictions: '',
      acquisition_reason: '',
      acknowledgement_date: '',
      acknowledgement_reference: '',
      transfer_of_title_number: '',
      credit_line: '',
      deed_of_gift_date: '',
      deed_of_gift_reference: '',
      board_approval_required: false,
      board_approval_date: '',
      board_approval_reference: '',
      board_note: '',
      objects_count: 1,
      acquisition_note: '',
      internal_note: '',
      accession_number: '',
      accession_date: '',
      accessioning_approved: false,
      accessioning_approved_date: '',
      accessioning_resolution: '',
      accessioning_note: '',
    } : {} as FormData
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  const { data: acquisition, isLoading, error } = useQuery({
    queryKey: ['acquisition', orgId, acquisitionId],
    queryFn: () => getAcquisition(orgId!, acquisitionId!),
    enabled: !isCreateMode && !!orgId && !!acquisitionId,
  });

  const { data: linkedEntry } = useQuery({
    queryKey: ['object-entry', orgId, acquisition?.entry_id],
    queryFn: () => getObjectEntry(orgId!, acquisition!.entry_id!),
    enabled: !!orgId && !!acquisition?.entry_id,
  });

  useEffect(() => {
    if (acquisition) {
      const data = {
        acquisition_method: acquisition.acquisition_method || 'gift',
        acquisition_date: acquisition.acquisition_date || '',
        source_id: acquisition.source_id || '',
        source_type: acquisition.source_type || '',
        authorization_date: acquisition.authorization_date || '',
        authorization_note: acquisition.authorization_note || '',
        funding_source: acquisition.funding_source || '',
        funding_account: acquisition.funding_account || '',
        funding_note: acquisition.funding_note || '',
        cost: acquisition.cost?.toString() || '',
        cost_currency: acquisition.cost_currency || 'USD',
        appraised_value: acquisition.appraised_value?.toString() || '',
        appraised_value_currency: acquisition.appraised_value_currency || 'USD',
        appraised_date: acquisition.appraised_date || '',
        appraiser_name: acquisition.appraiser_name || '',
        legal_status: acquisition.legal_status || 'clear',
        legal_note: acquisition.legal_note || '',
        provenance_verified: acquisition.provenance_verified ?? false,
        provenance_note: acquisition.provenance_note || '',
        provisos: acquisition.provisos || '',
        donor_restrictions: acquisition.donor_restrictions || '',
        acquisition_reason: acquisition.acquisition_reason || '',
        acknowledgement_date: acquisition.acknowledgement_date || '',
        acknowledgement_reference: acquisition.acknowledgement_reference || '',
        transfer_of_title_number: acquisition.transfer_of_title_number || '',
        credit_line: acquisition.credit_line || '',
        deed_of_gift_date: acquisition.deed_of_gift_date || '',
        deed_of_gift_reference: acquisition.deed_of_gift_reference || '',
        board_approval_required: acquisition.board_approval_required ?? false,
        board_approval_date: acquisition.board_approval_date || '',
        board_approval_reference: acquisition.board_approval_reference || '',
        board_note: acquisition.board_note || '',
        objects_count: acquisition.objects_count || 1,
        acquisition_note: acquisition.acquisition_note || '',
        internal_note: acquisition.internal_note || '',
        accession_number: acquisition.accession_number || '',
        accession_date: acquisition.accession_date || '',
        accessioning_approved: acquisition.accessioning_approved ?? false,
        accessioning_approved_date: acquisition.accessioning_approved_date || '',
        accessioning_resolution: acquisition.accessioning_resolution || '',
        accessioning_note: acquisition.accessioning_note || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [acquisition]);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createAcquisition(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['acquisitions', orgId] });
      navigate(`/organizations/${orgId}/collections/acquisitions/${result.acquisition_id}`);
    },
    onError: () => { setSaveStatus('error'); },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateAcquisition(orgId!, acquisitionId!, data),
    onSuccess: () => {
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
      queryClient.invalidateQueries({ queryKey: ['acquisitions', orgId] });
    },
    onError: () => { setSaveStatus('error'); },
  });

  const statusMutation = useMutation({
    mutationFn: (status: 'proposed' | 'approved' | 'completed' | 'cancelled') => {
      if (status === 'approved') return approveAcquisition(orgId!, acquisitionId!);
      if (status === 'completed') return completeAcquisition(orgId!, acquisitionId!);
      // proposed/cancelled are backward transitions handled by rollback
      return rollbackAcquisition(orgId!, acquisitionId!, status, 'Status change');
    },
    onSuccess: (updatedAcquisition) => {
      queryClient.setQueryData(['acquisition', orgId, acquisitionId], updatedAcquisition);
      queryClient.invalidateQueries({ queryKey: ['acquisitions', orgId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAcquisition(orgId!, acquisitionId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['acquisitions', orgId] });
      navigate(`/organizations/${orgId}/collections/acquisitions`);
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: ({ targetStatus, reason }: { targetStatus: string; reason: string }) => rollbackAcquisition(orgId!, acquisitionId!, targetStatus, reason),
    onSuccess: (updatedAcquisition) => {
      queryClient.setQueryData(['acquisition', orgId, acquisitionId], updatedAcquisition);
      queryClient.invalidateQueries({ queryKey: ['acquisitions', orgId] });
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      ...fd,
      objects_count: parseInt(fd.objects_count?.toString()) || 1,
      cost: fd.cost ? parseFloat(fd.cost) : null,
      appraised_value: fd.appraised_value ? parseFloat(fd.appraised_value) : null,
      acquisition_date: fd.acquisition_date || null,
      authorization_date: fd.authorization_date || null,
      deed_of_gift_date: fd.deed_of_gift_date || null,
      appraised_date: fd.appraised_date || null,
      board_approval_date: fd.board_approval_date || null,
      accession_date: fd.accession_date || null,
      accessioning_approved_date: fd.accessioning_approved_date || null,
      source_id: fd.source_id || null,
      source_type: fd.source_type || null,
      provisos: fd.provisos || null,
      donor_restrictions: fd.donor_restrictions || null,
      acquisition_reason: fd.acquisition_reason || null,
      acknowledgement_date: fd.acknowledgement_date || null,
      acknowledgement_reference: fd.acknowledgement_reference || null,
      transfer_of_title_number: fd.transfer_of_title_number || null,
      legal_note: fd.legal_note || null,
      provenance_note: fd.provenance_note || null,
      funding_note: fd.funding_note || null,
      board_approval_reference: fd.board_approval_reference || null,
      board_note: fd.board_note || null,
      internal_note: fd.internal_note || null,
      appraiser_name: fd.appraiser_name || null,
      accession_number: fd.accession_number || null,
      accessioning_resolution: fd.accessioning_resolution || null,
      accessioning_note: fd.accessioning_note || null,
    };
  }, []);

  const triggerSave = useCallback(() => {
    if (isCreateMode) return;
    const currentHasChanges = JSON.stringify(formDataRef.current) !== originalDataRef.current;
    if (!currentHasChanges) return;
    setSaveStatus('saving');
    updateMutation.mutate(buildPayload());
  }, [updateMutation, isCreateMode, buildPayload]);

  const handleCreate = useCallback(() => {
    const validationError = validateCreateForm(formData as unknown as Record<string, unknown>, [
      { field: 'title', label: 'Title', check: 'required' },
    ]);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setSaveStatus('saving');
    setErrorMessage(null);
    createMutation.mutate(buildPayload());
  }, [createMutation, buildPayload, formData]);

  const updateField = useCallback((field: string, value: any) => {
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
    acquisition,
    isLoading,
    error,
    linkedEntry,
    queryClient,
    triggerSave,
    handleCreate,
    statusMutation,
    deleteMutation,
    rollbackMutation,
  };
}
