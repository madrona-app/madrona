import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useLookupValues } from '../../../hooks/useLookupValues';
import {
  getConditionReport,
  createConditionReport,
  updateConditionReport,
  deleteConditionReport,
} from '../../../lib/api';
import { formatErrorMessage } from '../../../lib/formErrors';
import { validateCreateForm } from '../../../lib/formValidation';
import type { SaveStatus, FormData } from './types';
import { defaultFormData, SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS } from './types';

// =============================================================================
// useFormState
// =============================================================================

interface UseFormStateParams {
  orgId: string | undefined;
  reportId: string | undefined;
  isCreateMode: boolean;
  report?: Record<string, unknown>;
}

export function useFormState({ orgId, reportId, isCreateMode, report: _report }: UseFormStateParams) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getLookup } = useLookupValues({ context: 'condition_reports' });

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Fetch report data (disabled in create mode)
  const { data: existingReport, isLoading, error } = useQuery({
    queryKey: ['condition-report', orgId, reportId],
    queryFn: () => getConditionReport(orgId!, reportId!),
    enabled: !isCreateMode && !!orgId && !!reportId,
  });

  // examiner_id is a constituent reference (the picker is the contact selector,
  // and a staff member is a constituent linked to their user). The backend
  // serializes examiner_name alongside examiner_id, so we display it directly.
  const examinerContact = existingReport?.examiner_name
    ? { contact_id: existingReport.examiner_id, name: existingReport.examiner_name } as any
    : null;

  // Initialize form data from fetched report
  useEffect(() => {
    if (existingReport) {
      const data: FormData = {
        report_type: existingReport.report_type || 'periodic',
        check_reason: existingReport.check_reason || '',
        report_date: existingReport.report_date || new Date().toISOString().split('T')[0],
        examiner_id: existingReport.examiner_id || '',
        object_id: existingReport.object_id || '',
        overall_condition: existingReport.overall_condition || '',
        condition_summary: existingReport.condition_summary || '',
        completeness: existingReport.completeness || '',
        completeness_date: existingReport.completeness_date || '',
        hazards: existingReport.hazards ? JSON.stringify(existingReport.hazards) : '',
        recommendations: existingReport.recommendations || '',
        conservation_needed: existingReport.conservation_needed || false,
        conservation_priority: existingReport.conservation_priority || '',
        handling_requirements: existingReport.handling_requirements || '',
        packing_requirements: existingReport.packing_requirements || '',
        display_restrictions: existingReport.display_restrictions || '',
        next_check_date: existingReport.next_check_date || '',
        report_note: existingReport.report_note || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [existingReport]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createConditionReport(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['condition-reports', orgId] });
      navigate(`/organizations/${orgId}/collections/condition-reports/${result.report_id}`);
    },
    onError: (err: Error) => {
      setErrorMessage(formatErrorMessage(err.message, 'condition_report'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateConditionReport(orgId!, reportId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['condition-reports', orgId] });
      queryClient.invalidateQueries({ queryKey: ['condition-report', orgId, reportId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (err: Error) => {
      setErrorMessage(formatErrorMessage(err.message, 'condition_report'));
      setSaveStatus('error');
    },
  });

  // Status mutation
  const statusMutation = useMutation({
    mutationFn: (status: 'draft' | 'completed' | 'reviewed') => updateConditionReport(orgId!, reportId!, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['condition-report', orgId, reportId] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteConditionReport(orgId!, reportId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['condition-reports', orgId] });
      navigate(`/organizations/${orgId}/collections/condition-reports`);
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      ...fd,
      examiner_id: fd.examiner_id || null,
      check_reason: fd.check_reason || null,
      completeness: fd.completeness || null,
      completeness_date: fd.completeness_date || null,
      next_check_date: fd.next_check_date || null,
      hazards: fd.hazards ? JSON.parse(fd.hazards) : null,
      object_id: fd.object_id || null,
      conservation_priority: fd.conservation_priority || null,
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

  // Warn before unload with unsaved changes
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
    existingReport,
    isLoading,
    error,
    examinerContact,
    queryClient,
    triggerSave,
    handleCreate,
    statusMutation,
    deleteMutation,
    getLookup,
  };
}

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  reportId: string | undefined;
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
  reportId,
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
      basePath: `/organizations/${orgId}/collections/condition-reports/${reportId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['condition-report', orgId, reportId] }),
    },
  });
}

// =============================================================================
// useSectionSummaries
// =============================================================================

export function useSectionSummaries(formData: FormData): Record<string, string | undefined> {
  return useMemo(() => {
    const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
    const truncate = (s: string | undefined, max = 60) =>
      s && s.length > max ? s.slice(0, max) + '\u2026' : s;
    return {
      report: parts([formData.report_type, formData.report_date]),
      condition: parts([formData.overall_condition, formData.condition_summary ? truncate(formData.condition_summary) : undefined]),
      conservation: parts([
        formData.conservation_needed ? 'Conservation needed' : null,
        formData.conservation_priority,
      ]),
      requirements: parts([
        formData.handling_requirements ? 'Handling' : null,
        formData.packing_requirements ? 'Packing' : null,
        formData.display_restrictions ? 'Display restrictions' : null,
      ]),
      notes: truncate(formData.report_note),
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    report: !!(formData.report_type || formData.report_date || formData.examiner_id || formData.object_id),
    condition: !!(formData.overall_condition || formData.condition_summary || formData.hazards || formData.recommendations),
    conservation: !!(formData.conservation_needed || formData.conservation_priority),
    requirements: !!(formData.handling_requirements || formData.packing_requirements || formData.display_restrictions),
    notes: !!formData.report_note,
    history: true,
  }), [formData]);
}
