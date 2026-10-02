import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useLookupValues } from '../../../hooks/useLookupValues';
import {
  createIncidentReport,
  updateIncidentReport,
  deleteIncidentReport,
  closeIncidentReport,
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
  reportId,
  isCreateMode,
  report,
}: {
  orgId: string | undefined;
  reportId: string | undefined;
  isCreateMode: boolean;
  report: Record<string, unknown> | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getLookup, getLabel } = useLookupValues({ context: 'incidents' });

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Initialize form data from fetched report
  useEffect(() => {
    if (report) {
      const data: FormData = {
        report_number: (report.report_number as string) || '',
        report_date: (report.report_date as string) || new Date().toISOString().split('T')[0],
        incident_type: (report.incident_type as string) || 'damage',
        incident_subtype: (report.incident_subtype as string) || '',
        incident_date: (report.incident_date as string) || '',
        incident_location_description: (report.incident_location_description as string) || '',
        discovered_date: (report.discovered_date as string) || '',
        discovered_by_name: (report.discovered_by_name as string) || '',
        discovery_circumstances: (report.discovery_circumstances as string) || '',
        incident_description: (report.incident_description as string) || '',
        cause_analysis: (report.cause_analysis as string) || '',
        immediate_actions: (report.immediate_actions as string) || '',
        police_notified: (report.police_notified as boolean) || false,
        police_report_number: (report.police_report_number as string) || '',
        police_report_date: (report.police_report_date as string) || '',
        insurance_claim_filed: (report.insurance_claim_filed as boolean) || false,
        insurance_claim_number: (report.insurance_claim_number as string) || '',
        insurance_claim_status: (report.insurance_claim_status as string) || '',
        insurance_claim_amount: (report.insurance_claim_amount as number)?.toString() || '',
        insurance_settlement_amount: (report.insurance_settlement_amount as number)?.toString() || '',
        investigation_required: (report.investigation_required as boolean) || false,
        investigation_findings: (report.investigation_findings as string) || '',
        investigation_completed_date: (report.investigation_completed_date as string) || '',
        resolution_summary: (report.resolution_summary as string) || '',
        resolved_date: (report.resolved_date as string) || '',
        lessons_learned: (report.lessons_learned as string) || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [report]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createIncidentReport(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['incident-reports', orgId] });
      navigate(`/organizations/${orgId}/collections/incidents/${result.report_id}`);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'incident_report'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateIncidentReport(orgId!, reportId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident-report', orgId, reportId] });
      queryClient.invalidateQueries({ queryKey: ['incident-reports', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'incident_report'));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteIncidentReport(orgId!, reportId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident-reports', orgId] });
      navigate(`/organizations/${orgId}/collections/incidents`);
    },
  });

  // Status transition mutations
  const submitMutation = useMutation({
    mutationFn: () => updateIncidentReport(orgId!, reportId!, { status: 'submitted' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident-report', orgId, reportId] });
    },
  });

  const investigateMutation = useMutation({
    mutationFn: () => updateIncidentReport(orgId!, reportId!, { status: 'under_investigation' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident-report', orgId, reportId] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: () => updateIncidentReport(orgId!, reportId!, { status: 'resolved' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident-report', orgId, reportId] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => closeIncidentReport(orgId!, reportId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident-report', orgId, reportId] });
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      report_date: fd.report_date || null,
      incident_type: fd.incident_type,
      incident_subtype: fd.incident_subtype || null,
      incident_date: fd.incident_date || null,
      incident_location_description: fd.incident_location_description || null,
      discovered_date: fd.discovered_date || null,
      discovered_by_name: fd.discovered_by_name || null,
      discovery_circumstances: fd.discovery_circumstances || null,
      incident_description: fd.incident_description || null,
      cause_analysis: fd.cause_analysis || null,
      immediate_actions: fd.immediate_actions || null,
      police_notified: fd.police_notified,
      police_report_number: fd.police_report_number || null,
      police_report_date: fd.police_report_date || null,
      insurance_claim_filed: fd.insurance_claim_filed,
      insurance_claim_number: fd.insurance_claim_number || null,
      insurance_claim_status: fd.insurance_claim_status || null,
      insurance_claim_amount: fd.insurance_claim_amount ? parseFloat(fd.insurance_claim_amount) : null,
      insurance_settlement_amount: fd.insurance_settlement_amount ? parseFloat(fd.insurance_settlement_amount) : null,
      investigation_required: fd.investigation_required,
      investigation_findings: fd.investigation_findings || null,
      investigation_completed_date: fd.investigation_completed_date || null,
      resolution_summary: fd.resolution_summary || null,
      resolved_date: fd.resolved_date || null,
      lessons_learned: fd.lessons_learned || null,
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
    submitMutation,
    investigateMutation,
    resolveMutation,
    closeMutation,
    getLookup,
    getLabel,
  };
}

// =============================================================================
// useSectionSummaries
// =============================================================================

const truncate = (s: string, max = 60) => s.length > max ? s.slice(0, max) + '\u2026' : s;

export function useSectionSummaries(formData: FormData): Record<string, string | undefined> {
  return useMemo(() => {
    const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
    return {
      incident: parts([
        formData.incident_type,
        formData.incident_date,
        formData.incident_description ? truncate(formData.incident_description) : undefined,
      ]),
      discovery: parts([
        formData.discovered_date,
        formData.discovered_by_name,
      ]),
      objects: undefined,
      response: parts([
        formData.cause_analysis ? truncate(formData.cause_analysis) : undefined,
        formData.immediate_actions ? truncate(formData.immediate_actions) : undefined,
      ]),
      police: parts([
        formData.police_notified ? 'Police notified' : undefined,
        formData.police_report_number,
      ]),
      insurance: parts([
        formData.insurance_claim_filed ? 'Claim filed' : undefined,
        formData.insurance_claim_number,
        formData.insurance_claim_status,
      ]),
      investigation: parts([
        formData.investigation_required ? 'Required' : undefined,
        formData.investigation_completed_date,
      ]),
      resolution: parts([
        formData.resolved_date,
        formData.resolution_summary ? truncate(formData.resolution_summary) : undefined,
      ]),
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    incident: !!(formData.incident_type || formData.incident_date || formData.incident_description),
    discovery: !!(formData.discovered_date || formData.discovered_by_name || formData.discovery_circumstances),
    objects: false,
    response: !!(formData.cause_analysis || formData.immediate_actions),
    police: !!(formData.police_notified || formData.police_report_number),
    insurance: !!(formData.insurance_claim_filed || formData.insurance_claim_number),
    investigation: !!(formData.investigation_required || formData.investigation_findings),
    resolution: !!(formData.resolution_summary || formData.resolved_date),
    history: false,
  }), [formData]);
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
      basePath: `/organizations/${orgId}/collections/incidents/${reportId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['incident-report', orgId, reportId] }),
    },
  });
}
