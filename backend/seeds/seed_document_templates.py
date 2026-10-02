"""
Seed system document templates and field access policies.

Creates:
- 6 system-level document_templates (organization_id IS NULL)
- 15 field_access_policies for the collections application

Run with:
    python -m seeds.seed_document_templates

Idempotent: uses ON CONFLICT DO NOTHING for all inserts.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import Settings


# System default document templates (organization_id = NULL)
# (template_id, template_type, name, description, is_default, is_active, config_json, terms_and_conditions)
DOCUMENT_TEMPLATES = [
    (
        "30587dc8-0c02-4328-8845-504a2640d7e1",
        "condition_report",
        "Condition Report",
        "Printable condition assessment report",
        True, True,
        '{"sections": ["header", "object_info", "examination_details", "condition_summary", "detailed_findings", "recommendations", "examiner_signature"], "include_images": true, "include_diagrams": true}',
        None,
    ),
    (
        "e492145d-64de-4d64-8f46-b762c0b66bc6",
        "facility_report",
        "Facility Report",
        "Environmental and security facility report for loan requests",
        True, True,
        '{"sections": ["header", "venue_info", "environmental_conditions", "security", "fire_protection", "handling", "signatures"]}',
        None,
    ),
    (
        "862a78be-e3be-4d7c-8f62-d990d1deb5b0",
        "loan_agreement_in",
        "Loan Agreement (Incoming)",
        "Standard agreement for objects borrowed from other institutions",
        True, True,
        '{"sections": ["header", "lender_info", "loan_details", "object_list", "insurance", "conditions", "signatures"], "include_images": true, "include_condition": true, "include_dimensions": true}',
        None,
    ),
    (
        "920b47b6-ee07-4ec9-83cb-1bc2ba250ab4",
        "loan_agreement_out",
        "Loan Agreement (Outgoing)",
        "Standard agreement for objects on loan to other institutions",
        True, True,
        '{"sections": ["header", "borrower_info", "loan_details", "object_list", "insurance", "conditions", "signatures"], "include_images": true, "include_condition": true, "include_dimensions": true}',
        None,
    ),
    (
        "1d54a63d-abdf-4a87-8761-ba2c6af2386e",
        "object_receipt",
        "Object Receipt",
        "Receipt for objects deposited with the institution",
        True, True,
        '{"sections": ["header", "depositor_info", "object_list", "acknowledgment", "signature"], "include_images": false, "include_condition": true}',
        None,
    ),
    (
        "00eb9161-91f8-46a4-a1f3-0882a1611181",
        "packing_list",
        "Packing List",
        "List of objects and their packing details for shipment",
        True, True,
        '{"sections": ["header", "shipment_info", "object_list", "packing_details", "checklist"], "include_weight": true, "include_dimensions": true}',
        None,
    ),
]


# Field access policies across the platform
# (policy_id, app_key, entity_type, field_path, policy_type, display_name, description, default_visible, minimum_permission)
FIELD_ACCESS_POLICIES = [
    # =========================================================================
    # COLLECTION OBJECT
    # =========================================================================
    ("3556b5eb-d7ec-48f0-8bc0-9fc0deb143df", "collections", "collection_object", "acquisition_cost", "sensitive", "Acquisition Cost", "Purchase price or acquisition cost of the object", False, "org.manage_settings"),
    ("e5f47cd5-6c9e-493a-91e7-e19d8978cf10", "collections", "collection_object", "acquisition_funding_source", "sensitive", "Funding Source", "Source of acquisition funding", False, "org.manage_settings"),
    ("ff143e90-ea2e-458e-bc94-fe05e1891fa8", "collections", "collection_object", "acquisition_note", "internal", "Acquisition Notes", "Internal notes about the acquisition", True, "collections.edit"),
    ("98b7ba01-7bfb-44b4-8713-e73c9e4c8d91", "collections", "collection_object", "acquisition_source", "restricted", "Acquisition Source", "Person or organization from whom the object was acquired", True, "entries.edit"),
    ("3fdbab8e-6841-4545-b4a5-80afefaa919e", "collections", "collection_object", "acquisition_source_type", "restricted", "Source Type", "Type of acquisition source (dealer, donor, etc.)", True, "entries.edit"),
    ("2cd03b0b-7b35-40e9-ae2a-400eead41486", "collections", "collection_object", "comments", "internal", "Internal Comments", "Staff comments and notes", True, "collections.edit"),
    ("fa128ffa-106e-450b-8bed-17ab512aed5c", "collections", "collection_object", "condition_note", "internal", "Condition Notes", "Internal condition assessment notes", True, "collections.edit"),
    ("ea92fc28-2ddc-44e5-b718-1daa65032818", "collections", "collection_object", "current_value", "sensitive", "Current Value", "Current appraised or estimated value", False, "org.manage_settings"),
    ("e0190e52-6d54-4e4a-b3b8-739e9debb7e8", "collections", "collection_object", "insurance_value", "sensitive", "Insurance Value", "Value for insurance purposes", False, "org.manage_settings"),
    ("4aad8e0c-90e0-4477-a607-0baa6814dd1e", "collections", "collection_object", "provenance", "restricted", "Provenance", "Ownership history of the object", True, "entries.edit"),
    ("e76b788a-d598-4f45-ba7f-57c567b159d6", "collections", "collection_object", "provenance_structured", "restricted", "Structured Provenance", "Detailed provenance records", True, "entries.edit"),
    ("ca7fccae-f505-44c4-ab29-615ed73d3801", "collections", "collection_object", "valuation_history", "sensitive", "Valuation History", "Historical valuation records", False, "org.manage_settings"),

    # =========================================================================
    # LOCATION
    # =========================================================================
    ("e34b0d49-1bfa-4805-9396-6db42ad70d4e", "collections", "location", "access_requirements", "restricted", "Access Requirements", "Requirements for accessing the location", True, "entries.edit"),
    ("73098c84-9993-4fc5-b017-54eb82aac9da", "collections", "location", "security_level", "restricted", "Security Level", "Security classification of the location", True, "entries.edit"),
    ("6ce01d9b-5757-451f-83bc-1a21a3984fa9", "collections", "location", "security_note", "restricted", "Security Notes", "Security-related notes for the location", False, "org.manage_settings"),

    # =========================================================================
    # LOAN IN
    # =========================================================================
    ("7939264e-ad65-4b59-9b40-d4eba934462e", "collections", "loan_in", "insurance_value", "sensitive", "Insurance Value", "Monetary value of items insured during loan", False, "org.manage_settings"),
    ("e2bfcd37-8d7a-4a3f-8290-36573e73fb0c", "collections", "loan_in", "indemnity_reference", "sensitive", "Indemnity Reference", "Government indemnity agreement reference number", False, "org.manage_settings"),
    ("bbd58637-98ca-4c09-96db-9bbc5f9dc9b9", "collections", "loan_in", "lender_contact", "restricted", "Lender Contact Details", "Lender personal contact information", True, "entries.edit"),
    ("9ca77264-dac7-4786-bc59-0f58da3c519f", "collections", "loan_in", "loan_conditions", "internal", "Loan Conditions", "Internal loan terms and conditions", True, "collections.edit"),
    ("31a78870-7680-4d3c-8251-fe946c402cf3", "collections", "loan_in", "special_requirements", "internal", "Special Requirements", "Special handling or display requirements", True, "collections.edit"),
    ("cd080db5-a053-4fd4-9516-b7ff73d2ad57", "collections", "loan_in", "facility_report_note", "internal", "Facility Report Notes", "Internal notes on facility reports", True, "collections.edit"),

    # =========================================================================
    # LOAN IN OBJECT
    # =========================================================================
    ("e1c33915-a970-4479-af6a-5eb57b9f0940", "collections", "loan_in_object", "insurance_value", "sensitive", "Item Insurance Value", "Per-item insurance value for borrowed object", False, "org.manage_settings"),
    ("413b2f7c-73e8-4ea6-b40c-4e656cae0936", "collections", "loan_in_object", "condition_in_note", "internal", "Condition-In Notes", "Staff condition assessment on receipt", True, "collections.edit"),
    ("4b84e6ae-6cc4-43c1-b184-ed497a4353c8", "collections", "loan_in_object", "condition_out_note", "internal", "Condition-Out Notes", "Staff condition assessment on return", True, "collections.edit"),

    # =========================================================================
    # LOAN OUT
    # =========================================================================
    ("5b55d38e-bb5b-49b8-9f64-78ae5aefeb7c", "collections", "loan_out", "insurance_value_total", "sensitive", "Total Insurance Value", "Total monetary value for all loaned items", False, "org.manage_settings"),
    ("070d5daf-d9c0-44a9-ba8d-c61db846dc5d", "collections", "loan_out", "borrower_contact", "restricted", "Borrower Contact Details", "Borrower personal contact information", True, "entries.edit"),
    ("fc7a457d-3ee6-4f6c-a9fa-fd8830f98aaa", "collections", "loan_out", "venue_contact", "restricted", "Venue Contact Details", "Exhibition venue contact information", True, "entries.edit"),
    ("39c58876-6a3b-4661-9e84-4741ab383f48", "collections", "loan_out", "courier_out_contact", "restricted", "Outbound Courier Contact", "Outbound courier contact details", True, "entries.edit"),
    ("f6f5bf3e-2117-4b66-8353-cef07d158080", "collections", "loan_out", "courier_return_contact", "restricted", "Return Courier Contact", "Return courier contact details", True, "entries.edit"),
    ("5ce2d56a-eb66-4dce-b50b-02f49df6325a", "collections", "loan_out", "loan_conditions", "internal", "Loan Conditions", "Internal loan terms and conditions", True, "collections.edit"),
    ("47cea32e-b4cc-4736-bbef-741664651ea2", "collections", "loan_out", "special_conditions", "internal", "Special Conditions", "Special handling or display conditions", True, "collections.edit"),

    # =========================================================================
    # LOAN OUT OBJECT
    # =========================================================================
    ("cc606aa1-92c5-42cb-b9ee-f44108fd21c6", "collections", "loan_out_object", "insurance_value", "sensitive", "Item Insurance Value", "Per-item insurance value for loaned object", False, "org.manage_settings"),
    ("f12f0ab6-d51f-40e0-bfed-85ca050af18b", "collections", "loan_out_object", "condition_out_note", "internal", "Condition-Out Notes", "Staff condition assessment at dispatch", True, "collections.edit"),
    ("ece21504-b2b1-4775-a908-00a4b3a42a75", "collections", "loan_out_object", "condition_return_note", "internal", "Condition-Return Notes", "Staff condition assessment on return", True, "collections.edit"),
    ("a2131c3a-5ef4-4710-8c49-61e084e1b1b0", "collections", "loan_out_object", "damage_note", "internal", "Damage Notes", "Staff notes on damage or condition issues", True, "collections.edit"),

    # =========================================================================
    # ACQUISITION
    # =========================================================================
    ("3175c9ba-eebd-45ba-8e5e-16756f20a9b0", "collections", "acquisition", "cost", "sensitive", "Acquisition Cost", "Purchase or acquisition price paid", False, "org.manage_settings"),
    ("c6e692c5-3bd4-4fde-a44b-a8a10444305b", "collections", "acquisition", "funding_source", "sensitive", "Funding Source", "Funding mechanism for the acquisition", False, "org.manage_settings"),
    ("409dc9b8-9e8c-4ee1-8c6b-112a09f841e2", "collections", "acquisition", "funding_account", "sensitive", "Funding Account", "Internal accounting reference", False, "org.manage_settings"),
    ("d821769c-2dff-43fb-9f28-d04dccf040f3", "collections", "acquisition", "funding_note", "sensitive", "Funding Notes", "Notes on funding arrangements", False, "org.manage_settings"),
    ("6ddf4bb0-6fd9-4c81-9778-bbe1fa00b2bf", "collections", "acquisition", "appraised_value", "sensitive", "Appraised Value", "Professional appraisal value", False, "org.manage_settings"),
    ("c82757dc-1e5c-43fc-a0ac-0df215e4a687", "collections", "acquisition", "source_contact", "restricted", "Source Contact Details", "Donor or source contact information", True, "entries.edit"),
    ("61b1b4a7-8a19-46ea-9370-045a4a32bbdd", "collections", "acquisition", "donor_restrictions", "restricted", "Donor Restrictions", "Donor-imposed conditions on the acquisition", True, "entries.edit"),
    ("ade23b92-f0cd-4365-94ea-39c0932c9c01", "collections", "acquisition", "provisos", "restricted", "Acquisition Provisos", "Legal conditions and restrictions", True, "entries.edit"),
    ("2966b6e9-e029-447e-8bf7-dd304a6ab9c2", "collections", "acquisition", "provenance_note", "restricted", "Provenance Notes", "Ownership history details", True, "entries.edit"),
    ("16dc54db-53a6-43be-a1fd-40ea3bcfc369", "collections", "acquisition", "legal_note", "restricted", "Legal Notes", "Legal issues or restrictions on ownership", True, "entries.edit"),
    ("8689b22f-41e4-41d8-b082-a62205fd970b", "collections", "acquisition", "authorization_note", "internal", "Authorization Notes", "Internal authorization decision notes", True, "collections.edit"),
    ("3d5713e5-c765-4361-a231-5cc982ac2403", "collections", "acquisition", "board_note", "internal", "Board Notes", "Internal board discussion notes", True, "collections.edit"),

    # =========================================================================
    # DEACCESSION
    # =========================================================================
    ("29d9710e-f1e0-4124-99ef-8f083efa305b", "collections", "deaccession", "appraised_value", "sensitive", "Appraisal Value", "Professional valuation for disposal", False, "org.manage_settings"),
    ("0e43371a-37f4-4427-96e8-928de48cbb0d", "collections", "deaccession", "sale_price", "sensitive", "Sale Price", "Final sale or disposal price received", False, "org.manage_settings"),
    ("24284d91-f66a-46b2-94f1-15f631069008", "collections", "deaccession", "recipient_contact", "restricted", "Recipient Contact", "Recipient or buyer contact information", True, "entries.edit"),
    ("90542e82-0ea4-4a2a-af0a-eac7a1543c02", "collections", "deaccession", "provenance_review_note", "restricted", "Provenance Review Notes", "Ownership history review details", True, "entries.edit"),
    ("34fa2cbf-e49d-4cef-85a0-bd15ab1bcb05", "collections", "deaccession", "legal_review_note", "restricted", "Legal Review Notes", "Legal issues identified during review", True, "entries.edit"),
    ("c2b43363-5ba9-425c-b16e-de3a1d9d7200", "collections", "deaccession", "donor_restrictions_note", "restricted", "Donor Restriction Notes", "Donor conditions affecting deaccession", True, "entries.edit"),
    ("a86b7d01-212d-45a5-90ec-f3444e2ea724", "collections", "deaccession", "justification", "internal", "Deaccession Justification", "Internal reasoning for deaccession", True, "collections.edit"),
    ("75e701ea-07da-4a6f-beec-1254fff95368", "collections", "deaccession", "reason_detail", "internal", "Reason Details", "Detailed explanation of deaccession reason", True, "collections.edit"),
    ("5eb6e900-5864-48c2-b4a8-de855efbd4ac", "collections", "deaccession", "committee_note", "internal", "Committee Notes", "Internal committee discussion notes", True, "collections.edit"),
    ("e331ef18-f8b4-44bf-a82b-852f32e62e63", "collections", "deaccession", "board_note", "internal", "Board Notes", "Internal board discussion notes", True, "collections.edit"),

    # =========================================================================
    # OBJECT ENTRY
    # =========================================================================
    ("6954de15-d201-478d-af7a-ca36c55636e3", "collections", "object_entry", "insurance_value", "sensitive", "Insurance Value", "Declared value of temporarily entered objects", False, "org.manage_settings"),
    ("1351ff18-e02c-449d-8c73-39f8ee20450e", "collections", "object_entry", "depositor_contact", "restricted", "Depositor Contact", "Depositor personal contact information", True, "entries.edit"),
    ("0b2a688d-7acc-49a6-8c0d-1420d10a1938", "collections", "object_entry", "current_owner_contact", "restricted", "Owner Contact", "Current owner contact information", True, "entries.edit"),
    ("dceb162a-6575-41e0-ab9e-8e6159606243", "collections", "object_entry", "depositor_requirements", "internal", "Depositor Requirements", "Internal notes on depositor conditions", True, "collections.edit"),
    ("253617c3-88f6-439a-915f-5be0f07bc1a3", "collections", "object_entry", "special_conditions", "internal", "Special Conditions", "Special handling or display conditions", True, "collections.edit"),

    # =========================================================================
    # OBJECT ENTRY ITEM
    # =========================================================================
    ("06ecfd32-160e-4541-b70b-9d2421174b13", "collections", "object_entry_item", "declared_value", "sensitive", "Declared Value", "Per-item insurance declaration value", False, "org.manage_settings"),
    ("211cb2be-7a62-4829-b257-bfb4662bce8c", "collections", "object_entry_item", "condition_note", "internal", "Condition Notes", "Staff condition assessment at entry", True, "collections.edit"),

    # =========================================================================
    # OBJECT EXIT
    # =========================================================================
    ("25f40b55-c5e3-49a0-87b2-66183d4378ad", "collections", "object_exit", "insurance_value", "sensitive", "Insurance Value", "Insurance value for items being transferred", False, "org.manage_settings"),
    ("19a0b709-3f33-4fe7-9e3e-2f59f966b210", "collections", "object_exit", "recipient_contact", "restricted", "Recipient Contact", "Transfer recipient contact information", True, "entries.edit"),
    ("044e0e32-a6bb-4945-b584-05033fdddd41", "collections", "object_exit", "recipient_address", "restricted", "Recipient Address", "Transfer recipient address", True, "entries.edit"),
    ("c375fe93-ccdc-4bc8-b3a5-9747a1a1738d", "collections", "object_exit", "courier_contact", "restricted", "Courier Contact", "Shipping courier contact information", True, "entries.edit"),
    ("a5ccf0bc-a285-4c64-835a-7f187577141e", "collections", "object_exit", "authorization_note", "internal", "Authorization Notes", "Staff notes on authorization decision", True, "collections.edit"),
    ("ad38c619-84a5-4a2e-a0a7-7371c33000cb", "collections", "object_exit", "exit_note", "internal", "Exit Notes", "Staff-only exit notes", True, "collections.edit"),

    # =========================================================================
    # OBJECT EXIT ITEM
    # =========================================================================
    ("26b065a7-e0e3-4d6d-b369-518949e098ac", "collections", "object_exit_item", "insurance_value", "sensitive", "Item Insurance Value", "Per-item insurance for transfer", False, "org.manage_settings"),
    ("afbaf5a4-2eb4-4fe5-aad1-2c6327014a29", "collections", "object_exit_item", "condition_note", "internal", "Condition Notes", "Staff condition assessment at exit", True, "collections.edit"),

    # =========================================================================
    # CONDITION REPORT
    # =========================================================================
    ("db95c8ca-3b6b-4ef6-ad46-82b788662dbf", "collections", "condition_report", "detailed_findings", "internal", "Detailed Findings", "Technical conservation assessment details", True, "collections.edit"),
    ("0cd679a5-08dc-4d04-9320-eae1765ee223", "collections", "condition_report", "hazards", "internal", "Hazard Assessment", "Conservation hazards and risks identified", True, "collections.edit"),
    ("5b875fbd-ca96-4c2c-afa7-4271cf640491", "collections", "condition_report", "conservation_priority", "internal", "Conservation Priority", "Internal priority assessment for treatment", True, "collections.edit"),
    ("85f64505-5c6d-4d3b-9b5a-75672763cbc8", "collections", "condition_report", "handling_requirements", "internal", "Handling Requirements", "Sensitive handling instructions for staff", True, "collections.edit"),
    ("c84371be-2777-46a9-888b-c6e07c7a1b84", "collections", "condition_report", "display_restrictions", "internal", "Display Restrictions", "Conservation restrictions on display conditions", True, "collections.edit"),
    ("681ecf03-ad20-4e81-bf0c-54aefa3b2f3c", "collections", "condition_report", "recommendations", "internal", "Recommendations", "Conservator recommendations for care", True, "collections.edit"),

    # =========================================================================
    # CONSERVATION TREATMENT
    # =========================================================================
    ("7e828207-58e8-4a86-b67c-bcd0a868df98", "collections", "conservation_treatment", "estimated_cost", "sensitive", "Estimated Cost", "Estimated financial cost of conservation", False, "org.manage_settings"),
    ("b584bc3b-e14c-4296-bcbf-2959f9bf27ea", "collections", "conservation_treatment", "actual_cost", "sensitive", "Actual Cost", "Final cost paid for conservation work", False, "org.manage_settings"),
    ("ad6cc6f8-d83b-45a0-9e3e-f56b7a149081", "collections", "conservation_treatment", "cost_breakdown", "sensitive", "Cost Breakdown", "Itemized cost details", False, "org.manage_settings"),
    ("227a8424-f7d7-4737-8ecc-2cb8946280a1", "collections", "conservation_treatment", "conservator_contact", "restricted", "Conservator Contact", "Conservator contact information", True, "entries.edit"),
    ("c528afb3-c772-46ad-a47d-85a2d230e1b2", "collections", "conservation_treatment", "treatment_description", "internal", "Treatment Description", "Detailed conservation methodology", True, "collections.edit"),
    ("b36cd112-0588-4ff4-9b06-60beb6e707df", "collections", "conservation_treatment", "treatment_rationale", "internal", "Treatment Rationale", "Reasoning for chosen treatment approach", True, "collections.edit"),
    ("65ece8c6-2991-451c-94a2-33ed098b2af6", "collections", "conservation_treatment", "materials_used", "internal", "Materials Used", "Conservation materials and chemicals", True, "collections.edit"),
    ("871a43f7-9b50-4ca1-8ddd-d0ff339ffe85", "collections", "conservation_treatment", "approval_note", "internal", "Approval Notes", "Internal treatment approval notes", True, "collections.edit"),

    # =========================================================================
    # CONTACT
    # =========================================================================
    ("9d95d810-0e50-402a-af6f-7812d00466e1", "collections", "contact", "email", "restricted", "Email Address", "Personal or business email", True, "entries.edit"),
    ("a0bfd2ec-6fd9-4a3b-a0a7-953bc57afd98", "collections", "contact", "phone", "restricted", "Phone Number", "Personal or business phone", True, "entries.edit"),
    ("6770516c-5c33-41fd-b2b9-771972351ee3", "collections", "contact", "phone_secondary", "restricted", "Secondary Phone", "Alternate phone number", True, "entries.edit"),
    ("88aa43c5-dfe9-416b-9d2d-7b20c72eddd8", "collections", "contact", "address", "restricted", "Address", "Full address information", True, "entries.edit"),
    ("e043c386-e92d-4f20-998b-7d055b5cf9ef", "collections", "contact", "internal_notes", "internal", "Internal Notes", "Staff notes about contact", True, "collections.edit"),

    # =========================================================================
    # EXHIBITION
    # =========================================================================
    ("185d1390-a0af-438a-b7fb-b2490aca3a4f", "exhibit", "exhibition", "curator_notes", "internal", "Curator Notes", "Internal curatorial notes and decisions", True, "collections.edit"),
    ("86988af4-b424-419d-b265-aa6ec2411b7a", "exhibit", "exhibition", "provisos", "restricted", "Exhibition Provisos", "Donor or lender restrictions on exhibition", True, "entries.edit"),
    ("9a57da8a-e760-409d-be11-21cba67b34f9", "exhibit", "exhibition", "outcome", "internal", "Exhibition Outcome", "Post-exhibition evaluation notes", True, "collections.edit"),

    # =========================================================================
    # EXHIBITION LOAN
    # =========================================================================
    ("ec563f82-0f2b-49a4-990d-4de501e9720d", "collections", "exhibition_loan", "insurance_value", "sensitive", "Insurance Value", "Insurance value for exhibition loan", False, "org.manage_settings"),
    ("5c773c5b-8c38-47f7-860c-067f6d2721cb", "collections", "exhibition_loan", "party_contact", "restricted", "Lender Contact", "Lender or borrower contact details", True, "entries.edit"),
    ("e797aae8-ba4d-470e-abc7-801a820853e1", "collections", "exhibition_loan", "status_notes", "internal", "Status Notes", "Internal notes on loan status", True, "collections.edit"),

    # =========================================================================
    # INSURANCE POLICY
    # =========================================================================
    ("afd02c8d-00ec-40e7-b465-f598d76f22d6", "collections", "insurance_policy", "coverage_limit", "sensitive", "Coverage Limit", "Maximum insured amount", False, "org.manage_settings"),
    ("ee24ef22-a210-46f0-b668-e9bfce4cdd91", "collections", "insurance_policy", "per_occurrence_limit", "sensitive", "Per-Occurrence Limit", "Limit per individual loss event", False, "org.manage_settings"),
    ("0d5ed931-6a16-4e01-8799-d9717aa7ac1a", "collections", "insurance_policy", "deductible", "sensitive", "Deductible", "Amount organization must pay per claim", False, "org.manage_settings"),
    ("031b1a78-a710-46fe-82aa-5ac25b1fc3c5", "collections", "insurance_policy", "annual_premium", "sensitive", "Annual Premium", "Annual insurance cost", False, "org.manage_settings"),
    ("482c4baf-9a26-43f8-ab75-011060e284f3", "collections", "insurance_policy", "broker_name", "restricted", "Insurance Broker", "Broker contact and relationship info", True, "entries.edit"),
    ("9da9ffc5-6cf5-48a0-beff-b47dbda04f01", "collections", "insurance_policy", "notes", "internal", "Policy Notes", "Internal policy notes and terms", True, "collections.edit"),

    # =========================================================================
    # INSURANCE COVERAGE
    # =========================================================================
    ("049b7870-e6c0-40c3-a975-039a09e91bce", "collections", "insurance_coverage", "declared_value", "sensitive", "Declared Value", "Declared monetary value of covered item", False, "org.manage_settings"),
    ("92721074-bd0f-490b-ac9e-891b5dca89a2", "collections", "insurance_coverage", "agreed_value", "sensitive", "Agreed Value", "Insurer-agreed value", False, "org.manage_settings"),
    ("c0e8b2a4-14b8-499e-91c4-88e52b42d5bb", "collections", "insurance_coverage", "third_party_provider", "restricted", "Third-Party Provider", "Alternative insurance provider details", True, "entries.edit"),
    ("a76a3af5-c989-4cc2-8c65-373de6b47d55", "collections", "insurance_coverage", "third_party_policy_number", "restricted", "Third-Party Policy Number", "Alternative policy reference number", True, "entries.edit"),
    ("fcd65aa3-047e-4d1a-8db5-3d0a6193d196", "collections", "insurance_coverage", "notes", "internal", "Coverage Notes", "Internal coverage notes and conditions", True, "collections.edit"),

    # =========================================================================
    # INDEMNITY ARRANGEMENT
    # =========================================================================
    ("ac222506-e99a-49e6-944b-59021e0d2256", "collections", "indemnity_arrangement", "requested_coverage", "sensitive", "Requested Coverage", "Indemnity amount requested from government", False, "org.manage_settings"),
    ("1ab2e20d-a30d-4b72-bcd2-07af9a0e931d", "collections", "indemnity_arrangement", "awarded_coverage", "sensitive", "Awarded Coverage", "Indemnity amount approved by government", False, "org.manage_settings"),
    ("a4ab3fd6-9abe-4700-b92c-ff6668a3ce32", "collections", "indemnity_arrangement", "notes", "internal", "Indemnity Notes", "Internal notes on indemnity arrangement", True, "collections.edit"),

    # =========================================================================
    # INDEMNITY OBJECT
    # =========================================================================
    ("f66ee37a-6795-44c4-91e4-36842d42e3f5", "collections", "indemnity_object", "declared_value", "sensitive", "Declared Value", "Declared value for indemnity coverage", False, "org.manage_settings"),
    ("d64c3d37-9ee3-4dbd-864e-228b5c3c41d7", "collections", "indemnity_object", "approved_value", "sensitive", "Approved Value", "Government-approved indemnity value", False, "org.manage_settings"),

    # =========================================================================
    # INSURANCE CLAIM
    # =========================================================================
    ("71c4e0eb-8ee5-4a97-b6dc-fdacb02927c0", "collections", "insurance_claim", "claimed_amount", "sensitive", "Claimed Amount", "Amount claimed in loss", False, "org.manage_settings"),
    ("664d40cd-ca6b-4b73-aefe-b7d94c84e9e2", "collections", "insurance_claim", "settlement_amount", "sensitive", "Settlement Amount", "Amount settled or paid", False, "org.manage_settings"),
    ("a4a7b3f1-1c2d-4e5f-8a9b-0c3d6e7f8a1b", "collections", "insurance_claim", "adjuster_name", "restricted", "Insurance Adjuster", "Claims adjuster name", True, "entries.edit"),
    ("b5b8c4f2-2d3e-4f6a-9b0c-1d4e7f8a9b2c", "collections", "insurance_claim", "adjuster_contact", "restricted", "Adjuster Contact", "Claims adjuster contact details", True, "entries.edit"),
    ("c6c9d5f3-3e4f-4a7b-0c1d-2e5f8a9b0c3d", "collections", "insurance_claim", "loss_description", "internal", "Loss Description", "Details of loss or damage incident", True, "collections.edit"),
    ("d7d0e6f4-4f5a-4b8c-1d2e-3f6a9b0c1d4e", "collections", "insurance_claim", "notes", "internal", "Claim Notes", "Internal claim processing notes", True, "collections.edit"),
]


def seed_document_templates():
    """Seed system document templates and field access policies."""
    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())

    print("\n" + "=" * 80)
    print("Seeding Document Templates & Field Access Policies")
    print("=" * 80)

    with Session(engine) as session:
        # ------------------------------------------------------------------
        # Document Templates
        # ------------------------------------------------------------------
        print("\nDocument Templates:")
        print("-" * 40)

        templates_inserted = 0
        for row in DOCUMENT_TEMPLATES:
            template_id, template_type, name, description, is_default, is_active, config_json, terms = row

            result = session.execute(
                text("""
                    INSERT INTO document_templates
                        (template_id, organization_id, template_type, name, description,
                         is_default, is_active, config, terms_and_conditions)
                    VALUES
                        (:template_id, NULL, :template_type, :name, :description,
                         :is_default, :is_active, CAST(:config AS jsonb), :terms)
                    ON CONFLICT (template_id) DO NOTHING
                """),
                {
                    "template_id": template_id,
                    "template_type": template_type,
                    "name": name,
                    "description": description,
                    "is_default": is_default,
                    "is_active": is_active,
                    "config": config_json,
                    "terms": terms,
                },
            )

            if result.rowcount > 0:
                templates_inserted += 1
                print(f"  + {name} ({template_type})")
            else:
                print(f"  . {name} ({template_type}) -- already exists")

        # ------------------------------------------------------------------
        # Field Access Policies
        # ------------------------------------------------------------------
        print("\nField Access Policies:")
        print("-" * 40)

        policies_inserted = 0
        for row in FIELD_ACCESS_POLICIES:
            (policy_id, app_key, entity_type, field_path, policy_type,
             display_name, description, default_visible, minimum_permission) = row

            result = session.execute(
                text("""
                    INSERT INTO field_access_policies
                        (policy_id, application_id, entity_type, field_path, policy_type,
                         display_name, description, default_visible, minimum_permission)
                    SELECT
                        :policy_id, a.application_id, :entity_type, :field_path, :policy_type,
                        :display_name, :description, :default_visible, :minimum_permission
                    FROM applications a
                    WHERE a.key = :app_key
                    ON CONFLICT ON CONSTRAINT uq_field_policy_app_entity_field DO NOTHING
                """),
                {
                    "policy_id": policy_id,
                    "app_key": app_key,
                    "entity_type": entity_type,
                    "field_path": field_path,
                    "policy_type": policy_type,
                    "display_name": display_name,
                    "description": description,
                    "default_visible": default_visible,
                    "minimum_permission": minimum_permission,
                },
            )

            if result.rowcount > 0:
                policies_inserted += 1
                print(f"  + {entity_type}.{field_path} [{policy_type}]")
            else:
                print(f"  . {entity_type}.{field_path} [{policy_type}] -- already exists")

        session.commit()

        # ------------------------------------------------------------------
        # Summary
        # ------------------------------------------------------------------
        template_count = session.execute(
            text("SELECT count(*) FROM document_templates WHERE organization_id IS NULL")
        ).scalar()
        policy_count = session.execute(
            text("SELECT count(*) FROM field_access_policies")
        ).scalar()

        print("\n" + "=" * 80)
        print(f"Inserted {templates_inserted} document templates ({len(DOCUMENT_TEMPLATES)} attempted)")
        print(f"Inserted {policies_inserted} field access policies ({len(FIELD_ACCESS_POLICIES)} attempted)")
        print(f"Total system document templates: {template_count}")
        print(f"Total field access policies: {policy_count}")
        print("=" * 80 + "\n")


if __name__ == "__main__":
    seed_document_templates()
