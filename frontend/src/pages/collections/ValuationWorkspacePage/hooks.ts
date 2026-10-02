import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useAutoSaveForm } from '../../../hooks/useAutoSaveForm';
import { useLookupValues } from '../../../hooks/useLookupValues';
import {
  createValuation,
  updateValuation,
  deleteValuation,
} from '../../../lib/api';
import type { Valuation } from '../../../lib/schemas';
import type { FormData } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS, defaultFormData } from './types';

// =============================================================================
// useSectionSummaries
// =============================================================================

const truncate = (s: string, max = 60) => s.length > max ? s.slice(0, max) + '\u2026' : s;

export function useSectionSummaries(formData: FormData): Record<string, string | undefined> {
  return useMemo(() => {
    const parts = (items: (string | null | undefined)[]) => items.filter(Boolean).join(' \u00b7 ') || undefined;
    return {
      details: parts([
        formData.valuation_type,
        formData.valuation_amount ? `${formData.valuation_amount} ${formData.valuation_currency}` : null,
        formData.valuation_date,
      ]),
      valuator: parts([formData.valuator_credentials ? truncate(formData.valuator_credentials) : null]),
      validity: parts([
        formData.valid_from ? `From: ${formData.valid_from}` : null,
        formData.valid_until ? `Until: ${formData.valid_until}` : null,
      ]),
      linkedObject: parts([formData.object_id ? `Object: ${formData.object_id.slice(0, 8)}` : null]),
      documentation: parts([formData.documentation_reference ? truncate(formData.documentation_reference) : null]),
      authorization: parts([
        formData.authorizer_id ? 'Authorized' : null,
        formData.authorization_date ? `on ${formData.authorization_date}` : null,
      ]),
      notes: parts([formData.valuation_note ? truncate(formData.valuation_note) : null]),
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    details: !!(formData.valuation_amount || formData.valuation_date || formData.valuation_method),
    valuator: !!(formData.valuator_id || formData.valuator_credentials),
    validity: !!(formData.valid_from || formData.valid_until),
    linkedObject: !!formData.object_id,
    documentation: !!formData.documentation_reference,
    authorization: !!(formData.authorizer_id || formData.authorization_date || formData.authorization_note),
    notes: !!formData.valuation_note,
    history: false,
  }), [formData]);
}

// =============================================================================
// useFormState
// =============================================================================

export function useFormState({
  orgId,
  valuationId,
  isCreateMode,
  valuation,
}: {
  orgId: string | undefined;
  valuationId: string | undefined;
  isCreateMode: boolean;
  valuation: Valuation | undefined;
}) {
  const { getLookup, getLabel } = useLookupValues({ context: 'valuations' });

  const form = useAutoSaveForm<FormData, Valuation>({
    defaultFormData,
    hydrate: (server) => ({
      valuation_type: server.valuation_type || 'insurance',
      valuation_amount: server.valuation_amount?.toString() || '',
      valuation_currency: server.valuation_currency || 'USD',
      valuation_date: server.valuation_date?.split('T')[0] || new Date().toISOString().split('T')[0],
      valuation_method: server.valuation_method || '',
      is_current: server.is_current ?? true,
      object_id: server.object_id || '',
      valuator_id: server.valuator_id || '',
      valuator_credentials: server.valuator_credentials || '',
      valid_from: server.valid_from?.split('T')[0] || '',
      valid_until: server.valid_until?.split('T')[0] || '',
      documentation_reference: server.documentation_reference || '',
      valuation_note: server.valuation_note || '',
      authorizer_id: server.authorizer_id || '',
      authorization_date: server.authorization_date?.split('T')[0] || '',
      authorization_note: server.authorization_note || '',
    }),
    buildPayload: (fd) => ({
      valuation_type: fd.valuation_type,
      valuation_amount: fd.valuation_amount ? parseFloat(fd.valuation_amount) : 0,
      valuation_currency: fd.valuation_currency,
      valuation_date: fd.valuation_date || null,
      valuation_method: fd.valuation_method || null,
      is_current: fd.is_current,
      object_id: fd.object_id || null,
      valuator_id: fd.valuator_id || null,
      valuator_credentials: fd.valuator_credentials || null,
      valid_from: fd.valid_from || null,
      valid_until: fd.valid_until || null,
      documentation_reference: fd.documentation_reference || null,
      valuation_note: fd.valuation_note || null,
      authorizer_id: fd.authorizer_id || null,
      authorization_date: fd.authorization_date || null,
      authorization_note: fd.authorization_note || null,
    }),
    serverData: valuation,
    api: { create: createValuation, update: updateValuation, delete: deleteValuation },
    orgId,
    entityId: valuationId,
    isCreateMode,
    queryKeys: {
      entity: ['valuation', orgId, valuationId],
      collection: ['valuations', orgId],
    },
    paths: {
      afterCreate: (result: unknown) => `/organizations/${orgId}/collections/valuations/${(result as Record<string, string>).valuation_id}`,
      afterDelete: `/organizations/${orgId}/collections/valuations`,
    },
    validateCreate: (fd) => {
      if (!fd.object_id) return 'Object is required';
      return null;
    },
    entityLabel: 'valuation',
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
    deleteMutation: { mutate: form.handleDelete },
    blocker: form.blocker,
    getLookup,
    getLabel,
  };
}

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  valuationId: string | undefined;
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
  valuationId,
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
      basePath: `/organizations/${orgId}/collections/valuations/${valuationId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['valuation', orgId, valuationId] }),
    },
  });
}
