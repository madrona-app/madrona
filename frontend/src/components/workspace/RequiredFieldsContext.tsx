/**
 * Required fields for a procedure form, from one source.
 *
 * A procedure's form keeps its fixed required markers (the `required` prop on
 * EditableField / EditableSelect). On top of those, an organization can add
 * required fields per procedure (Collections configuration > Procedure
 * enforcement). RequiredFieldsProvider reads those added fields with
 * useProcedureRequirements and hands them to every field that names its record
 * column with the `name` prop, so the field shows the same visible marker and
 * is exposed as required to assistive technology.
 *
 * When the server refuses a status change because blocking requirements are
 * unmet (422 `procedure_requirements_not_met`), the provider marks the named
 * fields invalid with an inline message tied by aria-describedby, and shows an
 * error summary that takes focus and links to each field.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { AlertCircle, X } from 'lucide-react';
import { useProcedureRequirements } from '../../hooks/useProcedureRequirements';
import {
  RequiredFieldsContext,
  errorIdFor,
  humanizeStatus,
  parseMissingRequirements,
  useRequiredFields,
} from './requiredFields';
import type { MissingRequirement, RequiredFieldError, RequiredFieldsContextValue } from './requiredFields';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface RequiredFieldsProviderProps {
  procedureType: string;
  /** Defaults to the `orgId` route parameter. */
  orgId?: string;
  /**
   * Open (and switch to editing) the workspace section with this id, so a
   * field that is not on screen can receive focus. Pages pass the same handler
   * they give ProcedureRequirementsCard, here or with useRevealSection.
   */
  onRevealSection?: (sectionId: string) => void;
  children: ReactNode;
}

interface RegisteredField {
  /** Controls for the field; a picker can show more than one (Search, Change). */
  els: Set<HTMLElement>;
  sectionId: string | null;
}

export function RequiredFieldsProvider({
  procedureType,
  orgId: orgIdProp,
  onRevealSection,
  children,
}: RequiredFieldsProviderProps) {
  const params = useParams<{ orgId?: string }>();
  const orgId = orgIdProp ?? params.orgId;
  const { orgFields } = useRequiredFields(procedureType, orgId);
  const { requirementGroups } = useProcedureRequirements(procedureType, orgId);
  const revealRef = useRef<((sectionId: string) => void) | null>(null);
  const setRevealSection = useCallback((fn: ((sectionId: string) => void) | null) => {
    revealRef.current = fn;
  }, []);
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<{
    requirements: MissingRequirement[];
    targetStatus: string;
    key: number;
  } | null>(null);
  const [cleared, setCleared] = useState<Set<string>>(() => new Set());
  const registry = useRef(new Map<string, RegisteredField>());
  const summaryRef = useRef<HTMLDivElement>(null);
  const counter = useRef(0);

  const reportError = useCallback((error: unknown) => {
    const parsed = parseMissingRequirements(error, procedureType);
    if (!parsed) return false;
    counter.current += 1;
    setCleared(new Set());
    setFailure({ ...parsed, key: counter.current });
    return true;
  }, [procedureType]);

  // Every mutation on the page (save, status change, approve, dispatch...)
  // reaches the server through React Query, so watch the mutation cache
  // rather than wiring each handler.
  useEffect(() => {
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        reportError(event.action.error);
      }
    });
  }, [queryClient, reportError]);

  // Move focus to the summary each time the server refuses.
  useEffect(() => {
    if (failure) summaryRef.current?.focus();
  }, [failure?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const fieldMessages = useMemo(() => {
    const map = new Map<string, RequiredFieldError>();
    if (!failure) return map;
    const status = failure.targetStatus ? humanizeStatus(failure.targetStatus) : '';
    for (const req of failure.requirements) {
      for (const field of req.fields) {
        if (map.has(field) || cleared.has(field)) continue;
        map.set(field, {
          id: errorIdFor(procedureType, field),
          message: status
            ? `${req.label} is required before the status can change to ${status}.`
            : `${req.label} is required.`,
        });
      }
    }
    return map;
  }, [failure, cleared, procedureType]);

  const clearError = useCallback((name: string) => {
    setCleared((prev) => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  }, []);

  const registerField = useCallback((name: string, el: HTMLElement | null | undefined, sectionId: string | null) => {
    const entry = registry.current.get(name) ?? { els: new Set<HTMLElement>(), sectionId: null };
    // React calls a callback ref with null on unmount without saying which
    // element left, so unmounted elements are pruned when looked up instead.
    if (el) entry.els.add(el);
    if (sectionId) entry.sectionId = sectionId;
    registry.current.set(name, entry);
  }, []);

  const focusField = useCallback((req: MissingRequirement) => {
    const focus = (el: HTMLElement) => {
      el.focus();
      el.scrollIntoView?.({ block: 'center' });
    };
    const findEl = () => {
      for (const f of req.fields) {
        const entry = registry.current.get(f);
        if (!entry) continue;
        for (const el of entry.els) {
          if (el.isConnected) return el;
          entry.els.delete(el);
        }
      }
      return null;
    };
    const target = findEl();
    if (target) {
      focus(target);
      return;
    }
    // Not on screen: open the section that holds it. Prefer the section the
    // control was last seen in, then the requirement's own section.
    const sectionId =
      req.fields.map((f) => registry.current.get(f)?.sectionId).find((s): s is string => !!s) ??
      (requirementGroups ?? []).find((g) => g.requirements?.some((r) => r.id === req.id))?.sectionId;
    if (!sectionId) return;
    const reveal = onRevealSection ?? revealRef.current;
    reveal?.(sectionId);
    // The section renders on the next commit; wait for the control to mount,
    // and fall back to the section's heading button.
    let tries = 0;
    const tick = () => {
      const el = findEl();
      if (el) {
        focus(el);
        return;
      }
      if (tries++ < 20) {
        window.setTimeout(tick, 25);
        return;
      }
      const heading = document.getElementById(`section-${sectionId}`)?.querySelector<HTMLElement>('h2 button');
      if (heading) focus(heading);
    };
    window.setTimeout(tick, 0);
  }, [onRevealSection, requirementGroups]);

  const value = useMemo<RequiredFieldsContextValue>(() => ({
    procedureType,
    isOrgRequired: (name) => !!name && orgFields.has(name),
    getError: (name) => (name ? fieldMessages.get(name) ?? null : null),
    clearError,
    registerField,
    reportError,
    setRevealSection,
  }), [procedureType, orgFields, fieldMessages, clearError, registerField, reportError, setRevealSection]);

  const outstanding = failure
    ? failure.requirements.filter((r) => r.fields.length === 0 || r.fields.some((f) => !cleared.has(f)))
    : [];
  const headingId = `required-fields-summary-${procedureType}-heading`;

  return (
    <RequiredFieldsContext.Provider value={value}>
      {failure && outstanding.length > 0 && (
        <div className="mx-auto max-w-5xl px-6 pt-4">
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="region"
          aria-labelledby={headingId}
          className="mb-4 rounded-lg border border-semantic-error/40 bg-semantic-error/5 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold text-semantic-error">
              <AlertCircle size={18} aria-hidden="true" />
              {failure.targetStatus
                ? `Status not changed to ${humanizeStatus(failure.targetStatus)}: ${outstanding.length} required ${outstanding.length === 1 ? 'field is' : 'fields are'} missing`
                : `${outstanding.length} required ${outstanding.length === 1 ? 'field is' : 'fields are'} missing`}
            </h2>
            <button
              type="button"
              onClick={() => setFailure(null)}
              aria-label="Dismiss required field errors"
              className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md text-archive hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
            {outstanding.map((req) => (
              <li key={req.id}>
                {req.fields.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => focusField(req)}
                    className="text-left text-bark underline hover:text-copper-dark rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bark/30 focus-visible:ring-offset-2"
                  >
                    {req.label}
                  </button>
                ) : (
                  <span className="text-ink">{req.label}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        </div>
      )}
      {children}
    </RequiredFieldsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Pieces for controls that are not EditableField / EditableSelect
// ---------------------------------------------------------------------------

/** Inline message for a required field the server reported missing. */
export function RequiredFieldMessage({ error, as: Tag = 'p' }: { error: RequiredFieldError; as?: 'p' | 'dd' }) {
  return (
    <Tag id={error.id} className="flex items-start gap-1 text-xs text-semantic-error">
      <AlertCircle size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
      <span>{error.message}</span>
    </Tag>
  );
}

/**
 * Required marker for a labelled group (e.g. a contact picker), where
 * aria-required is not allowed: the visible asterisk plus the word for
 * screen readers.
 */
export function RequiredGroupMarker() {
  return (
    <>
      <span className="text-semantic-error ml-0.5" aria-hidden="true">*</span>
      <span className="sr-only"> (required)</span>
    </>
  );
}
