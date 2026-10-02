import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import { getEvent, createEvent, updateEvent, deleteEvent, addEventObject } from '../../../lib/api';
import { logger } from '../../../lib/logger';
import type { PendingEventObject } from '../../../components/collections/EventObjectLinker';
import { validateCreateForm } from '../../../lib/formValidation';
import type { SaveStatus, FormData } from './types';
import { defaultFormData, SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS } from './types';

// =============================================================================
// useFormState
// =============================================================================

interface UseFormStateParams {
  orgId: string | undefined;
  eventId: string | undefined;
  isCreateMode: boolean;
  event: Record<string, unknown> | undefined;
}

export function useFormState({ orgId, eventId, isCreateMode }: UseFormStateParams) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<FormData>({ ...defaultFormData });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef<FormData>(formData);

  // Pending objects for create mode (linked after event is created)
  const [pendingObjects, setPendingObjects] = useState<PendingEventObject[]>([]);

  // Fetch event data (if editing)
  const { data: event, isLoading, error } = useQuery({
    queryKey: ['event', orgId, eventId],
    queryFn: () => getEvent(orgId!, eventId!),
    enabled: !!orgId && !!eventId && !isCreateMode,
  });

  // Initialize form data from fetched event
  useEffect(() => {
    if (event) {
      const data: FormData = {
        title: event.title || '',
        event_type: event.event_type || 'program',
        status: event.status || 'draft',
        start_at: event.start_at ? event.start_at.slice(0, 16) : '',
        end_at: event.end_at ? event.end_at.slice(0, 16) : '',
        location_id: event.location_id || '',
        course_code: event.course_code || '',
        instructor_id: event.instructor_id || '',
        department: event.department || '',
        institution: event.institution || '',
        headcount: event.headcount?.toString() || '',
        session_format: event.session_format || '',
        audience: event.audience || '',
        capacity: event.capacity?.toString() || '',
        registration_url: event.registration_url || '',
        description: event.description || '',
        notes: event.notes || '',
      };
      setFormData(data);
      formDataRef.current = data;
      originalDataRef.current = JSON.stringify(data);
    }
  }, [event]);

  // Prepare payload for API
  const preparePayload = useCallback((data: FormData) => {
    return {
      title: data.title,
      event_type: data.event_type,
      status: data.status,
      start_at: data.start_at || null,
      end_at: data.end_at || null,
      location_id: data.location_id || null,
      course_code: data.course_code || null,
      instructor_id: data.instructor_id || null,
      department: data.department || null,
      institution: data.institution || null,
      headcount: data.headcount ? parseInt(data.headcount) : null,
      session_format: data.session_format || null,
      audience: data.audience || null,
      capacity: data.capacity ? parseInt(data.capacity) : null,
      registration_url: data.registration_url || null,
      description: data.description || null,
      notes: data.notes || null,
    };
  }, []);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createEvent(orgId!, data),
    onSuccess: async (result) => {
      // Link any pending objects to the newly created event
      if (pendingObjects.length > 0) {
        try {
          await Promise.all(
            pendingObjects.map((obj) =>
              addEventObject(orgId!, result.event_id, {
                object_id: obj.object_id,
                role: obj.role,
                planned_use: obj.planned_use,
              })
            )
          );
        } catch (err) {
          logger.error('Failed to link some objects:', err);
        }
      }

      setSaveStatus('saved');
      setHasUnsavedChanges(false);
      queryClient.invalidateQueries({ queryKey: ['events', orgId] });
      navigate(`/organizations/${orgId}/collections/events/${result.event_id}`);
    },
    onError: () => {
      setSaveStatus('error');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateEvent(orgId!, eventId!, data),
    onSuccess: () => {
      setSaveStatus('saved');
      setLastSaved(new Date());
      originalDataRef.current = JSON.stringify(formDataRef.current);
      setHasUnsavedChanges(false);
      queryClient.invalidateQueries({ queryKey: ['event', orgId, eventId] });
      queryClient.invalidateQueries({ queryKey: ['events', orgId] });
    },
    onError: () => {
      setSaveStatus('error');
    },
  });

  // Status mutation (separate for workflow actions)
  const statusMutation = useMutation({
    mutationFn: (status: 'draft' | 'scheduled' | 'completed' | 'cancelled') => updateEvent(orgId!, eventId!, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', orgId, eventId] });
      queryClient.invalidateQueries({ queryKey: ['events', orgId] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteEvent(orgId!, eventId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', orgId] });
      navigate(`/organizations/${orgId}/collections/events`);
    },
  });

  // Perform save
  const performSave = useCallback(() => {
    if (!hasUnsavedChanges) return;

    setSaveStatus('saving');
    const payload = preparePayload(formDataRef.current);

    if (isCreateMode) {
      createMutation.mutate(payload);
    } else {
      updateMutation.mutate(payload);
    }
  }, [hasUnsavedChanges, isCreateMode, preparePayload, createMutation, updateMutation]);

  // Debounced save (1000ms)
  const debouncedSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (hasUnsavedChanges && !isCreateMode) {
        performSave();
      }
    }, 1000);
  }, [hasUnsavedChanges, isCreateMode, performSave]);

  // Update form field
  const updateField = useCallback(
    <K extends keyof FormData>(field: K, value: FormData[K]) => {
      setFormData((prev) => {
        const next = { ...prev, [field]: value };
        formDataRef.current = next;
        const hasChanges = JSON.stringify(next) !== originalDataRef.current;
        setHasUnsavedChanges(hasChanges);
        if (hasChanges) {
          setSaveStatus('idle');
        }
        return next;
      });
      if (!isCreateMode) {
        debouncedSave();
      }
    },
    [isCreateMode, debouncedSave]
  );

  // Handle create
  const handleCreateSave = useCallback(() => {
    const validationError = validateCreateForm(formData as unknown as Record<string, unknown>, [
      { field: 'title', label: 'Title', check: 'required' },
    ]);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setSaveStatus('saving');
    setErrorMessage(null);
    createMutation.mutate(preparePayload(formData));
  }, [formData, preparePayload, createMutation]);

  // Prevent unsaved changes loss
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

  return {
    formData,
    updateField,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    event,
    isLoading,
    error,
    queryClient,
    performSave,
    handleCreateSave,
    statusMutation,
    deleteMutation,
    pendingObjects,
    setPendingObjects,
  };
}

// =============================================================================
// useSectionState — thin wrapper around useUnifiedSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  eventId: string | undefined;
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
  eventId,
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
      basePath: `/organizations/${orgId}/collections/events/${eventId}`,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      hasUnsavedChanges,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['event', orgId, eventId] }),
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
      details: parts([formData.event_type, formData.title ? truncate(formData.title) : undefined, formData.start_at ? formData.start_at.slice(0, 10) : undefined]),
      teaching: parts([formData.course_code, formData.institution, formData.session_format]),
      program: parts([formData.audience, formData.capacity ? `Cap: ${formData.capacity}` : undefined]),
      objects: undefined, // self-managed by EventObjectLinker
      impact: undefined,
      discussion: undefined,
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
    details: !!(formData.title || formData.event_type || formData.start_at || formData.end_at || formData.description),
    teaching: !!(formData.course_code || formData.instructor_id || formData.institution || formData.department || formData.headcount || formData.session_format),
    program: !!(formData.audience || formData.capacity || formData.registration_url),
    objects: false, // self-fetched by EventObjectLinker
    impact: false, // self-fetched by EventCollectionsImpact
    discussion: false, // self-fetched by RecordDiscussionTab
    notes: !!formData.notes,
    history: true,
  }), [formData]);
}
