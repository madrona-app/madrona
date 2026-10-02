import { useState, useCallback, useMemo } from 'react';

/**
 * Hook to manage contact selector state for workspace pages.
 * Reduces boilerplate for opening/closing contact selectors and handling selections.
 *
 * @example
 * ```tsx
 * const depositorSelector = useContactSelector();
 *
 * // In render:
 * <button onClick={depositorSelector.open}>Select Depositor</button>
 * <ContactSelectorSlideOver
 *   isOpen={depositorSelector.isOpen}
 *   onClose={depositorSelector.close}
 *   onSelect={(contactId) => {
 *     updateField('depositor_id', contactId);
 *     depositorSelector.close();
 *   }}
 *   organizationId={orgId}
 *   title="Select Depositor"
 * />
 * ```
 *
 * Or with the createSelectHandler helper:
 * ```tsx
 * <ContactSelectorSlideOver
 *   onSelect={depositorSelector.createSelectHandler((contactId) => updateField('depositor_id', contactId))}
 * />
 * ```
 */
export function useConstituentSelector() {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  /**
   * Creates a select handler that calls the provided callback and closes the selector.
   * Useful for inline handlers in JSX.
   */
  const createSelectHandler = useCallback(
    (onSelect: (contactId: string) => void) => {
      return (contactId: string) => {
        onSelect(contactId);
        setIsOpen(false);
      };
    },
    []
  );

  return useMemo(
    () => ({
      isOpen,
      open,
      close,
      createSelectHandler,
    }),
    [isOpen, open, close, createSelectHandler]
  );
}

/**
 * Props interface for components that use contact selectors.
 * Use this to type the selector objects returned by useContactSelector.
 */
export interface ContactSelectorState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  createSelectHandler: (onSelect: (contactId: string) => void) => (contactId: string) => void;
}

/**
 * Hook to manage multiple contact selectors in a single call.
 * Useful when a form has many contact fields.
 *
 * @example
 * ```tsx
 * const contactSelectors = useContactSelectors(['depositor', 'currentOwner', 'lender']);
 *
 * // In render:
 * <button onClick={contactSelectors.depositor.open}>Select Depositor</button>
 * <ContactSelectorSlideOver
 *   isOpen={contactSelectors.depositor.isOpen}
 *   onClose={contactSelectors.depositor.close}
 *   onSelect={contactSelectors.depositor.createSelectHandler(
 *     (contactId) => updateField('depositor_id', contactId)
 *   )}
 * />
 * ```
 */
export function useConstituentSelectors<T extends string>(
  fieldNames: readonly T[]
): Record<T, ContactSelectorState> {
  // Create state for all fields
  const [openStates, setOpenStates] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(fieldNames.map((name) => [name, false]))
  );

  // Create handlers for each field
  const selectors = useMemo(() => {
    const result = {} as Record<T, ContactSelectorState>;

    for (const name of fieldNames) {
      result[name] = {
        get isOpen() {
          return openStates[name] ?? false;
        },
        open: () => setOpenStates((prev) => ({ ...prev, [name]: true })),
        close: () => setOpenStates((prev) => ({ ...prev, [name]: false })),
        createSelectHandler: (onSelect: (contactId: string) => void) => {
          return (contactId: string) => {
            onSelect(contactId);
            setOpenStates((prev) => ({ ...prev, [name]: false }));
          };
        },
      };
    }

    return result;
  }, [fieldNames, openStates]);

  return selectors;
}

/** @deprecated Use useConstituentSelector / useConstituentSelectors instead */
export const useContactSelector = useConstituentSelector;
/** @deprecated Use useConstituentSelectors instead */
export const useContactSelectors = useConstituentSelectors;
