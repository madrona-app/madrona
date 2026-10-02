/**
 * Custom hooks for ObjectEntryWorkspacePage
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getObjectEntry,
  createObjectEntry,
  updateObjectEntry,
  deleteObjectEntry,
  getAcquisitions,
  getEntryLinkedLoans,
  getObjectExits,
  generateDocument,
  getObjectEntryAllMedia,
  getContact,
} from '../../../lib/api';
import { useContactSelector } from '../../../hooks/useContactSelector';
import {
  OBJECT_ENTRY_SECTIONS,
  calculateSectionCompletion,
  validateStatusTransition,
} from '../../../lib/procedureValidation';
import { computeProcedureCompliance } from '../../../lib/procedureComplianceUtils';
import type { RequirementGroup } from '../../../lib/procedureComplianceUtils';
import { navigateToSection } from '../../../lib/fieldHighlight';
import type { ObjectEntry } from '../../../lib/schemas';
import type { SaveStatus, EntryFormData, LinkedLoanWithEntryId } from './types';
import { DEFAULT_FORM_DATA, SECTION_GROUPS, GROUP_ORDER, DEFAULT_EXPANDED_SECTIONS } from './constants';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';

/**
 * Hook for managing entry form data and autosave
 */
export function useEntryForm(
  orgId: string | undefined,
  entryId: string | undefined,
  isCreateMode: boolean
) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<EntryFormData>(() =>
    isCreateMode ? { ...DEFAULT_FORM_DATA } as EntryFormData : {} as EntryFormData
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Fetch entry data
  const { data: entry, isLoading, error } = useQuery({
    queryKey: ['object-entry', orgId, entryId],
    queryFn: () => getObjectEntry(orgId!, entryId!),
    enabled: !isCreateMode && !!orgId && !!entryId,
  });

  // Initialize form data from fetched entry
  useEffect(() => {
    if (entry) {
      const data: EntryFormData = {
        entry_date: entry.entry_date || '',
        reason: entry.reason || 'loan_consideration',
        depositor_id: entry.depositor_id || '',
        depositor_name: entry.depositor_name || '',
        current_owner_id: entry.current_owner_id || '',
        current_owner: entry.current_owner || '',
        receipt_reference: entry.receipt_reference || '',
        objects_description: entry.objects_description || '',
        expected_duration: entry.expected_duration || '',
        expected_return_date: entry.expected_return_date || '',
        conditions: entry.conditions || '',
        insurance_value: entry.insurance_value?.toString() || '',
        insurance_currency: entry.insurance_currency || 'USD',
        insurance_note: entry.insurance_note || '',
        entry_note: entry.entry_note || '',
        entry_method: entry.entry_method || '',
        authorizer_id: entry.authorizer_id || '',
        authorizer_name: entry.authorizer_name || '',
        authorization_date: entry.authorization_date || '',
        authorization_note: entry.authorization_note || '',
        terms_accepted: entry.terms_accepted || false,
        terms_accepted_date: entry.terms_accepted_date || '',
        terms_accepted_by_id: entry.terms_accepted_by_id || '',
        acceptance_method: entry.acceptance_method || 'signature',
        acceptance_note: entry.acceptance_note || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
      setHasUnsavedChanges(false);
    }
  }, [entry]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createObjectEntry(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-entries', orgId] });
    },
    onError: () => {
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateObjectEntry(orgId!, entryId!, data),
    onSuccess: (updatedEntry) => {
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
      queryClient.setQueryData(['object-entry', orgId, entryId], updatedEntry);
      queryClient.invalidateQueries({
        queryKey: ['object-entries', orgId],
        refetchType: 'none',
      });
    },
    onError: () => {
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteObjectEntry(orgId!, entryId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-entries', orgId] });
    },
  });

  // Status mutation
  const statusMutation = useMutation({
    mutationFn: (status: string) => updateObjectEntry(orgId!, entryId!, { status: status as ObjectEntry['status'] }),
    onSuccess: (updatedEntry) => {
      queryClient.setQueryData(['object-entry', orgId, entryId], updatedEntry);
      queryClient.invalidateQueries({
        queryKey: ['object-entries', orgId],
        refetchType: 'none',
      });
    },
  });

  // Trigger save
  const triggerSave = useCallback(() => {
    if (isCreateMode) return;
    const currentFormData = formDataRef.current;
    const currentHasChanges = JSON.stringify(currentFormData) !== originalDataRef.current;
    if (!currentHasChanges) return;

    setSaveStatus('saving');
    const { current_owner: _co, depositor_name: _dn, ...restFormData } = currentFormData;
    const payload = {
      ...restFormData,
      insurance_value: currentFormData.insurance_value ? parseFloat(currentFormData.insurance_value) : null,
      expected_return_date: currentFormData.expected_return_date || null,
      expected_duration: currentFormData.expected_duration || null,
      depositor_id: currentFormData.depositor_id || null,
      current_owner_id: currentFormData.current_owner_id || null,
    };
    updateMutation.mutate(payload);
  }, [updateMutation, isCreateMode]);

  // Update field with autosave
  const updateField = useCallback((field: string, value: unknown) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      const hasChanges = JSON.stringify(next) !== originalDataRef.current;
      setHasUnsavedChanges(hasChanges);
      return next;
    });

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      triggerSave();
    }, 1000);
  }, [triggerSave]);

  // Handle create
  const handleCreate = useCallback(() => {
    setSaveStatus('saving');
    const { current_owner: _co, depositor_name: _dn, ...restFormData } = formData;
    const payload = {
      ...restFormData,
      insurance_value: formData.insurance_value ? parseFloat(formData.insurance_value) : null,
      expected_return_date: formData.expected_return_date || null,
      expected_duration: formData.expected_duration || null,
      entry_date: formData.entry_date || null,
      depositor_id: formData.depositor_id || null,
      current_owner_id: formData.current_owner_id || null,
    };
    return createMutation.mutateAsync(payload);
  }, [formData, createMutation]);

  return {
    formData,
    setFormData,
    updateField,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    saveStatus,
    setSaveStatus,
    lastSaved,
    queryClient,
    entry,
    isLoading,
    error,
    triggerSave,
    handleCreate,
    createMutation,
    updateMutation,
    deleteMutation,
    statusMutation,
  };
}

/**
 * Hook for managing section expansion and raising state
 */
export function useSectionState(_sectionOrder: Record<string, string[]>) {
  const {
    expandedSections,
    setExpandedSections,
    raisedSectionId,
    getSectionOrder,
    toggleSection,
    handleEnterEditMode,
    lowerAllSections,
  } = useUnifiedSectionState({
    sectionGroups: SECTION_GROUPS,
    groupOrder: GROUP_ORDER,
    initialExpandedSections: DEFAULT_EXPANDED_SECTIONS,
  });

  // Expose raiseSection as an alias for handleEnterEditMode (for compat with index.tsx)
  const raiseSection = handleEnterEditMode;

  return {
    raisedSectionId,
    expandedSections,
    setExpandedSections,
    getSectionOrder,
    lowerAllSections,
    raiseSection,
    toggleSection,
    handleEnterEditMode,
  };
}

/**
 * Hook for managing linked records
 */
export function useLinkedRecords(
  orgId: string | undefined,
  entryId: string | undefined,
  isCreateMode: boolean
) {
  // Fetch linked acquisition
  const { data: linkedAcquisitionsData } = useQuery({
    queryKey: ['acquisitions', orgId, 'entry', entryId],
    queryFn: () => getAcquisitions(orgId!, { entry_id: entryId, limit: 100 }),
    enabled: !isCreateMode && !!orgId && !!entryId,
    select: (data) => data.items.find((a) => a.entry_id === entryId),
  });

  // Fetch linked loan
  const { data: linkedLoanData } = useQuery({
    queryKey: ['entry-linked-loans', orgId, entryId],
    queryFn: () => getEntryLinkedLoans(orgId!, entryId!),
    enabled: !isCreateMode && !!orgId && !!entryId,
    select: (data): LinkedLoanWithEntryId | undefined =>
      data.loans_in?.[0] as LinkedLoanWithEntryId | undefined,
  });

  // Fetch linked exit
  const { data: linkedExitData } = useQuery({
    queryKey: ['object-exits', orgId, 'entry', entryId],
    queryFn: () => getObjectExits(orgId!, { entry_id: entryId, limit: 1 }),
    enabled: !isCreateMode && !!orgId && !!entryId,
  });

  return {
    linkedAcquisition: linkedAcquisitionsData,
    linkedLoan: linkedLoanData,
    linkedExit: linkedExitData?.items?.[0],
  };
}

/**
 * Hook for fetching all media across an entry's items (for the right-rail slideshow).
 *
 * Media CRUD itself happens inside each item's detail panel (see
 * ObjectsSection.tsx) — this hook is read-only and is invalidated whenever the
 * entry query refetches.
 */
export function useEntryAllMedia(
  orgId: string | undefined,
  entryId: string | undefined,
  isCreateMode: boolean
) {
  const { data, refetch } = useQuery({
    queryKey: ['object-entry-all-media', orgId, entryId],
    queryFn: () => getObjectEntryAllMedia(orgId!, entryId!),
    enabled: !isCreateMode && !!orgId && !!entryId,
  });

  return {
    allMedia: data?.media || [],
    refetchAllMedia: refetch,
  };
}

/**
 * Hook for managing contacts (depositor and current owner)
 */
export function useEntryContacts(orgId: string | undefined, formData: EntryFormData) {
  const depositorSelector = useContactSelector();
  const currentOwnerSelector = useContactSelector();

  const { data: depositorContact } = useQuery({
    queryKey: ['contact', orgId, formData.depositor_id],
    queryFn: () => getContact(orgId!, formData.depositor_id),
    enabled: !!orgId && !!formData.depositor_id,
  });

  const { data: currentOwnerContact } = useQuery({
    queryKey: ['contact', orgId, formData.current_owner_id],
    queryFn: () => getContact(orgId!, formData.current_owner_id),
    enabled: !!orgId && !!formData.current_owner_id,
  });

  const { data: authorizerContact } = useQuery({
    queryKey: ['contact', orgId, formData.authorizer_id],
    queryFn: () => getContact(orgId!, formData.authorizer_id),
    enabled: !!orgId && !!formData.authorizer_id,
  });

  return {
    depositorSelector,
    currentOwnerSelector,
    depositorContact,
    currentOwnerContact,
    authorizerContact,
  };
}

/**
 * Hook for PDF generation
 */
export function usePdfGeneration(
  orgId: string | undefined,
  entryId: string | undefined,
  entryNumber: string | undefined
) {
  const generatePdfMutation = useMutation({
    mutationFn: () => generateDocument(orgId!, 'object_receipt', { entry_id: entryId }),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${entryNumber || entryId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });

  return { generatePdfMutation };
}

/**
 * Hook for procedure compliance
 */
export function useProcedureCompliance(
  formData: EntryFormData,
  entryNumber: string | undefined,
  currentStatus: string,
  requirementGroups: RequirementGroup[],
  statusOrder: string[],
  // Items live on the fetched entry, not in formData. Predicates like
  // `items_count` and `entry_location` check `record.items`, so we need to
  // merge them into the record used for validation.
  items?: Array<Record<string, unknown>>,
) {
  const sectionCompletions = useMemo(() => {
    const record: Record<string, unknown> = {
      ...formData,
      entry_number: entryNumber || '',
      items: items || [],
    };
    return OBJECT_ENTRY_SECTIONS.reduce((acc, section) => {
      acc[section.id] = calculateSectionCompletion(section, record);
      return acc;
    }, {} as Record<string, ReturnType<typeof calculateSectionCompletion>>);
  }, [formData, entryNumber, items]);

  const validateStatusChange = useCallback((targetStatus: string) => {
    const record: Record<string, unknown> = {
      ...formData,
      entry_number: entryNumber || '',
      items: items || [],
    };
    return validateStatusTransition('object_entry', targetStatus, record);
  }, [formData, entryNumber]);

  const handleSectionNavigate = useCallback((
    sectionId: string,
    fieldPath?: string,
    setExpandedSections?: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void
  ) => {
    if (setExpandedSections) {
      setExpandedSections(prev => ({ ...prev, [sectionId]: true }));
    }

    const requirement = computeProcedureCompliance(
      requirementGroups,
      { ...formData, entry_number: entryNumber || '' },
      currentStatus,
      statusOrder
    ).blockingMissing.find(r => r.missingFields.includes(fieldPath || ''));

    const helperText = requirement
      ? `Required to continue: ${requirement.requirement.label}`
      : undefined;

    navigateToSection(sectionId, fieldPath, {
      expandSection: setExpandedSections
        ? (id: string) => setExpandedSections(prev => ({ ...prev, [id]: true }))
        : undefined,
      helperText,
    });
  }, [formData, entryNumber, currentStatus]);

  return {
    sectionCompletions,
    validateStatusChange,
    handleSectionNavigate,
  };
}

