import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSectionOrder } from '../../../components/record-detail';
import {
  createPlaceAuthority,
  updatePlaceAuthority,
  deletePlaceAuthority,
} from '../../../lib/api';
import { formatErrorMessage } from '../../../lib/formErrors';
import type { SaveStatus, FormData } from './types';
import type { PlaceAuthority } from '../../../lib/schemas';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS, defaultFormData } from './types';

// =============================================================================
// useFormState
// =============================================================================

export function useFormState({
  orgId,
  placeId,
  isCreateMode,
  place,
}: {
  orgId: string | undefined;
  placeId: string | undefined;
  isCreateMode: boolean;
  place: PlaceAuthority | undefined;
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

  // Initialize form data from fetched place authority
  useEffect(() => {
    if (place) {
      const data: FormData = {
        preferred_name: place.preferred_name || '',
        variant_names: place.variant_names || [],
        place_type: place.place_type || 'place',
        tgn_id: place.tgn_id || '',
        geonames_id: place.geonames_id || '',
        wikidata_id: place.wikidata_id || '',
        coordinates_lat: place.coordinates_lat ?? null,
        coordinates_lng: place.coordinates_lng ?? null,
        parent_place_id: place.parent_place_id ?? null,
        hierarchy_path: place.hierarchy_path || '',
        country_code: place.country_code || '',
        notes: place.notes || '',
        status: place.status || 'active',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [place]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Partial<PlaceAuthority>) => createPlaceAuthority(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['place-authorities', orgId] });
      navigate(`/organizations/${orgId}/collections/place-authorities/${result.place_authority_id}`);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'place authority'));
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Partial<PlaceAuthority>) => updatePlaceAuthority(orgId!, placeId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['place-authority', orgId, placeId] });
      queryClient.invalidateQueries({ queryKey: ['place-authorities', orgId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, 'place authority'));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deletePlaceAuthority(orgId!, placeId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['place-authorities', orgId] });
      navigate(`/organizations/${orgId}/collections/vocabularies`);
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      preferred_name: fd.preferred_name,
      variant_names: fd.variant_names.length ? fd.variant_names : null,
      place_type: fd.place_type,
      tgn_id: fd.tgn_id || null,
      geonames_id: fd.geonames_id || null,
      wikidata_id: fd.wikidata_id || null,
      coordinates_lat: fd.coordinates_lat || null,
      coordinates_lng: fd.coordinates_lng || null,
      parent_place_id: fd.parent_place_id || null,
      hierarchy_path: fd.hierarchy_path || null,
      country_code: fd.country_code || null,
      notes: fd.notes || null,
      status: fd.status,
    };
  }, []);

  const triggerSave = useCallback(() => {
    if (isCreateMode) return;
    const currentHasChanges = JSON.stringify(formDataRef.current) !== originalDataRef.current;
    if (!currentHasChanges) return;

    if (!formDataRef.current.preferred_name?.trim()) {
      setErrorMessage('Preferred name is required');
      setSaveStatus('error');
      return;
    }

    setSaveStatus('saving');
    setErrorMessage(null);
    updateMutation.mutate(buildPayload() as Partial<PlaceAuthority>);
  }, [updateMutation, isCreateMode, buildPayload]);

  const handleCreate = useCallback(() => {
    if (!formDataRef.current.preferred_name?.trim()) {
      setErrorMessage('Preferred name is required');
      setSaveStatus('error');
      return;
    }
    setSaveStatus('saving');
    setErrorMessage(null);
    createMutation.mutate(buildPayload() as Partial<PlaceAuthority>);
  }, [createMutation, buildPayload]);

  const updateField = useCallback((field: string, value: string | number | null | string[]) => {
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
        formData.preferred_name,
        formData.place_type,
        formData.country_code,
      ]),
      location: parts([
        formData.coordinates_lat != null ? `${formData.coordinates_lat}` : undefined,
        formData.coordinates_lng != null ? `${formData.coordinates_lng}` : undefined,
      ]),
      area: undefined,
      external: parts([
        formData.tgn_id ? `TGN: ${formData.tgn_id}` : undefined,
        formData.geonames_id ? `GeoNames: ${formData.geonames_id}` : undefined,
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
    identity: !!(formData.preferred_name || formData.place_type || formData.country_code || (formData.variant_names && formData.variant_names.length > 0)),
    location: !!(formData.coordinates_lat != null || formData.coordinates_lng != null),
    area: false,
    external: !!(formData.tgn_id || formData.geonames_id || formData.wikidata_id),
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
  placeId: string | undefined;
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
  placeId,
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
      const basePath = `/organizations/${orgId}/collections/place-authorities/${placeId}`;
      window.history.replaceState(null, '', newMode ? `${basePath}/edit` : basePath);
    }
    if (!newMode) {
      lowerAllSections();
      queryClient.invalidateQueries({ queryKey: ['place-authority', orgId, placeId] });
    }
    if (!newMode && hasUnsavedChanges && !isCreateMode) performSave();
  }, [isEditing, isCreateMode, orgId, placeId, hasUnsavedChanges, performSave, lowerAllSections, setIsEditing, queryClient]);

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
      const basePath = `/organizations/${orgId}/collections/place-authorities/${placeId}`;
      window.history.replaceState(null, '', `${basePath}/edit`);
    }
  }, [raisedSectionId, isEditing, isCreateMode, canEdit, orgId, placeId, setIsEditing]);

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
