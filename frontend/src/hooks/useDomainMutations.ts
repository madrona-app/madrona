/**
 * Reusable mutation hooks for common workspace page patterns.
 *
 * These hooks centralize the mutation + cache invalidation patterns that appear
 * across 30+ workspace pages, reducing boilerplate and ensuring consistent
 * cache behavior.
 *
 * The `useAutoSaveForm` hook handles core CRUD (create/update/delete with autosave).
 * These hooks cover the *additional* mutation patterns that sit alongside CRUD:
 *   - Status transitions (11+ pages)
 *   - Status rollback (4+ pages)
 *   - Generic entity actions with cache invalidation
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryKey, UseMutationResult } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Describes which query keys to invalidate after a mutation succeeds. */
export interface InvalidationConfig {
  /** The entity's own query key, e.g. ['loan-in', orgId, loanId] */
  entityKey?: QueryKey;
  /** The collection list query key, e.g. ['loans-in', orgId] */
  collectionKey?: QueryKey;
  /** Additional query keys to invalidate */
  additionalKeys?: QueryKey[];
  /**
   * When true, uses `refetchType: 'none'` for the collection key invalidation
   * (marks it stale without triggering an immediate refetch). Useful when the
   * list view is not currently mounted.
   */
  deferCollectionRefetch?: boolean;
}

/** Common options for status/rollback mutations */
interface StatusMutationOptions<TStatus extends string, TResult = unknown> {
  /** The API function to call, e.g. `(orgId, entityId, { status }) => Promise<T>` */
  mutationFn: (status: TStatus) => Promise<TResult>;
  /** Cache invalidation config */
  invalidation: InvalidationConfig;
  /**
   * When true, sets the entity query data with the mutation result
   * for an optimistic-feeling update (avoids waiting for refetch).
   * Default: false
   */
  optimistic?: boolean;
  /** Optional callback after successful mutation */
  onSuccess?: (result: TResult, status: TStatus) => void;
}

// ---------------------------------------------------------------------------
// useStatusMutation
// ---------------------------------------------------------------------------

/**
 * Hook for status transition mutations.
 *
 * Replaces the 11+ copies of:
 * ```ts
 * const statusMutation = useMutation({
 *   mutationFn: (status) => updateEntity(orgId!, entityId!, { status }),
 *   onSuccess: (result) => {
 *     queryClient.setQueryData(entityKey, result);
 *     queryClient.invalidateQueries({ queryKey: collectionKey });
 *   },
 * });
 * ```
 *
 * @example
 * const statusMutation = useStatusMutation<LoanInStatus>({
 *   mutationFn: (status) => updateLoanIn(orgId!, loanId!, { status }),
 *   invalidation: {
 *     entityKey: ['loan-in', orgId, loanId],
 *     collectionKey: ['loans-in', orgId],
 *     deferCollectionRefetch: true,
 *   },
 *   optimistic: true,
 * });
 */
export function useStatusMutation<TStatus extends string, TResult = unknown>(
  options: StatusMutationOptions<TStatus, TResult>,
): UseMutationResult<TResult, Error, TStatus> {
  const queryClient = useQueryClient();
  const { mutationFn, invalidation, optimistic = false, onSuccess } = options;

  return useMutation({
    mutationFn,
    onSuccess: (result, status) => {
      if (optimistic && invalidation.entityKey) {
        queryClient.setQueryData(invalidation.entityKey, result);
      } else if (invalidation.entityKey) {
        queryClient.invalidateQueries({ queryKey: invalidation.entityKey });
      }

      if (invalidation.collectionKey) {
        queryClient.invalidateQueries({
          queryKey: invalidation.collectionKey,
          ...(invalidation.deferCollectionRefetch
            ? { refetchType: 'none' as const }
            : {}),
        });
      }

      if (invalidation.additionalKeys) {
        for (const key of invalidation.additionalKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }

      onSuccess?.(result, status);
    },
  });
}

// ---------------------------------------------------------------------------
// useRollbackMutation
// ---------------------------------------------------------------------------

/**
 * Hook for status rollback mutations.
 *
 * Replaces the 4+ copies of:
 * ```ts
 * const rollbackMutation = useMutation({
 *   mutationFn: (targetStatus) => rollbackEntity(orgId!, entityId!, targetStatus),
 *   onSuccess: (result) => {
 *     queryClient.setQueryData(entityKey, result);
 *     queryClient.invalidateQueries({ queryKey: collectionKey });
 *   },
 * });
 * ```
 *
 * @example
 * const rollbackMutation = useRollbackMutation({
 *   mutationFn: (targetStatus) => rollbackLoanIn(orgId!, loanId!, targetStatus),
 *   invalidation: {
 *     entityKey: ['loan-in', orgId, loanId],
 *     collectionKey: ['loans-in', orgId],
 *   },
 *   optimistic: true,
 * });
 */
export function useRollbackMutation<TResult = unknown>(options: {
  mutationFn: (targetStatus: string) => Promise<TResult>;
  invalidation: InvalidationConfig;
  optimistic?: boolean;
  onSuccess?: (result: TResult, targetStatus: string) => void;
}): UseMutationResult<TResult, Error, string> {
  // Rollback has the same shape as status: call a fn with a string, then invalidate.
  return useStatusMutation<string, TResult>(options);
}

// ---------------------------------------------------------------------------
// useDeleteWithNavigate
// ---------------------------------------------------------------------------

/**
 * Hook for delete mutations that navigate after success.
 *
 * While `useAutoSaveForm` includes a delete mutation, many pages still define
 * delete mutations manually (e.g., pages not yet migrated to useAutoSaveForm,
 * or pages that need the delete mutation separately from the form hook).
 *
 * @example
 * const deleteMutation = useDeleteWithNavigate({
 *   mutationFn: () => deleteObjectEntry(orgId!, entryId!),
 *   invalidation: { collectionKey: ['object-entries', orgId] },
 *   navigateTo: `/organizations/${orgId}/collections/entries`,
 * });
 */
export function useDeleteWithNavigate(options: {
  mutationFn: () => Promise<unknown>;
  invalidation: InvalidationConfig;
  navigateTo: string;
  navigate: (path: string) => void;
}): UseMutationResult<unknown, Error, void> {
  const queryClient = useQueryClient();
  const { mutationFn, invalidation, navigateTo, navigate } = options;

  return useMutation({
    mutationFn,
    onSuccess: () => {
      if (invalidation.entityKey) {
        queryClient.invalidateQueries({ queryKey: invalidation.entityKey });
      }
      if (invalidation.collectionKey) {
        queryClient.invalidateQueries({ queryKey: invalidation.collectionKey });
      }
      if (invalidation.additionalKeys) {
        for (const key of invalidation.additionalKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }
      navigate(navigateTo);
    },
  });
}

// ---------------------------------------------------------------------------
// useInvalidatingMutation
// ---------------------------------------------------------------------------

/**
 * Generic hook for any mutation that needs cache invalidation on success.
 *
 * Use this for one-off domain actions that don't fit the status/rollback/delete
 * patterns but still need consistent cache invalidation. Examples: linking an
 * object, adding coverage to a policy, delivering a reproduction, etc.
 *
 * @example
 * const addCoverageMutation = useInvalidatingMutation<Partial<Coverage>, Coverage>({
 *   mutationFn: (data) => createInsuranceCoverage(orgId!, data),
 *   invalidation: {
 *     additionalKeys: [['insurance-coverages', orgId, policyId]],
 *   },
 *   onSuccess: () => {
 *     setShowAddForm(false);
 *     resetForm();
 *   },
 * });
 */
export function useInvalidatingMutation<TInput, TResult = unknown>(options: {
  mutationFn: (input: TInput) => Promise<TResult>;
  invalidation: InvalidationConfig;
  onSuccess?: (result: TResult, input: TInput) => void;
  onError?: (error: Error, input: TInput) => void;
}): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient();
  const { mutationFn, invalidation, onSuccess, onError } = options;

  return useMutation({
    mutationFn,
    onSuccess: (result, input) => {
      if (invalidation.entityKey) {
        queryClient.invalidateQueries({ queryKey: invalidation.entityKey });
      }
      if (invalidation.collectionKey) {
        queryClient.invalidateQueries({
          queryKey: invalidation.collectionKey,
          ...(invalidation.deferCollectionRefetch
            ? { refetchType: 'none' as const }
            : {}),
        });
      }
      if (invalidation.additionalKeys) {
        for (const key of invalidation.additionalKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }
      onSuccess?.(result, input);
    },
    onError,
  });
}

// ---------------------------------------------------------------------------
// Helper: buildInvalidationConfig
// ---------------------------------------------------------------------------

/**
 * Convenience factory for creating an InvalidationConfig from the common
 * (entityKey, collectionKey) pair pattern.
 *
 * @example
 * const invalidation = buildInvalidationConfig(
 *   ['loan-in', orgId, loanId],      // entity
 *   ['loans-in', orgId],             // collection
 *   { deferCollectionRefetch: true },
 * );
 */
export function buildInvalidationConfig(
  entityKey: QueryKey | undefined,
  collectionKey: QueryKey | undefined,
  overrides?: Partial<InvalidationConfig>,
): InvalidationConfig {
  return {
    entityKey,
    collectionKey,
    ...overrides,
  };
}
