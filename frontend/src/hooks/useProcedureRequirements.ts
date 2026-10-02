/**
 * Hook to fetch procedure requirements from the API.
 *
 * Returns RequirementGroup[] compatible with ProcedureRequirementsCard
 * and computeProcedureCompliance. Predicates that can't be serialized
 * are hydrated client-side from a local registry keyed by requirement id.
 */

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import type { Requirement, RequirementGroup } from '../lib/procedureComplianceUtils';

// ---------------------------------------------------------------------------
// API response types (matches backend serialization)
// ---------------------------------------------------------------------------

interface ApiRequirement {
  id: string;
  label: string;
  groupId: string;
  fieldPaths: string[];
  requiredForStatuses: string[];
  severity: 'blocking' | 'recommended' | 'info';
  helpText?: string;
  helpLink?: string;
  hasPredicate?: boolean;
}

interface ApiRequirementGroup {
  id: string;
  label: string;
  sectionId: string;
  requirements: ApiRequirement[];
}

interface ApiProcedureRequirements {
  procedureType: string;
  procedureLabel: string;
  procedureProcedure: string;
  statusOrder: string[];
  requirementGroups: ApiRequirementGroup[];
}

// ---------------------------------------------------------------------------
// Predicate registry — client-side logic that can't be serialized as JSON
// ---------------------------------------------------------------------------

type PredicateFn = (record: Record<string, unknown>) => boolean;

const PREDICATE_REGISTRY: Record<string, PredicateFn> = {
  // Signed documents — each procedure embeds a `signed_document_types` list
  // of distinct document_type strings currently attached. Predicates just
  // check whether the required document_type is present.
  signed_entry_form: (r) =>
    Array.isArray(r.signed_document_types) &&
    (r.signed_document_types as string[]).includes('entry_form'),
  signed_exit_form: (r) =>
    Array.isArray(r.signed_document_types) &&
    (r.signed_document_types as string[]).includes('exit_form'),
  signed_transfer_of_title: (r) => {
    const types = r.signed_document_types as string[] | undefined;
    if (!Array.isArray(types)) return false;
    return (
      types.includes('deed_of_gift') ||
      types.includes('transfer_of_title') ||
      types.includes('bill_of_sale')
    );
  },
  signed_loan_agreement: (r) =>
    Array.isArray(r.signed_document_types) &&
    (r.signed_document_types as string[]).includes('loan_agreement'),
  signed_disposal_decision: (r) => {
    const types = r.signed_document_types as string[] | undefined;
    if (!Array.isArray(types)) return false;
    return (
      types.includes('disposal_decision') ||
      types.includes('board_resolution') ||
      types.includes('deed_of_gift_out')
    );
  },
  signed_custody_transfer: (r) =>
    Array.isArray(r.signed_document_types) &&
    (r.signed_document_types as string[]).includes('custody_transfer'),

  // Object Entry
  items_count: (r) => Array.isArray(r.items) && (r.items as unknown[]).length >= 1,
  entry_location: (r) => {
    const items = r.items as Array<{ location_id?: string | null }> | undefined;
    if (!Array.isArray(items) || items.length === 0) return false;
    return items.every((i) => i && typeof i.location_id === 'string' && i.location_id.length > 0);
  },
  entry_image: (r) => typeof r.media_count === 'number' && (r.media_count as number) > 0,
  insurance_value: (r) => {
    if (r.insurance_applicable === false) return true;
    const v = r.insurance_value;
    return v !== null && v !== undefined && v !== '' && v !== 0;
  },
  terms_accepted: (r) => r.terms_accepted === true,
  terms_accepted_date: (r) => {
    if (!r.terms_accepted) return true;
    const d = r.terms_accepted_date;
    return typeof d === 'string' && d.trim().length > 0;
  },
  terms_accepted_by: (r) => {
    if (!r.terms_accepted) return true;
    const n = r.terms_accepted_by;
    return typeof n === 'string' && n.trim().length > 0;
  },

  // Object Exit
  receipt_acknowledged: (r) => r.receipt_acknowledged === true,

  // Deaccession
  board_approval_date: (r) => {
    if (!r.board_approval_required) return true;
    const d = r.board_approval_date;
    return typeof d === 'string' && (d as string).trim().length > 0;
  },
  board_approval_reference: (r) => {
    if (!r.board_approval_required) return true;
    const ref = r.board_approval_reference;
    return typeof ref === 'string' && (ref as string).trim().length > 0;
  },
  provenance_review_complete: (r) => r.provenance_review_complete === true,

  // Movement
  shipping_insurance_value: (r) => {
    const method = r.movement_method;
    if (method !== 'shipped' && method !== 'courier') return true;
    const v = r.shipping_insurance_value;
    return v !== null && v !== undefined && v !== '' && v !== 0;
  },

  // Documentation Plan
  measurable_results: (r) => Array.isArray(r.measurable_results) && (r.measurable_results as unknown[]).length > 0,
  actions: (r) => Array.isArray(r.actions) && (r.actions as unknown[]).length > 0,
  resources_required: (r) => {
    const res = r.resources_required;
    if (Array.isArray(res)) return res.length > 0;
    if (typeof res === 'string') return res.trim().length > 0;
    return false;
  },
};

// ---------------------------------------------------------------------------
// Hydration — attach predicates to API response
// ---------------------------------------------------------------------------

function hydrateRequirements(apiGroups: ApiRequirementGroup[]): RequirementGroup[] {
  return apiGroups.map((g) => ({
    id: g.id,
    label: g.label,
    sectionId: g.sectionId,
    requirements: g.requirements.map((r): Requirement => {
      const base: Requirement = {
        id: r.id,
        label: r.label,
        groupId: r.groupId,
        fieldPaths: r.fieldPaths,
        requiredForStatuses: r.requiredForStatuses,
        severity: r.severity,
        helpText: r.helpText,
        helpLink: r.helpLink,
      };
      if (r.hasPredicate && PREDICATE_REGISTRY[r.id]) {
        base.predicate = PREDICATE_REGISTRY[r.id];
      }
      return base;
    }),
  }));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseProcedureRequirementsResult {
  requirementGroups: RequirementGroup[];
  statusOrder: string[];
  procedureLabel: string;
  enforcementEnabled: boolean;
  isLoading: boolean;
  error: Error | null;
}

export function useProcedureRequirements(
  procedureType: string,
  organizationId?: string,
): UseProcedureRequirementsResult {
  const queryParam = organizationId ? `?organization_id=${organizationId}` : '';
  const { data, isLoading, error } = useQuery<ApiProcedureRequirements & { enforcementEnabled?: boolean }>({
    queryKey: ['procedure-requirements', procedureType, organizationId],
    queryFn: () => apiFetch(`/procedure-requirements/${procedureType}${queryParam}`),
    staleTime: organizationId ? 5 * 60 * 1000 : Infinity, // Per-org: 5 min, global: forever
    gcTime: organizationId ? 10 * 60 * 1000 : Infinity,
  });

  return {
    requirementGroups: data ? hydrateRequirements(data.requirementGroups) : [],
    statusOrder: data?.statusOrder ?? [],
    procedureLabel: data?.procedureLabel ?? '',
    enforcementEnabled: data?.enforcementEnabled ?? false,
    isLoading,
    error: error as Error | null,
  };
}
