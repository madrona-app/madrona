import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useLookupValues } from '../../../hooks/useLookupValues';
import {
  getAuditCampaign,
  createAuditCampaign,
  updateAuditCampaign,
  deleteAuditCampaign,
  approveAuditCampaign,
  startAuditCampaign,
  completeAuditCampaign,
} from '../../../lib/api';
import { formatErrorMessage } from '../../../lib/formErrors';
import { validateCreateForm } from '../../../lib/formValidation';
import type { SaveStatus, FormData } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS, defaultFormData } from './types';

// =============================================================================
// useFormState
// =============================================================================

interface UseFormStateParams {
  orgId: string | undefined;
  campaignId: string | undefined;
  isCreateMode: boolean;
  campaign: Record<string, unknown> | undefined;
}

export function useFormState({ orgId, campaignId, isCreateMode, campaign }: UseFormStateParams) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getLookup, getLabel } = useLookupValues({ context: 'audits' });

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Initialize form data from fetched campaign
  useEffect(() => {
    if (campaign) {
      const data: FormData = {
        title: (campaign.title as string) || '',
        audit_type: (campaign.audit_type as string) || 'location',
        scope_description: (campaign.scope as string) || '',
        sample_method: (campaign.sample_method as string) || 'complete',
        sample_size: campaign.sample_size != null ? String(campaign.sample_size) : '',
        sample_percentage: campaign.sample_percentage != null ? String(campaign.sample_percentage) : '',
        sampling_criteria: '',
        methodology: (campaign.methodology as string) || '',
        verification_procedures: '',
        planned_start_date: (campaign.start_date as string) || '',
        planned_end_date: (campaign.end_date as string) || '',
        objects_total: campaign.items_total != null ? String(campaign.items_total) : '0',
        findings_summary: (campaign.findings_summary as string) || '',
        recommendations: '',
        remedial_actions: (campaign.remedial_actions as string) || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [campaign]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createAuditCampaign(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['audit-campaigns', orgId] });
      navigate(`/organizations/${orgId}/collections/audits/${result.audit_id}`);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'audit_campaign'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateAuditCampaign(orgId!, campaignId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-campaigns', orgId] });
      queryClient.invalidateQueries({ queryKey: ['audit-campaign', orgId, campaignId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'audit_campaign'));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteAuditCampaign(orgId!, campaignId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-campaigns', orgId] });
      navigate(`/organizations/${orgId}/collections/audits`);
    },
  });

  // Status mutations
  const approveMutation = useMutation({
    mutationFn: () => approveAuditCampaign(orgId!, campaignId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-campaign', orgId, campaignId] });
    },
  });

  const startMutation = useMutation({
    mutationFn: () => startAuditCampaign(orgId!, campaignId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-campaign', orgId, campaignId] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => completeAuditCampaign(orgId!, campaignId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-campaign', orgId, campaignId] });
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      title: fd.title,
      audit_type: fd.audit_type,
      scope: fd.scope_description || null,
      sample_method: fd.sample_method || null,
      sample_size: fd.sample_size ? parseInt(fd.sample_size) : null,
      sample_percentage: fd.sample_percentage ? parseFloat(fd.sample_percentage) : null,
      methodology: fd.methodology || null,
      start_date: fd.planned_start_date || null,
      end_date: fd.planned_end_date || null,
      items_total: parseInt(fd.objects_total) || 0,
      findings_summary: fd.findings_summary || null,
      remedial_actions: fd.remedial_actions || null,
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

  const updateField = useCallback((field: string, value: string) => {
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

  // Warn before unload if unsaved changes
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
  };
}

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  campaignId: string | undefined;
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
  campaignId,
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
      basePath: `/organizations/${orgId}/collections/audits/${campaignId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['audit-campaign', orgId, campaignId] }),
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
      info: parts([formData.title ? truncate(formData.title) : undefined, formData.audit_type, formData.objects_total && formData.objects_total !== '0' ? `${formData.objects_total} objects` : undefined]),
      sampling: parts([formData.sample_method, formData.sample_size ? `${formData.sample_size} items` : undefined, formData.sample_percentage ? `${formData.sample_percentage}%` : undefined]),
      timeline: parts([formData.planned_start_date, formData.planned_end_date]),
      methodology: truncate(formData.methodology),
      findings: truncate(formData.findings_summary),
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    info: !!(formData.title || formData.audit_type || formData.scope_description || (formData.objects_total && formData.objects_total !== '0')),
    sampling: !!(formData.sample_method || formData.sample_size || formData.sample_percentage || formData.sampling_criteria),
    timeline: !!(formData.planned_start_date || formData.planned_end_date),
    methodology: !!(formData.methodology || formData.verification_procedures),
    findings: !!(formData.findings_summary || formData.recommendations || formData.remedial_actions),
    history: true,
  }), [formData]);
}

// =============================================================================
// useAuditCampaignQuery
// =============================================================================

export function useAuditCampaignQuery(
  orgId: string | undefined,
  campaignId: string | undefined,
  isCreateMode: boolean,
) {
  return useQuery({
    queryKey: ['audit-campaign', orgId, campaignId],
    queryFn: () => getAuditCampaign(orgId!, campaignId!),
    enabled: !isCreateMode && !!orgId && !!campaignId,
  });
}
