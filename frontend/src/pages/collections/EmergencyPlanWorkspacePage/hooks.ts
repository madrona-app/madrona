import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import {
  createEmergencyPlan,
  updateEmergencyPlan,
  deleteEmergencyPlan,
  approveEmergencyPlan,
  activateEmergencyPlan,
} from '../../../lib/api';
import { formatErrorMessage } from '../../../lib/formErrors';
import { validateCreateForm } from '../../../lib/formValidation';
import type { SaveStatus, FormData, EmergencyContact, RiskAssessment } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS, defaultFormData } from './types';

// =============================================================================
// useFormState
// =============================================================================

export function useFormState({
  orgId,
  planId,
  isCreateMode,
  plan,
}: {
  orgId: string | undefined;
  planId: string | undefined;
  isCreateMode: boolean;
  plan: Record<string, unknown> | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [riskAssessments, setRiskAssessments] = useState<RiskAssessment[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  const riskAssessmentsRef = useRef(riskAssessments);
  riskAssessmentsRef.current = riskAssessments;

  // Initialize form data from fetched plan
  useEffect(() => {
    if (plan) {
      const data: FormData = {
        title: (plan.title as string) || '',
        plan_version: (plan.plan_version as string) || '1.0',
        facility_name: (plan.facility_name as string) || '',
        evacuation_procedures: (plan.evacuation_procedures as string) || '',
        response_procedures: (plan.response_procedures as string) || '',
        recovery_procedures: (plan.recovery_procedures as string) || '',
        salvage_priority_guidance: (plan.salvage_priority_guidance as string) || '',
        last_drill_date: (plan.last_drill_date as string) || '',
        next_drill_date: (plan.next_drill_date as string) || '',
        review_date: (plan.next_review_date as string) || '',
        notes: (plan.plan_note as string) || '',
      };
      setFormData(data);

      const parsedContacts = ((plan.emergency_contacts as unknown as Record<string, unknown>[]) || []).map((c) => ({
        name: (c.name as string) || '',
        role: (c.role as string) || '',
        phone: (c.phone as string) || '',
        email: (c.email as string) || '',
        priority: (c.priority as number) || 0,
      }));
      setContacts(parsedContacts);

      const parsedRisks = ((plan.risk_assessments as unknown as Record<string, unknown>[]) || []).map((r) => ({
        hazard_type: (r.hazard_type as string) || '',
        likelihood: (r.likelihood as string) || '',
        impact: (r.impact as string) || '',
        mitigation_measures: (r.mitigation_measures as string) || '',
      }));
      setRiskAssessments(parsedRisks);

      originalDataRef.current = JSON.stringify({ data, contacts: parsedContacts, risks: parsedRisks });
    }
  }, [plan]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createEmergencyPlan(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['emergency-plans', orgId] });
      navigate(`/organizations/${orgId}/collections/emergency-plans/${result.plan_id}`);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'emergency_plan'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateEmergencyPlan(orgId!, planId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emergency-plan', orgId, planId] });
      queryClient.invalidateQueries({ queryKey: ['emergency-plans', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify({
        data: formDataRef.current,
        contacts: contactsRef.current,
        risks: riskAssessmentsRef.current,
      });
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'emergency_plan'));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteEmergencyPlan(orgId!, planId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emergency-plans', orgId] });
      navigate(`/organizations/${orgId}/collections/emergency-plans`);
    },
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: () => approveEmergencyPlan(orgId!, planId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emergency-plan', orgId, planId] });
    },
  });

  // Activate mutation
  const activateMutation = useMutation({
    mutationFn: () => activateEmergencyPlan(orgId!, planId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emergency-plan', orgId, planId] });
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    const ct = contactsRef.current;
    const ra = riskAssessmentsRef.current;
    return {
      title: fd.title,
      plan_version: fd.plan_version || null,
      facility_name: fd.facility_name || null,
      evacuation_procedures: fd.evacuation_procedures || null,
      response_procedures: fd.response_procedures || null,
      recovery_procedures: fd.recovery_procedures || null,
      salvage_priority_guidance: fd.salvage_priority_guidance || null,
      last_drill_date: fd.last_drill_date || null,
      next_drill_date: fd.next_drill_date || null,
      review_date: fd.review_date || null,
      notes: fd.notes || null,
      emergency_contacts: ct.length > 0 ? ct : null,
      risk_assessments: ra.length > 0 ? ra : null,
    };
  }, []);

  const triggerSave = useCallback(() => {
    if (isCreateMode) return;
    const currentState = JSON.stringify({
      data: formDataRef.current,
      contacts: contactsRef.current,
      risks: riskAssessmentsRef.current,
    });
    if (currentState === originalDataRef.current) return;
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

  const markChanged = useCallback(() => {
    const currentState = JSON.stringify({
      data: formDataRef.current,
      contacts: contactsRef.current,
      risks: riskAssessmentsRef.current,
    });
    setHasUnsavedChanges(currentState !== originalDataRef.current);
  }, []);

  const updateField = useCallback((field: string, value: string) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      formDataRef.current = next;
      return next;
    });
    markChanged();
    if (!isCreateMode) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => { triggerSave(); }, 1000);
    }
  }, [isCreateMode, triggerSave, markChanged]);

  const addContact = useCallback(() => {
    setContacts(prev => {
      const next = [...prev, { name: '', role: '', phone: '', email: '', priority: prev.length + 1 }];
      contactsRef.current = next;
      return next;
    });
    markChanged();
  }, [markChanged]);

  const updateContact = useCallback((index: number, field: string, value: string | number) => {
    setContacts(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      contactsRef.current = updated;
      return updated;
    });
    markChanged();
    if (!isCreateMode) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => { triggerSave(); }, 1000);
    }
  }, [isCreateMode, triggerSave, markChanged]);

  const removeContact = useCallback((index: number) => {
    setContacts(prev => {
      const next = prev.filter((_, i) => i !== index);
      contactsRef.current = next;
      return next;
    });
    markChanged();
    if (!isCreateMode) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => { triggerSave(); }, 1000);
    }
  }, [isCreateMode, triggerSave, markChanged]);

  const addRiskAssessment = useCallback(() => {
    setRiskAssessments(prev => {
      const next = [...prev, { hazard_type: '', likelihood: '', impact: '', mitigation_measures: '' }];
      riskAssessmentsRef.current = next;
      return next;
    });
    markChanged();
  }, [markChanged]);

  const updateRiskAssessment = useCallback((index: number, field: string, value: string) => {
    setRiskAssessments(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      riskAssessmentsRef.current = updated;
      return updated;
    });
    markChanged();
    if (!isCreateMode) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => { triggerSave(); }, 1000);
    }
  }, [isCreateMode, triggerSave, markChanged]);

  const removeRiskAssessment = useCallback((index: number) => {
    setRiskAssessments(prev => {
      const next = prev.filter((_, i) => i !== index);
      riskAssessmentsRef.current = next;
      return next;
    });
    markChanged();
    if (!isCreateMode) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => { triggerSave(); }, 1000);
    }
  }, [isCreateMode, triggerSave, markChanged]);

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
    contacts,
    riskAssessments,
    updateField,
    addContact,
    updateContact,
    removeContact,
    addRiskAssessment,
    updateRiskAssessment,
    removeRiskAssessment,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    queryClient,
    triggerSave,
    handleCreate,
    deleteMutation,
    approveMutation,
    activateMutation,
  };
}

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  planId: string | undefined;
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
  planId,
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
      basePath: `/organizations/${orgId}/collections/emergency-plans/${planId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['emergency-plan', orgId, planId] }),
    },
  });
}

// =============================================================================
// useSectionSummaries
// =============================================================================

export function useSectionSummaries(
  formData: FormData,
  contacts: EmergencyContact[],
  riskAssessments: RiskAssessment[],
): Record<string, string | undefined> {
  return useMemo(() => {
    const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
    const truncate = (s: string | undefined, max = 60) =>
      s && s.length > max ? s.slice(0, max) + '\u2026' : s;
    return {
      info: parts([formData.title ? truncate(formData.title) : undefined, formData.plan_version ? `v${formData.plan_version}` : undefined, formData.facility_name]),
      contacts: contacts.length > 0 ? `${contacts.length} contact${contacts.length > 1 ? 's' : ''}` : undefined,
      risks: riskAssessments.length > 0 ? `${riskAssessments.length} risk${riskAssessments.length > 1 ? 's' : ''}` : undefined,
      procedures: parts([
        formData.evacuation_procedures ? 'Evacuation' : null,
        formData.response_procedures ? 'Response' : null,
        formData.recovery_procedures ? 'Recovery' : null,
      ]),
      schedule: parts([
        formData.last_drill_date ? `Last: ${formData.last_drill_date}` : null,
        formData.next_drill_date ? `Next: ${formData.next_drill_date}` : null,
      ]),
      notes: truncate(formData.notes),
      history: undefined,
    };
  }, [formData, contacts, riskAssessments]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(
  formData: FormData,
  contacts: EmergencyContact[],
  riskAssessments: RiskAssessment[],
): Record<string, boolean> {
  return useMemo(() => ({
    info: !!(formData.title || formData.plan_version || formData.facility_name),
    contacts: contacts.length > 0,
    risks: riskAssessments.length > 0,
    procedures: !!(formData.evacuation_procedures || formData.response_procedures || formData.recovery_procedures || formData.salvage_priority_guidance),
    schedule: !!(formData.last_drill_date || formData.next_drill_date || formData.review_date),
    notes: !!formData.notes,
    history: true,
  }), [formData, contacts, riskAssessments]);
}
