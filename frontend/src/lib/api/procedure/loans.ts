/**
 * Loans In & Loans Out API
 */
import { apiFetch, validate, buildQueryString } from '../_utils';
import {
  LoanInSchema,
  PaginatedLoansInSchema,
  LoanOutSchema,
  PaginatedLoansOutSchema,
} from '../../schemas';
import type {
  LoanIn,
  PaginatedLoansIn,
  LoanOut,
  PaginatedLoansOut,
} from '../../schemas';

// ============================================================================
// LOANS IN
// ============================================================================

export async function getLoansIn(
  organizationId: string,
  params?: {
    q?: string;
    limit?: number;
    offset?: number;
    status?: string;
    loan_purpose?: string;
    entry_id?: string;
  }
): Promise<PaginatedLoansIn> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-in${query}`);
  return validate(PaginatedLoansInSchema, data);
}

export async function getLoanIn(
  organizationId: string,
  loanId: string
): Promise<LoanIn> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-in/${loanId}`);
  return validate(LoanInSchema, data);
}

export async function createLoanIn(
  organizationId: string,
  loan: Partial<LoanIn>
): Promise<LoanIn> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-in`, {
    method: 'POST',
    body: JSON.stringify(loan),
  });
  return validate(LoanInSchema, data);
}

export async function updateLoanIn(
  organizationId: string,
  loanId: string,
  updates: Partial<LoanIn>
): Promise<LoanIn> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-in/${loanId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(LoanInSchema, data);
}

export async function approveLoanIn(
  organizationId: string,
  loanId: string
): Promise<LoanIn> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-in/${loanId}/approve`, {
    method: 'POST',
  });
  return validate(LoanInSchema, data);
}

export async function receiveLoanIn(
  organizationId: string,
  loanId: string,
  receiptDate?: string
): Promise<LoanIn> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-in/${loanId}/receive`, {
    method: 'POST',
    body: JSON.stringify({ receipt_date: receiptDate }),
  });
  return validate(LoanInSchema, data);
}

export async function returnLoanIn(
  organizationId: string,
  loanId: string,
  returnDate?: string
): Promise<LoanIn> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-in/${loanId}/return`, {
    method: 'POST',
    body: JSON.stringify({ return_date: returnDate }),
  });
  return validate(LoanInSchema, data);
}

export async function renewLoanIn(
  organizationId: string,
  loanId: string,
  newEndDate: string
): Promise<LoanIn> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-in/${loanId}/renew`, {
    method: 'POST',
    body: JSON.stringify({ new_end_date: newEndDate }),
  });
  return validate(LoanInSchema, data);
}

export async function rollbackLoanIn(
  organizationId: string,
  loanId: string,
  targetStatus: string,
  reason: string
): Promise<LoanIn> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-in/${loanId}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ target_status: targetStatus, reason }),
  });
  return validate(LoanInSchema, data);
}

export async function deleteLoanIn(
  organizationId: string,
  loanId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/loans-in/${loanId}`, {
    method: 'DELETE',
  });
}

// Loan In - Object Entry Links
export interface LoanInEntryLink {
  loan_in_entry_id: string;
  entry_id: string;
  entry_number: string | null;
  entry_date: string | null;
  depositor_name: string | null;
  location_name: string | null;
  objects_description: string | null;
  status: string | null;
  notes: string | null;
  created_at: string | null;
}

export async function getLoanInObjectEntries(
  organizationId: string,
  loanId: string
): Promise<{ entries: LoanInEntryLink[] }> {
  return await apiFetch(`/organizations/${organizationId}/collections/loans-in/${loanId}/object-entries`);
}

export async function addLoanInObjectEntry(
  organizationId: string,
  loanId: string,
  data: { entry_id: string; notes?: string }
): Promise<LoanInEntryLink> {
  return await apiFetch(`/organizations/${organizationId}/collections/loans-in/${loanId}/object-entries`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function removeLoanInObjectEntry(
  organizationId: string,
  loanId: string,
  loanInEntryId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/collections/loans-in/${loanId}/object-entries/${loanInEntryId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// LOANS OUT
// ============================================================================

export async function getLoansOut(
  organizationId: string,
  params?: {
    q?: string;
    limit?: number;
    offset?: number;
    status?: string;
    loan_purpose?: string;
  }
): Promise<PaginatedLoansOut> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-out${query}`);
  return validate(PaginatedLoansOutSchema, data);
}

export async function getLoanOut(
  organizationId: string,
  loanId: string
): Promise<LoanOut> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-out/${loanId}`);
  return validate(LoanOutSchema, data);
}

export async function createLoanOut(
  organizationId: string,
  loan: Partial<LoanOut>
): Promise<LoanOut> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-out`, {
    method: 'POST',
    body: JSON.stringify(loan),
  });
  return validate(LoanOutSchema, data);
}

export async function updateLoanOut(
  organizationId: string,
  loanId: string,
  updates: Partial<LoanOut>
): Promise<LoanOut> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-out/${loanId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(LoanOutSchema, data);
}

export async function approveLoanOut(
  organizationId: string,
  loanId: string,
  boardApprovalRequired?: boolean
): Promise<LoanOut> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-out/${loanId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ board_approval_required: boardApprovalRequired }),
  });
  return validate(LoanOutSchema, data);
}

export async function dispatchLoanOut(
  organizationId: string,
  loanId: string,
  dispatchDate?: string
): Promise<LoanOut> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-out/${loanId}/dispatch`, {
    method: 'POST',
    body: JSON.stringify({ dispatch_date: dispatchDate }),
  });
  return validate(LoanOutSchema, data);
}

export async function receiveReturnLoanOut(
  organizationId: string,
  loanId: string,
  returnDate?: string
): Promise<LoanOut> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-out/${loanId}/receive-return`, {
    method: 'POST',
    body: JSON.stringify({ return_date: returnDate }),
  });
  return validate(LoanOutSchema, data);
}

export async function renewLoanOut(
  organizationId: string,
  loanId: string,
  newEndDate: string
): Promise<LoanOut> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-out/${loanId}/renew`, {
    method: 'POST',
    body: JSON.stringify({ new_end_date: newEndDate }),
  });
  return validate(LoanOutSchema, data);
}

export async function deleteLoanOut(
  organizationId: string,
  loanId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/loans-out/${loanId}`, {
    method: 'DELETE',
  });
}

export async function addLoanOutObject(
  organizationId: string,
  loanId: string,
  objectData: { object_id: string; notes?: string }
): Promise<{ loan_object_id: string }> {
  return await apiFetch(`/organizations/${organizationId}/collections/loans-out/${loanId}/objects`, {
    method: 'POST',
    body: JSON.stringify(objectData),
  });
}

export async function updateLoanOutObject(
  organizationId: string,
  loanId: string,
  loanObjectId: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return await apiFetch(
    `/organizations/${organizationId}/collections/loans-out/${loanId}/objects/${loanObjectId}`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    }
  );
}
