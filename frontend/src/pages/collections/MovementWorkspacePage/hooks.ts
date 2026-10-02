import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUnifiedSectionState } from '../../../hooks/useUnifiedSectionState';
import {
  getMovement,
  createMovement,
  updateMovement,
  deleteMovement,
  getCollectionObject,
  getContact,
} from '../../../lib/api';
import { formatErrorMessage } from '../../../lib/formErrors';
import { logger } from '../../../lib/logger';
import type { MovementFormData, SaveStatus } from './types';
import { SECTION_GROUPS, GROUP_ORDER, INITIAL_EXPANDED_SECTIONS } from './types';
import { DEFAULT_FORM_DATA } from './constants';

// =============================================================================
// useSectionState
// =============================================================================

interface UseSectionStateParams {
  orgId: string | undefined;
  movementId: string | undefined;
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
  movementId,
  isCreateMode,
  isEditing,
  setIsEditing,
  canEdit,
  hasUnsavedChanges,
  performSave,
  queryClient,
}: UseSectionStateParams) {
  const basePath = `/organizations/${orgId}/collections/movements/${movementId}`;

  const {
    expandedSections,
    raisedSectionId,
    getSectionOrder,
    toggleSection,
    handleToggleMode,
    handleEnterEditMode,
  } = useUnifiedSectionState({
    sectionGroups: SECTION_GROUPS,
    groupOrder: GROUP_ORDER,
    initialExpandedSections: INITIAL_EXPANDED_SECTIONS,
    editMode: {
      basePath,
      isEditing,
      setIsEditing,
      canEdit,
      isCreateMode,
      onSaveBeforeExit: performSave,
      onExitEditMode: () => queryClient.invalidateQueries({ queryKey: ['movement', orgId, movementId] }),
      hasUnsavedChanges,
    },
  });

  return {
    expandedSections,
    raisedSectionId,
    getSectionOrder,
    toggleSection,
    handleToggleMode,
    handleEnterEditMode,
  };
}

// =============================================================================
// useMovementForm
// =============================================================================

export function useMovementForm(
  orgId: string | undefined,
  movementId: string | undefined,
  isCreateMode: boolean,
  initialObjectId: string,
  initialToLocationId: string
) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<MovementFormData>({
    ...DEFAULT_FORM_DATA,
    object_id: initialObjectId,
    to_location_id: initialToLocationId,
  });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  const [selectedObjectLocationId, setSelectedObjectLocationId] = useState<string | null>(null);

  // Fetch existing movement
  const { data: existingMovement, isLoading, error } = useQuery({
    queryKey: ['movement', orgId, movementId],
    queryFn: () => getMovement(orgId!, movementId!),
    enabled: !isCreateMode && !!orgId && !!movementId,
  });

  // Fetch object info for create mode
  const { data: initialObjectData } = useQuery({
    queryKey: ['collection-object', orgId, initialObjectId],
    queryFn: () => getCollectionObject(orgId!, initialObjectId),
    enabled: !!orgId && !!initialObjectId && isCreateMode,
  });

  // Handler contact
  const { data: handlerContact } = useQuery({
    queryKey: ['contact', orgId, formData.handler_id],
    queryFn: () => getContact(orgId!, formData.handler_id),
    enabled: !!orgId && !!formData.handler_id,
  });

  // Authorizer contact
  const { data: authorizerContact } = useQuery({
    queryKey: ['contact', orgId, formData.authorizer_id],
    queryFn: () => getContact(orgId!, formData.authorizer_id),
    enabled: !!orgId && !!formData.authorizer_id,
  });

  // Shipper contact
  const { data: shipperContact } = useQuery({
    queryKey: ['contact', orgId, formData.shipper_id],
    queryFn: () => getContact(orgId!, formData.shipper_id),
    enabled: !!orgId && !!formData.shipper_id,
  });

  // Set from_location from initial object
  useEffect(() => {
    if (initialObjectData && isCreateMode) {
      const currentLocationId = initialObjectData.current_location_id || null;
      setSelectedObjectLocationId(currentLocationId);
      if (currentLocationId) {
        setFormData(prev => ({ ...prev, from_location_id: currentLocationId }));
      }
    }
  }, [initialObjectData, isCreateMode]);

  // Load existing data
  useEffect(() => {
    if (existingMovement) {
      const data: MovementFormData = {
        object_id: existingMovement.object_id || '',
        reason: existingMovement.reason || 'storage',
        from_location_id: existingMovement.from_location_id || '',
        to_location_id: existingMovement.to_location_id || '',
        movement_date: existingMovement.movement_date?.split('T')[0] || '',
        status: existingMovement.status || 'completed',
        movement_note: existingMovement.movement_note || '',
        handler_id: existingMovement.handler_id || '',
        handler_name: existingMovement.handler_name || '',
        // Authorization
        authorizer_id: existingMovement.authorizer_id || '',
        authorization_date: existingMovement.authorization_date || '',
        authorization_note: existingMovement.authorization_note || '',
        // Shipping & Courier
        movement_method: existingMovement.movement_method || '',
        organization_courier: existingMovement.organization_courier ?? false,
        courier_name: existingMovement.courier_name || '',
        shipper_id: existingMovement.shipper_id || '',
        shipper_name: existingMovement.shipper_name || '',
        shipping_method: existingMovement.shipping_method || '',
        shipping_tracking_number: existingMovement.shipping_tracking_number || '',
        shipping_insurance_value: existingMovement.shipping_insurance_value || '',
        shipping_insurance_currency: existingMovement.shipping_insurance_currency || '',
        shipping_note: existingMovement.shipping_note || '',
        // Condition
        condition_note: existingMovement.condition_note || '',
        condition_report_id: existingMovement.condition_report_id || '',
        // Planning
        location_fitness: existingMovement.location_fitness || '',
        planned_removal_date: existingMovement.planned_removal_date || '',
        planned_return_date: existingMovement.planned_return_date || '',
      };
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
    }
  }, [existingMovement]);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createMovement(orgId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['collection-movements', orgId] });
      navigate(`/organizations/${orgId}/collections/movements/${result.movement_id}`);
    },
    onError: (err: Error) => {
      setErrorMessage(formatErrorMessage(err.message, 'movement'));
      setSaveStatus('error');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateMovement(orgId!, movementId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection-movements', orgId] });
      queryClient.invalidateQueries({ queryKey: ['movement', orgId, movementId] });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (err: Error) => {
      setErrorMessage(formatErrorMessage(err.message, 'movement'));
      setSaveStatus('error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMovement(orgId!, movementId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collection-movements', orgId] });
      navigate(`/organizations/${orgId}/collections/movements`);
    },
  });

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    return {
      object_id: fd.object_id,
      reason: fd.reason,
      from_location_id: fd.from_location_id || null,
      to_location_id: fd.to_location_id,
      movement_date: fd.movement_date || null,
      status: fd.status,
      movement_note: fd.movement_note || null,
      handler_id: fd.handler_id || null,
      // Authorization
      authorizer_id: fd.authorizer_id || null,
      authorization_date: fd.authorization_date || null,
      authorization_note: fd.authorization_note || null,
      // Shipping & Courier
      movement_method: fd.movement_method || null,
      organization_courier: fd.organization_courier,
      courier_name: fd.courier_name || null,
      shipper_id: fd.shipper_id || null,
      shipper_name: fd.shipper_name || null,
      shipping_method: fd.shipping_method || null,
      shipping_tracking_number: fd.shipping_tracking_number || null,
      shipping_insurance_value: fd.shipping_insurance_value || null,
      shipping_insurance_currency: fd.shipping_insurance_currency || null,
      shipping_note: fd.shipping_note || null,
      // Condition
      condition_note: fd.condition_note || null,
      condition_report_id: fd.condition_report_id || null,
      // Planning
      location_fitness: fd.location_fitness || null,
      planned_removal_date: fd.planned_removal_date || null,
      planned_return_date: fd.planned_return_date || null,
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

  const handleCreateSave = useCallback(() => {
    if (!formDataRef.current.object_id || !formDataRef.current.to_location_id) {
      setErrorMessage('Object and destination location are required');
      return;
    }
    setSaveStatus('saving');
    setErrorMessage(null);
    createMutation.mutate(buildPayload());
  }, [createMutation, buildPayload]);

  const updateField = useCallback((field: string, value: string | boolean) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      const hasChanges = JSON.stringify(next) !== originalDataRef.current;
      setHasUnsavedChanges(hasChanges);
      return next;
    });

    if (!isCreateMode) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        triggerSave();
      }, 1000);
    }
  }, [isCreateMode, triggerSave]);

  const handleObjectChange = useCallback(async (objectId: string | null) => {
    setFormData(prev => ({ ...prev, object_id: objectId || '' }));
    setHasUnsavedChanges(true);

    if (objectId && isCreateMode) {
      try {
        const objectData = await getCollectionObject(orgId!, objectId);
        const currentLocationId = objectData.current_location_id || null;
        setSelectedObjectLocationId(currentLocationId);
        if (currentLocationId) {
          setFormData(prev => ({ ...prev, from_location_id: currentLocationId }));
        }
      } catch (err) {
        logger.error('Failed to fetch object location:', err);
      }
    }
  }, [orgId, isCreateMode]);

  // Warn about unsaved changes
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
    setFormData,
    updateField,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    existingMovement,
    isLoading,
    error,
    handlerContact,
    authorizerContact,
    shipperContact,
    selectedObjectLocationId,
    queryClient,
    triggerSave,
    handleCreateSave,
    handleObjectChange,
    createMutation,
    updateMutation,
    deleteMutation,
  };
}
