"""Loans Out requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)
from app.services.workflow_definitions import WORKFLOW_DEFINITIONS

_status_order = WORKFLOW_DEFINITIONS["loan_out"].status_order

LOAN_OUT_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="loan_out",
        procedure_label="Loan Out",
        procedure="Loans Out",
        status_order=_status_order,
        requirement_groups=[
            ProcedureRequirementGroup(
                id="borrower",
                label="Borrower",
                section_id="borrower",
                requirements=[
                    ProcedureRequirement(
                        id="borrower_id",
                        label="Borrower",
                        group_id="borrower",
                        field_paths=["borrower_id"],
                        required_for_statuses=[
                            "approved", "agreement_sent", "agreement_signed",
                            "in_transit", "on_loan", "return_scheduled",
                            "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="The institution or individual borrowing the objects.",
                    ),
                    ProcedureRequirement(
                        id="borrower_contact_id",
                        label="Borrower contact person",
                        group_id="borrower",
                        field_paths=["borrower_contact_id"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="The contact person at the borrowing institution.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="details",
                label="Loan Details",
                section_id="details",
                requirements=[
                    ProcedureRequirement(
                        id="loan_purpose",
                        label="Loan purpose",
                        group_id="details",
                        field_paths=["loan_purpose"],
                        required_for_statuses=[
                            "approved", "agreement_sent", "agreement_signed",
                            "in_transit", "on_loan", "return_scheduled",
                            "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="The reason for the loan (exhibition, research, etc.).",
                    ),
                    ProcedureRequirement(
                        id="exhibition_title",
                        label="Exhibition title",
                        group_id="details",
                        field_paths=["exhibition_title"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Title of the exhibition or project for which objects are lent.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="objects",
                label="Objects",
                section_id="objects",
                requirements=[
                    ProcedureRequirement(
                        id="objects",
                        label="Loan objects",
                        group_id="objects",
                        field_paths=["objects"],
                        required_for_statuses=[
                            "approved", "agreement_sent", "agreement_signed",
                            "in_transit", "on_loan", "return_scheduled",
                            "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="At least one object must be added to the loan.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="authorization",
                label="Authorization",
                section_id="authorization",
                requirements=[
                    ProcedureRequirement(
                        id="authorizer_id",
                        label="Authorizer",
                        group_id="authorization",
                        field_paths=["authorizer_id"],
                        required_for_statuses=[
                            "agreement_sent", "agreement_signed", "in_transit",
                            "on_loan", "return_scheduled", "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="The person who authorized the loan (Procedure: Loan out authorizer).",
                    ),
                    ProcedureRequirement(
                        id="authorization_date",
                        label="Authorization date",
                        group_id="authorization",
                        field_paths=["authorization_date"],
                        required_for_statuses=[
                            "agreement_sent", "agreement_signed", "in_transit",
                            "on_loan", "return_scheduled", "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="The date the loan was authorized (Procedure: Loan out authorization date).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="dates",
                label="Key Dates",
                section_id="dates",
                requirements=[
                    ProcedureRequirement(
                        id="loan_start_date",
                        label="Loan start date",
                        group_id="dates",
                        field_paths=["loan_start_date"],
                        required_for_statuses=[
                            "in_transit", "on_loan", "return_scheduled",
                            "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="The agreed start date for the loan period (Procedure: Loan out begin date).",
                    ),
                    ProcedureRequirement(
                        id="loan_end_date",
                        label="Loan end date",
                        group_id="dates",
                        field_paths=["loan_end_date"],
                        required_for_statuses=[
                            "in_transit", "on_loan", "return_scheduled",
                            "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="The agreed end date for the loan period (Procedure: Loan out end date).",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="insurance",
                label="Insurance",
                section_id="insurance",
                requirements=[
                    ProcedureRequirement(
                        id="insurance_value_total",
                        label="Insurance value",
                        group_id="insurance",
                        field_paths=["insurance_value_total"],
                        required_for_statuses=[
                            "in_transit", "on_loan", "return_scheduled",
                            "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="Total insurance value for all loaned objects.",
                    ),
                    ProcedureRequirement(
                        id="certificate_of_insurance_received",
                        label="Certificate of insurance",
                        group_id="insurance",
                        field_paths=["certificate_of_insurance_received"],
                        required_for_statuses=["in_transit"],
                        severity="recommended",
                        help_text="Confirmation that a certificate of insurance has been received from the borrower.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="facility",
                label="Facility Report",
                section_id="facility",
                requirements=[
                    ProcedureRequirement(
                        id="condition_report_out_id",
                        label="Outbound condition report",
                        group_id="facility",
                        field_paths=["condition_report_out_id"],
                        required_for_statuses=["in_transit"],
                        severity="recommended",
                        help_text="Condition check with images before objects leave the building (Procedure: Condition checking).",
                    ),
                    ProcedureRequirement(
                        id="facility_report_received",
                        label="Facility report",
                        group_id="facility",
                        field_paths=["facility_report_received"],
                        required_for_statuses=["in_transit"],
                        severity="recommended",
                        help_text="Confirmation that a facility report has been received and reviewed.",
                    ),
                    ProcedureRequirement(
                        id="security_conditions_confirmed",
                        label="Security conditions confirmed",
                        group_id="facility",
                        field_paths=["security_conditions_confirmed"],
                        required_for_statuses=["in_transit"],
                        severity="recommended",
                        help_text="Confirmation that security conditions at the borrowing venue have been reviewed and confirmed.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="agreement",
                label="Loan Agreement",
                section_id="agreement",
                requirements=[
                    ProcedureRequirement(
                        id="loan_agreement_signed_date",
                        label="Agreement signed",
                        group_id="agreement",
                        field_paths=["loan_agreement_signed_date"],
                        required_for_statuses=[
                            "agreement_signed", "in_transit", "on_loan",
                            "return_scheduled", "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="Date the loan agreement was signed by both parties.",
                    ),
                    ProcedureRequirement(
                        id="document_location",
                        label="Document location",
                        group_id="agreement",
                        field_paths=["document_location"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Where the physical loan file and documents are stored (Procedure: Document location).",
                    ),
                    ProcedureRequirement(
                        id="signed_loan_agreement",
                        label="Signed loan agreement",
                        group_id="agreement",
                        field_paths=["signed_document_types"],
                        required_for_statuses=[
                            "agreement_signed", "in_transit", "on_loan",
                            "return_scheduled", "returned", "closed",
                        ],
                        severity="recommended",
                        help_text="Loans Out expects both parties to sign the loan agreement. Attach the signed copy.",
                        has_predicate=True,
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="closing",
                label="Closing",
                section_id="closing",
                requirements=[
                    ProcedureRequirement(
                        id="actual_return_date",
                        label="Actual return date",
                        group_id="closing",
                        field_paths=["actual_return_date"],
                        required_for_statuses=["returned", "closed"],
                        severity="blocking",
                        help_text="The date objects were actually returned to the institution.",
                    ),
                    ProcedureRequirement(
                        id="receipt_acknowledged",
                        label="Receipt acknowledged",
                        group_id="closing",
                        field_paths=["receipt_acknowledged"],
                        required_for_statuses=["closed"],
                        severity="blocking",
                        help_text="Confirmation that safe receipt of returned objects has been acknowledged.",
                    ),
                    ProcedureRequirement(
                        id="conditions_met_confirmed",
                        label="All conditions met",
                        group_id="closing",
                        field_paths=["conditions_met_confirmed"],
                        required_for_statuses=["closed"],
                        severity="blocking",
                        help_text="Confirmation that all loan conditions have been satisfied.",
                    ),
                    ProcedureRequirement(
                        id="closing_invoice_sent",
                        label="Invoice sent",
                        group_id="closing",
                        field_paths=["closing_invoice_sent"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Whether the borrower has been invoiced for any remaining costs.",
                    ),
                ],
            ),
        ],
    )
)
