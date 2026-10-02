/**
 * Miscellaneous Procedures API
 *
 * Covers: Documentation Plans, Object Rights, Emergency Plans,
 * Incident Reports, Collections Reviews, Audit Campaigns,
 * Use Requests, Valuations, Reproduction Requests,
 * Authority Verification, Insurance Management
 */
import { apiFetch, validate, buildQueryString } from '../_utils';
import {
  // Documentation Plans
  DocumentationPlanSchema,
  PaginatedDocumentationPlansSchema,
  PersonAuthoritySchema,
  // Emergency Plans
  EmergencyPlanSchema,
  PaginatedEmergencyPlansSchema,
  // Incident Reports
  IncidentReportSchema,
  PaginatedIncidentReportsSchema,
  // Collections Reviews
  CollectionsReviewSchema,
  PaginatedCollectionsReviewsSchema,
  // Audit Campaigns
  AuditCampaignSchema,
  PaginatedAuditCampaignsSchema,
  // Use Requests
  UseRequestSchema,
  PaginatedUseRequestsSchema,
  // Valuations
  ValuationSchema,
  PaginatedValuationsSchema,
  // Reproduction Requests
  ReproductionRequestSchema,
  PaginatedReproductionRequestsSchema,
  // Insurance Management
  InsurancePolicySchema,
  InsurancePoliciesListSchema,
  InsuranceCoverageSchema,
  InsuranceCoveragesListSchema,
  IndemnityArrangementSchema,
  IndemnityArrangementsListSchema,
  InsuranceClaimSchema,
  InsuranceClaimsListSchema,
  InsuranceEnumsSchema,
} from '../../schemas';
import type {
  // Documentation Plans & Object Rights
  DocumentationPlan,
  PaginatedDocumentationPlans,
  ObjectRight,
  PersonAuthority,
  // Emergency Plans
  EmergencyPlan,
  PaginatedEmergencyPlans,
  // Incident Reports
  IncidentReport,
  PaginatedIncidentReports,
  IncidentReportObject,
  // Collections Reviews
  CollectionsReview,
  PaginatedCollectionsReviews,
  ObjectReviewAssessment,
  // Audit Campaigns
  AuditCampaign,
  PaginatedAuditCampaigns,
  AuditResult,
  // Use Requests
  UseRequest,
  PaginatedUseRequests,
  UseRequestObject,
  // Valuations
  Valuation,
  PaginatedValuations,
  // Reproduction Requests
  ReproductionRequest,
  PaginatedReproductionRequests,
  // Insurance Management
  InsurancePolicy,
  InsurancePoliciesList,
  InsuranceCoverage,
  InsuranceCoveragesList,
  IndemnityArrangement,
  IndemnityArrangementsList,
  InsuranceClaim,
  InsuranceClaimsList,
  InsuranceEnums,
} from '../../schemas';

// Re-export Insurance types for consumers
export type {
  InsurancePolicy,
  InsurancePoliciesList,
  InsuranceCoverage,
  InsuranceCoveragesList,
  IndemnityArrangement,
  IndemnityArrangementsList,
  InsuranceClaim,
  InsuranceClaimsList,
  InsuranceEnums,
};

// ============================================================================
// DOCUMENTATION PLANS API
// ============================================================================

export async function getDocumentationPlans(
  organizationId: string,
  params?: {
    q?: string;
    limit?: number;
    offset?: number;
    status?: string;
    plan_type?: string;
  }
): Promise<PaginatedDocumentationPlans> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/documentation-plans${query}`);
  return validate(PaginatedDocumentationPlansSchema, data);
}

export async function getDocumentationPlan(
  organizationId: string,
  planId: string
): Promise<DocumentationPlan> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/documentation-plans/${planId}`);
  return validate(DocumentationPlanSchema, data);
}

export async function createDocumentationPlan(
  organizationId: string,
  plan: Partial<DocumentationPlan>
): Promise<DocumentationPlan> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/documentation-plans`, {
    method: 'POST',
    body: JSON.stringify(plan),
  });
  return validate(DocumentationPlanSchema, data);
}

export async function updateDocumentationPlan(
  organizationId: string,
  planId: string,
  updates: Partial<DocumentationPlan>
): Promise<DocumentationPlan> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/documentation-plans/${planId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(DocumentationPlanSchema, data);
}

export async function approveDocumentationPlan(
  organizationId: string,
  planId: string
): Promise<DocumentationPlan> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/documentation-plans/${planId}/approve`, {
    method: 'POST',
  });
  return validate(DocumentationPlanSchema, data);
}

export async function startDocumentationPlan(
  organizationId: string,
  planId: string
): Promise<DocumentationPlan> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/documentation-plans/${planId}/start`, {
    method: 'POST',
  });
  return validate(DocumentationPlanSchema, data);
}

export async function completeDocumentationPlan(
  organizationId: string,
  planId: string
): Promise<DocumentationPlan> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/documentation-plans/${planId}/complete`, {
    method: 'POST',
  });
  return validate(DocumentationPlanSchema, data);
}

export async function deleteDocumentationPlan(
  organizationId: string,
  planId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/documentation-plans/${planId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// OBJECT RIGHTS
// ============================================================================

export async function getObjectRights(
  organizationId: string,
  objectId: string
): Promise<ObjectRight[]> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/rights`);
  return data;
}

export async function getAllRights(
  organizationId: string,
  params?: {
    q?: string;
    right_type?: string;
    status?: string;
    is_orphan_work?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<{ items: ObjectRight[]; total: number }> {
  const query = buildQueryString(params || {});
  return await apiFetch(`/organizations/${organizationId}/collections/rights${query}`);
}

export async function getRight(
  organizationId: string,
  rightId: string
): Promise<ObjectRight> {
  return await apiFetch(`/organizations/${organizationId}/collections/rights/${rightId}`);
}

export async function createObjectRight(
  organizationId: string,
  objectId: string,
  right: Partial<ObjectRight>
): Promise<ObjectRight> {
  return await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/rights`, {
    method: 'POST',
    body: JSON.stringify(right),
  });
}

export async function updateObjectRight(
  organizationId: string,
  rightId: string,
  right: Partial<ObjectRight>
): Promise<ObjectRight> {
  return await apiFetch(`/organizations/${organizationId}/collections/rights/${rightId}`, {
    method: 'PUT',
    body: JSON.stringify(right),
  });
}

export async function deleteObjectRight(
  organizationId: string,
  rightId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/rights/${rightId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// EMERGENCY PLANS
// ============================================================================

export async function getEmergencyPlans(
  organizationId: string,
  params?: {
    q?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<PaginatedEmergencyPlans> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/emergency-plans${query}`);
  return validate(PaginatedEmergencyPlansSchema, data);
}

export async function getEmergencyPlan(
  organizationId: string,
  planId: string
): Promise<EmergencyPlan> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/emergency-plans/${planId}`);
  return validate(EmergencyPlanSchema, data);
}

export async function createEmergencyPlan(
  organizationId: string,
  plan: Partial<EmergencyPlan>
): Promise<EmergencyPlan> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/emergency-plans`, {
    method: 'POST',
    body: JSON.stringify(plan),
  });
  return validate(EmergencyPlanSchema, data);
}

export async function updateEmergencyPlan(
  organizationId: string,
  planId: string,
  updates: Partial<EmergencyPlan>
): Promise<EmergencyPlan> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/emergency-plans/${planId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(EmergencyPlanSchema, data);
}

export async function approveEmergencyPlan(
  organizationId: string,
  planId: string
): Promise<EmergencyPlan> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/emergency-plans/${planId}/approve`, {
    method: 'POST',
  });
  return validate(EmergencyPlanSchema, data);
}

export async function activateEmergencyPlan(
  organizationId: string,
  planId: string
): Promise<EmergencyPlan> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/emergency-plans/${planId}/activate`, {
    method: 'POST',
  });
  return validate(EmergencyPlanSchema, data);
}

export async function deleteEmergencyPlan(
  organizationId: string,
  planId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/emergency-plans/${planId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// INCIDENT REPORTS
// ============================================================================

export async function getIncidentReports(
  organizationId: string,
  params?: {
    q?: string;
    incident_type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<PaginatedIncidentReports> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/incidents${query}`);
  return validate(PaginatedIncidentReportsSchema, data);
}

export async function getIncidentReport(
  organizationId: string,
  reportId: string
): Promise<IncidentReport> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/incidents/${reportId}`);
  return validate(IncidentReportSchema, data);
}

export async function createIncidentReport(
  organizationId: string,
  report: Partial<IncidentReport>
): Promise<IncidentReport> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/incidents`, {
    method: 'POST',
    body: JSON.stringify(report),
  });
  return validate(IncidentReportSchema, data);
}

export async function updateIncidentReport(
  organizationId: string,
  reportId: string,
  updates: Partial<IncidentReport>
): Promise<IncidentReport> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/incidents/${reportId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(IncidentReportSchema, data);
}

export async function addIncidentObject(
  organizationId: string,
  reportId: string,
  objectData: Partial<IncidentReportObject>
): Promise<IncidentReportObject> {
  return await apiFetch(`/organizations/${organizationId}/collections/incidents/${reportId}/objects`, {
    method: 'POST',
    body: JSON.stringify(objectData),
  });
}

export async function removeIncidentObject(
  organizationId: string,
  reportId: string,
  objectId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/incidents/${reportId}/objects/${objectId}`, {
    method: 'DELETE',
  });
}

export async function closeIncidentReport(
  organizationId: string,
  reportId: string
): Promise<IncidentReport> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/incidents/${reportId}/close`, {
    method: 'POST',
  });
  return validate(IncidentReportSchema, data);
}

export async function deleteIncidentReport(
  organizationId: string,
  reportId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/incidents/${reportId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// COLLECTIONS REVIEWS
// ============================================================================

export async function getCollectionsReviews(
  organizationId: string,
  params?: {
    q?: string;
    review_type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<PaginatedCollectionsReviews> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/reviews${query}`);
  return validate(PaginatedCollectionsReviewsSchema, data);
}

export async function getCollectionsReview(
  organizationId: string,
  reviewId: string
): Promise<CollectionsReview> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/reviews/${reviewId}`);
  return validate(CollectionsReviewSchema, data);
}

export async function createCollectionsReview(
  organizationId: string,
  review: Partial<CollectionsReview>
): Promise<CollectionsReview> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/reviews`, {
    method: 'POST',
    body: JSON.stringify(review),
  });
  return validate(CollectionsReviewSchema, data);
}

export async function updateCollectionsReview(
  organizationId: string,
  reviewId: string,
  updates: Partial<CollectionsReview>
): Promise<CollectionsReview> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/reviews/${reviewId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(CollectionsReviewSchema, data);
}

export async function approveCollectionsReview(
  organizationId: string,
  reviewId: string
): Promise<CollectionsReview> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/reviews/${reviewId}/approve`, {
    method: 'POST',
  });
  return validate(CollectionsReviewSchema, data);
}

export async function startCollectionsReview(
  organizationId: string,
  reviewId: string
): Promise<CollectionsReview> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/reviews/${reviewId}/start`, {
    method: 'POST',
  });
  return validate(CollectionsReviewSchema, data);
}

export async function completeCollectionsReview(
  organizationId: string,
  reviewId: string
): Promise<CollectionsReview> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/reviews/${reviewId}/complete`, {
    method: 'POST',
  });
  return validate(CollectionsReviewSchema, data);
}

export async function getReviewAssessments(
  organizationId: string,
  reviewId: string,
  params?: { limit?: number; offset?: number }
): Promise<{ items: ObjectReviewAssessment[]; total: number }> {
  const query = buildQueryString(params || {});
  return await apiFetch(`/organizations/${organizationId}/collections/reviews/${reviewId}/assessments${query}`);
}

export async function createReviewAssessment(
  organizationId: string,
  reviewId: string,
  assessment: Partial<ObjectReviewAssessment>
): Promise<ObjectReviewAssessment> {
  return await apiFetch(`/organizations/${organizationId}/collections/reviews/${reviewId}/assessments`, {
    method: 'POST',
    body: JSON.stringify(assessment),
  });
}

export async function deleteCollectionsReview(
  organizationId: string,
  reviewId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/reviews/${reviewId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// AUDIT CAMPAIGNS
// ============================================================================

export async function getAuditCampaigns(
  organizationId: string,
  params?: {
    q?: string;
    audit_type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<PaginatedAuditCampaigns> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/audits${query}`);
  return validate(PaginatedAuditCampaignsSchema, data);
}

export async function getAuditCampaign(
  organizationId: string,
  campaignId: string
): Promise<AuditCampaign> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/audits/${campaignId}`);
  return validate(AuditCampaignSchema, data);
}

export async function createAuditCampaign(
  organizationId: string,
  campaign: Partial<AuditCampaign>
): Promise<AuditCampaign> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/audits`, {
    method: 'POST',
    body: JSON.stringify(campaign),
  });
  return validate(AuditCampaignSchema, data);
}

export async function updateAuditCampaign(
  organizationId: string,
  campaignId: string,
  updates: Partial<AuditCampaign>
): Promise<AuditCampaign> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/audits/${campaignId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(AuditCampaignSchema, data);
}

export async function approveAuditCampaign(
  organizationId: string,
  campaignId: string
): Promise<AuditCampaign> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/audits/${campaignId}/approve`, {
    method: 'POST',
  });
  return validate(AuditCampaignSchema, data);
}

export async function startAuditCampaign(
  organizationId: string,
  campaignId: string
): Promise<AuditCampaign> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/audits/${campaignId}/start`, {
    method: 'POST',
  });
  return validate(AuditCampaignSchema, data);
}

export async function completeAuditCampaign(
  organizationId: string,
  campaignId: string
): Promise<AuditCampaign> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/audits/${campaignId}/complete`, {
    method: 'POST',
  });
  return validate(AuditCampaignSchema, data);
}

export async function getAuditResults(
  organizationId: string,
  campaignId: string,
  params?: { limit?: number; offset?: number }
): Promise<{ items: AuditResult[]; total: number }> {
  const query = buildQueryString(params || {});
  return await apiFetch(`/organizations/${organizationId}/collections/audits/${campaignId}/results${query}`);
}

export async function createAuditResult(
  organizationId: string,
  campaignId: string,
  result: Partial<AuditResult>
): Promise<AuditResult> {
  return await apiFetch(`/organizations/${organizationId}/collections/audits/${campaignId}/results`, {
    method: 'POST',
    body: JSON.stringify(result),
  });
}

export async function deleteAuditCampaign(
  organizationId: string,
  campaignId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/audits/${campaignId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// USE REQUESTS
// ============================================================================

export async function getUseRequests(
  organizationId: string,
  params?: {
    q?: string;
    use_type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<PaginatedUseRequests> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/use-requests${query}`);
  return validate(PaginatedUseRequestsSchema, data);
}

export async function getUseRequest(
  organizationId: string,
  requestId: string
): Promise<UseRequest> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/use-requests/${requestId}`);
  return validate(UseRequestSchema, data);
}

export async function createUseRequest(
  organizationId: string,
  request: Partial<UseRequest>
): Promise<UseRequest> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/use-requests`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return validate(UseRequestSchema, data);
}

export async function updateUseRequest(
  organizationId: string,
  requestId: string,
  updates: Partial<UseRequest>
): Promise<UseRequest> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/use-requests/${requestId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(UseRequestSchema, data);
}

export async function getUseRequestObjects(
  organizationId: string,
  requestId: string
): Promise<{ objects: UseRequestObject[] }> {
  return await apiFetch(`/organizations/${organizationId}/collections/use-requests/${requestId}/objects`);
}

export async function addUseRequestObject(
  organizationId: string,
  requestId: string,
  objectData: { object_id: string; object_note?: string; special_handling?: string }
): Promise<UseRequestObject> {
  return await apiFetch(`/organizations/${organizationId}/collections/use-requests/${requestId}/objects`, {
    method: 'POST',
    body: JSON.stringify(objectData),
  });
}

export async function removeUseRequestObject(
  organizationId: string,
  requestId: string,
  objectId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/collections/use-requests/${requestId}/objects/${objectId}`, {
    method: 'DELETE',
  });
}

export async function approveUseRequest(
  organizationId: string,
  requestId: string
): Promise<UseRequest> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/use-requests/${requestId}/approve`, {
    method: 'POST',
  });
  return validate(UseRequestSchema, data);
}

export async function denyUseRequest(
  organizationId: string,
  requestId: string
): Promise<UseRequest> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/use-requests/${requestId}/deny`, {
    method: 'POST',
  });
  return validate(UseRequestSchema, data);
}

export async function completeUseRequest(
  organizationId: string,
  requestId: string
): Promise<UseRequest> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/use-requests/${requestId}/complete`, {
    method: 'POST',
  });
  return validate(UseRequestSchema, data);
}

export async function deleteUseRequest(
  organizationId: string,
  requestId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/use-requests/${requestId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// VALUATIONS
// ============================================================================

export async function getValuations(
  organizationId: string,
  params?: {
    q?: string;
    object_id?: string;
    valuation_type?: string;
    is_current?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<PaginatedValuations> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/valuations${query}`);
  return validate(PaginatedValuationsSchema, data);
}

export async function getObjectValuations(
  organizationId: string,
  objectId: string
): Promise<Valuation[]> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/valuations`);
  return data.valuations ?? [];
}

export async function getValuation(
  organizationId: string,
  valuationId: string
): Promise<Valuation> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/valuations/${valuationId}`);
  return validate(ValuationSchema, data);
}

export async function createValuation(
  organizationId: string,
  valuation: Partial<Valuation>
): Promise<Valuation> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/valuations`, {
    method: 'POST',
    body: JSON.stringify(valuation),
  });
  return validate(ValuationSchema, data);
}

export async function updateValuation(
  organizationId: string,
  valuationId: string,
  updates: Partial<Valuation>
): Promise<Valuation> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/valuations/${valuationId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(ValuationSchema, data);
}

export async function deleteValuation(
  organizationId: string,
  valuationId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/valuations/${valuationId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// REPRODUCTION REQUESTS
// ============================================================================

export async function getReproductionRequests(
  organizationId: string,
  params?: {
    q?: string;
    reproduction_type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<PaginatedReproductionRequests> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/reproduction-requests${query}`);
  return validate(PaginatedReproductionRequestsSchema, data);
}

export async function getReproductionRequest(
  organizationId: string,
  requestId: string
): Promise<ReproductionRequest> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/reproduction-requests/${requestId}`);
  return validate(ReproductionRequestSchema, data);
}

export async function createReproductionRequest(
  organizationId: string,
  request: Partial<ReproductionRequest>
): Promise<ReproductionRequest> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/reproduction-requests`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return validate(ReproductionRequestSchema, data);
}

export async function updateReproductionRequest(
  organizationId: string,
  requestId: string,
  updates: Partial<ReproductionRequest>
): Promise<ReproductionRequest> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/reproduction-requests/${requestId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return validate(ReproductionRequestSchema, data);
}

export async function clearReproductionRights(
  organizationId: string,
  requestId: string
): Promise<ReproductionRequest> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/reproduction-requests/${requestId}/clear-rights`, {
    method: 'POST',
  });
  return validate(ReproductionRequestSchema, data);
}

export async function deliverReproduction(
  organizationId: string,
  requestId: string
): Promise<ReproductionRequest> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/reproduction-requests/${requestId}/deliver`, {
    method: 'POST',
  });
  return validate(ReproductionRequestSchema, data);
}

export async function deleteReproductionRequest(
  organizationId: string,
  requestId: string
): Promise<{ success: boolean }> {
  return await apiFetch(`/organizations/${organizationId}/collections/reproduction-requests/${requestId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// AUTHORITY VERIFICATION
// ============================================================================

export async function verifyAuthority(
  organizationId: string,
  authorityId: string
): Promise<PersonAuthority> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/authorities/${authorityId}/verify`, {
    method: 'POST',
  });
  return validate(PersonAuthoritySchema, data);
}

// ============================================================================
// INSURANCE MANAGEMENT
// ============================================================================

// --- Insurance Policies ---

export async function getInsurancePolicies(
  organizationId: string,
  params?: {
    status?: string;
    policy_type?: string;
    active_only?: boolean;
  }
): Promise<InsurancePoliciesList> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/policies${query}`);
  return validate(InsurancePoliciesListSchema, data);
}

export async function getInsurancePolicy(
  organizationId: string,
  policyId: string
): Promise<InsurancePolicy> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/policies/${policyId}`);
  return validate(InsurancePolicySchema, data);
}

export async function createInsurancePolicy(
  organizationId: string,
  policy: Partial<InsurancePolicy>
): Promise<InsurancePolicy> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/policies`, {
    method: 'POST',
    body: JSON.stringify(policy),
  });
  return validate(InsurancePolicySchema, data);
}

export async function updateInsurancePolicy(
  organizationId: string,
  policyId: string,
  updates: Partial<InsurancePolicy>
): Promise<InsurancePolicy> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/policies/${policyId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return validate(InsurancePolicySchema, data);
}

export async function deleteInsurancePolicy(
  organizationId: string,
  policyId: string
): Promise<void> {
  await apiFetch(`/organizations/${organizationId}/collections/insurance/policies/${policyId}`, {
    method: 'DELETE',
  });
}

export async function approveInsurancePolicy(
  organizationId: string,
  policyId: string
): Promise<InsurancePolicy> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/policies/${policyId}/approve`, {
    method: 'POST',
  });
  return validate(InsurancePolicySchema, data);
}

// --- Insurance Coverages ---

export async function getInsuranceCoverages(
  organizationId: string,
  params?: {
    policy_id?: string;
    entity_type?: string;
    status?: string;
  }
): Promise<InsuranceCoveragesList> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/coverages${query}`);
  return validate(InsuranceCoveragesListSchema, data);
}

export async function getInsuranceCoverage(
  organizationId: string,
  coverageId: string
): Promise<InsuranceCoverage> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/coverages/${coverageId}`);
  return validate(InsuranceCoverageSchema, data);
}

export async function createInsuranceCoverage(
  organizationId: string,
  coverage: Partial<InsuranceCoverage>
): Promise<InsuranceCoverage> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/coverages`, {
    method: 'POST',
    body: JSON.stringify(coverage),
  });
  return validate(InsuranceCoverageSchema, data);
}

export async function updateInsuranceCoverage(
  organizationId: string,
  coverageId: string,
  updates: Partial<InsuranceCoverage>
): Promise<InsuranceCoverage> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/coverages/${coverageId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return validate(InsuranceCoverageSchema, data);
}

export async function confirmInsuranceCoverage(
  organizationId: string,
  coverageId: string
): Promise<InsuranceCoverage> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/coverages/${coverageId}/confirm`, {
    method: 'POST',
  });
  return validate(InsuranceCoverageSchema, data);
}

// --- Entity-specific Insurance Lookups ---

export async function getObjectInsurance(
  organizationId: string,
  objectId: string
): Promise<InsuranceCoveragesList> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/objects/${objectId}/insurance`);
  return validate(InsuranceCoveragesListSchema, data);
}

export async function getLoanInInsurance(
  organizationId: string,
  loanId: string
): Promise<InsuranceCoveragesList> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-in/${loanId}/insurance`);
  return validate(InsuranceCoveragesListSchema, data);
}

export async function getLoanOutInsurance(
  organizationId: string,
  loanId: string
): Promise<InsuranceCoveragesList> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/loans-out/${loanId}/insurance`);
  return validate(InsuranceCoveragesListSchema, data);
}

export async function getShipmentInsurance(
  organizationId: string,
  shipmentId: string
): Promise<InsuranceCoveragesList> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/shipments/${shipmentId}/insurance`);
  return validate(InsuranceCoveragesListSchema, data);
}

// --- Indemnity Arrangements ---

export async function getIndemnityArrangements(
  organizationId: string,
  params?: {
    program?: string;
    status?: string;
    exhibition_id?: string;
  }
): Promise<IndemnityArrangementsList> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/indemnities${query}`);
  return validate(IndemnityArrangementsListSchema, data);
}

export async function getIndemnityArrangement(
  organizationId: string,
  indemnityId: string
): Promise<IndemnityArrangement> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/indemnities/${indemnityId}`);
  return validate(IndemnityArrangementSchema, data);
}

export async function createIndemnityArrangement(
  organizationId: string,
  indemnity: Partial<IndemnityArrangement>
): Promise<IndemnityArrangement> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/indemnities`, {
    method: 'POST',
    body: JSON.stringify(indemnity),
  });
  return validate(IndemnityArrangementSchema, data);
}

export async function updateIndemnityArrangement(
  organizationId: string,
  indemnityId: string,
  updates: Partial<IndemnityArrangement>
): Promise<IndemnityArrangement> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/indemnities/${indemnityId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return validate(IndemnityArrangementSchema, data);
}

export async function submitIndemnityArrangement(
  organizationId: string,
  indemnityId: string
): Promise<IndemnityArrangement> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/indemnities/${indemnityId}/submit`, {
    method: 'POST',
  });
  return validate(IndemnityArrangementSchema, data);
}

// --- Indemnity Objects ---

export async function addIndemnityObject(
  organizationId: string,
  indemnityId: string,
  body: {
    object_id: string;
    declared_value?: number | null;
    approved_value?: number | null;
    value_currency?: string | null;
    object_number?: string | null;
    object_title?: string | null;
    notes?: string | null;
  },
): Promise<Record<string, unknown>> {
  return apiFetch(
    `/organizations/${organizationId}/collections/insurance/indemnities/${indemnityId}/objects`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export async function removeIndemnityObject(
  organizationId: string,
  indemnityId: string,
  linkId: string,
): Promise<void> {
  await apiFetch(
    `/organizations/${organizationId}/collections/insurance/indemnities/${indemnityId}/objects/${linkId}`,
    { method: 'DELETE' },
  );
}

// --- Insurance Claims ---

export async function getInsuranceClaims(
  organizationId: string,
  params?: {
    status?: string;
    loss_type?: string;
    coverage_id?: string;
    indemnity_id?: string;
  }
): Promise<InsuranceClaimsList> {
  const query = buildQueryString(params || {});
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/claims${query}`);
  return validate(InsuranceClaimsListSchema, data);
}

export async function getInsuranceClaim(
  organizationId: string,
  claimId: string
): Promise<InsuranceClaim> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/claims/${claimId}`);
  return validate(InsuranceClaimSchema, data);
}

export async function createInsuranceClaim(
  organizationId: string,
  claim: Partial<InsuranceClaim>
): Promise<InsuranceClaim> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/claims`, {
    method: 'POST',
    body: JSON.stringify(claim),
  });
  return validate(InsuranceClaimSchema, data);
}

export async function updateInsuranceClaim(
  organizationId: string,
  claimId: string,
  updates: Partial<InsuranceClaim>
): Promise<InsuranceClaim> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/claims/${claimId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return validate(InsuranceClaimSchema, data);
}

export async function fileInsuranceClaim(
  organizationId: string,
  claimId: string
): Promise<InsuranceClaim> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/claims/${claimId}/file`, {
    method: 'POST',
  });
  return validate(InsuranceClaimSchema, data);
}

export async function settleInsuranceClaim(
  organizationId: string,
  claimId: string,
  settlementAmount?: number
): Promise<InsuranceClaim> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/claims/${claimId}/settle`, {
    method: 'POST',
    body: JSON.stringify({ settlement_amount: settlementAmount }),
  });
  return validate(InsuranceClaimSchema, data);
}

// --- Insurance Enums ---

export async function getInsuranceEnums(
  organizationId: string
): Promise<InsuranceEnums> {
  const data = await apiFetch(`/organizations/${organizationId}/collections/insurance/enums`);
  return validate(InsuranceEnumsSchema, data);
}
