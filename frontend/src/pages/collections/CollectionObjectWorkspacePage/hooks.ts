import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDateShort, formatCurrency } from '@/lib/formatters';
import {
  getCollectionObject,
  createCollectionObject,
  updateCollectionObject,
  getObjectValuations,
  getObjectProcedures,
  getObjectRights,
  listObjectMedia,
  linkMediaToObject,
  unlinkMediaFromObject,
  setObjectPrimaryMedia,
  updateObjectMediaLink,
} from '../../../lib/api';
import type { CollectionObject, Valuation } from '../../../lib/schemas';
import { computeSectionIndicator } from '../../../components/record-detail/SectionIndicator';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import type { LinkedMediaItem } from '../../../components/collections/MediaLibraryLinker';
import type { FormData } from './types';
import { SECTION_GROUPS, GROUP_ORDER, DEFAULT_SECTION_ORDER, INITIAL_EXPANDED_SECTIONS, PAGE_SECTION_GROUPS, ALL_SECTION_IDS, CREATE_MODE_EXCLUDE } from './types';
import { logger } from '../../../lib/logger';

/**
 * Custom hook that encapsulates all data fetching for the Collection Object page
 */
export function useCollectionObjectData() {
  const { orgId, objectId } = useParams<{ orgId: string; objectId: string }>();
  const queryClient = useQueryClient();

  const isCreateMode = !objectId;

  // Main object query
  const {
    data: object,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['collection-object', orgId, objectId],
    queryFn: () => getCollectionObject(orgId!, objectId!),
    enabled: !!orgId && !!objectId && !isCreateMode,
    refetchOnWindowFocus: true,
  });

  // Valuations query
  const { data: valuationsData } = useQuery({
    queryKey: ['object-valuations', orgId, objectId],
    queryFn: () => getObjectValuations(orgId!, objectId!),
    enabled: !!orgId && !!objectId,
  });

  // Procedures query (for condition reports)
  const { data: proceduresData } = useQuery({
    queryKey: ['object-procedures', orgId, objectId],
    queryFn: () => getObjectProcedures(orgId!, objectId!),
    enabled: !!orgId && !!objectId,
  });

  // Rights query
  const { data: rightsData } = useQuery({
    queryKey: ['object-rights', orgId, objectId],
    queryFn: () => getObjectRights(orgId!, objectId!),
    enabled: !!orgId && !!objectId,
  });

  // Object media query
  const { data: objectMediaData, isLoading: isLoadingMedia } = useQuery({
    queryKey: ['object-media', orgId, objectId],
    queryFn: () => listObjectMedia(orgId!, objectId!),
    enabled: !isCreateMode && !!orgId && !!objectId,
  });

  // Transform media data for MediaLibraryLinker
  const linkedMedia: LinkedMediaItem[] = useMemo(() => {
    return (objectMediaData?.media || []).map(m => ({
      link_id: m.media_id,
      media_id: m.media_id,
      is_primary: m.is_primary,
      caption_override: m.caption_override || undefined,
      usage_type: m.usage_type || undefined,
      media: m.media || undefined,
    }));
  }, [objectMediaData]);

  return {
    orgId,
    objectId,
    isCreateMode,
    object,
    isLoading,
    error,
    valuationsData,
    proceduresData,
    rightsData,
    linkedMedia,
    isLoadingMedia,
    queryClient,
  };
}

/**
 * Custom hook for media mutations
 */
export function useMediaMutations(orgId: string | undefined, objectId: string | undefined) {
  const queryClient = useQueryClient();

  const linkMediaMutation = useMutation({
    mutationFn: (params: { media_id: string; usage_type?: string; caption_override?: string }) =>
      linkMediaToObject(orgId!, objectId!, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-media', orgId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['collection-object', orgId, objectId] });
    },
  });

  const unlinkMediaMutation = useMutation({
    mutationFn: (mediaId: string) => unlinkMediaFromObject(orgId!, objectId!, mediaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-media', orgId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['collection-object', orgId, objectId] });
    },
  });

  const setPrimaryMediaMutation = useMutation({
    mutationFn: (mediaId: string) => setObjectPrimaryMedia(orgId!, objectId!, mediaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-media', orgId, objectId] });
      queryClient.invalidateQueries({ queryKey: ['collection-object', orgId, objectId] });
    },
  });

  const updateMediaLinkMutation = useMutation({
    mutationFn: ({ mediaId, updates }: { mediaId: string; updates: { caption_override?: string; usage_type?: string } }) =>
      updateObjectMediaLink(orgId!, objectId!, mediaId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-media', orgId, objectId] });
    },
  });

  return {
    linkMediaMutation,
    unlinkMediaMutation,
    setPrimaryMediaMutation,
    updateMediaLinkMutation,
  };
}

/**
 * Custom hook for form state and autosave
 */
export function useFormState(
  object: CollectionObject | undefined,
  isCreateMode: boolean,
  isEditing: boolean,
  orgId: string | undefined,
  objectId: string | undefined,
  navigate: ReturnType<typeof useNavigate>
) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<FormData | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originalDataRef = useRef<string>('');
  const formDataRef = useRef<FormData | null>(null);
  const serverUpdatedAtRef = useRef<string | null>(null);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Partial<CollectionObject>) => createCollectionObject(orgId!, data),
    onSuccess: (newObject) => {
      if (!newObject?.object_id || !orgId) {
        logger.error('Create succeeded but missing object_id or orgId', { newObject, orgId });
        setSaveStatus('error');
        return;
      }
      queryClient.setQueryData(['collection-object', orgId, newObject.object_id], newObject);
      queryClient.invalidateQueries({ queryKey: ['collections-search', orgId] });
      queryClient.invalidateQueries({ queryKey: ['collection-objects-db', orgId] });
      if (formData) {
        originalDataRef.current = JSON.stringify(formData);
      }
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      navigate(`/organizations/${orgId}/collections/objects/${newObject.object_id}`, { replace: true });
    },
    onError: (error: Error & { status?: number }) => {
      logger.error('Create failed:', error);
      setSaveStatus('error');
      const message = error.message || 'Failed to create object';
      if (message.includes('already exists') || message.includes('DUPLICATE')) {
        setErrorMessage('An object with this number already exists. Please use a different object number.');
      } else {
        setErrorMessage(message);
      }
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Partial<CollectionObject>) => updateCollectionObject(orgId!, objectId!, data),
    onSuccess: (updatedObject) => {
      queryClient.invalidateQueries({ queryKey: ['collections-search', orgId] });
      // Refresh the object so collapsed cards show updated data
      queryClient.invalidateQueries({ queryKey: ['collection-object', orgId, objectId] });
      if (formData) {
        originalDataRef.current = JSON.stringify(formData);
      }
      // Track the server's updated_at for conflict detection on next save
      if (updatedObject?.updated_at) {
        serverUpdatedAtRef.current = updatedObject.updated_at;
      }
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      setErrorMessage(null);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
    },
    onError: async (error: Error & { status?: number }, variables) => {
      if (error.status === 409) {
        // Conflict: another process updated this object. Retry once with fresh timestamp.
        const retryCount = (variables as any).__retryCount || 0;
        if (retryCount >= 1) {
          setSaveStatus('error');
          setErrorMessage('Save conflict. Please refresh the page and try again.');
          return;
        }
        try {
          const freshObject = await queryClient.fetchQuery({
            queryKey: ['collection-object', orgId, objectId],
            queryFn: () => getCollectionObject(orgId!, objectId!),
            staleTime: 0,
          });
          if (freshObject?.updated_at) {
            serverUpdatedAtRef.current = freshObject.updated_at;
          }
          const retryPayload = { ...variables, updated_at: serverUpdatedAtRef.current, __retryCount: retryCount + 1 };
          updateMutation.mutate(retryPayload as any);
        } catch {
          setSaveStatus('error');
          setErrorMessage('Unable to save. Please refresh the page.');
        }
        return;
      }
      setSaveStatus('error');
      setErrorMessage(error.message || 'Save failed');
    },
  });

  // Prepare update data
  const prepareUpdateData = useCallback((data: FormData): Partial<CollectionObject> => {
    const payload: Partial<CollectionObject> = {
      object_number: data.object_number.trim(),
      titles: data.titles.filter((t) => t.title.trim()),
      object_name: data.object_name.trim() || null,
      object_type: data.object_type || null,
      classifications: data.classifications.filter((c) => c.term?.trim()),
      object_status: data.object_status,
      other_numbers: data.other_numbers.filter((n) => n.type && n.value.trim()),
      number_of_objects: data.number_of_objects || 1,
      department_id: data.department_id || null,
      brief_description: data.brief_description.trim() || null,
      full_description: data.full_description.trim() || null,
      comments: data.comments.trim() || null,
      distinguishing_features: data.distinguishing_features.trim() || null,
      content_description: data.content_description.trim() || null,
      creation_date_display: data.creation_date_display.trim() || null,
      creation_date_earliest: data.creation_date_earliest || null,
      creation_date_latest: data.creation_date_latest || null,
      creation_place: data.creation_place.trim() || null,
      production_reason: data.production_reason.trim() || null,
      production_note: data.production_note.trim() || null,
      physical_description: data.physical_description.trim() || null,
      color: data.color.trim() || null,
      form: data.form.trim() || null,
      measurements: data.measurements.filter((m) => m.dimension && m.value != null),
      inscriptions: data.inscriptions.filter((i) => i.trim()),
      edition: data.edition.trim() || null,
      copy_number: data.copy_number.trim() || null,
      edition_note: data.edition_note.trim() || null,
      state_number: data.state_number || null,
      total_states: data.total_states || null,
      state_description: data.state_description.trim() || null,
      catalog_level: data.catalog_level || null,
      age: data.age.trim() || null,
      age_qualifier: data.age_qualifier.trim() || null,
      age_unit: data.age_unit || null,
      orientation: data.orientation.trim() || null,
      facture_description: data.facture_description.trim() || null,
      arrangement: data.arrangement.trim() || null,
      installation_instructions: data.installation_instructions.trim() || null,
      watermarks: data.watermarks.length > 0 ? data.watermarks : null,
      technical_attributes: data.technical_attributes.length > 0 ? data.technical_attributes : null,
      depicted_activities: data.depicted_activities.length > 0 ? data.depicted_activities.filter(a => a.trim()) : null,
      depicted_concepts: data.depicted_concepts.length > 0 ? data.depicted_concepts.filter(c => c.trim()) : null,
      associated_concepts: data.associated_concepts.length > 0 ? data.associated_concepts.filter(c => c.trim()) : null,
      condition_note: data.condition_note.trim() || null,
      completeness: data.completeness || null,
      completeness_note: data.completeness_note.trim() || null,
      conservation_priority: data.conservation_priority || null,
      next_condition_check_date: data.next_condition_check_date || null,
      handling_requirements: data.handling_requirements.trim() || null,
      salvage_priority: data.salvage_priority || null,
      hazards: data.hazards.length > 0 ? data.hazards : null,
      environmental_requirements: data.environmental_requirements,
      current_location_id: data.current_location_id || null,
      current_location_fitness: data.current_location_fitness || null,
      current_location_note: data.current_location_note.trim() || null,
      home_location_id: data.home_location_id || null,
      is_discoverable: data.is_discoverable,
      acquisition_method: data.acquisition_method || null,
      acquisition_date: data.acquisition_date || null,
      acquisition_source: data.acquisition_source.trim() || null,
      provenance: data.provenance.trim() || null,
      credit_line: data.credit_line.trim() || null,
      object_history_note: data.object_history_note.trim() || null,
      usage: data.usage.trim() || null,
      usage_note: data.usage_note.trim() || null,
      associated_cultural_affinity: data.associated_cultural_affinity.trim() || null,
      association_note: data.association_note.trim() || null,
      provenance_structured: data.provenance_structured.length > 0 ? data.provenance_structured : null,
      exhibition_history: data.exhibition_history.length > 0 ? data.exhibition_history : null,
      publication_history: data.publication_history.length > 0 ? data.publication_history : null,
      excavation_site: data.excavation_site.trim() || null,
      excavation_date: data.excavation_date.trim() || null,
      field_collection_number: data.field_collection_number.trim() || null,
    };
    // Include last-known updated_at for optimistic concurrency control
    if (serverUpdatedAtRef.current) {
      payload.updated_at = serverUpdatedAtRef.current;
    }
    return payload;
  }, []);

  // Perform save
  const performSave = useCallback(() => {
    const currentData = formDataRef.current;
    if (!currentData || !currentData.object_number.trim()) return;
    setSaveStatus('saving');
    const data = prepareUpdateData(currentData);
    if (isCreateMode) {
      createMutation.mutate(data);
    } else {
      updateMutation.mutate(data);
    }
  }, [prepareUpdateData, isCreateMode, createMutation, updateMutation]);

  // Debounced save
  const debouncedSave = useCallback(() => {
    if (isCreateMode) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => performSave(), 1000);
  }, [isCreateMode, performSave]);

  // Update field with autosave
  const updateField = useCallback(<K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => {
      if (!prev) return null;
      const updated = { ...prev, [field]: value };
      formDataRef.current = updated;
      setHasUnsavedChanges(JSON.stringify(updated) !== originalDataRef.current);
      return updated;
    });
    debouncedSave();
  }, [debouncedSave]);

  // Update field without autosave
  const updateFieldSilent = useCallback(<K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => {
      if (!prev) return null;
      const updated = { ...prev, [field]: value };
      formDataRef.current = updated;
      setHasUnsavedChanges(JSON.stringify(updated) !== originalDataRef.current);
      return updated;
    });
  }, []);

  // Handle field blur — use ref to check for changes since state may not have flushed yet
  const handleFieldBlur = useCallback(() => {
    const isDirty = formDataRef.current && JSON.stringify(formDataRef.current) !== originalDataRef.current;
    if (isDirty || hasUnsavedChanges) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      performSave();
    }
  }, [hasUnsavedChanges, performSave]);

  // Initialize empty form data for create mode
  useEffect(() => {
    if (isCreateMode && !formData) {
      const emptyData: FormData = {
        object_number: '',
        titles: [],
        object_name: '',
        object_type: '',
        classifications: [],
        object_status: 'pending',
        other_numbers: [],
        number_of_objects: 1,
        department_id: null,
        brief_description: '',
        full_description: '',
        comments: '',
        distinguishing_features: '',
        content_description: '',
        creation_date_display: '',
        creation_date_earliest: '',
        creation_date_latest: '',
        creation_place: '',
        production_reason: '',
        production_note: '',
        physical_description: '',
        color: '',
        form: '',
        measurements: [],
        inscriptions: [],
        edition: '',
        copy_number: '',
        edition_note: '',
        state_number: null,
        total_states: null,
        state_description: '',
        catalog_level: '',
        age: '',
        age_qualifier: '',
        age_unit: '',
        orientation: '',
        facture_description: '',
        arrangement: '',
        installation_instructions: '',
        watermarks: [],
        technical_attributes: [],
        depicted_activities: [],
        depicted_concepts: [],
        associated_concepts: [],
        condition_note: '',
        completeness: '',
        completeness_note: '',
        conservation_priority: '',
        next_condition_check_date: '',
        handling_requirements: '',
        salvage_priority: '',
        hazards: [],
        environmental_requirements: null,
        current_location_id: null,
        current_location_fitness: '',
        current_location_note: '',
        home_location_id: null,
        is_discoverable: false,
        acquisition_method: '',
        acquisition_date: '',
        acquisition_source: '',
        provenance: '',
        credit_line: '',
        object_history_note: '',
        usage: '',
        usage_note: '',
        associated_cultural_affinity: '',
        association_note: '',
        provenance_structured: [],
        exhibition_history: [],
        publication_history: [],
        excavation_site: '',
        excavation_date: '',
        field_collection_number: '',
      };
      setFormData(emptyData);
      formDataRef.current = emptyData;
      originalDataRef.current = JSON.stringify(emptyData);
    }
  }, [isCreateMode, formData]);

  // Initialize form data when entering edit mode
  useEffect(() => {
    if (object && isEditing && !formData && !isCreateMode) {
      const data: FormData = {
        object_number: object.object_number || '',
        titles: object.titles || [],
        object_name: object.object_name || '',
        object_type: object.object_type || '',
        classifications: object.classifications || [],
        object_status: object.object_status || 'active',
        other_numbers: object.other_numbers || [],
        number_of_objects: object.number_of_objects ?? 1,
        department_id: object.department_id ?? null,
        brief_description: object.brief_description || '',
        full_description: object.full_description || '',
        comments: object.comments || '',
        distinguishing_features: object.distinguishing_features || '',
        content_description: object.content_description || '',
        creation_date_display: object.creation_date_display || '',
        creation_date_earliest: object.creation_date_earliest || '',
        creation_date_latest: object.creation_date_latest || '',
        creation_place: object.creation_place || '',
        production_reason: object.production_reason || '',
        production_note: object.production_note || '',
        physical_description: object.physical_description || '',
        color: object.color || '',
        form: object.form || '',
        measurements: object.measurements || [],
        inscriptions: object.inscriptions || [],
        edition: object.edition || '',
        copy_number: object.copy_number || '',
        edition_note: object.edition_note || '',
        state_number: object.state_number ?? null,
        total_states: object.total_states ?? null,
        state_description: object.state_description || '',
        catalog_level: object.catalog_level || '',
        age: object.age || '',
        age_qualifier: object.age_qualifier || '',
        age_unit: object.age_unit || '',
        orientation: object.orientation || '',
        facture_description: object.facture_description || '',
        arrangement: object.arrangement || '',
        installation_instructions: object.installation_instructions || '',
        watermarks: object.watermarks || [],
        technical_attributes: object.technical_attributes || [],
        depicted_activities: object.depicted_activities || [],
        depicted_concepts: object.depicted_concepts || [],
        associated_concepts: object.associated_concepts || [],
        condition_note: object.condition_note || '',
        completeness: object.completeness || '',
        completeness_note: object.completeness_note || '',
        conservation_priority: object.conservation_priority || '',
        next_condition_check_date: object.next_condition_check_date || '',
        handling_requirements: object.handling_requirements || '',
        salvage_priority: object.salvage_priority || '',
        hazards: object.hazards || [],
        environmental_requirements: object.environmental_requirements || null,
        current_location_id: object.current_location_id || null,
        current_location_fitness: object.current_location_fitness || '',
        current_location_note: object.current_location_note || '',
        home_location_id: object.home_location_id || null,
        is_discoverable: object.is_discoverable ?? false,
        acquisition_method: object.acquisition_method || '',
        acquisition_date: object.acquisition_date || '',
        acquisition_source: object.acquisition_source || '',
        provenance: object.provenance || '',
        credit_line: object.credit_line || '',
        object_history_note: object.object_history_note || '',
        usage: object.usage || '',
        usage_note: object.usage_note || '',
        associated_cultural_affinity: object.associated_cultural_affinity || '',
        association_note: object.association_note || '',
        provenance_structured: object.provenance_structured || [],
        exhibition_history: object.exhibition_history || [],
        publication_history: object.publication_history || [],
        excavation_site: object.excavation_site || '',
        excavation_date: object.excavation_date || '',
        field_collection_number: object.field_collection_number || '',
      };
      setFormData(data);
      formDataRef.current = data;
      originalDataRef.current = JSON.stringify(data);
      // Track server timestamp for conflict detection
      serverUpdatedAtRef.current = object.updated_at || null;
    }
  }, [object, isEditing, formData, isCreateMode]);

  // Reset form data when exiting edit mode
  useEffect(() => {
    if (!isEditing) {
      setFormData(null);
      formDataRef.current = null;
      setHasUnsavedChanges(false);
      setSaveStatus('idle');
    }
  }, [isEditing]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  return {
    formData,
    saveStatus,
    errorMessage,
    setErrorMessage,
    lastSaved,
    hasUnsavedChanges,
    updateField,
    updateFieldSilent,
    handleFieldBlur,
    performSave,
  };
}

/**
 * Data needed for smart auto-expand computation
 */
export interface SmartExpandData {
  linkedMedia?: LinkedMediaItem[];
  valuationsData?: Valuation[];
  rightsData?: any[];
}

/**
 * Custom hook for section state management
 */
export function useSectionState(
  object: CollectionObject | undefined,
  isCreateMode: boolean,
  smartExpandData?: SmartExpandData,
) {
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const initialExpandAppliedRef = useRef(false);

  const unified = useUnifiedSectionState({
    sectionGroups: SECTION_GROUPS,
    groupOrder: GROUP_ORDER,
    initialExpandedSections: INITIAL_EXPANDED_SECTIONS,
  });

  const {
    expandedSections,
    setExpandedSections,
    raisedSectionId,
    lowerAllSections,
    getSectionOrder: unifiedGetSectionOrder,
  } = unified;

  // Smart auto-expand: open Identification + any required-missing sections on first load
  useEffect(() => {
    if (initialExpandAppliedRef.current || isCreateMode || !object) return;
    initialExpandAppliedRef.current = true;

    const state = { ...INITIAL_EXPANDED_SECTIONS };
    state.identification = true;

    // Check for required-missing sections
    if (smartExpandData) {
      const sectionData = buildSectionDataMap(object, smartExpandData);
      for (const group of PAGE_SECTION_GROUPS) {
        for (const section of group.sections) {
          const data = sectionData[section.dataKey];
          const status = computeSectionIndicator(data, {
            isRequired: section.isRequired,
            requiredFields: section.requiredFields,
          });
          if (status === 'required-missing') {
            state[section.id] = true;
          }
        }
      }
    }

    setExpandedSections(state);
  }, [object, isCreateMode, smartExpandData, setExpandedSections]);

  // Get CSS order value for a section (with fallback to DEFAULT_SECTION_ORDER)
  const getSectionOrder = useCallback((sectionId: string): number => {
    const result = unifiedGetSectionOrder(sectionId);
    if (result !== undefined) return result;

    const groupId = SECTION_GROUPS[sectionId];
    if (!groupId) return 999;
    const groupOffset = GROUP_ORDER.indexOf(groupId) * 100;
    return groupOffset + (DEFAULT_SECTION_ORDER[sectionId] ?? 50);
  }, [unifiedGetSectionOrder]);

  // Section IDs for navigation — derived from config, filtered by mode
  const sectionIds = useMemo(() => {
    if (isCreateMode) {
      return ALL_SECTION_IDS.filter(id => !CREATE_MODE_EXCLUDE.includes(id));
    }
    return [...ALL_SECTION_IDS];
  }, [isCreateMode]);

  // Raise a section — extra params are consumed by index.tsx wrapper for edit mode entry
  const raiseSection = useCallback((sectionId: string, isEditing: boolean, isCreateMode: boolean, canEdit: boolean, setIsEditing: (v: boolean) => void, setSearchParams: (p: any, o?: any) => void) => {
    // Use lowerAllSections for the previously raised section, then raise the new one
    unified.handleEnterEditMode(sectionId);

    if (!isEditing && !isCreateMode && canEdit) {
      setIsEditing(true);
      setSearchParams({ mode: 'edit' }, { replace: true });
    }
  }, [unified]);

  // Toggle section — delegates to the unified hook but accepts a raise callback for compat
  const toggleSection = useCallback((sectionId: string, raiseFn: (id: string) => void) => {
    const isCurrentlyExpanded = expandedSections[sectionId];

    if (isCurrentlyExpanded) {
      setExpandedSections(prev => ({
        ...prev,
        [sectionId]: false,
      }));
      lowerAllSections();
    } else {
      setExpandedSections(prev => {
        const newState: Record<string, boolean> = {};
        Object.keys(prev).forEach(key => {
          newState[key] = key === sectionId;
        });
        return newState;
      });
      raiseFn(sectionId);
    }
  }, [expandedSections, lowerAllSections, setExpandedSections]);

  return {
    expandedSections,
    setExpandedSections,
    raisedSectionId,
    sectionRefs,
    getSectionOrder,
    sectionIds,
    lowerAllSections,
    raiseSection,
    toggleSection,
  };
}

/**
 * Build a section data map for completeness computation (used by smart auto-expand)
 */
function buildSectionDataMap(
  object: CollectionObject,
  data: SmartExpandData,
): Record<string, unknown> {
  return {
    media: data.linkedMedia || [],
    identification: {
      object_number: object.object_number,
      titles: object.titles,
    },
    description: {
      brief_description: object.brief_description,
      full_description: object.full_description,
    },
    physical_description: {
      material_count: object.material_count || 0,
      technique_count: object.technique_count || 0,
      measurements: object.measurements,
    },
    styles_periods: object.style_periods || [],
    subjects: object.subjects || [],
    people: object.constituents || [],
    places: object.place_authorities || [],
    related_objects: object.related_objects || [],
    citations: object.citations || [],
    events: [],
    condition: {
      condition_note: object.condition_note,
      completeness: object.completeness,
    },
    location: {
      current_location_id: object.current_location_id,
      home_location_id: object.home_location_id,
    },
    rights: data.rightsData || [],
    nagpra: {},
    acquisition: {
      acquisition_method: object.acquisition_method,
      acquisition_date: object.acquisition_date,
    },
    valuations: data.valuationsData || [],
    procedures: [],
    parts: object.parts || [],
    history: { exists: true },
  };
}

/**
 * Custom hook for computing rich section summaries (replaces useSectionHints)
 */
export function useSectionSummaries(
  object: CollectionObject | undefined,
  linkedMedia: LinkedMediaItem[],
  valuationsData: Valuation[] | undefined,
  proceduresData: any,
  rightsData: any[] | undefined,
): Record<string, string | undefined> {
  return useMemo(() => {
    const obj = object;
    if (!obj) return {};

    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

    // Identification: type · number · status
    const idParts = [
      obj.object_type ? capitalize(obj.object_type) : null,
      obj.object_number,
      obj.object_status ? capitalize(obj.object_status) : null,
    ].filter(Boolean);
    const identification = idParts.length > 0 ? idParts.join(' \u00b7 ') : undefined;

    // Description: first ~60 chars of brief_description
    const description = obj.brief_description
      ? obj.brief_description.length > 60
        ? obj.brief_description.slice(0, 60) + '\u2026'
        : obj.brief_description
      : undefined;

    // Physical: material count · technique count · dimensions
    const physParts: string[] = [];
    if (obj.material_count) physParts.push(`${obj.material_count} material${obj.material_count > 1 ? 's' : ''}`);
    if (obj.technique_count) physParts.push(`${obj.technique_count} technique${obj.technique_count > 1 ? 's' : ''}`);
    if (obj.measurements?.length) {
      const dims = obj.measurements.map(m => `${m.value} ${m.unit || ''}`).join(' \u00d7 ');
      physParts.push(dims);
    }
    const physical = physParts.length > 0 ? physParts.join(' \u00b7 ') : undefined;

    // Media
    const mediaCount = linkedMedia.length;
    const media = mediaCount > 0 ? `${mediaCount} image${mediaCount !== 1 ? 's' : ''}` : undefined;

    // People (exclude 'depicted' role — those show under Subjects)
    const nonDepictedConstituents = obj.constituents?.filter((c: any) => c.role !== 'depicted') || [];
    const peopleCount = nonDepictedConstituents.length + (obj.person_authorities?.length || 0);
    const people = peopleCount > 0 ? `${peopleCount} linked` : undefined;

    // Places
    const placesCount = obj.place_authorities?.length || 0;
    const places = placesCount > 0 ? `${placesCount} linked` : undefined;

    // Subjects — count comes from SubjectLinker (via onCountChange), not obj.subjects
    const subjects = undefined;

    // Style Periods
    const periodsCount = obj.style_periods?.length || 0;
    const stylePeriods = periodsCount > 0 ? `${periodsCount} period${periodsCount !== 1 ? 's' : ''}` : undefined;

    // Related Objects
    const relatedCount = obj.related_objects?.length || 0;
    const relationships = relatedCount > 0 ? `${relatedCount} related` : undefined;

    // Citations
    const citationsCount = obj.citations?.length || 0;
    const citations = citationsCount > 0 ? `${citationsCount} citation${citationsCount !== 1 ? 's' : ''}` : undefined;

    // Parts
    const partsCount = obj.parts?.length || 0;
    const parts = partsCount > 1 ? `${partsCount} parts` : undefined;

    // Acquisition
    const acqParts: string[] = [];
    if (obj.acquisition_method) acqParts.push(capitalize(obj.acquisition_method));
    if (obj.acquisition_date) {
      try {
        acqParts.push(new Date(obj.acquisition_date).getFullYear().toString());
      } catch { /* ignore invalid dates */ }
    }
    const acquisition = acqParts.length > 0 ? acqParts.join(' \u00b7 ') : undefined;

    // Valuations
    let valuations: string | undefined;
    if (valuationsData?.length) {
      const current = valuationsData.find((v: Valuation) => v.is_current);
      if (current) {
        valuations = formatCurrency(current.valuation_amount, current.valuation_currency || 'USD', 0);
      } else {
        valuations = `${valuationsData.length} valuation${valuationsData.length !== 1 ? 's' : ''}`;
      }
    }

    // Condition
    const conditionReports = proceduresData?.condition_reports || [];
    let condition = 'No assessment';
    if (conditionReports.length > 0) {
      const sorted = [...conditionReports].sort((a: any, b: any) => {
        return (b.report_date ? new Date(b.report_date).getTime() : 0) -
               (a.report_date ? new Date(a.report_date).getTime() : 0);
      });
      const latestDate = sorted[0]?.report_date;
      if (latestDate) {
        condition = `Last: ${formatDateShort(latestDate)}`;
      }
    }

    // Rights
    const rights = rightsData || [];
    const unresolvedStatuses = ['unknown', 'requested', 'orphan', 'disputed'];
    const unresolvedCount = rights.filter((r: any) => unresolvedStatuses.includes(r.status)).length;
    const rightsHint = unresolvedCount > 0
      ? `${unresolvedCount} unresolved`
      : rights.length > 0
        ? `${rights.length} right${rights.length !== 1 ? 's' : ''}`
        : undefined;

    // Location
    let location = 'Location unknown';
    if (obj.current_location) {
      location = `Current: ${obj.current_location.path || obj.current_location.name}`;
    } else if ((obj.parts?.length || 0) > 1) {
      const located = obj.parts!.filter(p => p.current_location_id).length;
      location = `${located}/${obj.parts!.length} parts located`;
    }

    return {
      identification,
      description,
      physical,
      media,
      people,
      places,
      subjects,
      stylePeriods,
      relationships,
      citations,
      parts,
      acquisition,
      valuations,
      condition,
      rights: rightsHint,
      location,
    };
  }, [object, linkedMedia, valuationsData, proceduresData, rightsData]);
}

/**
 * Custom hook for checking if sections have content (extended to all sections)
 */
export function useHasContent(
  object: CollectionObject | undefined,
  linkedMedia?: LinkedMediaItem[],
  valuationsData?: Valuation[],
  rightsData?: any[],
) {
  return useMemo(() => {
    const obj = object;
    return {
      media: (linkedMedia?.length || 0) > 0,
      identification: true, // always has content (object_number required)
      description: !!(obj?.brief_description || obj?.full_description || obj?.comments || obj?.distinguishing_features || obj?.content_description),
      physical: !!(obj?.material_count || obj?.technique_count || obj?.measurements?.length || obj?.inscriptions?.length || obj?.physical_description || obj?.color || obj?.form || obj?.edition || obj?.state_number),
      stylePeriods: (obj?.style_periods?.length || 0) > 0,
      subjects: (obj?.subjects?.length || 0) > 0 || (obj?.depicted_activities?.length || 0) > 0 || (obj?.depicted_concepts?.length || 0) > 0 || (obj?.associated_concepts?.length || 0) > 0,
      people: (obj?.constituents?.length || 0) > 0 || (obj?.person_authorities?.length || 0) > 0,
      places: (obj?.place_authorities?.length || 0) > 0,
      relationships: (obj?.related_objects?.length || 0) > 0,
      citations: (obj?.citations?.length || 0) > 0,
      events: false, // self-fetched by ObjectEventLinker
      condition: !!(obj?.condition_note || obj?.completeness || obj?.handling_requirements),
      location: !!(obj?.current_location_id || obj?.home_location_id),
      rights: (rightsData?.length || 0) > 0,
      nagpra: false, // self-fetched by NagpraManager
      acquisition: !!(obj?.acquisition || obj?.acquisition_method || obj?.acquisition_date || obj?.provenance || obj?.credit_line || obj?.object_history_note || obj?.usage || obj?.excavation_site),
      valuations: (valuationsData?.length || 0) > 0,
      procedures: false, // self-fetched by RelatedProcedures
      parts: (obj?.parts?.length || 0) > 1,
      history: true, // always has content
    };
  }, [object, linkedMedia, valuationsData, rightsData]);
}
