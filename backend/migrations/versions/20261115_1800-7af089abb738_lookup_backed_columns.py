"""Lookup-backed columns: drop CHECKs on open vocabularies, fix fixed ones.

Form controls offer values from lookup categories (seeded, and extendable per
organization), but 23 columns carried CHECK constraints listing a different or
narrower vocabulary, so picking e.g. acquisition method "Other", citation type
"Catalog", loan purpose "Long-term", or any value an organization added failed
at commit. These are descriptive vocabularies: the CHECKs are dropped and the
API validates against the organization's active lookup values
(app/services/lookup_fields.py), as for documentation plans (73098feecfda).
Values the old CHECKs accepted but that were never seeded (e.g. acquisition
method "commission", audit type "spot_check") are added as system lookup
values, so nothing the API accepted before is refused now.

Three categories stay closed because code branches on their values: object
status, condition rating, rights status. Their CHECKs stay; the seeded values
the CHECK refused (object status "active" / "in_conservation", condition
"critical") are removed, "destroyed" is added to object status, and any
organization-added value outside the CHECK is deactivated. Object exits that
stored condition "critical" (that column has no CHECK) are mapped to
"unacceptable", the most severe value of the scale.

Revision ID: 7af089abb738
Revises: 73098feecfda
"""

from alembic import op

revision = "7af089abb738"
down_revision = "73098feecfda"
branch_labels = None
depends_on = None


# (table, constraint, definition) — definitions as they stood before this
# revision, restored NOT VALID on downgrade.
_OPEN_CHECKS = [
    ("collections.acquisitions", "check_acquisition_legal_status", "legal_status IS NULL OR legal_status IN ('clear', 'pending_provenance', 'disputed', 'restricted')"),
    ("collections.acquisitions", "check_acquisition_method_acq", "acquisition_method IN ('gift', 'purchase', 'bequest', 'transfer', 'exchange', 'field_collection', 'commission', 'found_in_collection', 'conversion', 'donation', 'unknown')"),
    ("collections.acquisitions", "check_acquisition_source_type", "source_type IS NULL OR source_type IN ('individual', 'institution', 'estate', 'dealer', 'other')"),
    ("collections.audit_campaigns", "check_audit_type", "audit_type IN ('location', 'condition', 'documentation', 'security', 'comprehensive', 'spot_check', 'annual')"),
    ("collections.audit_campaigns", "check_sample_method", "sample_method IS NULL OR sample_method IN ('complete', 'random', 'stratified', 'systematic', 'targeted')"),
    ("collections.citations", "check_citation_type", "citation_type IN ('book', 'monograph', 'article', 'journal_article', 'exhibition_catalog', 'collection_catalog', 'auction_catalog', 'dissertation', 'thesis', 'website', 'database', 'unpublished', 'correspondence', 'archival', 'newspaper', 'magazine', 'other')"),
    ("collections.collections_reviews", "check_review_type", "review_type IN ('significance', 'relevance', 'care', 'deaccession', 'rationalization', 'thematic', 'condition', 'documentation', 'comprehensive')"),
    ("collections.condition_reports", "check_report_type", "report_type IN ('intake', 'loan_out', 'loan_in', 'loan_return', 'periodic', 'conservation', 'incident', 'pre_treatment', 'post_treatment')"),
    ("collections.conservation_treatments", "check_treatment_type", "treatment_type IN ('preventive', 'remedial', 'restoration', 'analysis', 'stabilization', 'cleaning', 'repair', 'documentation', 'mount_making', 'rehousing', 'pest_treatment', 'other')"),
    ("collections.deaccessions", "check_deaccession_reason", "reason IN ('duplicate', 'outside_scope', 'deterioration', 'damage', 'repatriation', 'theft_loss', 'exchange', 'ethical', 'donor_request', 'legal_requirement', 'hazard', 'other')"),
    ("collections.events", "check_event_audience", "audience IS NULL OR audience IN ('public', 'members', 'internal')"),
    ("collections.events", "check_event_type", "event_type IN ('teaching_session', 'program', 'opening_reception', 'donor_development', 'internal')"),
    ("collections.incident_reports", "check_incident_type", "incident_type IN ('damage', 'loss', 'theft', 'vandalism', 'environmental', 'fire', 'water', 'pest', 'other')"),
    ("collections.incident_reports", "check_insurance_claim_status", "insurance_claim_status IS NULL OR insurance_claim_status IN ('pending', 'approved', 'denied', 'settled', 'withdrawn')"),
    ("collections.loans_in", "check_loan_in_purpose", "loan_purpose IN ('exhibition', 'research', 'conservation', 'long_term', 'photography', 'education', 'study', 'other')"),
    ("collections.loans_out", "check_loan_out_purpose", "loan_purpose IN ('exhibition', 'research', 'conservation', 'education', 'photography', 'touring', 'inter_museum', 'other')"),
    ("collections.object_entries", "check_entry_reason", "entry_reason IN ('loan_consideration', 'gift_offer', 'purchase_consideration', 'identification', 'conservation', 'photography', 'research', 'enquiry', 'other')"),
    ("collections.object_exits", "check_exit_reason", "exit_reason IN ('loan_return', 'loan_out', 'transfer', 'disposal', 'deaccession', 'conservation', 'photography', 'enquiry_return', 'repatriation', 'destruction', 'theft_loss', 'other')"),
    ("collections.object_rights", "check_right_type", "right_type IN ('copyright', 'reproduction', 'exhibition', 'publication', 'broadcast', 'performance', 'adaptation', 'distribution', 'moral_rights', 'database_rights', 'trademark', 'other')"),
    ("collections.reproduction_requests", "check_reproduction_type", "reproduction_type IN ('photograph', 'scan', 'cast', '3d_print', 'digital_copy', 'film', 'video', 'other')"),
    ("collections.use_requests", "check_use_type", "use_type IN ('research', 'exhibition', 'reproduction', 'education', 'publication', 'broadcast', 'commercial', 'conservation', 'loan', 'digitization', 'other')"),
    ("collections.valuations", "check_valuation_method", "valuation_method IS NULL OR valuation_method IN ('comparable_sales', 'replacement_cost', 'income_approach', 'expert_opinion', 'formula', 'hybrid')"),
    ("collections.valuations", "check_valuation_type", "valuation_type IN ('insurance', 'market', 'replacement', 'probate', 'donation', 'internal')"),
]

# Closed categories and the values their CHECK allows.
_FIXED = {
    "object_status": ("pending", "accessioned", "on_loan", "deaccessioned", "missing", "destroyed"),
    "condition": ("excellent", "good", "fair", "poor", "unacceptable"),
    "right_status": (
        "unknown", "public_domain", "owned", "licensed", "granted",
        "requested", "denied", "expired", "orphan", "disputed",
    ),
}

# Seeded values the CHECKs refused (value_id, category, key, label, description, sort).
_REMOVED_SEEDS = [
    ("28cf50e8-1bd7-4cca-b5ef-849f338507fd", "object_status", "active", "Active", "Active in collection", 2),
    ("dd983dd8-24dc-4b53-b9f5-a521901f07af", "object_status", "in_conservation", "In Conservation", "Under conservation", 4),
    ("219ad9e0-5114-44ae-8271-6645ad9eca11", "condition", "critical", "Critical", "Object in critical condition requiring immediate attention", 5),
]
_DESTROYED_ID = "3980d362-9bc6-4a46-8d36-b22f3ee48692"

# Values the dropped CHECKs accepted that were never seeded as lookup values.
# Added as system values so every value the API accepted before is still
# accepted (and offered); organizations can hide the ones they do not use.
# (category, value_id, key, label, sort)
_FORMER_CHECK_VALUES = [
    ("acquisition_method", "2c0560f5-e99a-53c7-8c9f-4c7fbcb1ad4b", "commission", "Commission", 8),
    ("acquisition_method", "13c6ef2e-1964-5b49-8638-0d1a90879fac", "conversion", "Conversion", 9),
    ("acquisition_method", "1080283b-636f-52db-aa89-3c8caf466a6d", "donation", "Donation", 10),
    ("acquisition_method", "be95fc71-1ca3-56b9-801e-684a3654b928", "unknown", "Unknown", 11),
    ("audit_type", "e6c40082-49d7-54d2-a947-ac245c46d163", "spot_check", "Spot check", 5),
    ("audit_type", "19aa5b13-9af0-5fdb-8a60-866cde464aa6", "annual", "Annual", 6),
    ("citation_type", "34dbe95c-8c6f-57db-a35a-768d9d63990c", "monograph", "Monograph", 6),
    ("citation_type", "2f35037e-07ea-5588-9d95-50845fa19d0c", "journal_article", "Journal article", 7),
    ("citation_type", "283a2e5d-9633-584a-9cfe-9ed758048c10", "collection_catalog", "Collection catalog", 8),
    ("citation_type", "0172efc0-d2d3-52af-9cf2-36cb4464aa85", "auction_catalog", "Auction catalog", 9),
    ("citation_type", "6128c525-bb36-52c8-a21d-1ee0465b3571", "thesis", "Thesis", 10),
    ("citation_type", "4601ea35-bd06-5a91-b25c-bab317958dd1", "database", "Database", 11),
    ("citation_type", "5d428a54-88ba-5d9d-a159-79e2e2e0032f", "unpublished", "Unpublished", 12),
    ("citation_type", "227ca263-0915-503a-8f68-d21933ed9f15", "correspondence", "Correspondence", 13),
    ("citation_type", "d3cca905-c7f7-5190-b3b5-c61f2555e67d", "archival", "Archival", 14),
    ("citation_type", "f803d67b-81d9-5392-a9a9-a5141bce1b13", "newspaper", "Newspaper", 15),
    ("citation_type", "28fadee5-8ee6-55aa-937f-4931ddc4067e", "magazine", "Magazine", 16),
    ("citation_type", "b9e2f805-9fd0-5590-aa45-c8014f0ac4ce", "other", "Other", 17),
    ("review_type", "c7bb7091-dd20-5b06-b162-cb947a627cf2", "thematic", "Thematic", 5),
    ("review_type", "40f15b2c-dc13-5b44-8103-cbd642462686", "condition", "Condition", 6),
    ("review_type", "e21aa610-e171-55ee-b72f-cd55d9377d62", "documentation", "Documentation", 7),
    ("review_type", "c017b7d8-249f-5883-8d42-446d5319dbe2", "comprehensive", "Comprehensive", 8),
    ("report_type", "08d56e17-b98f-5253-915f-8b6ee1d0b700", "loan_return", "Loan return", 6),
    ("report_type", "22bf0b26-cc08-5f8e-b012-cef2cedc0bd8", "pre_treatment", "Pre-treatment", 7),
    ("report_type", "d1881e7b-b33a-5242-92ec-d08a414aa530", "post_treatment", "Post-treatment", 8),
    ("treatment_type", "07ef742f-f05b-5c15-ab11-765371a43410", "stabilization", "Stabilization", 5),
    ("treatment_type", "dcf100a7-adc0-51de-acd3-ca39aee9f2ce", "cleaning", "Cleaning", 6),
    ("treatment_type", "69391216-7a7c-5b80-9124-ce8dee2520a5", "repair", "Repair", 7),
    ("treatment_type", "0f663fca-5fb4-5349-b309-e1395a24c42e", "documentation", "Documentation", 8),
    ("treatment_type", "d2b4e324-4172-551b-8ea8-1da443d64e1c", "mount_making", "Mount making", 9),
    ("treatment_type", "3a972cbf-5bbf-5719-93e2-e4ad22dd9ef6", "rehousing", "Rehousing", 10),
    ("treatment_type", "b84b2faf-cdd1-57c9-90fd-dc49536b67e9", "pest_treatment", "Pest treatment", 11),
    ("deaccession_reason", "a855ced9-fc4e-579a-944e-df3b0a3c6658", "damage", "Damage", 6),
    ("deaccession_reason", "ad5731bb-522d-547d-b261-9097b15ba994", "exchange", "Exchange", 7),
    ("deaccession_reason", "985fe9db-eeff-5954-8761-c1956f8ef302", "ethical", "Ethical", 8),
    ("deaccession_reason", "b5c248fb-e4d2-570f-aec8-63eb5f7da83d", "donor_request", "Donor request", 9),
    ("deaccession_reason", "aa10cbc2-3a7e-596d-bfe2-191d3985442d", "legal_requirement", "Legal requirement", 10),
    ("deaccession_reason", "d46d9418-e702-5eb9-a7cf-73e081b04444", "hazard", "Hazard", 11),
    ("claim_status", "07a51081-25bc-525e-b802-5a63d83f305b", "pending", "Pending", 5),
    ("claim_status", "3cc8cba7-f319-512e-8604-3555f23e51a7", "withdrawn", "Withdrawn", 6),
    ("loan_purpose", "95f296a5-7d3d-5923-8055-4abdde388ab5", "photography", "Photography", 6),
    ("loan_purpose", "3bcb710a-0ccf-58cd-9e05-a744f275858a", "study", "Study", 7),
    ("loan_purpose", "c0eec9f5-99c6-51e9-92c1-3e6782f899b4", "touring", "Touring", 8),
    ("loan_purpose", "f62f6c40-437f-5df7-81ba-d9623adc30bc", "inter_museum", "Inter-museum", 9),
    ("entry_reason", "9eb549f0-e167-5e9d-a584-3250bd07a312", "purchase_consideration", "Purchase consideration", 7),
    ("entry_reason", "38a7b4ab-5673-5c81-bc8a-187c45757c4e", "enquiry", "Enquiry", 8),
    ("exit_reason", "52b9c2e6-8eae-5f3f-8884-36863d826489", "destruction", "Destruction", 10),
    ("exit_reason", "6b96d5dd-3700-54bc-badb-22424ad1c96a", "theft_loss", "Theft or loss", 11),
    ("right_type", "f6e53fa9-883d-5e9e-a0d2-27f541c2a92f", "performance", "Performance", 6),
    ("right_type", "7de05e82-7d92-54e4-aef6-bb376d341dda", "adaptation", "Adaptation", 7),
    ("right_type", "d05b3fa4-dbd8-5f99-9b4a-e0659eac215d", "distribution", "Distribution", 8),
    ("right_type", "76837007-5361-5b33-b19f-afa0569f8d72", "moral_rights", "Moral rights", 9),
    ("right_type", "a3e336f4-3e19-5b9f-8474-81d0d0bebdb3", "database_rights", "Database rights", 10),
    ("right_type", "3263a10b-7200-5f81-82ee-3444463a658f", "trademark", "Trademark", 11),
    ("right_type", "e5b846ee-30e6-5229-aa55-c1c253b81cd1", "other", "Other", 12),
    ("reproduction_type", "fb1247b4-da58-5ce5-88f4-ef721fbf12d3", "video", "Video", 7),
    ("reproduction_type", "a46b66c1-b930-5f13-bbfb-d365c534cede", "other", "Other", 8),
    ("use_type", "56b6fd6d-d6ad-5639-b545-839555c2177b", "broadcast", "Broadcast", 5),
    ("use_type", "4cae39a2-0855-50de-8d2c-d2c6cd27fe0e", "commercial", "Commercial", 6),
    ("use_type", "aa3bbd44-57c7-597c-b2b2-9fcdf8a4b257", "conservation", "Conservation", 7),
    ("use_type", "66bef828-9e45-5040-adff-6819aa93a30e", "loan", "Loan", 8),
    ("use_type", "da1a4705-fe96-5763-a8cc-a90adcace2ec", "digitization", "Digitization", 9),
    ("use_type", "b2181e02-564f-52b1-8eb4-9fbd09e05e98", "other", "Other", 10),
    ("valuation_method", "510a3fa7-13a0-5e7d-8193-a10b215c3333", "hybrid", "Hybrid", 5),
    ("valuation_type", "75da5644-d8a0-5b3e-8642-3f6b47105954", "internal", "Internal", 5),
]


def _quoted(values) -> str:
    return ", ".join(f"'{v}'" for v in values)


def upgrade() -> None:
    for table, name, _definition in _OPEN_CHECKS:
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {name}")

    for value_id, _category, _key, _label, _desc, _sort in _REMOVED_SEEDS:
        op.execute(f"DELETE FROM collections.lookup_values WHERE value_id = '{value_id}'")

    for category, allowed in _FIXED.items():
        op.execute(
            "UPDATE collections.lookup_values v SET is_active = false, updated_at = now() "
            "FROM collections.lookup_categories c "
            f"WHERE v.category_id = c.category_id AND c.category_key = '{category}' "
            f"AND v.value_key NOT IN ({_quoted(allowed)}) AND v.is_active"
        )

    op.execute(
        "INSERT INTO collections.lookup_values "
        "(value_id, category_id, organization_id, value_key, label, description, "
        "icon_name, sort_order, is_active, is_hidden) "
        f"SELECT '{_DESTROYED_ID}', c.category_id, NULL, 'destroyed', 'Destroyed', "
        "'Destroyed or lost beyond recovery', NULL, 7, true, false "
        "FROM collections.lookup_categories c WHERE c.category_key = 'object_status' "
        "AND NOT EXISTS (SELECT 1 FROM collections.lookup_values v "
        "WHERE v.category_id = c.category_id AND v.organization_id IS NULL "
        "AND v.value_key = 'destroyed')"
    )

    for category, value_id, key, label, sort in _FORMER_CHECK_VALUES:
        op.execute(
            "INSERT INTO collections.lookup_values "
            "(value_id, category_id, organization_id, value_key, label, description, "
            "icon_name, sort_order, is_active, is_hidden) "
            f"SELECT '{value_id}', c.category_id, NULL, '{key}', '{label}', NULL, NULL, {sort}, true, false "
            f"FROM collections.lookup_categories c WHERE c.category_key = '{category}' "
            "AND NOT EXISTS (SELECT 1 FROM collections.lookup_values v "
            "WHERE v.category_id = c.category_id AND v.organization_id IS NULL "
            f"AND v.value_key = '{key}') ON CONFLICT DO NOTHING"
        )

    op.execute(
        "UPDATE collections.object_exits SET condition_at_exit = 'unacceptable' "
        "WHERE condition_at_exit = 'critical'"
    )


def downgrade() -> None:
    # Remapped exit conditions and deactivated organization values are not
    # restored: the old state could not be saved through the CHECKs anyway.
    for _category, value_id, _key, _label, _sort in _FORMER_CHECK_VALUES:
        op.execute(f"DELETE FROM collections.lookup_values WHERE value_id = '{value_id}'")
    op.execute(f"DELETE FROM collections.lookup_values WHERE value_id = '{_DESTROYED_ID}'")
    for value_id, category, key, label, desc, sort in _REMOVED_SEEDS:
        op.execute(
            "INSERT INTO collections.lookup_values "
            "(value_id, category_id, organization_id, value_key, label, description, "
            "icon_name, sort_order, is_active, is_hidden) "
            f"SELECT '{value_id}', c.category_id, NULL, '{key}', '{label}', '{desc}', "
            f"NULL, {sort}, true, false FROM collections.lookup_categories c "
            f"WHERE c.category_key = '{category}' ON CONFLICT DO NOTHING"
        )
    # NOT VALID: rows saved since the upgrade may hold lookup values outside
    # the old lists; the constraints then apply to new writes only.
    for table, name, definition in _OPEN_CHECKS:
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {name}")
        op.execute(f"ALTER TABLE {table} ADD CONSTRAINT {name} CHECK ({definition}) NOT VALID")
