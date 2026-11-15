/**
 * Required-field state for procedure forms (hooks and helpers); the
 * provider and its visual pieces live in RequiredFieldsContext.tsx.
 *
 * A procedure's form keeps its fixed required markers (the `required` prop on
 * EditableField / EditableSelect). On top of those, an organization can add
 * required fields per procedure. Fields that name their record column with
 * `name` pick those up here.
 */

import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useProcedureRequirements } from '../../hooks/useProcedureRequirements';
import { ApiError } from '../../lib/apiClient';

// ---------------------------------------------------------------------------
// Section id — lets a field remember which workspace section holds it, so the
// error summary can open that section when the field is not on screen.
// ---------------------------------------------------------------------------

export const WorkspaceSectionIdContext = createContext<string | null>(null);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MissingRequirement {
  id: string;
  label: string;
  fields: string[];
  source?: 'baseline' | 'org';
}

export interface RequiredFieldError {
  id: string;
  message: string;
}

export interface RequiredFieldsContextValue {
  procedureType: string;
  /** True when the organization added `name` as a required field. */
  isOrgRequired: (name?: string) => boolean;
  /** Inline server error for `name`, or null. */
  getError: (name?: string) => RequiredFieldError | null;
  /** Drop the error on `name` (called when the user edits the field). */
  clearError: (name: string) => void;
  /**
   * Remember the control for `name` (null when it unmounts; undefined keeps
   * the current one) and the section that holds it.
   */
  registerField: (name: string, el: HTMLElement | null | undefined, sectionId: string | null) => void;
  /**
   * Mark fields from a `procedure_requirements_not_met` error. Returns true
   * when the error was one. Mutations are picked up automatically; call this
   * for requests made outside React Query.
   */
  reportError: (error: unknown) => boolean;
  /** Set the handler that opens a workspace section (see useRevealSection). */
  setRevealSection: (fn: ((sectionId: string) => void) | null) => void;
}

export const RequiredFieldsContext = createContext<RequiredFieldsContextValue | null>(null);

export function useRequiredFieldsContext(): RequiredFieldsContextValue | null {
  return useContext(RequiredFieldsContext);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

/** Missing requirements from a server error, or null when it is not one. */
export function parseMissingRequirements(
  error: unknown,
  procedureType?: string,
): { requirements: MissingRequirement[]; targetStatus: string } | null {
  if (!(error instanceof ApiError) || error.code !== 'procedure_requirements_not_met') return null;
  const details = (error.details ?? {}) as {
    procedure_type?: string;
    target_status?: string;
    missing_requirements?: MissingRequirement[];
  };
  if (procedureType && details.procedure_type && details.procedure_type !== procedureType) return null;
  const requirements = Array.isArray(details.missing_requirements) ? details.missing_requirements : [];
  return { requirements, targetStatus: details.target_status ?? '' };
}

export function errorIdFor(procedureType: string, name: string): string {
  return `required-field-${procedureType}-${name}-error`.replace(/[^a-zA-Z0-9_-]/g, '-');
}

// ---------------------------------------------------------------------------
// Hook — merged "required" lookup
// ---------------------------------------------------------------------------

/**
 * Required-field lookup for a procedure: the field's own fixed requirement
 * merged with the fields the organization added.
 *
 * Org-added fields count only while enforcement is switched on for the
 * procedure, which is the server's rule (procedure_enforcement checks them
 * only when the org's toggle for that procedure is on); with it off a status
 * change never blocks on them, so the form does not call them required.
 */
export function useRequiredFields(procedureType: string, orgId?: string) {
  const { orgRequiredFields, enforcementEnabled } = useProcedureRequirements(procedureType, orgId);
  const orgFields = useMemo(
    () => new Set(enforcementEnabled ? (orgRequiredFields ?? []).map((f) => f.field) : []),
    [orgRequiredFields, enforcementEnabled],
  );
  const isRequired = useCallback(
    (name?: string, baseRequired = false) => baseRequired || (!!name && orgFields.has(name)),
    [orgFields],
  );
  return { isRequired, orgRequiredFields, orgFields, enforcementEnabled: !!enforcementEnabled };
}

/**
 * Give the provider the page's "open this section for editing" handler, so
 * the error summary can bring a collapsed field on screen before focusing it.
 */
export function useRevealSection(fn: (sectionId: string) => void) {
  const ctx = useRequiredFieldsContext();
  const setter = ctx?.setRevealSection;
  useEffect(() => {
    if (!setter) return undefined;
    setter(fn);
    return () => setter(null);
  }, [setter, fn]);
}

// ---------------------------------------------------------------------------
// Field hook — used by EditableField / EditableSelect and custom controls
// ---------------------------------------------------------------------------

/**
 * Required/invalid state for the control that edits record column `name`.
 * Outside a RequiredFieldsProvider, or without a name, it returns the fixed
 * `baseRequired` and no error, so existing forms are unchanged.
 */
export function useRequiredField(
  name: string | undefined,
  baseRequired = false,
  /** Section holding the control, when the hook runs outside that section. */
  sectionIdOverride?: string,
) {
  const ctx = useRequiredFieldsContext();
  const sectionFromContext = useContext(WorkspaceSectionIdContext);
  const sectionId = sectionIdOverride ?? sectionFromContext;
  const orgRequired = !!ctx?.isOrgRequired(name);
  const error = ctx?.getError(name) ?? null;

  const register = useCallback((el: HTMLElement | null) => {
    if (ctx && name) ctx.registerField(name, el, sectionId);
  }, [ctx, name, sectionId]);

  // Remember the section even while the field shows as read-only text.
  useEffect(() => {
    if (ctx && name && sectionId) ctx.registerField(name, undefined, sectionId);
  }, [ctx, name, sectionId]);

  const onEdited = useCallback(() => {
    if (ctx && name && error) ctx.clearError(name);
  }, [ctx, name, error]);

  const onlyOrg = orgRequired && !baseRequired;
  return {
    /** Show the required marker. */
    required: baseRequired || orgRequired,
    /** Required only because the organization added it (no native `required`). */
    orgRequired: onlyOrg,
    error,
    register,
    onEdited,
    /**
     * Props for a native input/select/textarea. Org-added fields get
     * aria-required, not the `required` attribute, which would block native
     * submission of a new record before the status that needs them.
     */
    controlProps: {
      ref: register,
      'aria-required': onlyOrg ? true : undefined,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error?.id,
    } as const,
  };
}
