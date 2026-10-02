import { useState, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useAutoSaveForm } from '../../../hooks/useAutoSaveForm';
import {
  createInsurancePolicy,
  updateInsurancePolicy,
  deleteInsurancePolicy,
  createInsuranceCoverage,
  type InsuranceCoverage,
} from '../../../lib/api';
import { formatErrorMessage } from '../../../lib/formErrors';
import type { FormData } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS, defaultFormData, POLICY_TYPE_OPTIONS, STATUS_OPTIONS } from './types';

// =============================================================================
// useSectionSummaries
// =============================================================================

const truncate = (s: string, max = 60) => s.length > max ? s.slice(0, max) + '\u2026' : s;

export function useSectionSummaries(formData: FormData): Record<string, string | undefined> {
  return useMemo(() => {
    const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
    const typeLabel = POLICY_TYPE_OPTIONS.find(t => t.value === formData.policy_type)?.label;
    const statusLabel = STATUS_OPTIONS.find(s => s.value === formData.status)?.label;
    return {
      details: parts([formData.policy_number, typeLabel, statusLabel]),
      provider: parts([formData.provider_name, formData.broker_name]),
      coverage: parts([
        formData.coverage_limit ? `Limit: ${formData.coverage_limit} ${formData.coverage_limit_currency}` : null,
        formData.deductible ? `Deductible: ${formData.deductible}` : null,
      ]),
      dates: parts([
        formData.effective_date ? `From: ${formData.effective_date}` : null,
        formData.expiration_date ? `To: ${formData.expiration_date}` : null,
      ]),
      coveredItems: undefined,
      notes: parts([formData.notes ? truncate(formData.notes) : null]),
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    details: !!(formData.policy_number || formData.policy_name || formData.policy_type),
    provider: !!(formData.provider_name || formData.broker_name),
    coverage: !!(formData.coverage_limit || formData.per_occurrence_limit || formData.deductible || formData.annual_premium),
    dates: !!(formData.effective_date || formData.expiration_date),
    coveredItems: false,
    notes: !!formData.notes,
    history: false,
  }), [formData]);
}

// =============================================================================
// useFormState
// =============================================================================

export function useFormState({
  orgId,
  policyId,
  isCreateMode,
  policy,
}: {
  orgId: string | undefined;
  policyId: string | undefined;
  isCreateMode: boolean;
  policy: Record<string, unknown> | undefined;
}) {
  const form = useAutoSaveForm<FormData, Record<string, unknown>>({
    defaultFormData,
    hydrate: (server) => ({
      policy_number: (server.policy_number as string) || '',
      policy_name: (server.policy_name as string) || '',
      policy_type: (server.policy_type as string) || 'blanket',
      provider_name: (server.provider_name as string) || '',
      broker_name: (server.broker_name as string) || '',
      effective_date: (server.effective_date as string)?.split('T')[0] || '',
      expiration_date: (server.expiration_date as string)?.split('T')[0] || '',
      coverage_limit: server.coverage_limit?.toString() || '',
      coverage_limit_currency: (server.coverage_limit_currency as string) || 'USD',
      per_occurrence_limit: server.per_occurrence_limit?.toString() || '',
      deductible: server.deductible?.toString() || '',
      annual_premium: server.annual_premium?.toString() || '',
      status: (server.status as string) || 'draft',
      notes: (server.notes as string) || '',
    }),
    buildPayload: (fd) => ({
      policy_number: fd.policy_number || null,
      policy_name: fd.policy_name || null,
      policy_type: fd.policy_type,
      provider_name: fd.provider_name || null,
      broker_name: fd.broker_name || null,
      effective_date: fd.effective_date || null,
      expiration_date: fd.expiration_date || null,
      coverage_limit: fd.coverage_limit ? parseFloat(fd.coverage_limit) : null,
      coverage_limit_currency: fd.coverage_limit_currency,
      per_occurrence_limit: fd.per_occurrence_limit ? parseFloat(fd.per_occurrence_limit) : null,
      deductible: fd.deductible ? parseFloat(fd.deductible) : null,
      annual_premium: fd.annual_premium ? parseFloat(fd.annual_premium) : null,
      status: fd.status,
      notes: fd.notes || null,
    }),
    serverData: policy,
    api: { create: createInsurancePolicy, update: updateInsurancePolicy, delete: deleteInsurancePolicy },
    orgId,
    entityId: policyId,
    isCreateMode,
    queryKeys: {
      entity: ['insurance-policy', orgId, policyId],
      collection: ['insurance-policies', orgId],
    },
    paths: {
      afterCreate: (result: unknown) => `/organizations/${orgId}/collections/insurance/policies/${(result as Record<string, string>).policy_id}`,
      afterDelete: `/organizations/${orgId}/collections/insurance`,
    },
    validateCreate: (fd) => {
      if (!fd.policy_name) return 'Policy Name is required';
      return null;
    },
    entityLabel: 'insurance policy',
  });

  // Coverage form state (orthogonal to main form)
  const [showAddCoverageForm, setShowAddCoverageForm] = useState(false);
  const [newCoverage, setNewCoverage] = useState({
    covered_entity_type: 'collection_object',
    covered_entity_id: '',
    declared_value: '',
    value_currency: 'USD',
  });

  const addCoverageMutation = useMutation({
    mutationFn: (data: Partial<InsuranceCoverage>) => createInsuranceCoverage(orgId!, data),
    onSuccess: () => {
      form.queryClient.invalidateQueries({ queryKey: ['insurance-coverages', orgId, policyId] });
      setShowAddCoverageForm(false);
      setNewCoverage({
        covered_entity_type: 'collection_object',
        covered_entity_id: '',
        declared_value: '',
        value_currency: 'USD',
      });
    },
    onError: (error: Error) => {
      form.setErrorMessage(formatErrorMessage(error.message, 'coverage'));
    },
  });

  const handleAddCoverage = useCallback(() => {
    if (!newCoverage.covered_entity_id) {
      form.setErrorMessage('Entity ID is required');
      return;
    }
    addCoverageMutation.mutate({
      policy_id: policyId,
      covered_entity_type: newCoverage.covered_entity_type as InsuranceCoverage['covered_entity_type'],
      covered_entity_id: newCoverage.covered_entity_id,
      declared_value: newCoverage.declared_value ? parseFloat(newCoverage.declared_value) : undefined,
      value_currency: newCoverage.value_currency,
      status: 'pending',
    });
  }, [newCoverage, policyId, addCoverageMutation, form]);

  return {
    formData: form.formData,
    updateField: form.updateField as (field: string, value: string | boolean) => void,
    hasUnsavedChanges: form.hasUnsavedChanges,
    saveStatus: form.saveStatus,
    lastSaved: form.lastSaved,
    errorMessage: form.errorMessage,
    queryClient: form.queryClient,
    triggerSave: form.performSave,
    handleCreate: form.handleCreate,
    deleteMutation: { mutate: form.handleDelete, isPending: form.isDeleting },
    blocker: form.blocker,
    addCoverageMutation,
    showAddCoverageForm,
    setShowAddCoverageForm,
    newCoverage,
    setNewCoverage,
    handleAddCoverage,
  };
}

// =============================================================================
// useSectionState — thin wrapper around useUnifiedSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  policyId: string | undefined;
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
  policyId,
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
      basePath: `/organizations/${orgId}/collections/insurance/policies/${policyId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['insurance-policy', orgId, policyId] }),
    },
  });
}
