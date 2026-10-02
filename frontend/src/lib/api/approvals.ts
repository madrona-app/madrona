import { apiFetch } from './_utils';

export interface ApprovalRequest {
  request_id: string;
  entity_type: string;
  entity_id: string;
  rule_description: string;
  requester_id?: string;
  requester_name: string | null;
  requested_action: {
    action: string;
    resubmitted?: boolean;
    changed_fields?: string[];
  };
  created_at: string;
  status: string;
  reviewed_by?: string | null;
  reviewer_name?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
}

export interface ApprovalsListResponse {
  items: ApprovalRequest[];
  total: number;
}

export interface ApprovalsCountResponse {
  pending_count: number;
}

export async function getApprovals(
  orgId: string,
  options?: { status?: 'pending' | 'reviewed'; limit?: number },
): Promise<ApprovalsListResponse> {
  const params = new URLSearchParams();
  params.append('status', options?.status ?? 'pending');
  if (options?.limit) params.append('limit', String(options.limit));
  return apiFetch<ApprovalsListResponse>(
    `/organizations/${orgId}/approvals?${params.toString()}`,
  );
}

export async function getApprovalsCount(
  orgId: string,
): Promise<ApprovalsCountResponse> {
  return apiFetch<ApprovalsCountResponse>(
    `/organizations/${orgId}/approvals/count`,
  );
}
