import { useState, useCallback } from 'react';

/**
 * Hook to standardize dialog state management across workspace pages.
 *
 * Supports two usage patterns:
 *
 * **Simple boolean dialog** (no arguments):
 * ```ts
 * const deleteDialog = useDialogState();
 * deleteDialog.isOpen;   // boolean
 * deleteDialog.open();   // open the dialog
 * deleteDialog.close();  // close the dialog
 * deleteDialog.toggle(); // toggle open/closed
 * ```
 *
 * **Dialog with associated data** (pass initial data):
 * ```ts
 * const statusDialog = useDialogState({ targetStatus: '', targetStatusLabel: '' });
 * statusDialog.isOpen;              // boolean
 * statusDialog.data.targetStatus;   // current data value
 * statusDialog.open({ targetStatus: 'approved', targetStatusLabel: 'Approved' });
 * statusDialog.close();             // closes and resets data to initial values
 * ```
 */
function useDialogState(): {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};
function useDialogState<T extends Record<string, unknown>>(initialData: T): {
  isOpen: boolean;
  data: T;
  open: (data?: Partial<T>) => void;
  close: () => void;
  toggle: () => void;
};
function useDialogState<T extends Record<string, unknown>>(initialData?: T) {
  const [state, setState] = useState<{ isOpen: boolean; data: T | undefined }>({
    isOpen: false,
    data: initialData,
  });

  /** Open the dialog, optionally merging partial data with the initial values. */
  const open = useCallback(
    (data?: Partial<T>) => {
      setState({
        isOpen: true,
        data: initialData !== undefined ? { ...initialData, ...data } : undefined,
      });
    },
    [initialData],
  );

  /** Close the dialog and reset data back to initial values. */
  const close = useCallback(() => {
    setState({ isOpen: false, data: initialData });
  }, [initialData]);

  /** Toggle the dialog open or closed. When closing, resets data to initial values. */
  const toggle = useCallback(() => {
    setState((prev) => ({
      isOpen: !prev.isOpen,
      data: prev.isOpen ? initialData : prev.data,
    }));
  }, [initialData]);

  if (initialData !== undefined) {
    return { isOpen: state.isOpen, data: state.data as T, open, close, toggle };
  }

  return { isOpen: state.isOpen, open, close, toggle };
}

/** Type for a simple boolean dialog state (no associated data). */
export type SimpleDialogState = ReturnType<typeof useDialogState>;

/** Type for a dialog state with associated data of type T. */
export type DataDialogState<T extends Record<string, unknown>> = ReturnType<
  typeof useDialogState<T>
>;

export { useDialogState };
