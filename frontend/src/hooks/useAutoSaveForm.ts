import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Blocker } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatErrorMessage } from '../lib/formErrors';
import { useUnsavedGuard } from './useUnsavedGuard';

/**
 * Generic autosave form hook for workspace pages.
 *
 * Consolidates the duplicated ~100-line form state pattern found in 20+ workspace pages
 * into a single reusable hook. Handles hydration, dirty detection, debounced/blur-based
 * autosave, beforeunload warnings, create/delete flows, and cache invalidation.
 *
 * @example
 * const form = useAutoSaveForm<FormData, ServerData>({
 *   defaultFormData: { title: '', status: 'draft' },
 *   hydrate: (server) => ({ title: server.title || '', status: server.status || 'draft' }),
 *   buildPayload: (fd) => ({ title: fd.title || null, status: fd.status }),
 *   serverData: query.data,
 *   api: { create: createLoan, update: updateLoan, delete: deleteLoan },
 *   orgId, entityId: loanId, isCreateMode,
 *   queryKeys: { entity: ['loan-in', orgId, loanId], collection: ['loans-in', orgId] },
 *   paths: {
 *     afterCreate: (r) => `/organizations/${orgId}/collections/loans-in/${r.loan_id}`,
 *     afterDelete: `/organizations/${orgId}/collections/loans-in`,
 *   },
 * });
 */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type SaveStrategy = 'debounce' | 'blur';

export interface UseAutoSaveFormOptions<
  TForm extends Record<string, unknown>,
  TServer,
> {
  /** Default/initial form data for create mode */
  defaultFormData: TForm;

  /** Transform server data to form data (hydration) */
  hydrate: (serverData: TServer) => TForm;

  /** Transform form data to API payload */
  buildPayload: (formData: TForm) => Record<string, unknown>;

  /** Server data from useQuery (undefined while loading or in create mode) */
  serverData: TServer | undefined;

  /** API functions */
  api: {
    create: (orgId: string, payload: Record<string, unknown>) => Promise<unknown>;
    update: (
      orgId: string,
      entityId: string,
      payload: Record<string, unknown>,
    ) => Promise<unknown>;
    delete?: (orgId: string, entityId: string) => Promise<unknown>;
  };

  /** Organization ID */
  orgId: string | undefined;

  /** Entity ID (undefined in create mode) */
  entityId: string | undefined;

  /** Whether we're creating a new record */
  isCreateMode: boolean;

  /** Query keys for cache invalidation */
  queryKeys: {
    entity: (string | undefined)[];
    collection: (string | undefined)[];
  };

  /** Navigation paths */
  paths: {
    afterCreate: (result: unknown) => string;
    afterDelete: string;
  };

  /** Save strategy: 'debounce' (default) or 'blur' (save on field blur) */
  saveStrategy?: SaveStrategy;

  /** Debounce delay in ms (default 1000) — only used with 'debounce' strategy */
  debounceMs?: number;

  /** Optional validation before create — return error message or null */
  validateCreate?: (formData: TForm) => string | null;

  /** Entity label for error messages (e.g., 'loan', 'insurance policy') */
  entityLabel?: string;
}

export interface UseAutoSaveFormReturn<TForm> {
  formData: TForm;
  setFormData: React.Dispatch<React.SetStateAction<TForm>>;
  /** Type-safe field update that triggers autosave */
  updateField: <K extends keyof TForm>(field: K, value: TForm[K]) => void;
  /** Update field without triggering autosave (for intermediate states) */
  updateFieldSilent: <K extends keyof TForm>(field: K, value: TForm[K]) => void;
  hasUnsavedChanges: boolean;
  saveStatus: SaveStatus;
  lastSaved: Date | null;
  errorMessage: string | null;
  setErrorMessage: (msg: string | null) => void;
  /** Manually trigger a save (for edit-mode exit or explicit save buttons) */
  performSave: () => void;
  /** Handle create (validates, then creates) */
  handleCreate: () => void;
  /** Handle delete */
  handleDelete: () => void;
  /** Whether a delete is in progress */
  isDeleting: boolean;
  /** Call on field blur (triggers save for blur strategy, or immediate save for debounce) */
  handleFieldBlur: () => void;
  /** Exposed for pages that need additional mutations or custom invalidation */
  queryClient: ReturnType<typeof useQueryClient>;
  /** React Router blocker for in-app navigation guard */
  blocker: Blocker;
}

export function useAutoSaveForm<
  TForm extends Record<string, unknown>,
  TServer,
>(options: UseAutoSaveFormOptions<TForm, TServer>): UseAutoSaveFormReturn<TForm> {
  const {
    defaultFormData,
    hydrate,
    buildPayload,
    serverData,
    api,
    orgId,
    entityId,
    isCreateMode,
    queryKeys,
    paths,
    saveStrategy = 'debounce',
    debounceMs = 1000,
    validateCreate,
    entityLabel = 'record',
  } = options;

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<TForm>(() => ({ ...defaultFormData }));
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const originalDataRef = useRef<string>('');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Hydrate form data from server
  useEffect(() => {
    if (serverData) {
      const data = hydrate(serverData);
      setFormData(data);
      originalDataRef.current = JSON.stringify(data);
      setHasUnsavedChanges(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverData]);

  // Auto-reset saved status after 2 seconds
  useEffect(() => {
    if (saveStatus === 'saved') {
      const timer = setTimeout(() => setSaveStatus('idle'), 2000);
      return () => clearTimeout(timer);
    }
  }, [saveStatus]);

  // Guard against navigation with unsaved changes (beforeunload + future data router blocker)
  const blocker = useUnsavedGuard(hasUnsavedChanges);

  // Cleanup save timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.update(orgId!, entityId!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.entity });
      queryClient.invalidateQueries({ queryKey: queryKeys.collection });
      setSaveStatus('saved');
      setLastSaved(new Date());
      setHasUnsavedChanges(false);
      originalDataRef.current = JSON.stringify(formDataRef.current);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, entityLabel));
      setSaveStatus('error');
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.create(orgId!, payload),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.collection });
      navigate(paths.afterCreate(result));
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, entityLabel));
      setSaveStatus('error');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => api.delete!(orgId!, entityId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.collection });
      navigate(paths.afterDelete);
    },
    onError: (error: Error) => {
      setErrorMessage(formatErrorMessage(error.message, entityLabel));
    },
  });

  // Trigger save (for autosave — skipped in create mode)
  const triggerSave = useCallback(() => {
    if (isCreateMode) return;
    const isDirty =
      JSON.stringify(formDataRef.current) !== originalDataRef.current;
    if (!isDirty) return;
    setSaveStatus('saving');
    setErrorMessage(null);
    updateMutation.mutate(buildPayload(formDataRef.current));
  }, [isCreateMode, updateMutation, buildPayload]);

  // Public performSave (for explicit save triggers)
  const performSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    triggerSave();
  }, [triggerSave]);

  // Update a field and schedule autosave
  const updateField = useCallback(
    <K extends keyof TForm>(field: K, value: TForm[K]) => {
      setFormData((prev) => {
        const next = { ...prev, [field]: value };
        setHasUnsavedChanges(
          JSON.stringify(next) !== originalDataRef.current,
        );
        return next;
      });
      if (!isCreateMode && saveStrategy === 'debounce') {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          triggerSave();
        }, debounceMs);
      }
    },
    [isCreateMode, saveStrategy, debounceMs, triggerSave],
  );

  // Update a field without triggering autosave
  const updateFieldSilent = useCallback(
    <K extends keyof TForm>(field: K, value: TForm[K]) => {
      setFormData((prev) => {
        const next = { ...prev, [field]: value };
        setHasUnsavedChanges(
          JSON.stringify(next) !== originalDataRef.current,
        );
        return next;
      });
    },
    [],
  );

  // Handle field blur (triggers save for blur strategy)
  const handleFieldBlur = useCallback(() => {
    if (!isCreateMode && saveStrategy === 'blur') {
      triggerSave();
    }
  }, [isCreateMode, saveStrategy, triggerSave]);

  // Handle create
  const handleCreate = useCallback(() => {
    if (validateCreate) {
      const error = validateCreate(formDataRef.current);
      if (error) {
        setErrorMessage(error);
        return;
      }
    }
    setSaveStatus('saving');
    setErrorMessage(null);
    createMutation.mutate(buildPayload(formDataRef.current));
  }, [validateCreate, createMutation, buildPayload]);

  // Handle delete
  const handleDelete = useCallback(() => {
    if (!api.delete) return;
    deleteMutation.mutate();
  }, [api.delete, deleteMutation]);

  return {
    formData,
    setFormData,
    updateField,
    updateFieldSilent,
    hasUnsavedChanges,
    saveStatus,
    lastSaved,
    errorMessage,
    setErrorMessage,
    performSave,
    handleCreate,
    handleDelete,
    isDeleting: deleteMutation.isPending,
    handleFieldBlur,
    queryClient,
    blocker,
  };
}
