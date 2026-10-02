import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import {
  getObjectExit,
  createObjectExit,
  updateObjectExit,
  deleteObjectExit,
  rollbackObjectExit,
  getObjectEntry,
  generateDocument,
  getContact,
} from '../../../lib/api';
import type { SaveStatus, FormData } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS } from './types';
import { DEFAULT_FORM_DATA } from './constants';

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  exitId: string | undefined;
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
  exitId,
  isCreateMode,
  isEditing,
  setIsEditing,
  canEdit,
  hasUnsavedChanges,
  performSave,
  queryClient,
}: UseSectionStateParams) {
  const basePath = `/organizations/${orgId}/collections/exits/${exitId}`;

  const {
    expandedSections,
    getSectionOrder,
    toggleSection,
    handleToggleMode,
    handleEnterEditMode,
  } = useUnifiedSectionState({
    sectionGroups: SECTION_GROUPS,
    groupOrder: GROUP_ORDER,
    initialExpandedSections: INITIAL_EXPANDED_SECTIONS,
    editMode: {
      basePath,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['object-exit', orgId, exitId] }),
      hasUnsavedChanges,
    },
  });

  return {
    expandedSections,
    getSectionOrder,
    toggleSection,
    handleToggleMode,
    handleEnterEditMode,
  };
}

// =============================================================================
// useExitForm
// =============================================================================

export function useExitForm(
  orgId: string | undefined,
  exitId: string | undefined,
  isCreateMode: boolean,
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<FormData>(() =>
    isCreateMode ? { ...DEFAULT_FORM_DATA } : {} as FormData
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  const { data: exit, isLoading, error } = useQuery({
    queryKey: ['object-exit', orgId, exitId],
    queryFn: () => getObjectExit(orgId!, exitId!),
    enabled: !isCreateMode && !!orgId && !!exitId,
  });

  const { data: courierContact } = useQuery({
    queryKey: ['contact', orgId, formData.courier_id],
    queryFn: () => getContact(orgId!, formData.courier_id),
    enabled: !!orgId && !!formData.courier_id,
  });

  const { data: linkedEntry } = useQuery({
    queryKey: ['object-entry', orgId, exit?.entry_id],
    queryFn: () => getObjectEntry(orgId!, exit!.entry_id!),
    enabled: !!orgId && !!exit?.entry_id,
  });

  useEffect(() => {
    if (exit) {
      const data = {
        exit_date: exit.exit_date || '',
        exit_reason: exit.exit_reason || 'other',
        exit_method: exit.exit_method || '',
        recipient_name: exit.recipient_name || '',
        packing_method: exit.packing_method || '',
        shipping_method: exit.shipping_method || '',
        shipping_company: exit.shipping_company || '',
        tracking_number: exit.tracking_number || '',
        courier_id: exit.courier_id || '',
        condition_at_exit: exit.condition_at_exit || '',
        authorization_date: exit.authorization_date || '',
        authorization_note: exit.authorization_note || '',
        receipt_reference: exit.receipt_reference || '',
        receipt_note: exit.receipt_note || '',
        exit_note: exit.exit_note || '',
        internal_note: exit.internal_note || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [exit]);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createObjectExit(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['object-exits', orgId] });
      navigate(`/organizations/${orgId}/collections/exits/${result.exit_id}`);
    },
    onError: () => { setSaveStatus('error'); },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateObjectExit(orgId!, exitId!, data),
    onSuccess: () => {
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
      queryClient.invalidateQueries({ queryKey: ['object-exits', orgId] });
    },
    onError: () => { setSaveStatus('error'); },
  });

  const statusMutation = useMutation({
    mutationFn: (status: 'pending' | 'preparing' | 'dispatched' | 'in_transit' | 'acknowledged' | 'cancelled') =>
      updateObjectExit(orgId!, exitId!, { status }),
    onSuccess: (updatedExit) => {
      queryClient.setQueryData(['object-exit', orgId, exitId], updatedExit);
      queryClient.invalidateQueries({ queryKey: ['object-exits', orgId] });
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: ({ targetStatus, reason }: { targetStatus: string; reason: string }) => rollbackObjectExit(orgId!, exitId!, targetStatus, reason),
    onSuccess: (updatedExit) => {
      queryClient.setQueryData(['object-exit', orgId, exitId], updatedExit);
      queryClient.invalidateQueries({ queryKey: ['object-exits', orgId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteObjectExit(orgId!, exitId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-exits', orgId] });
      navigate(`/organizations/${orgId}/collections/exits`);
    },
  });

  const generatePdfMutation = useMutation({
    mutationFn: () => generateDocument(orgId!, 'packing_list', { exit_id: exitId }),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `packing-list-${exit?.exit_number || exitId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fd)) {
      payload[key] = value === '' ? null : value;
    }
    return payload;
  }, []);

  const triggerSave = useCallback(() => {
    if (isCreateMode) return;
    const currentHasChanges = JSON.stringify(formDataRef.current) !== originalDataRef.current;
    if (!currentHasChanges) return;
    setSaveStatus('saving');
    updateMutation.mutate(buildPayload());
  }, [updateMutation, isCreateMode, buildPayload]);

  const handleCreate = useCallback(() => {
    setSaveStatus('saving');
    createMutation.mutate(buildPayload());
  }, [createMutation, buildPayload]);

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
    exit,
    isLoading,
    error,
    courierContact,
    linkedEntry,
    queryClient,
    triggerSave,
    handleCreate,
    statusMutation,
    rollbackMutation,
    deleteMutation,
    generatePdfMutation,
  };
}

