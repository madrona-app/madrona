import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useAutoSaveForm } from '../../../hooks/useAutoSaveForm';
import {
  createIndemnityArrangement,
  updateIndemnityArrangement,
} from '../../../lib/api';
import { apiFetch } from '../../../lib/api';
import type { FormData } from './types';
import {
  SECTION_GROUPS,
  GROUP_ORDER,
  INITIAL_EXPANDED_SECTIONS,
  defaultFormData,
  PROGRAM_OPTIONS,
  STATUS_OPTIONS,
} from './types';

// =============================================================================
// useSectionSummaries
// =============================================================================

const truncate = (s: string, max = 60) => s.length > max ? s.slice(0, max) + '\u2026' : s;

export function useSectionSummaries(
  formData: FormData,
  objectCount?: number,
): Record<string, string | undefined> {
  return useMemo(() => {
    const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
    const programLabel = PROGRAM_OPTIONS.find(p => p.value === formData.program)?.label;
    const statusLabel = STATUS_OPTIONS.find(s => s.value === formData.status)?.label;
    return {
      arrangement: parts([programLabel, formData.reference_number, statusLabel]),
      application: parts([
        formData.requested_coverage ? `Requested: ${formData.requested_coverage} ${formData.coverage_currency}` : null,
        formData.awarded_coverage ? `Awarded: ${formData.awarded_coverage} ${formData.coverage_currency}` : null,
      ]),
      coveragePeriod: parts([
        formData.coverage_start_date ? `From: ${formData.coverage_start_date}` : null,
        formData.coverage_end_date ? `To: ${formData.coverage_end_date}` : null,
      ]),
      objects: objectCount ? `${objectCount} object${objectCount === 1 ? '' : 's'}` : undefined,
      notes: parts([formData.notes ? truncate(formData.notes) : null]),
      history: undefined,
    };
  }, [formData, objectCount]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(
  formData: FormData,
  objectCount?: number,
): Record<string, boolean> {
  return useMemo(() => ({
    arrangement: !!(formData.program || formData.reference_number || formData.internal_reference),
    application: !!(formData.requested_coverage || formData.awarded_coverage || formData.application_date),
    coveragePeriod: !!(formData.coverage_start_date || formData.coverage_end_date),
    objects: (objectCount ?? 0) > 0,
    notes: !!formData.notes,
    history: false,
  }), [formData, objectCount]);
}

// =============================================================================
// deleteIndemnityArrangement (inline, not in api module yet)
// =============================================================================

async function deleteIndemnityArrangement(orgId: string, indemnityId: string): Promise<void> {
  await apiFetch(`/organizations/${orgId}/collections/insurance/indemnities/${indemnityId}`, {
    method: 'DELETE',
  });
}

// =============================================================================
// useFormState
// =============================================================================

export function useFormState({
  orgId,
  indemnityId,
  isCreateMode,
  indemnity,
}: {
  orgId: string | undefined;
  indemnityId: string | undefined;
  isCreateMode: boolean;
  indemnity: Record<string, unknown> | undefined;
}) {
  const form = useAutoSaveForm<FormData, Record<string, unknown>>({
    defaultFormData,
    hydrate: (server) => ({
      program: (server.program as string) || 'uk_gis',
      reference_number: (server.reference_number as string) || '',
      internal_reference: (server.internal_reference as string) || '',
      exhibition_id: (server.exhibition_id as string) || '',
      loan_in_id: (server.loan_in_id as string) || '',
      application_date: (server.application_date as string)?.split('T')[0] || '',
      requested_coverage: server.requested_coverage?.toString() || '',
      awarded_coverage: server.awarded_coverage?.toString() || '',
      coverage_currency: (server.coverage_currency as string) || 'USD',
      coverage_start_date: (server.coverage_start_date as string)?.split('T')[0] || '',
      coverage_end_date: (server.coverage_end_date as string)?.split('T')[0] || '',
      commercial_gap_required: (server.commercial_gap_required as boolean) || false,
      gap_coverage_id: (server.gap_coverage_id as string) || '',
      status: (server.status as string) || 'draft',
      notes: (server.notes as string) || '',
    }),
    buildPayload: (fd) => ({
      program: fd.program,
      reference_number: fd.reference_number || null,
      internal_reference: fd.internal_reference || null,
      exhibition_id: fd.exhibition_id || null,
      loan_in_id: fd.loan_in_id || null,
      application_date: fd.application_date || null,
      requested_coverage: fd.requested_coverage ? parseFloat(fd.requested_coverage) : null,
      awarded_coverage: fd.awarded_coverage ? parseFloat(fd.awarded_coverage) : null,
      coverage_currency: fd.coverage_currency,
      coverage_start_date: fd.coverage_start_date || null,
      coverage_end_date: fd.coverage_end_date || null,
      commercial_gap_required: fd.commercial_gap_required,
      gap_coverage_id: fd.gap_coverage_id || null,
      status: fd.status,
      notes: fd.notes || null,
    }),
    serverData: indemnity,
    api: {
      create: createIndemnityArrangement,
      update: updateIndemnityArrangement,
      delete: deleteIndemnityArrangement,
    },
    orgId,
    entityId: indemnityId,
    isCreateMode,
    queryKeys: {
      entity: ['indemnity-arrangement', orgId, indemnityId],
      collection: ['indemnity-arrangements', orgId],
    },
    paths: {
      afterCreate: (result: unknown) =>
        `/organizations/${orgId}/collections/insurance/indemnities/${(result as Record<string, string>).indemnity_id}`,
      afterDelete: `/organizations/${orgId}/collections/insurance/indemnities`,
    },
    validateCreate: (fd) => {
      if (!fd.program) return 'Program is required';
      return null;
    },
    entityLabel: 'indemnity arrangement',
  });

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
  };
}

// =============================================================================
// useSectionState — thin wrapper around useUnifiedSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  indemnityId: string | undefined;
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
  indemnityId,
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
      basePath: `/organizations/${orgId}/collections/insurance/indemnities/${indemnityId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['indemnity-arrangement', orgId, indemnityId] }),
    },
  });
}
