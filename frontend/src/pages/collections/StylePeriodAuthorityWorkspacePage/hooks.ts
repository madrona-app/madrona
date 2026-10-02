import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSectionOrder } from '../../../components/record-detail';
import {
  createStylePeriodAuthority,
  updateStylePeriodAuthority,
  deleteStylePeriodAuthority,
} from '../../../lib/api';
import { formatErrorMessage } from '../../../lib/formErrors';
import type { SaveStatus, FormData } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS, defaultFormData } from './types';
import type { StylePeriodAuthority } from '../../../lib/schemas';

// =============================================================================
// useFormState
// =============================================================================

export function useFormState({
  orgId,
  styleId,
  isCreateMode,
  style,
}: {
  orgId: string | undefined;
  styleId: string | undefined;
  isCreateMode: boolean;
  style: StylePeriodAuthority | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Initialize form data from fetched style/period authority
  useEffect(() => {
    if (style) {
      const data: FormData = {
        preferred_term: style.preferred_term || '',
        variant_terms: style.variant_terms || [],
        authority_type: style.authority_type || 'style',
        aat_id: style.aat_id || '',
        wikidata_id: style.wikidata_id || '',
        culture: style.culture || '',
        date_display: style.date_display || '',
        date_earliest: style.date_earliest || '',
        date_latest: style.date_latest || '',
        geographic_scope: style.geographic_scope || '',
        parent_authority_id: style.parent_authority_id ?? null,
        description: style.description || '',
        notes: style.notes || '',
        status: style.status || 'active',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [style]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Partial<StylePeriodAuthority>) => createStylePeriodAuthority(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['style-period-authorities', orgId] });
      navigate(`/organizations/${orgId}/collections/style-period-authorities/${result.authority_id}`);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'style/period authority'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Partial<StylePeriodAuthority>) => updateStylePeriodAuthority(orgId!, styleId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['style-period-authority', orgId, styleId] });
      queryClient.invalidateQueries({ queryKey: ['style-period-authorities', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'style/period authority'));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteStylePeriodAuthority(orgId!, styleId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['style-period-authorities', orgId] });
      navigate(`/organizations/${orgId}/collections/vocabularies`);
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      preferred_term: fd.preferred_term,
      variant_terms: fd.variant_terms.length ? fd.variant_terms : null,
      authority_type: fd.authority_type,
      aat_id: fd.aat_id || null,
      wikidata_id: fd.wikidata_id || null,
      culture: fd.culture || null,
      date_display: fd.date_display || null,
      date_earliest: fd.date_earliest || null,
      date_latest: fd.date_latest || null,
      geographic_scope: fd.geographic_scope || null,
      parent_authority_id: fd.parent_authority_id,
      description: fd.description || null,
      notes: fd.notes || null,
      status: fd.status,
    };
  }, []);

  const triggerSave = useCallback(() => {
    if (isCreateMode) return;
    const currentHasChanges = JSON.stringify(formDataRef.current) !== originalDataRef.current;
    if (!currentHasChanges) return;

    if (!formDataRef.current.preferred_term?.trim()) {
      setErrorMessage('Preferred term is required');
      setSaveStatus('error');
      return;
    }

    setSaveStatus('saving');
    setErrorMessage(null);
    updateMutation.mutate(buildPayload() as Partial<StylePeriodAuthority>);
  }, [updateMutation, isCreateMode, buildPayload]);

  const handleCreate = useCallback(() => {
    if (!formDataRef.current.preferred_term?.trim()) {
      setErrorMessage('Preferred term is required');
      setSaveStatus('error');
      return;
    }
    setSaveStatus('saving');
    setErrorMessage(null);
    createMutation.mutate(buildPayload() as Partial<StylePeriodAuthority>);
  }, [createMutation, buildPayload]);

  const updateField = useCallback((field: string, value: string | null | string[]) => {
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
      identity: parts([
        formData.preferred_term,
        formData.authority_type,
        formData.culture,
      ]),
      dates: parts([
        formData.date_display,
        formData.date_earliest && formData.date_latest
          ? `${formData.date_earliest}\u2013${formData.date_latest}`
          : formData.date_earliest || formData.date_latest || undefined,
      ]),
      external: parts([
        formData.aat_id ? `AAT: ${formData.aat_id}` : undefined,
        formData.wikidata_id ? `Wikidata: ${formData.wikidata_id}` : undefined,
      ]),
      status: formData.status || undefined,
      notes: formData.notes ? truncate(formData.notes) : undefined,
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    identity: !!(formData.preferred_term || formData.authority_type || formData.culture || (formData.variant_terms && formData.variant_terms.length > 0)),
    dates: !!(formData.date_display || formData.date_earliest || formData.date_latest),
    external: !!(formData.aat_id || formData.wikidata_id),
    status: !!formData.status,
    notes: !!formData.notes,
    history: false,
  }), [formData]);
}

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  styleId: string | undefined;
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
  styleId,
  isCreateMode,
  isEditing,
  setIsEditing,
  canEdit,
  hasUnsavedChanges,
  performSave,
  queryClient,
}: UseSectionStateParams) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(
    { ...INITIAL_EXPANDED_SECTIONS }
  );
  const [raisedSectionId, setRaisedSectionId] = useState<string | null>(null);
  const [sectionOrder] = useSectionOrder();

  const getSectionOrder = useCallback((sectionId: string): number | undefined => {
    const groupId = SECTION_GROUPS[sectionId];
    if (!groupId) return undefined;
    const customOrder = sectionOrder[groupId];
    if (!customOrder || customOrder.length === 0) return undefined;
    const index = customOrder.indexOf(sectionId);
    if (index === -1) return undefined;
    const groupIndex = GROUP_ORDER.indexOf(groupId);
    return (groupIndex >= 0 ? groupIndex : 99) * 100 + index;
  }, [sectionOrder]);

  const lowerAllSections = useCallback(() => {
    if (raisedSectionId) {
      const section = document.getElementById(`section-${raisedSectionId}`) || document.getElementById(raisedSectionId);
      if (section) {
        section.classList.remove('section-raised', 'section-raise-enter');
        section.classList.add('section-raise-exit');
        setTimeout(() => { section.classList.remove('section-raise-exit'); }, 200);
      }
      setRaisedSectionId(null);
    }
  }, [raisedSectionId]);

  const handleToggleMode = useCallback(() => {
    const newMode = !isEditing;
    setIsEditing(newMode);
    if (!isCreateMode) {
      const basePath = `/organizations/${orgId}/collections/style-period-authorities/${styleId}`;
      window.history.replaceState(null, '', newMode ? `${basePath}/edit` : basePath);
    }
    if (!newMode) {
      lowerAllSections();
      queryClient.invalidateQueries({ queryKey: ['style-period-authority', orgId, styleId] });
    }
    if (!newMode && hasUnsavedChanges && !isCreateMode) performSave();
  }, [isEditing, isCreateMode, orgId, styleId, hasUnsavedChanges, performSave, lowerAllSections, setIsEditing, queryClient]);

  const raiseSection = useCallback((sectionId: string) => {
    if (raisedSectionId && raisedSectionId !== sectionId) {
      const prevSection = document.getElementById(`section-${raisedSectionId}`) || document.getElementById(raisedSectionId);
      if (prevSection) {
        prevSection.classList.remove('section-raised', 'section-raise-enter');
        prevSection.classList.add('section-raise-exit');
        setTimeout(() => { prevSection.classList.remove('section-raise-exit'); }, 200);
      }
    }
    setRaisedSectionId(sectionId);
    setTimeout(() => {
      const section = document.getElementById(`section-${sectionId}`) || document.getElementById(sectionId);
      if (section) {
        section.classList.remove('section-raise-exit');
        section.classList.add('section-raise-enter', 'section-raised');
        section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 50);
    if (!isEditing && !isCreateMode && canEdit) {
      setIsEditing(true);
      const basePath = `/organizations/${orgId}/collections/style-period-authorities/${styleId}`;
      window.history.replaceState(null, '', `${basePath}/edit`);
    }
  }, [raisedSectionId, isEditing, isCreateMode, canEdit, orgId, styleId, setIsEditing]);

  const toggleSection = useCallback((sectionId: string) => {
    const isCurrentlyExpanded = expandedSections[sectionId];
    if (isCurrentlyExpanded) {
      if (!isEditing && !isCreateMode && canEdit) {
        setExpandedSections(prev => {
          const newState: Record<string, boolean> = {};
          Object.keys(prev).forEach(key => { newState[key] = key === sectionId; });
          return newState;
        });
        raiseSection(sectionId);
      } else {
        setExpandedSections(prev => ({ ...prev, [sectionId]: false }));
        lowerAllSections();
      }
    } else {
      setExpandedSections(prev => {
        const newState: Record<string, boolean> = {};
        Object.keys(prev).forEach(key => { newState[key] = key === sectionId; });
        return newState;
      });
      raiseSection(sectionId);
    }
  }, [expandedSections, raiseSection, lowerAllSections, isEditing, isCreateMode, canEdit]);

  const handleEnterEditMode = useCallback((sectionId: string) => {
    setExpandedSections(prev => {
      const newState: Record<string, boolean> = {};
      Object.keys(prev).forEach(key => { newState[key] = key === sectionId; });
      return newState;
    });
    raiseSection(sectionId);
  }, [raiseSection]);

  return {
    expandedSections,
    getSectionOrder,
    toggleSection,
    handleToggleMode,
    handleEnterEditMode,
  };
}
