"""
Data-driven form registry for all procedure entity types.

Provides structured metadata about every entity's fields, sections,
statuses, and status-advancement requirements. Used by the agent to
give context-aware data-entry guidance and by get_record_summary to
produce formatted record overviews.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.services.workflow_definitions import WORKFLOW_DEFINITIONS
from app.services.procedure_requirements import derive_status_requirements


# ============================================================================
# DATACLASSES
# ============================================================================

@dataclass(frozen=True)
class FieldMeta:
    """Metadata for a single form field."""
    name: str
    label: str
    section: str
    field_type: str  # text, date, boolean, currency, integer, contact, enum, json
    required: bool = False
    enum_values: list[str] | None = None
    lookup_category: str | None = None  # e.g. 'location', 'user', 'constituent'


@dataclass(frozen=True)
class StatusRequirement:
    """Fields required to advance to a given status."""
    target_status: str
    target_status_label: str
    required_fields: list[str]


@dataclass(frozen=True)
class FormDefinition:
    """Complete form definition for a single entity type."""
    entity_type: str
    entity_label: str
    procedure: str
    statuses: list[str]
    status_labels: dict[str, str]
    fields: list[FieldMeta]
    status_requirements: list[StatusRequirement] = field(default_factory=list)


# ============================================================================
# HELPER
# ============================================================================

def _label(name: str) -> str:
    """Convert snake_case field name to a human-readable label."""
    return name.replace("_", " ").replace(" id", "").strip().title()


def _derive_status_reqs(entity_type: str, status_labels: dict[str, str]) -> list[StatusRequirement]:
    """Derive StatusRequirement list from PROCEDURE_REQUIREMENTS for a procedure.

    Only includes blocking requirements (not recommended/info).

    For ``collection_object``, merges requirements from both the
    ``inventory`` and ``cataloging`` procedure types because those
    procedures apply to collection objects but are registered under
    their own procedure_type keys, not under ``collection_object``.
    """
    # Merge multiple procedure types for entities that have compound
    # requirement sets (inventory + cataloging for collection objects).
    procedure_keys = _ENTITY_PROCEDURE_MAP.get(entity_type, [entity_type])

    status_fields: dict[str, list] = {}
    for key in procedure_keys:
        for status, reqs in derive_status_requirements(key).items():
            status_fields.setdefault(status, []).extend(reqs)

    result = []
    for status, field_reqs in status_fields.items():
        blocking_fields = sorted({
            fr.field_path for fr in field_reqs if fr.severity == "blocking"
        })
        if blocking_fields:
            result.append(StatusRequirement(
                target_status=status,
                target_status_label=status_labels.get(status, status.replace("_", " ").title()),
                required_fields=blocking_fields,
            ))
    return result


# Entity types that draw requirements from multiple procedure definitions.
_ENTITY_PROCEDURE_MAP: dict[str, list[str]] = {
    "collection_object": ["inventory", "cataloging"],
}


# ============================================================================
# OBJECT ENTRY
# ============================================================================

_OBJECT_ENTRY_STATUS_LABELS = {
    "pending": "Pending",
    "received": "Received",
    "processing": "Processing",
    "processed": "Processed",
    "returned": "Returned",
    "acquired": "Acquired",
}

_OBJECT_ENTRY = FormDefinition(
    entity_type="object_entry",
    entity_label="Object Entry",
    procedure="Object Entry",
    statuses=WORKFLOW_DEFINITIONS["object_entry"].valid_statuses,
    status_labels=_OBJECT_ENTRY_STATUS_LABELS,
    fields=[
        # Entry Information
        FieldMeta("entry_number", "Entry number", "entry", "text", required=True),
        FieldMeta("entry_date", "Entry date", "entry", "date", required=True),
        FieldMeta("department_id", "Department", "entry", "contact", lookup_category="department"),
        FieldMeta("entry_reason", "Entry reason", "entry", "enum", required=True,
                  enum_values=["loan_consideration", "gift_offer", "purchase_consideration",
                               "identification", "conservation", "photography", "research",
                               "enquiry", "other"]),
        FieldMeta("entry_method", "Entry method", "entry", "text"),
        # Depositor
        FieldMeta("depositor_id", "Depositor", "depositor", "contact", required=True,
                  lookup_category="constituent"),
        FieldMeta("current_owner_id", "Current owner", "depositor", "contact",
                  lookup_category="constituent"),
        # Objects (entry-level summary; individual items live in object_entry_items)
        FieldMeta("objects_description", "Brief description", "objects", "text", required=True),
        # Duration & Return
        FieldMeta("expected_return_date", "Expected return date", "duration", "date"),
        FieldMeta("expected_duration", "Expected duration", "duration", "text"),
        FieldMeta("conditions", "Conditions", "duration", "text"),
        FieldMeta("special_conditions", "Special conditions", "duration", "text"),
        FieldMeta("depositor_requirements", "Depositor requirements", "duration", "text"),
        # Insurance
        FieldMeta("insurance_value", "Insurance value", "insurance", "currency"),
        FieldMeta("insurance_currency", "Currency", "insurance", "text"),
        FieldMeta("insurance_policy", "Insurance policy", "insurance", "text"),
        FieldMeta("insurance_note", "Insurance note", "insurance", "text"),
        # Terms & Conditions
        FieldMeta("terms_accepted", "Terms accepted", "terms-acceptance", "boolean", required=True),
        FieldMeta("terms_accepted_date", "Acceptance date", "terms-acceptance", "date"),
        FieldMeta("terms_accepted_by_id", "Accepted by", "terms-acceptance", "contact",
                  lookup_category="constituent"),
        FieldMeta("signature_reference", "Signature reference", "terms-acceptance", "text"),
        # Receipt
        FieldMeta("receipt_reference", "Receipt reference", "receipt", "text"),
        FieldMeta("receipt_date", "Receipt date", "receipt", "date"),
        # Packing
        FieldMeta("packing_note", "Packing note", "packing", "text"),
        FieldMeta("packing_method", "Packing method", "packing", "text"),
        # Location
        FieldMeta("location_id", "Storage location", "location", "text", lookup_category="location"),
        # Manager
        FieldMeta("entry_manager_id", "Entry manager", "manager", "text", lookup_category="user"),
        FieldMeta("entry_note", "Entry note", "notes", "text"),
        # Outcome
        FieldMeta("outcome", "Outcome", "outcome", "enum",
                  enum_values=["returned", "acquired", "transferred"]),
        FieldMeta("outcome_note", "Outcome note", "outcome", "text"),
        # Return
        FieldMeta("return_date", "Return date", "return", "date"),
        FieldMeta("returned_to", "Returned to", "return", "text"),
        FieldMeta("return_method", "Return method", "return", "text"),
        FieldMeta("return_receipt_reference", "Return receipt reference", "return", "text"),
    ],
    status_requirements=_derive_status_reqs("object_entry", _OBJECT_ENTRY_STATUS_LABELS),
)


# ============================================================================
# ACQUISITION
# ============================================================================

_ACQUISITION_STATUS_LABELS = {
    "proposed": "Proposed",
    "pending_approval": "Pending Approval",
    "approved": "Approved",
    "completed": "Completed",
    "accessioned": "Accessioned",
    "cancelled": "Cancelled",
}

_ACQUISITION = FormDefinition(
    entity_type="acquisition",
    entity_label="Acquisition",
    procedure="Acquisition",
    statuses=WORKFLOW_DEFINITIONS["acquisition"].valid_statuses,
    status_labels=_ACQUISITION_STATUS_LABELS,
    fields=[
        # Identification
        FieldMeta("acquisition_number", "Acquisition number", "identification", "text", required=True),
        FieldMeta("department_id", "Department", "identification", "contact", lookup_category="department"),
        FieldMeta("acquisition_method", "Acquisition method", "identification", "enum", required=True,
                  enum_values=["gift", "purchase", "bequest", "transfer", "exchange",
                               "field_collection", "commission", "found_in_collection",
                               "conversion", "donation", "unknown"]),
        FieldMeta("acquisition_date", "Acquisition date", "identification", "date"),
        # Accessioning
        FieldMeta("accession_number", "Accession number", "accessioning", "text"),
        FieldMeta("accession_date", "Accession date", "accessioning", "date"),
        FieldMeta("accessioning_approved", "Accessioning approved", "accessioning", "boolean"),
        FieldMeta("accessioning_approved_date", "Approved date", "accessioning", "date"),
        FieldMeta("accessioning_resolution", "Resolution", "accessioning", "text"),
        FieldMeta("accessioning_note", "Note", "accessioning", "text"),
        # Source
        FieldMeta("source_id", "Source", "source", "contact", lookup_category="constituent"),
        FieldMeta("source_name", "Source name", "source", "text"),
        FieldMeta("source_type", "Source type", "source", "text"),
        # Authorization
        FieldMeta("authorization_date", "Authorization date", "authorization", "date"),
        FieldMeta("authorization_note", "Authorization note", "authorization", "text"),
        # Board approval
        FieldMeta("board_approval_required", "Board approval required", "board-approval", "boolean"),
        FieldMeta("board_approval_date", "Board approval date", "board-approval", "date"),
        FieldMeta("board_approval_reference", "Board reference", "board-approval", "text"),
        FieldMeta("board_note", "Board note", "board-approval", "text"),
        # Cost/Value
        FieldMeta("cost", "Cost", "cost", "currency"),
        FieldMeta("cost_currency", "Currency", "cost", "text"),
        FieldMeta("funding_source", "Funding source", "cost", "text"),
        FieldMeta("funding_account", "Funding account", "cost", "text"),
        FieldMeta("funding_note", "Funding note", "cost", "text"),
        # Appraisal
        FieldMeta("appraised_value", "Appraised value", "appraisal", "currency"),
        FieldMeta("appraised_value_currency", "Currency", "appraisal", "text"),
        FieldMeta("appraised_date", "Appraisal date", "appraisal", "date"),
        FieldMeta("appraiser_name", "Appraiser", "appraisal", "text"),
        # Legal
        FieldMeta("legal_status", "Legal status", "legal", "text"),
        FieldMeta("legal_note", "Legal note", "legal", "text"),
        # Provenance
        FieldMeta("provenance_verified", "Provenance verified", "provenance", "boolean"),
        FieldMeta("provenance_note", "Provenance note", "provenance", "text"),
        # Restrictions
        FieldMeta("provisos", "Provisos", "restrictions", "text"),
        FieldMeta("donor_restrictions", "Donor restrictions", "restrictions", "text"),
        FieldMeta("credit_line", "Credit line", "restrictions", "text"),
        # Documentation
        FieldMeta("deed_of_gift_date", "Deed of gift date", "documentation", "date"),
        FieldMeta("deed_of_gift_reference", "Deed of gift reference", "documentation", "text"),
        FieldMeta("transfer_of_title_number", "Transfer of title number", "documentation", "text"),
        # Notes
        FieldMeta("acquisition_note", "Acquisition note", "notes", "text"),
        FieldMeta("internal_note", "Internal note", "notes", "text"),
    ],
    status_requirements=_derive_status_reqs("acquisition", _ACQUISITION_STATUS_LABELS),
)


# ============================================================================
# LOAN IN
# ============================================================================

_LOAN_IN_STATUS_LABELS = {
    "requested": "Requested",
    "pending_approval": "Pending Approval",
    "approved": "Approved",
    "agreement_sent": "Agreement Sent",
    "agreement_signed": "Agreement Signed",
    "in_transit": "In Transit",
    "received": "Received",
    "on_loan": "On Loan",
    "return_initiated": "Return Initiated",
    "returned": "Returned",
    "closed": "Closed",
    "cancelled": "Cancelled",
    "overdue": "Overdue",
}

_LOAN_IN = FormDefinition(
    entity_type="loan_in",
    entity_label="Loan In",
    procedure="Loans In",
    statuses=WORKFLOW_DEFINITIONS["loan_in"].valid_statuses,
    status_labels=_LOAN_IN_STATUS_LABELS,
    fields=[
        # Lender
        FieldMeta("lender_id", "Lender", "lender", "contact", required=True,
                  lookup_category="constituent"),
        # Lender Authorization
        FieldMeta("lender_authorizer_id", "Authorizer", "lender-authorization", "contact",
                  lookup_category="constituent"),
        FieldMeta("lender_authorizer_name", "Authorizer name", "lender-authorization", "text"),
        FieldMeta("lender_authorizer_title", "Authorizer title", "lender-authorization", "text"),
        FieldMeta("lender_authorization_date", "Authorization date", "lender-authorization", "date"),
        # Details
        FieldMeta("loan_number", "Loan number", "details", "text", required=True),
        FieldMeta("department_id", "Department", "details", "contact", lookup_category="department"),
        FieldMeta("loan_purpose", "Loan purpose", "details", "enum", required=True,
                  enum_values=["exhibition", "research", "conservation", "long_term",
                               "photography", "education", "study", "other"]),
        FieldMeta("exhibition_name", "Exhibition name", "details", "text"),
        FieldMeta("exhibition_venue", "Exhibition venue", "details", "text"),
        FieldMeta("loan_conditions", "Loan conditions", "details", "text"),
        FieldMeta("special_requirements", "Special requirements", "details", "text"),
        FieldMeta("display_requirements", "Display requirements", "details", "text"),
        FieldMeta("photography_restrictions", "Photography restrictions", "details", "text"),
        # Dates
        FieldMeta("request_date", "Request date", "dates", "date", required=True),
        FieldMeta("approval_date", "Approval date", "dates", "date"),
        FieldMeta("loan_start_date", "Loan start date", "dates", "date", required=True),
        FieldMeta("loan_end_date", "Loan end date", "dates", "date", required=True),
        FieldMeta("actual_receipt_date", "Actual receipt date", "dates", "date"),
        FieldMeta("actual_return_date", "Actual return date", "dates", "date"),
        # Insurance
        FieldMeta("insurance_value", "Insurance value", "insurance", "currency", required=True),
        FieldMeta("insurance_currency", "Currency", "insurance", "text"),
        FieldMeta("insurance_policy", "Policy number", "insurance", "text"),
        FieldMeta("insurance_provider", "Provider", "insurance", "text"),
        FieldMeta("indemnity", "Indemnity", "insurance", "boolean"),
        FieldMeta("indemnity_reference", "Indemnity reference", "insurance", "text"),
        # Facility report
        FieldMeta("facility_report_sent", "Report sent", "facility", "boolean"),
        FieldMeta("facility_report_date", "Report date", "facility", "date"),
        FieldMeta("facility_report_approved", "Report approved", "facility", "boolean"),
        FieldMeta("facility_report_approved_date", "Approved date", "facility", "date"),
        FieldMeta("facility_report_note", "Report notes", "facility", "text"),
        # Shipping
        FieldMeta("shipping_method", "Shipping method", "shipping", "text"),
        FieldMeta("shipping_company", "Shipping company", "shipping", "text"),
        FieldMeta("courier_required", "Courier required", "shipping", "boolean"),
        FieldMeta("courier_details", "Courier details", "shipping", "text"),
        FieldMeta("crate_required", "Crate required", "shipping", "boolean"),
        FieldMeta("crate_specifications", "Crate specifications", "shipping", "text"),
        # Condition reports
        FieldMeta("condition_report_in_id", "Incoming condition report", "condition-reports", "text"),
        FieldMeta("condition_report_out_id", "Outgoing condition report", "condition-reports", "text"),
        # Agreement
        FieldMeta("loan_agreement_reference", "Agreement reference", "agreement", "text", required=True),
        FieldMeta("loan_agreement_date", "Agreement date", "agreement", "date"),
        FieldMeta("loan_agreement_signed_date", "Signed date", "agreement", "date"),
        # Renewals
        FieldMeta("renewal_count", "Renewal count", "renewals", "integer"),
        FieldMeta("max_renewals", "Maximum renewals", "renewals", "integer"),
        # Document location
        FieldMeta("document_location", "File location", "document-location", "text"),
        FieldMeta("document_location_note", "Location notes", "document-location", "text"),
        # Loan contact
        FieldMeta("loan_contact_name", "Contact name", "loan-contact", "text"),
        FieldMeta("loan_contact_email", "Contact email", "loan-contact", "text"),
        FieldMeta("loan_contact_phone", "Contact phone", "loan-contact", "text"),
        # Notes
        FieldMeta("loan_note", "Loan note", "notes", "text"),
        FieldMeta("internal_note", "Internal notes", "notes", "text"),
    ],
    status_requirements=_derive_status_reqs("loan_in", _LOAN_IN_STATUS_LABELS),
)


# ============================================================================
# LOAN OUT
# ============================================================================

_LOAN_OUT_STATUS_LABELS = {
    "requested": "Requested",
    "pending_approval": "Pending Approval",
    "approved": "Approved",
    "agreement_sent": "Agreement Sent",
    "agreement_signed": "Agreement Signed",
    "in_transit": "In Transit",
    "on_loan": "On Loan",
    "return_scheduled": "Return Scheduled",
    "returned": "Returned",
    "closed": "Closed",
    "declined": "Declined",
    "cancelled": "Cancelled",
}

_LOAN_OUT = FormDefinition(
    entity_type="loan_out",
    entity_label="Loan Out",
    procedure="Loans Out",
    statuses=WORKFLOW_DEFINITIONS["loan_out"].valid_statuses,
    status_labels=_LOAN_OUT_STATUS_LABELS,
    fields=[
        # Identification
        FieldMeta("loan_number", "Loan number", "identification", "text", required=True),
        FieldMeta("department_id", "Department", "identification", "contact", lookup_category="department"),
        # Borrower
        FieldMeta("borrower_id", "Borrower", "borrower", "contact",
                  lookup_category="constituent"),
        FieldMeta("borrower_name", "Borrower name", "borrower", "text"),
        # Venue
        FieldMeta("venue_name", "Venue name", "venue", "text"),
        # Purpose
        FieldMeta("loan_purpose", "Loan purpose", "purpose", "enum", required=True,
                  enum_values=["exhibition", "research", "conservation", "education",
                               "photography", "touring", "inter_museum", "other"]),
        FieldMeta("exhibition_title", "Exhibition title", "purpose", "text"),
        # Dates
        FieldMeta("request_date", "Request date", "dates", "date"),
        FieldMeta("approval_date", "Approval date", "dates", "date"),
        FieldMeta("board_approval_date", "Board approval date", "dates", "date"),
        FieldMeta("loan_start_date", "Loan start date", "dates", "date"),
        FieldMeta("loan_end_date", "Loan end date", "dates", "date"),
        FieldMeta("actual_dispatch_date", "Actual dispatch date", "dates", "date"),
        FieldMeta("actual_return_date", "Actual return date", "dates", "date"),
        # Conditions
        FieldMeta("loan_conditions", "Loan conditions", "conditions", "text"),
        FieldMeta("special_conditions", "Special conditions", "conditions", "text"),
        FieldMeta("display_requirements", "Display requirements", "conditions", "text"),
        FieldMeta("installation_requirements", "Installation requirements", "conditions", "text"),
        FieldMeta("photography_restrictions", "Photography restrictions", "conditions", "text"),
        # Insurance
        FieldMeta("insurance_value_total", "Insurance value total", "insurance", "currency"),
        FieldMeta("insurance_currency", "Currency", "insurance", "text"),
        FieldMeta("insurance_requirements", "Insurance requirements", "insurance", "text"),
        FieldMeta("insurance_coverage_type", "Coverage type", "insurance", "text"),
        FieldMeta("certificate_of_insurance_required", "Certificate required", "insurance", "boolean"),
        FieldMeta("certificate_of_insurance_received", "Certificate received", "insurance", "boolean"),
        FieldMeta("certificate_of_insurance_date", "Certificate date", "insurance", "date"),
        # Facility report
        FieldMeta("facility_report_required", "Facility report required", "facility", "boolean"),
        FieldMeta("facility_report_received", "Report received", "facility", "boolean"),
        FieldMeta("facility_report_date", "Report date", "facility", "date"),
        FieldMeta("facility_report_approved", "Report approved", "facility", "boolean"),
        FieldMeta("facility_report_note", "Report notes", "facility", "text"),
        # Shipping
        FieldMeta("shipping_method", "Shipping method", "shipping", "text"),
        FieldMeta("shipping_company", "Shipping company", "shipping", "text"),
        FieldMeta("courier_required", "Courier required", "shipping", "boolean"),
        FieldMeta("crate_required", "Crate required", "shipping", "boolean"),
        FieldMeta("crate_specifications", "Crate specifications", "shipping", "text"),
        FieldMeta("packing_requirements", "Packing requirements", "shipping", "text"),
        # Agreement
        FieldMeta("loan_agreement_reference", "Agreement reference", "agreement", "text"),
        FieldMeta("loan_agreement_date", "Agreement date", "agreement", "date"),
        FieldMeta("loan_agreement_signed_date", "Signed date", "agreement", "date"),
        FieldMeta("loan_agreement_note", "Agreement note", "agreement", "text"),
        # Fee
        FieldMeta("loan_fee", "Loan fee", "fee", "currency"),
        FieldMeta("loan_fee_currency", "Fee currency", "fee", "text"),
        FieldMeta("loan_fee_note", "Fee note", "fee", "text"),
        # Notes
        FieldMeta("loan_note", "Loan note", "notes", "text"),
        FieldMeta("internal_note", "Internal note", "notes", "text"),
    ],
    status_requirements=_derive_status_reqs("loan_out", _LOAN_OUT_STATUS_LABELS),
)


# ============================================================================
# CONDITION REPORT
# ============================================================================

_CONDITION_REPORT_STATUS_LABELS = {
    "draft": "Draft",
    "completed": "Completed",
    "reviewed": "Reviewed",
    "superseded": "Superseded",
}

_CONDITION_REPORT = FormDefinition(
    entity_type="condition_report",
    entity_label="Condition Report",
    procedure="Condition Checking and Technical Assessment",
    statuses=["draft", "completed", "reviewed", "superseded"],
    status_labels=_CONDITION_REPORT_STATUS_LABELS,
    fields=[
        # Identification
        FieldMeta("report_number", "Report number", "identification", "text", required=True),
        FieldMeta("department_id", "Department", "identification", "contact", lookup_category="department"),
        FieldMeta("report_type", "Report type", "identification", "enum", required=True,
                  enum_values=["intake", "loan_out", "loan_in", "loan_return",
                               "periodic", "conservation", "incident",
                               "pre_treatment", "post_treatment"]),
        FieldMeta("report_date", "Report date", "identification", "date", required=True),
        # Examiner
        FieldMeta("examiner_name", "Examiner name", "examiner", "text"),
        FieldMeta("examiner_institution", "Examiner institution", "examiner", "text"),
        # Object
        FieldMeta("object_id", "Object", "object", "text", lookup_category="collection_object"),
        # Condition
        FieldMeta("overall_condition", "Overall condition", "condition", "enum",
                  enum_values=["excellent", "good", "fair", "poor", "unacceptable"]),
        FieldMeta("condition_summary", "Condition summary", "condition", "text"),
        # Examination
        FieldMeta("examination_method", "Examination method", "examination", "text"),
        FieldMeta("examination_place", "Examination place", "examination", "text"),
        # Hazards
        FieldMeta("hazard_summary", "Hazard summary", "hazards", "text"),
        # Recommendations
        FieldMeta("recommendations", "Recommendations", "recommendations", "text"),
        FieldMeta("conservation_needed", "Conservation needed", "recommendations", "boolean"),
        FieldMeta("conservation_priority", "Conservation priority", "recommendations", "enum",
                  enum_values=["urgent", "high", "medium", "low", "none"]),
        # Requirements
        FieldMeta("handling_requirements", "Handling requirements", "requirements", "text"),
        FieldMeta("packing_requirements", "Packing requirements", "requirements", "text"),
        FieldMeta("display_restrictions", "Display restrictions", "requirements", "text"),
        # Notes
        FieldMeta("report_note", "Report note", "notes", "text"),
    ],
    status_requirements=_derive_status_reqs("condition_report", _CONDITION_REPORT_STATUS_LABELS),
)


# ============================================================================
# CONSERVATION TREATMENT
# ============================================================================

_CONSERVATION_STATUS_LABELS = {
    "proposed": "Proposed",
    "under_review": "Under Review",
    "committee_reviewed": "Committee Reviewed",
    "pending_board": "Pending Board",
    "approved": "Approved",
    "in_progress": "In Progress",
    "completed": "Completed",
    "cancelled": "Cancelled",
    "rejected": "Rejected",
}

_CONSERVATION = FormDefinition(
    entity_type="conservation",
    entity_label="Conservation Treatment",
    procedure="Collections Care and Conservation",
    statuses=WORKFLOW_DEFINITIONS["conservation"].valid_statuses,
    status_labels=_CONSERVATION_STATUS_LABELS,
    fields=[
        # Identification
        FieldMeta("treatment_number", "Treatment number", "identification", "text", required=True),
        FieldMeta("department_id", "Department", "identification", "contact", lookup_category="department"),
        FieldMeta("object_id", "Object", "identification", "text", required=True,
                  lookup_category="collection_object"),
        # Conservator
        FieldMeta("conservator_id", "Conservator", "conservator", "contact",
                  lookup_category="constituent"),
        FieldMeta("conservator_name", "Conservator name", "conservator", "text"),
        FieldMeta("conservator_institution", "Institution", "conservator", "text"),
        FieldMeta("is_external", "External conservator", "conservator", "boolean"),
        # Treatment type
        FieldMeta("treatment_type", "Treatment type", "treatment-type", "enum", required=True,
                  enum_values=["preventive", "remedial", "restoration", "analysis",
                               "stabilization", "cleaning", "repair", "documentation",
                               "mount_making", "rehousing", "pest_treatment", "other"]),
        # Place
        FieldMeta("treatment_place", "Treatment place", "place", "text"),
        # Proposal
        FieldMeta("proposal_date", "Proposal date", "proposal", "date"),
        FieldMeta("proposal_summary", "Proposal summary", "proposal", "text"),
        FieldMeta("proposal_document_ref", "Proposal document", "proposal", "text"),
        # Estimates
        FieldMeta("estimated_duration_days", "Estimated duration (days)", "estimates", "integer"),
        FieldMeta("estimated_cost", "Estimated cost", "estimates", "currency"),
        FieldMeta("estimated_cost_currency", "Currency", "estimates", "text"),
        # Authorization
        FieldMeta("approval_date", "Approval date", "authorization", "date"),
        FieldMeta("approval_note", "Approval note", "authorization", "text"),
        # Dates
        FieldMeta("start_date", "Start date", "dates", "date"),
        FieldMeta("end_date", "End date", "dates", "date"),
        FieldMeta("actual_duration_days", "Actual duration (days)", "dates", "integer"),
        # Actual costs
        FieldMeta("actual_cost", "Actual cost", "actual-cost", "currency"),
        FieldMeta("actual_cost_currency", "Currency", "actual-cost", "text"),
        # Description
        FieldMeta("treatment_description", "Treatment description", "description", "text"),
        FieldMeta("treatment_rationale", "Treatment rationale", "description", "text"),
        FieldMeta("methods_used", "Methods used", "description", "text"),
        # Recommendations
        FieldMeta("recommendations", "Recommendations", "recommendations", "text"),
        FieldMeta("future_care_instructions", "Future care instructions", "recommendations", "text"),
        FieldMeta("restrictions", "Restrictions", "recommendations", "text"),
        FieldMeta("recall_date", "Recall date", "recommendations", "date"),
        # External treatment
        FieldMeta("dispatch_date", "Dispatch date", "external", "date"),
        FieldMeta("return_date", "Return date", "external", "date"),
        FieldMeta("shipping_method", "Shipping method", "external", "text"),
        FieldMeta("shipping_note", "Shipping note", "external", "text"),
        FieldMeta("insurance_value", "Insurance value", "external", "currency"),
        FieldMeta("insurance_currency", "Currency", "external", "text"),
        # Notes
        FieldMeta("treatment_note", "Treatment note", "notes", "text"),
        FieldMeta("internal_note", "Internal note", "notes", "text"),
    ],
    status_requirements=_derive_status_reqs("conservation", _CONSERVATION_STATUS_LABELS),
)


# ============================================================================
# OBJECT EXIT
# ============================================================================

_OBJECT_EXIT_STATUS_LABELS = {
    "pending": "Pending",
    "preparing": "Preparing",
    "dispatched": "Dispatched",
    "in_transit": "In Transit",
    "acknowledged": "Acknowledged",
    "cancelled": "Cancelled",
}

_OBJECT_EXIT = FormDefinition(
    entity_type="object_exit",
    entity_label="Object Exit",
    procedure="Object Exit",
    statuses=WORKFLOW_DEFINITIONS["object_exit"].valid_statuses,
    status_labels=_OBJECT_EXIT_STATUS_LABELS,
    fields=[
        # Exit Information
        FieldMeta("exit_number", "Exit number", "exit", "text", required=True),
        FieldMeta("department_id", "Department", "exit", "contact", lookup_category="department"),
        FieldMeta("exit_date", "Exit date", "exit", "date", required=True),
        FieldMeta("exit_reason", "Exit reason", "exit", "enum", required=True,
                  enum_values=["loan_return", "loan_out", "transfer", "disposal",
                               "deaccession", "conservation", "photography",
                               "enquiry_return", "repatriation", "destruction",
                               "theft_loss", "other"]),
        # Recipient
        FieldMeta("recipient_id", "Recipient", "recipient", "contact",
                  lookup_category="constituent"),
        FieldMeta("recipient_name", "Recipient name", "recipient", "text", required=True),
        # Authorization
        FieldMeta("authorization_id", "Authorizer", "authorization", "text",
                  required=True, lookup_category="user"),
        FieldMeta("authorization_date", "Authorization date", "authorization", "date", required=True),
        FieldMeta("authorization_note", "Authorization note", "authorization", "text"),
        # Method & Shipping
        FieldMeta("exit_method", "Exit method", "shipping", "text"),
        FieldMeta("packing_method", "Packing method", "shipping", "text"),
        FieldMeta("shipping_method", "Shipping method", "shipping", "text"),
        FieldMeta("shipping_company", "Shipping company", "shipping", "text"),
        FieldMeta("tracking_number", "Tracking number", "shipping", "text"),
        FieldMeta("courier_id", "Courier", "shipping", "contact", lookup_category="constituent"),
        FieldMeta("courier_name", "Courier name", "shipping", "text"),
        # Insurance
        FieldMeta("insurance_value", "Insurance value", "insurance", "currency"),
        FieldMeta("insurance_currency", "Currency", "insurance", "text"),
        FieldMeta("insurance_note", "Insurance note", "insurance", "text"),
        # Condition
        FieldMeta("condition_at_exit", "Condition at exit", "condition", "enum",
                  enum_values=["excellent", "good", "fair", "poor", "unacceptable"]),
        FieldMeta("condition_report_id", "Condition report", "condition", "text"),
        # Receipt
        FieldMeta("receipt_acknowledged", "Receipt acknowledged", "receipt", "boolean"),
        FieldMeta("receipt_acknowledged_by", "Acknowledged by", "receipt", "text"),
        FieldMeta("receipt_acknowledged_date", "Acknowledged date", "receipt", "date"),
        FieldMeta("receipt_reference", "Receipt reference", "receipt", "text"),
        FieldMeta("receipt_note", "Receipt note", "receipt", "text"),
        # Notes
        FieldMeta("exit_note", "Exit note", "notes", "text"),
        FieldMeta("internal_note", "Internal note", "notes", "text"),
    ],
    status_requirements=_derive_status_reqs("object_exit", _OBJECT_EXIT_STATUS_LABELS),
)


# ============================================================================
# MOVEMENT
# ============================================================================

_MOVEMENT_STATUS_LABELS = {
    "pending": "Pending",
    "in_transit": "In Transit",
    "completed": "Completed",
    "cancelled": "Cancelled",
}

_MOVEMENT = FormDefinition(
    entity_type="movement",
    entity_label="Movement",
    procedure="Movement and Location Control",
    statuses=WORKFLOW_DEFINITIONS["movement"].valid_statuses,
    status_labels=_MOVEMENT_STATUS_LABELS,
    fields=[
        # Object
        FieldMeta("object_id", "Object", "object", "text", required=True,
                  lookup_category="collection_object"),
        FieldMeta("movement_reference_number", "Movement reference", "object", "text", required=True),
        # Movement details
        FieldMeta("reason", "Reason", "movement", "enum", required=True,
                  enum_values=["exhibition", "storage", "conservation", "loan",
                               "photography", "research", "inventory", "rearrangement",
                               "environmental", "security", "access_request", "other"]),
        FieldMeta("from_location_id", "From location", "movement", "text",
                  lookup_category="location"),
        FieldMeta("to_location_id", "To location", "movement", "text", required=True,
                  lookup_category="location"),
        FieldMeta("movement_date", "Movement date", "movement", "date", required=True),
        FieldMeta("location_fitness", "Location fitness", "movement", "enum",
                  enum_values=["suitable", "temporary", "unsuitable"]),
        FieldMeta("planned_removal_date", "Planned removal date", "movement", "date"),
        FieldMeta("removal_date", "Removal date", "movement", "date"),
        FieldMeta("planned_return_date", "Planned return date", "movement", "date"),
        # Authorization
        FieldMeta("authorization_date", "Authorization date", "authorization", "date"),
        FieldMeta("authorization_note", "Authorization note", "authorization", "text"),
        # Handler & Notes
        FieldMeta("handler_id", "Handler", "details", "contact", lookup_category="constituent"),
        FieldMeta("handler_name", "Handler name", "details", "text"),
        FieldMeta("movement_contact", "Movement contact", "details", "text"),
        FieldMeta("movement_method", "Movement method", "details", "enum",
                  enum_values=["hand_carried", "cart", "forklift", "vehicle",
                               "shipped", "courier"]),
        FieldMeta("movement_note", "Notes", "details", "text"),
        # Shipping
        FieldMeta("shipper_name", "Shipper name", "shipping", "text"),
        FieldMeta("shipping_method", "Shipping method", "shipping", "enum",
                  enum_values=["ground", "air", "sea"]),
        FieldMeta("shipping_tracking_number", "Tracking number", "shipping", "text"),
        FieldMeta("shipping_insurance_value", "Insurance value", "shipping", "currency"),
        FieldMeta("shipping_insurance_currency", "Currency", "shipping", "text"),
        FieldMeta("shipping_note", "Shipping note", "shipping", "text"),
        # Condition
        FieldMeta("condition_note", "Condition note", "condition", "text"),
    ],
    status_requirements=_derive_status_reqs("movement", _MOVEMENT_STATUS_LABELS),
)


# ============================================================================
# COLLECTION OBJECT
# ============================================================================

_COLLECTION_OBJECT_STATUS_LABELS = {
    "pending": "Pending",
    "accessioned": "Accessioned",
    "on_loan": "On Loan",
    "deaccessioned": "Deaccessioned",
    "missing": "Missing",
    "destroyed": "Destroyed",
}

_COLLECTION_OBJECT = FormDefinition(
    entity_type="collection_object",
    entity_label="Collection Object",
    procedure="Object Cataloging",
    statuses=["pending", "accessioned", "on_loan", "deaccessioned", "missing", "destroyed"],
    status_labels=_COLLECTION_OBJECT_STATUS_LABELS,
    fields=[
        # Identification
        FieldMeta("object_number", "Object number", "identification", "text", required=True),
        FieldMeta("department_id", "Department", "identification", "contact", lookup_category="department"),
        FieldMeta("object_name", "Object name", "identification", "text"),
        FieldMeta("object_name_type", "Name type", "identification", "text"),
        FieldMeta("brief_description", "Brief description", "identification", "text"),
        FieldMeta("full_description", "Full description", "identification", "text"),
        FieldMeta("number_of_objects", "Number of objects", "identification", "integer"),
        # Description
        FieldMeta("object_type", "Object type", "description", "text"),
        FieldMeta("category", "Category", "description", "text"),
        FieldMeta("physical_description", "Physical description", "description", "text"),
        FieldMeta("color", "Color", "description", "text"),
        FieldMeta("form", "Form", "description", "text"),
        # Edition
        FieldMeta("edition", "Edition", "edition", "text"),
        FieldMeta("copy_number", "Copy number", "edition", "text"),
        FieldMeta("edition_size", "Edition size", "edition", "integer"),
        FieldMeta("edition_note", "Edition note", "edition", "text"),
        # Catalog level
        FieldMeta("catalog_level", "Catalog level", "catalog", "enum",
                  enum_values=["item", "group", "collection", "series", "component", "volume"]),
        FieldMeta("orientation", "Orientation", "catalog", "enum",
                  enum_values=["portrait", "landscape", "square", "vertical",
                               "horizontal", "variable", "site_specific"]),
        # Style
        FieldMeta("style_period", "Style/Period", "style", "text"),
        FieldMeta("age", "Age", "style", "text"),
        # Production
        FieldMeta("creation_date_display", "Date (display)", "production", "text"),
        FieldMeta("creation_date_earliest", "Date (earliest)", "production", "date"),
        FieldMeta("creation_date_latest", "Date (latest)", "production", "date"),
        FieldMeta("creation_place", "Place of creation", "production", "text"),
        FieldMeta("production_reason", "Production reason", "production", "text"),
        FieldMeta("production_note", "Production note", "production", "text"),
        # History
        FieldMeta("provenance", "Provenance", "history", "text"),
        FieldMeta("object_history_note", "History note", "history", "text"),
        FieldMeta("usage", "Usage", "history", "text"),
        FieldMeta("usage_note", "Usage note", "history", "text"),
        # Subject & Content
        FieldMeta("content_description", "Content description", "subject", "text"),
        # Acquisition
        FieldMeta("acquisition_method", "Acquisition method", "acquisition", "enum",
                  enum_values=["purchase", "gift", "bequest", "transfer", "exchange",
                               "field_collection", "found_in_collection", "unknown"]),
        FieldMeta("acquisition_date", "Acquisition date", "acquisition", "date"),
        FieldMeta("acquisition_source", "Acquisition source", "acquisition", "text"),
        FieldMeta("credit_line", "Credit line", "acquisition", "text"),
        FieldMeta("accession_date", "Accession date", "acquisition", "date"),
        # Location
        FieldMeta("current_location_id", "Current location", "location", "text",
                  lookup_category="location"),
        FieldMeta("current_location_fitness", "Location fitness", "location", "enum",
                  enum_values=["suitable", "temporary", "unsuitable"]),
        FieldMeta("current_location_note", "Location note", "location", "text"),
        FieldMeta("home_location_id", "Home location", "location", "text",
                  lookup_category="location"),
        # Condition (condition_rating and condition_date are derived from latest condition report)
        FieldMeta("condition_note", "Condition note", "condition", "text"),
        FieldMeta("completeness", "Completeness", "condition", "enum",
                  enum_values=["complete", "incomplete", "fragment"]),
        FieldMeta("conservation_priority", "Conservation priority", "condition", "enum",
                  enum_values=["urgent", "high", "medium", "low", "none"]),
        FieldMeta("handling_requirements", "Handling requirements", "condition", "text"),
        FieldMeta("salvage_priority", "Salvage priority", "condition", "enum",
                  enum_values=["critical", "high", "medium", "low"]),
        # Valuation
        FieldMeta("current_value", "Current value", "valuation", "currency"),
        FieldMeta("current_value_currency", "Value currency", "valuation", "text"),
        FieldMeta("current_value_date", "Value date", "valuation", "date"),
        FieldMeta("insurance_value", "Insurance value", "valuation", "currency"),
        FieldMeta("insurance_value_currency", "Insurance currency", "valuation", "text"),
        FieldMeta("insurance_note", "Insurance note", "valuation", "text"),
        # Inventory
        FieldMeta("barcode", "Barcode", "inventory", "text"),
        FieldMeta("last_inventoried_date", "Last inventoried", "inventory", "date"),
        # Discovery
        FieldMeta("is_discoverable", "Discoverable", "discovery", "boolean"),
        # --- Linker-managed fields ---
        # These aren't simple form fields — they're managed by separate UI
        # sections via record linkers. Listed here so lookup_madrona_field
        # can report the correct section label when Guide narrates blocking
        # requirements (e.g. "fill in Creator/maker in the People section").
        FieldMeta("titles", "Titles", "identification", "json"),
        FieldMeta("constituents", "Creator / maker", "people", "json",
                  lookup_category="constituent"),
        FieldMeta("creation_date_display", "Date of production (display)", "production", "text"),
        FieldMeta("measurements", "Measurements", "physical", "json"),
        FieldMeta("material_count", "Materials", "physical", "integer"),
        FieldMeta("primary_image_url", "Object image", "media", "text"),
    ],
    status_requirements=_derive_status_reqs("collection_object", _COLLECTION_OBJECT_STATUS_LABELS),
)


# ============================================================================
# DEACCESSION
# ============================================================================

_DEACCESSION_STATUS_LABELS = {
    "proposed": "Proposed",
    "under_review": "Under Review",
    "committee_reviewed": "Committee Reviewed",
    "pending_board": "Pending Board",
    "approved": "Approved",
    "in_progress": "In Progress",
    "completed": "Completed",
    "cancelled": "Cancelled",
    "rejected": "Rejected",
}

_DEACCESSION = FormDefinition(
    entity_type="deaccession",
    entity_label="Deaccession",
    procedure="Deaccessioning and Disposal",
    statuses=WORKFLOW_DEFINITIONS["deaccession"].valid_statuses,
    status_labels=_DEACCESSION_STATUS_LABELS,
    fields=[
        # Identification
        FieldMeta("deaccession_number", "Deaccession number", "identification", "text", required=True),
        FieldMeta("department_id", "Department", "identification", "contact", lookup_category="department"),
        FieldMeta("object_id", "Object", "identification", "text", required=True,
                  lookup_category="collection_object"),
        # Proposal
        FieldMeta("proposal_date", "Proposal date", "proposal", "date"),
        # Reason
        FieldMeta("reason", "Reason", "reason", "enum", required=True,
                  enum_values=["duplicate", "outside_scope", "deterioration", "damage",
                               "repatriation", "theft_loss", "exchange", "ethical",
                               "donor_request", "legal_requirement", "hazard", "other"]),
        FieldMeta("reason_detail", "Reason detail", "reason", "text"),
        FieldMeta("justification", "Justification", "reason", "text"),
        # Disposal
        FieldMeta("disposal_method", "Disposal method", "disposal", "text"),
        FieldMeta("disposal_method_detail", "Disposal detail", "disposal", "text"),
        # Recipient
        FieldMeta("recipient_id", "Recipient", "recipient", "contact",
                  lookup_category="constituent"),
        FieldMeta("recipient_name", "Recipient name", "recipient", "text"),
        # Committee review
        FieldMeta("committee_review_required", "Committee review required", "committee", "boolean"),
        FieldMeta("committee_review_date", "Committee review date", "committee", "date"),
        FieldMeta("committee_recommendation", "Committee recommendation", "committee", "text"),
        FieldMeta("committee_note", "Committee note", "committee", "text"),
        # Board approval
        FieldMeta("board_approval_required", "Board approval required", "board-approval", "boolean"),
        FieldMeta("board_approval_date", "Board approval date", "board-approval", "date"),
        FieldMeta("board_approval_reference", "Board reference", "board-approval", "text"),
        FieldMeta("board_resolution", "Board resolution", "board-approval", "text"),
        FieldMeta("board_note", "Board note", "board-approval", "text"),
        # Legal review
        FieldMeta("legal_review_required", "Legal review required", "legal-review", "boolean"),
        FieldMeta("legal_review_date", "Legal review date", "legal-review", "date"),
        FieldMeta("legal_review_note", "Legal review note", "legal-review", "text"),
        FieldMeta("legal_cleared", "Legal cleared", "legal-review", "boolean"),
        # Provenance review
        FieldMeta("provenance_review_required", "Provenance review required", "provenance-review", "boolean"),
        FieldMeta("provenance_review_complete", "Provenance review complete", "provenance-review", "boolean"),
        FieldMeta("provenance_review_date", "Provenance review date", "provenance-review", "date"),
        FieldMeta("provenance_review_note", "Provenance review note", "provenance-review", "text"),
        FieldMeta("provenance_issues_found", "Provenance issues found", "provenance-review", "boolean"),
        # Donor restrictions
        FieldMeta("donor_restrictions_exist", "Donor restrictions exist", "donor-restrictions", "boolean"),
        FieldMeta("donor_restrictions_note", "Donor restrictions note", "donor-restrictions", "text"),
        FieldMeta("donor_notified", "Donor notified", "donor-restrictions", "boolean"),
        FieldMeta("donor_notified_date", "Donor notified date", "donor-restrictions", "date"),
        # Valuation
        FieldMeta("appraised_value", "Appraised value", "valuation", "currency"),
        FieldMeta("appraised_value_currency", "Currency", "valuation", "text"),
        FieldMeta("appraised_date", "Appraisal date", "valuation", "date"),
        FieldMeta("appraiser_id", "Appraiser", "valuation", "contact",
                  lookup_category="constituent"),
        FieldMeta("appraiser_name", "Appraiser name", "valuation", "text"),
        # Sale details
        FieldMeta("sale_method", "Sale method", "sale", "text"),
        FieldMeta("sale_price", "Sale price", "sale", "currency"),
        FieldMeta("sale_currency", "Sale currency", "sale", "text"),
        FieldMeta("sale_date", "Sale date", "sale", "date"),
        FieldMeta("sale_reference", "Sale reference", "sale", "text"),
        FieldMeta("buyer_name", "Buyer name", "sale", "text"),
        FieldMeta("proceeds_usage", "Proceeds usage", "sale", "text"),
        # Public notice
        FieldMeta("public_notice_required", "Public notice required", "public-notice", "boolean"),
        FieldMeta("public_notice_date", "Notice date", "public-notice", "date"),
        FieldMeta("public_notice_publication", "Publication", "public-notice", "text"),
        FieldMeta("public_notice_reference", "Notice reference", "public-notice", "text"),
        FieldMeta("public_notice_period_end", "Notice period end", "public-notice", "date"),
        # Dates
        FieldMeta("deaccession_date", "Deaccession date", "dates", "date"),
        FieldMeta("completion_date", "Completion date", "dates", "date"),
        # Notes
        FieldMeta("deaccession_note", "Deaccession note", "notes", "text"),
        FieldMeta("internal_note", "Internal note", "notes", "text"),
    ],
    status_requirements=_derive_status_reqs("deaccession", _DEACCESSION_STATUS_LABELS),
)


# ============================================================================
# USE REQUEST
# ============================================================================

_USE_REQUEST_STATUS_LABELS = {
    "submitted": "Submitted",
    "under_review": "Under Review",
    "approved": "Approved",
    "denied": "Denied",
    "in_progress": "In Progress",
    "completed": "Completed",
    "cancelled": "Cancelled",
    "withdrawn": "Withdrawn",
}

_USE_REQUEST = FormDefinition(
    entity_type="use_request",
    entity_label="Use Request",
    procedure="Use of Collections",
    statuses=["submitted", "under_review", "approved", "denied",
              "in_progress", "completed", "cancelled", "withdrawn"],
    status_labels=_USE_REQUEST_STATUS_LABELS,
    fields=[
        # Identification
        FieldMeta("request_number", "Request number", "identification", "text", required=True),
        FieldMeta("request_date", "Request date", "identification", "date", required=True),
        FieldMeta("use_type", "Use type", "identification", "enum", required=True,
                  enum_values=["research", "exhibition", "reproduction", "education",
                               "publication", "broadcast", "commercial", "conservation",
                               "loan", "digitization", "other"]),
        FieldMeta("use_purpose", "Use purpose", "identification", "text", required=True),
        FieldMeta("use_description", "Use description", "identification", "text"),
        # Requester
        FieldMeta("requester_name", "Requester name", "requester", "text", required=True),
        FieldMeta("requester_title", "Requester title", "requester", "text"),
        FieldMeta("requester_institution", "Institution", "requester", "text"),
        FieldMeta("requester_email", "Email", "requester", "text"),
        FieldMeta("requester_phone", "Phone", "requester", "text"),
        # Access
        FieldMeta("access_date_start", "Access start date", "access", "date"),
        FieldMeta("access_date_end", "Access end date", "access", "date"),
        FieldMeta("location_required", "Location required", "access", "text"),
        FieldMeta("special_requirements", "Special requirements", "access", "text"),
        # Project
        FieldMeta("project_title", "Project title", "project", "text"),
        FieldMeta("project_description", "Project description", "project", "text"),
        FieldMeta("project_deadline", "Project deadline", "project", "date"),
        FieldMeta("funding_source", "Funding source", "project", "text"),
        # Reproduction
        FieldMeta("reproduction_type", "Reproduction type", "reproduction", "text"),
        FieldMeta("reproduction_quantity", "Quantity", "reproduction", "integer"),
        FieldMeta("reproduction_format", "Format", "reproduction", "text"),
        FieldMeta("intended_use", "Intended use", "reproduction", "text"),
        FieldMeta("publication_details", "Publication details", "reproduction", "text"),
        FieldMeta("credit_line", "Credit line", "reproduction", "text"),
        # Exhibition
        FieldMeta("exhibition_title", "Exhibition title", "exhibition", "text"),
        FieldMeta("exhibition_venue", "Exhibition venue", "exhibition", "text"),
        FieldMeta("exhibition_organizer", "Exhibition organizer", "exhibition", "text"),
        FieldMeta("insurance_value", "Insurance value", "exhibition", "currency"),
        FieldMeta("insurance_currency", "Currency", "exhibition", "text"),
        # Approval
        FieldMeta("approval_date", "Approval date", "approval", "date"),
        FieldMeta("approval_conditions", "Approval conditions", "approval", "text"),
        FieldMeta("denial_reason", "Denial reason", "approval", "text"),
        # Fees
        FieldMeta("fee_quoted", "Fee quoted", "fees", "currency"),
        FieldMeta("fee_paid", "Fee paid", "fees", "currency"),
        FieldMeta("fee_currency", "Fee currency", "fees", "text"),
        FieldMeta("fee_waived", "Fee waived", "fees", "boolean"),
        FieldMeta("fee_waiver_reason", "Waiver reason", "fees", "text"),
        FieldMeta("invoice_number", "Invoice number", "fees", "text"),
        FieldMeta("payment_date", "Payment date", "fees", "date"),
        # Fulfillment
        FieldMeta("fulfillment_date", "Fulfillment date", "fulfillment", "date"),
        FieldMeta("fulfillment_note", "Fulfillment note", "fulfillment", "text"),
        # Outcomes
        FieldMeta("knowledge_gained", "Knowledge gained", "outcomes", "text"),
        FieldMeta("publication_reference", "Publication reference", "outcomes", "text"),
        FieldMeta("follow_up_required", "Follow-up required", "outcomes", "boolean"),
        FieldMeta("follow_up_note", "Follow-up note", "outcomes", "text"),
        # Notes
        FieldMeta("request_note", "Request note", "notes", "text"),
        FieldMeta("internal_note", "Internal note", "notes", "text"),
    ],
    status_requirements=_derive_status_reqs("use_request", _USE_REQUEST_STATUS_LABELS),
)


# ============================================================================
# VALUATION
# ============================================================================

_VALUATION_STATUS_LABELS: dict[str, str] = {}

_VALUATION = FormDefinition(
    entity_type="valuation",
    entity_label="Valuation",
    procedure="Valuation Control",
    statuses=[],  # No status workflow - valuations track is_current flag instead
    status_labels=_VALUATION_STATUS_LABELS,
    fields=[
        # Valuation details
        FieldMeta("object_id", "Object", "details", "text", lookup_category="collection_object"),
        FieldMeta("valuation_type", "Valuation type", "details", "enum", required=True,
                  enum_values=["insurance", "market", "replacement", "probate",
                               "donation", "internal"]),
        FieldMeta("valuation_amount", "Amount", "details", "currency", required=True),
        FieldMeta("valuation_currency", "Currency", "details", "text", required=True),
        FieldMeta("valuation_date", "Valuation date", "details", "date", required=True),
        # Source
        FieldMeta("valuator_id", "Valuator", "source", "contact",
                  lookup_category="constituent"),
        FieldMeta("valuator_name", "Valuator name", "source", "text"),
        FieldMeta("valuator_organization", "Organization", "source", "text"),
        FieldMeta("valuator_credentials", "Credentials", "source", "text"),
        FieldMeta("valuation_method", "Method", "source", "enum",
                  enum_values=["comparable_sales", "replacement_cost", "income_approach",
                               "expert_opinion", "formula", "hybrid"]),
        # Documentation
        FieldMeta("documentation_reference", "Documentation reference", "documentation", "text"),
        FieldMeta("valuation_note", "Note", "documentation", "text"),
        # Validity
        FieldMeta("valid_from", "Valid from", "validity", "date"),
        FieldMeta("valid_until", "Valid until", "validity", "date"),
        FieldMeta("is_current", "Is current", "validity", "boolean"),
    ],
    status_requirements=_derive_status_reqs("valuation", _VALUATION_STATUS_LABELS),
)


# ============================================================================
# INCIDENT REPORT
# ============================================================================

_INCIDENT_REPORT_STATUS_LABELS = {
    "draft": "Draft",
    "submitted": "Submitted",
    "under_investigation": "Under Investigation",
    "resolved": "Resolved",
    "closed": "Closed",
}

_INCIDENT_REPORT = FormDefinition(
    entity_type="incident_report",
    entity_label="Incident Report",
    procedure="Damage and Loss",
    statuses=["draft", "submitted", "under_investigation", "resolved", "closed"],
    status_labels=_INCIDENT_REPORT_STATUS_LABELS,
    fields=[
        # Identification
        FieldMeta("report_number", "Report number", "identification", "text", required=True),
        FieldMeta("report_date", "Report date", "identification", "date", required=True),
        FieldMeta("incident_type", "Incident type", "identification", "enum", required=True,
                  enum_values=["damage", "loss", "theft", "vandalism", "environmental",
                               "fire", "water", "pest", "other"]),
        FieldMeta("incident_subtype", "Incident subtype", "identification", "text"),
        # Incident details
        FieldMeta("incident_date", "Incident date", "incident-details", "date"),
        FieldMeta("incident_date_approximate", "Date approximate", "incident-details", "boolean"),
        FieldMeta("incident_location_id", "Incident location", "incident-details", "text",
                  lookup_category="location"),
        FieldMeta("incident_location_description", "Location description", "incident-details", "text"),
        # Discovery
        FieldMeta("discovered_date", "Discovered date", "discovery", "date", required=True),
        FieldMeta("discovered_by_name", "Discovered by", "discovery", "text"),
        FieldMeta("discovery_circumstances", "Circumstances", "discovery", "text"),
        # Description
        FieldMeta("incident_description", "Incident description", "description", "text", required=True),
        FieldMeta("cause_analysis", "Cause analysis", "description", "text"),
        FieldMeta("immediate_actions", "Immediate actions", "description", "text"),
        # Police
        FieldMeta("police_notified", "Police notified", "police", "boolean"),
        FieldMeta("police_report_number", "Police report number", "police", "text"),
        FieldMeta("police_report_date", "Police report date", "police", "date"),
        FieldMeta("police_contact", "Police contact", "police", "text"),
        FieldMeta("police_note", "Police note", "police", "text"),
        # Insurance claim
        FieldMeta("insurance_claim_filed", "Claim filed", "insurance-claim", "boolean"),
        FieldMeta("insurance_claim_number", "Claim number", "insurance-claim", "text"),
        FieldMeta("insurance_claim_date", "Claim date", "insurance-claim", "date"),
        FieldMeta("insurance_adjuster", "Adjuster", "insurance-claim", "text"),
        FieldMeta("insurance_claim_status", "Claim status", "insurance-claim", "enum",
                  enum_values=["pending", "approved", "denied", "settled", "withdrawn"]),
        FieldMeta("insurance_claim_amount", "Claim amount", "insurance-claim", "currency"),
        FieldMeta("insurance_settlement_amount", "Settlement amount", "insurance-claim", "currency"),
        FieldMeta("insurance_currency", "Currency", "insurance-claim", "text"),
        FieldMeta("insurance_note", "Insurance note", "insurance-claim", "text"),
        # Notifications
        FieldMeta("director_notified", "Director notified", "notifications", "boolean"),
        FieldMeta("director_notified_date", "Director notified date", "notifications", "date"),
        FieldMeta("board_notified", "Board notified", "notifications", "boolean"),
        FieldMeta("board_notified_date", "Board notified date", "notifications", "date"),
        # Investigation
        FieldMeta("investigation_required", "Investigation required", "investigation", "boolean"),
        FieldMeta("investigation_findings", "Investigation findings", "investigation", "text"),
        FieldMeta("investigation_completed_date", "Investigation completed", "investigation", "date"),
        # Resolution
        FieldMeta("resolution_summary", "Resolution summary", "resolution", "text"),
        FieldMeta("resolved_date", "Resolved date", "resolution", "date"),
        FieldMeta("lessons_learned", "Lessons learned", "resolution", "text"),
        # Notes
        FieldMeta("report_note", "Report note", "notes", "text"),
        FieldMeta("internal_note", "Internal note", "notes", "text"),
    ],
    status_requirements=_derive_status_reqs("incident_report", _INCIDENT_REPORT_STATUS_LABELS),
)


# ============================================================================
# OBJECT RIGHT
# ============================================================================

_OBJECT_RIGHT_STATUS_LABELS = {
    "unknown": "Unknown",
    "public_domain": "Public Domain",
    "owned": "Owned",
    "licensed": "Licensed",
    "granted": "Granted",
    "requested": "Requested",
    "denied": "Denied",
    "expired": "Expired",
    "orphan": "Orphan",
    "disputed": "Disputed",
}

_OBJECT_RIGHT = FormDefinition(
    entity_type="right",
    entity_label="Object Right",
    procedure="Rights Management",
    statuses=["unknown", "public_domain", "owned", "licensed", "granted",
              "requested", "denied", "expired", "orphan", "disputed"],
    status_labels=_OBJECT_RIGHT_STATUS_LABELS,
    fields=[
        # Object
        FieldMeta("object_id", "Object", "object", "text", required=True,
                  lookup_category="collection_object"),
        # Right type
        FieldMeta("right_type", "Right type", "type", "enum", required=True,
                  enum_values=["copyright", "reproduction", "exhibition", "publication",
                               "broadcast", "performance", "adaptation", "distribution",
                               "moral_rights", "database_rights", "trademark", "other"]),
        FieldMeta("right_subtype", "Right subtype", "type", "text"),
        # Rights holder
        FieldMeta("rights_holder_contact_id", "Rights holder", "holder", "contact",
                  lookup_category="constituent"),
        # Dates
        FieldMeta("start_date", "Start date", "dates", "date"),
        FieldMeta("end_date", "End date", "dates", "date"),
        FieldMeta("is_perpetual", "Perpetual", "dates", "boolean"),
        # Territory
        FieldMeta("territory", "Territory", "territory", "text"),
        FieldMeta("territory_note", "Territory note", "territory", "text"),
        # License
        FieldMeta("license_type", "License type", "license", "text"),
        FieldMeta("license_reference", "License reference", "license", "text"),
        FieldMeta("license_url", "License URL", "license", "text"),
        FieldMeta("usage_conditions", "Usage conditions", "license", "text"),
        FieldMeta("restrictions", "Restrictions", "license", "text"),
        # Fees
        FieldMeta("fee_required", "Fee required", "fees", "boolean"),
        FieldMeta("fee_amount", "Fee amount", "fees", "currency"),
        FieldMeta("fee_currency", "Fee currency", "fees", "text"),
        FieldMeta("fee_note", "Fee note", "fees", "text"),
        # Orphan works
        FieldMeta("is_orphan_work", "Orphan work", "orphan-works", "boolean"),
        FieldMeta("due_diligence_conducted", "Due diligence conducted", "orphan-works", "boolean"),
        FieldMeta("due_diligence_date", "Due diligence date", "orphan-works", "date"),
        FieldMeta("orphan_works_license_number", "License number", "orphan-works", "text"),
        FieldMeta("orphan_works_license_date", "License date", "orphan-works", "date"),
        FieldMeta("orphan_works_license_expiry", "License expiry", "orphan-works", "date"),
        # Documentation
        FieldMeta("agreement_reference", "Agreement reference", "documentation", "text"),
        # Review
        FieldMeta("next_review_date", "Next review date", "review", "date"),
        FieldMeta("last_review_date", "Last review date", "review", "date"),
        # Notes
        FieldMeta("right_note", "Right note", "notes", "text"),
        FieldMeta("internal_note", "Internal note", "notes", "text"),
    ],
    status_requirements=_derive_status_reqs("right", _OBJECT_RIGHT_STATUS_LABELS),
)


# ============================================================================
# REPRODUCTION REQUEST
# ============================================================================

_REPRODUCTION_REQUEST_STATUS_LABELS = {
    "submitted": "Submitted",
    "rights_review": "Rights Review",
    "approved": "Approved",
    "denied": "Denied",
    "in_production": "In Production",
    "delivered": "Delivered",
    "completed": "Completed",
    "cancelled": "Cancelled",
}

_REPRODUCTION_REQUEST = FormDefinition(
    entity_type="reproduction_request",
    entity_label="Reproduction Request",
    procedure="Reproduction",
    statuses=["submitted", "rights_review", "approved", "denied",
              "in_production", "delivered", "completed", "cancelled"],
    status_labels=_REPRODUCTION_REQUEST_STATUS_LABELS,
    fields=[
        # Identification
        FieldMeta("request_number", "Request number", "identification", "text", required=True),
        FieldMeta("object_id", "Object", "identification", "text",
                  lookup_category="collection_object"),
        # Requester
        FieldMeta("requester_name", "Requester name", "requester", "text", required=True),
        FieldMeta("requester_institution", "Institution", "requester", "text"),
        FieldMeta("requester_email", "Email", "requester", "text"),
        FieldMeta("requester_phone", "Phone", "requester", "text"),
        # Reproduction details
        FieldMeta("reproduction_type", "Reproduction type", "reproduction", "enum", required=True,
                  enum_values=["photograph", "scan", "cast", "3d_print", "digital_copy",
                               "film", "video", "other"]),
        FieldMeta("reproduction_purpose", "Purpose", "reproduction", "text"),
        FieldMeta("intended_use", "Intended use", "reproduction", "text"),
        FieldMeta("quantity", "Quantity", "reproduction", "integer"),
        FieldMeta("format_requested", "Format requested", "reproduction", "text"),
        FieldMeta("dimensions_requested", "Dimensions requested", "reproduction", "text"),
        # Rights clearance
        FieldMeta("rights_cleared", "Rights cleared", "rights", "boolean"),
        FieldMeta("rights_check_date", "Rights check date", "rights", "date"),
        FieldMeta("rights_restrictions", "Rights restrictions", "rights", "text"),
        FieldMeta("credit_line_required", "Credit line required", "rights", "text"),
        # Fees
        FieldMeta("fee_type", "Fee type", "fees", "text"),
        FieldMeta("fee_amount", "Fee amount", "fees", "currency"),
        FieldMeta("fee_currency", "Fee currency", "fees", "text"),
        FieldMeta("fee_paid", "Fee paid", "fees", "boolean"),
        FieldMeta("payment_date", "Payment date", "fees", "date"),
        # Fulfillment
        FieldMeta("master_file_reference", "Master file reference", "fulfillment", "text"),
        FieldMeta("delivery_method", "Delivery method", "fulfillment", "text"),
        FieldMeta("delivery_date", "Delivery date", "fulfillment", "date"),
        FieldMeta("quality_approved", "Quality approved", "fulfillment", "boolean"),
        # Notes
        FieldMeta("notes", "Notes", "notes", "text"),
    ],
    status_requirements=_derive_status_reqs("reproduction_request", _REPRODUCTION_REQUEST_STATUS_LABELS),
)


# ============================================================================
# FORM REGISTRY
# ============================================================================

FORM_REGISTRY: dict[str, FormDefinition] = {
    "object_entry": _OBJECT_ENTRY,
    "acquisition": _ACQUISITION,
    "loan_in": _LOAN_IN,
    "loan_out": _LOAN_OUT,
    "condition_report": _CONDITION_REPORT,
    "conservation": _CONSERVATION,
    "object_exit": _OBJECT_EXIT,
    "movement": _MOVEMENT,
    "collection_object": _COLLECTION_OBJECT,
    "deaccession": _DEACCESSION,
    "use_request": _USE_REQUEST,
    "valuation": _VALUATION,
    "incident_report": _INCIDENT_REPORT,
    "right": _OBJECT_RIGHT,
    "reproduction_request": _REPRODUCTION_REQUEST,
}


# ============================================================================
# ENTITY MODEL MAP (lazy imports to avoid circular dependencies)
# ============================================================================

def get_entity_model_map() -> dict[str, tuple]:
    """
    Return mapping of entity_type -> (ModelClass, pk_field, number_field).

    Uses lazy imports to avoid circular import issues at module level.
    """
    from app.models.procedures import (
        ObjectEntry, Acquisition, LoanIn, LoanOut,
        ConservationTreatment, ObjectExit, Deaccession,
    )
    from app.models.objects import (
        CollectionObject, ConditionReport,
        UseRequest, Valuation, ObjectRight, ReproductionRequest,
    )
    from app.models.locations import Movement
    from app.models.compliance import IncidentReport

    return {
        "object_entry": (ObjectEntry, "entry_id", "entry_number"),
        "acquisition": (Acquisition, "acquisition_id", "acquisition_number"),
        "loan_in": (LoanIn, "loan_in_id", "loan_number"),
        "loan_out": (LoanOut, "loan_out_id", "loan_number"),
        "condition_report": (ConditionReport, "report_id", "report_number"),
        "conservation": (ConservationTreatment, "treatment_id", "treatment_number"),
        "object_exit": (ObjectExit, "exit_id", "exit_number"),
        "movement": (Movement, "movement_id", "movement_reference_number"),
        "collection_object": (CollectionObject, "object_id", "object_number"),
        "deaccession": (Deaccession, "deaccession_id", "deaccession_number"),
        "use_request": (UseRequest, "request_id", "request_number"),
        "valuation": (Valuation, "valuation_id", None),
        "incident_report": (IncidentReport, "report_id", "report_number"),
        "right": (ObjectRight, "right_id", None),
        "reproduction_request": (ReproductionRequest, "reproduction_id", "request_number"),
    }
