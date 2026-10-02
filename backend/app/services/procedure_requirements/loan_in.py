"""Loans In requirements."""
from __future__ import annotations

from app.services.procedure_requirements import (
    ProcedureRequirements,
    ProcedureRequirement,
    ProcedureRequirementGroup,
    _register,
)
from app.services.workflow_definitions import WORKFLOW_DEFINITIONS

_status_order = WORKFLOW_DEFINITIONS["loan_in"].status_order

LOAN_IN_REQUIREMENTS = _register(
    ProcedureRequirements(
        procedure_type="loan_in",
        procedure_label="Loan In",
        procedure="Loans In",
        status_order=_status_order,
        requirement_groups=[
            ProcedureRequirementGroup(
                id="lender",
                label="Lender",
                section_id="lender",
                requirements=[
                    ProcedureRequirement(
                        id="lender_id",
                        label="Lender",
                        group_id="lender",
                        field_paths=["lender_id"],
                        required_for_statuses=[
                            "approved", "agreement_sent", "agreement_signed",
                            "in_transit", "received", "on_loan",
                            "return_initiated", "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="The institution or individual lending the objects.",
                    ),
                    ProcedureRequirement(
                        id="lender_contact_id",
                        label="Lender contact person",
                        group_id="lender",
                        field_paths=["lender_contact_id"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="The contact person at the lending institution.",
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
                            "in_transit", "received", "on_loan",
                            "return_initiated", "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="The reason for the loan (exhibition, research, etc.).",
                    ),
                    ProcedureRequirement(
                        id="exhibition_name",
                        label="Exhibition name",
                        group_id="details",
                        field_paths=["exhibition_name"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="Name of the exhibition or project for which objects are borrowed.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="objects",
                label="Objects",
                section_id="linkedEntry",
                requirements=[
                    ProcedureRequirement(
                        id="objects",
                        label="Loan objects",
                        group_id="objects",
                        field_paths=["objects"],
                        required_for_statuses=[
                            "approved", "agreement_sent", "agreement_signed",
                            "in_transit", "received", "on_loan",
                            "return_initiated", "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="At least one object must be added to the loan.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="lender_authorization",
                label="Lender Authorization",
                section_id="lender-authorization",
                requirements=[
                    ProcedureRequirement(
                        id="lender_authorizer_id",
                        label="Lender authorizer",
                        group_id="lender_authorization",
                        field_paths=["lender_authorizer_id"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="The person who authorized the loan on behalf of the lender.",
                    ),
                    ProcedureRequirement(
                        id="lender_authorization_date",
                        label="Lender authorization date",
                        group_id="lender_authorization",
                        field_paths=["lender_authorization_date"],
                        required_for_statuses=[],
                        severity="recommended",
                        help_text="The date the lender authorized the loan.",
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
                            "in_transit", "received", "on_loan",
                            "return_initiated", "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="The agreed start date for the loan period.",
                    ),
                    ProcedureRequirement(
                        id="loan_end_date",
                        label="Loan end date",
                        group_id="dates",
                        field_paths=["loan_end_date"],
                        required_for_statuses=[
                            "in_transit", "received", "on_loan",
                            "return_initiated", "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="The agreed end date for the loan period.",
                    ),
                ],
            ),
            ProcedureRequirementGroup(
                id="insurance",
                label="Insurance",
                section_id="insurance",
                requirements=[
                    ProcedureRequirement(
                        id="insurance_value",
                        label="Insurance value",
                        group_id="insurance",
                        field_paths=["insurance_value"],
                        required_for_statuses=[
                            "in_transit", "received", "on_loan",
                            "return_initiated", "returned", "closed",
                        ],
                        severity="blocking",
                        help_text="Total insurance value for all borrowed objects.",
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
                            "agreement_signed", "in_transit", "received",
                            "on_loan", "return_initiated", "returned", "closed",
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
                            "agreement_signed", "in_transit", "received",
                            "on_loan", "return_initiated", "returned", "closed",
                        ],
                        severity="recommended",
                        help_text="Loans In expects both parties to sign the loan agreement. Attach the signed copy.",
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
                        help_text="The date objects were actually returned to the lender.",
                    ),
                    ProcedureRequirement(
                        id="receipt_acknowledged",
                        label="Receipt acknowledged",
                        group_id="closing",
                        field_paths=["receipt_acknowledged"],
                        required_for_statuses=["closed"],
                        severity="blocking",
                        help_text="Confirmation that safe receipt of returned objects has been acknowledged by the lender.",
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
                        help_text="Whether the lender has been invoiced for any remaining costs.",
                    ),
                ],
            ),
        ],
    )
)
