import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { useLookupValues } from '../../../hooks/useLookupValues';
import {
  createCitation,
  updateCitation,
  deleteCitation,
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
  citationId,
  isCreateMode,
  citation,
}: {
  orgId: string | undefined;
  citationId: string | undefined;
  isCreateMode: boolean;
  citation: Record<string, unknown> | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { getLookup, getLabel } = useLookupValues({ context: 'citations' });

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Initialize form data from fetched citation
  useEffect(() => {
    if (citation) {
      const data: FormData = {
        citation_type: (citation.citation_type as string) || 'book',
        brief_citation: (citation.brief_citation as string) || '',
        full_citation: (citation.full_citation as string) || '',
        author: (citation.author as string) || '',
        title: (citation.title as string) || '',
        publication: (citation.publication as string) || '',
        publisher: (citation.publisher as string) || '',
        publication_place: (citation.publication_place as string) || '',
        publication_year: citation.publication_year?.toString() || '',
        volume: (citation.volume as string) || '',
        issue: (citation.issue as string) || '',
        pages: (citation.pages as string) || '',
        url: (citation.url as string) || '',
        doi: (citation.doi as string) || '',
        isbn: (citation.isbn as string) || '',
        works_cited: (citation.works_cited as boolean) || false,
        works_illustrated: (citation.works_illustrated as boolean) || false,
        notes: (citation.notes as string) || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [citation]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createCitation(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['citations', orgId] });
      navigate(`/organizations/${orgId}/collections/citations`);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'citation'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateCitation(orgId!, citationId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['citation', orgId, citationId] });
      queryClient.invalidateQueries({ queryKey: ['citations', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'citation'));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteCitation(orgId!, citationId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['citations', orgId] });
      navigate(`/organizations/${orgId}/collections/citations`);
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      citation_type: fd.citation_type,
      brief_citation: fd.brief_citation || null,
      full_citation: fd.full_citation || null,
      author: fd.author || null,
      title: fd.title || null,
      publication: fd.publication || null,
      publisher: fd.publisher || null,
      publication_place: fd.publication_place || null,
      publication_year: fd.publication_year ? parseInt(fd.publication_year) : null,
      volume: fd.volume || null,
      issue: fd.issue || null,
      pages: fd.pages || null,
      url: fd.url || null,
      doi: fd.doi || null,
      isbn: fd.isbn || null,
      works_cited: fd.works_cited,
      works_illustrated: fd.works_illustrated,
      notes: fd.notes || null,
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
    getLookup,
    getLabel,
  };
}

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  citationId: string | undefined;
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
  citationId,
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
      basePath: `/organizations/${orgId}/collections/citations/${citationId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['citation', orgId, citationId] }),
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
      basic: parts([formData.citation_type, formData.brief_citation]),
      structured: parts([formData.author, formData.title ? truncate(formData.title) : undefined, formData.publication_year]),
      digital: parts([formData.doi, formData.isbn, formData.url ? truncate(formData.url) : undefined]),
      flags: parts([
        formData.works_cited ? 'Works Cited' : null,
        formData.works_illustrated ? 'Works Illustrated' : null,
      ]),
      notes: truncate(formData.notes),
      history: undefined,
    };
  }, [formData]);
}

// =============================================================================
// useHasContent
// =============================================================================

export function useHasContent(formData: FormData): Record<string, boolean> {
  return useMemo(() => ({
    basic: !!(formData.citation_type || formData.brief_citation || formData.full_citation),
    structured: !!(formData.author || formData.title || formData.publication || formData.publisher || formData.publication_place || formData.publication_year || formData.volume || formData.issue || formData.pages),
    digital: !!(formData.url || formData.doi || formData.isbn),
    flags: true, // boolean toggles always have content
    notes: !!formData.notes,
    history: true,
  }), [formData]);
}
