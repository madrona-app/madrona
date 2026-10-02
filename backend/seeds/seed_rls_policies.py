"""
Seed RLS functions and policies across all schemas.

Creates/replaces PostgreSQL functions (current_org_id, current_dept_ids,
current_dept_bypass) and ensures all Row-Level Security policies are in place.
Uses DROP POLICY IF EXISTS + CREATE POLICY for idempotency.

Run with:
    python -m seeds.seed_rls_policies
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import Settings


# ── current_org_id() function ────────────────────────────────────────────────

CURRENT_ORG_ID_FUNCTION = """
CREATE OR REPLACE FUNCTION public.current_org_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
AS $function$
        BEGIN
            RETURN NULLIF(current_setting('app.current_org_id', true), '')::uuid;
        EXCEPTION WHEN OTHERS THEN
            RETURN NULL;
        END;
        $function$;
"""

CURRENT_DEPT_IDS_FUNCTION = """
CREATE OR REPLACE FUNCTION public.current_dept_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE
AS $function$
        BEGIN
            RETURN string_to_array(
                NULLIF(current_setting('app.current_dept_ids', true), ''),
                ','
            )::uuid[];
        EXCEPTION WHEN OTHERS THEN
            RETURN NULL;
        END;
        $function$;
"""

CURRENT_DEPT_BYPASS_FUNCTION = """
CREATE OR REPLACE FUNCTION public.current_dept_bypass()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
        BEGIN
            RETURN COALESCE(
                current_setting('app.dept_bypass', true)::boolean,
                FALSE
            );
        EXCEPTION WHEN OTHERS THEN
            RETURN FALSE;
        END;
        $function$;
"""

# current_user_id() lets user-scoped tables (organization_memberships, etc.)
# enforce RLS *before* any org context is known. The /me bootstrap query
# can't set current_org_id() — it's literally trying to discover which orgs
# the user belongs to — so policies on those tables read the user instead.
CURRENT_USER_ID_FUNCTION = """
CREATE OR REPLACE FUNCTION public.current_user_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
AS $function$
        BEGIN
            RETURN NULLIF(current_setting('app.current_user_id', true), '')::uuid;
        EXCEPTION WHEN OTHERS THEN
            RETURN NULL;
        END;
        $function$;
"""

# ── Tables with RLS enabled ──────────────────────────────────────────────────
# Format: (schema, table, force_rls)

RLS_TABLES = [
    # collections schema
    ("collections", "acquisitions", True),
    ("collections", "audit_campaigns", True),
    ("collections", "audit_results", True),
    ("collections", "citations", True),
    ("collections", "collection_objects", True),
    ("collections", "collections_reviews", True),
    ("collections", "condition_reports", True),
    ("collections", "conservation_treatments", True),
    ("collections", "constituents", True),
    ("collections", "constituent_xrefs", True),
    ("collections", "constituent_relations", True),
    ("collections", "crates", True),
    ("collections", "department_memberships", True),
    ("collections", "departments", True),
    ("collections", "deaccession_audit", True),
    ("collections", "deaccessions", True),
    ("collections", "documentation_plans", True),
    ("collections", "emergency_plans", True),
    ("collections", "event_object_links", True),
    # event_participants removed - migrated to constituent_xrefs
    ("collections", "events", True),
    ("collections", "exhibition_content_blocks", True),
    ("collections", "exhibition_floor_plans", True),
    ("collections", "exhibition_objects", True),
    ("collections", "exhibition_status_history", True),
    ("collections", "exhibition_venues", True),
    ("collections", "exhibitions", True),
    ("collections", "exports", True),
    ("collections", "floor_plans", True),
    ("collections", "frame_styles", True),
    ("collections", "incident_report_objects", True),
    ("collections", "incident_reports", True),
    ("collections", "label_templates", True),
    ("collections", "loan_in_objects", True),
    ("collections", "loan_out_objects", True),
    ("collections", "loans_in", True),
    ("collections", "loans_out", True),
    ("collections", "locations", True),
    ("collections", "lookup_categories", True),
    ("collections", "lookup_sort_overrides", True),
    ("collections", "lookup_values", True),
    ("collections", "mount_configs", True),
    ("collections", "movements", True),
    ("collections", "object_citations", True),
    # object_contacts removed - migrated to constituent_xrefs
    ("collections", "object_entries", True),
    ("collections", "object_entry_items", True),
    ("collections", "object_exit_items", True),
    ("collections", "object_exits", True),
    ("collections", "object_parts", True),
    # object_person_authorities removed - migrated to constituent_xrefs
    ("collections", "object_relationships", True),
    ("collections", "object_review_assessments", True),
    ("collections", "object_rights", True),
    # person_authorities and person_authority_relations removed - migrated to constituents/constituent_relations
    ("collections", "placements", True),
    ("collections", "reproduction_requests", True),
    ("collections", "shipment_documents", True),
    ("collections", "shipment_items", True),
    ("collections", "shipment_legs", True),
    ("collections", "shipment_references", True),
    ("collections", "shipment_status_history", True),
    ("collections", "shipments", True),
    ("collections", "use_request_objects", True),
    ("collections", "use_requests", True),
    ("collections", "user_active_context", False),
    ("collections", "valuations", True),
    ("collections", "venues", True),
    ("collections", "vocabulary_mappings", True),
    ("collections", "vocabulary_term_relationships", True),
    ("collections", "vocabulary_terms", True),
    ("collections", "workspace_items", False),
    ("collections", "workspace_shares", False),
    ("collections", "workspaces", False),
    # content schema
    ("content", "pages", True),
    ("content", "content_blocks", True),
    ("content", "categories", True),
    ("content", "page_categories", True),
    ("content", "menus", True),
    ("content", "menu_items", True),
    # flow schema
    ("flow", "change_events", True),
    ("flow", "connector_instances", True),
    ("flow", "dataset_transformers", True),
    ("flow", "datasets", True),
    ("flow", "entity_current", True),
    ("flow", "entity_fields", True),
    ("flow", "entity_relationships", True),
    ("flow", "field_diffs", True),
    ("flow", "jobs", True),
    ("flow", "org_scoped_docs", True),
    ("flow", "pipeline_destinations", True),
    ("flow", "pipeline_sources", True),
    ("flow", "pipelines", True),
    ("flow", "relationship_definitions", True),
    ("flow", "run_destination_steps", True),
    ("flow", "run_source_steps", True),
    ("flow", "runs", True),
    ("flow", "schedules", True),
    # media schema
    ("media", "media", False),
    ("media", "media_collection_items", False),
    ("media", "media_collection_shares", False),
    ("media", "media_collections", False),
    ("media", "media_consent", False),
    ("media", "media_derivatives", False),
    ("media", "media_download_request_items", False),
    ("media", "media_download_requests", False),
    ("media", "media_field_inheritance_config", False),
    ("media", "media_folders", False),
    ("media", "media_processing_jobs", False),
    ("media", "media_rights", False),
    ("media", "media_tag_definitions", False),
    ("media", "media_tags", False),
    ("media", "media_usage_events", False),
    ("media", "media_versions", False),
    ("media", "watermark_templates", False),
    ("media", "workspace_action_runs", True),
    ("media", "workspace_items", True),
    ("media", "workspace_shares", True),
    # public schema
    ("public", "api_keys", True),
    ("public", "approval_requests", True),
    ("public", "approval_rules", True),
    ("public", "audit_logs", True),
    ("public", "org_role_labels", True),
    ("public", "organization_invitations", True),
    ("public", "organization_memberships", True),
    ("public", "notifications", True),
    ("public", "record_comments", False),
    ("public", "record_watches", False),
    ("public", "tasks", True),
    ("public", "user_overview_prefs", True),
    ("public", "guide_user_prefs", True),
    ("public", "user_layout_overrides", True),
    # reporting schema
    # reports schema
    ("reports", "report_runs", True),
    ("reports", "report_schedules", True),
    ("reports", "reports", True),
    # collections schema (added 2026-04-23 during RLS coverage audit)
    ("collections", "acquisition_objects", True),
    ("collections", "barcode_labels", True),
    ("collections", "barcode_scans", True),
    ("collections", "cataloging_history", True),
    ("collections", "compliance_actions", True),
    ("collections", "compliance_issue_items", True),
    ("collections", "critical_responses", True),
    ("collections", "deaccession_votes", True),
    ("collections", "discover_configs", True),
    ("collections", "emergency_assembly_points", True),
    ("collections", "emergency_equipment", True),
    ("collections", "emergency_evacuation_routes", True),
    ("collections", "emergency_external_services", True),
    ("collections", "emergency_plan_contacts", True),
    ("collections", "emergency_risk_assessments", True),
    ("collections", "entity_images", True),
    ("collections", "exhibition_loans", True),
    ("collections", "expiration_alerts", True),
    ("collections", "indemnity_arrangements", True),
    ("collections", "insurance_claims", True),
    ("collections", "insurance_coverages", True),
    ("collections", "insurance_policies", True),
    ("collections", "loan_in_entries", True),
    ("collections", "loan_monitoring_events", True),
    ("collections", "loan_renewals", True),
    ("collections", "nagpra_actions", True),
    ("collections", "nagpra_consultation_events", True),
    ("collections", "object_classifications", True),
    ("collections", "object_contexts", True),
    ("collections", "object_inscriptions", True),
    ("collections", "object_materials", True),
    ("collections", "object_measurements", True),
    ("collections", "object_other_numbers", True),
    ("collections", "object_place_authorities", True),
    ("collections", "object_style_periods", True),
    ("collections", "object_subjects", True),
    ("collections", "object_techniques", True),
    ("collections", "object_titles", True),
    ("collections", "other_number_types", True),
    ("collections", "place_authorities", True),
    ("collections", "publish_schedules", True),
    ("collections", "sequence_counters", True),
    ("collections", "signed_documents", True),
    ("collections", "style_period_authorities", True),
    ("collections", "subject_authorities", True),
    ("collections", "treatment_costs", True),
    ("collections", "treatment_materials", True),
    ("collections", "treatment_techniques", True),
    ("collections", "variant_terms", True),
    # content schema (added 2026-04-23 during RLS coverage audit)
    ("content", "redirects", True),
    # media schema (added 2026-04-23 during RLS coverage audit)
    ("media", "collection_feedback_requests", True),
    ("media", "collection_feedback_responses", True),
    ("media", "derivative_size_configs", True),
    ("media", "information_packages", True),
    ("media", "media_ai_config", True),
    ("media", "media_ai_tag_mappings", True),
    ("media", "media_ai_tags", True),
    ("media", "media_alternatives", True),
    ("media", "media_annotations", True),
    ("media", "media_embeddings", True),
    ("media", "media_locks", True),
    ("media", "media_search_subscriptions", True),
    ("media", "metadata_templates", True),
    ("media", "preservation_action_plans", True),
    ("media", "preservation_events", True),
    ("media", "preservation_policies", True),
    ("media", "replication_records", True),
    # public schema (added 2026-04-23 during RLS coverage audit)
    ("public", "agent_plans", True),
    ("public", "agent_drafts", True),
    ("public", "agent_plan_step_metrics", True),  # §2A effort telemetry
    ("public", "app_role_assignments", True),
    ("public", "checklist_templates", True),
    ("public", "conversations", True),
    ("public", "document_templates", True),
    ("public", "entity_audit_events", True),
    ("public", "entity_audit_field_diffs", True),
    ("public", "entity_merge_log", True),
    ("public", "guide_documents", True),
    ("public", "guide_metrics", True),
    ("public", "guide_system_prompts", True),
    ("public", "info_request_templates", True),
    ("public", "messages", True),
    # org_provisioning_jobs and provisioning_audit_logs are PLATFORM-level
    # tables, not org-scoped. Their `organization_id` columns are the
    # *target* of provisioning (often NULL until the saga creates the
    # org), not access scope. The standard policy
    # `organization_id = current_org_id()` always failed for new INSERTs
    # (NULL ≠ requester's current_org_id), which broke the entire
    # /api/platform/provision endpoint after the RLS bootstrap landed
    # 2026-04-23. Migration f1a2b3c4d5e6 disables RLS on these on
    # existing environments; this list keeps them out of future runs.
    ("public", "organization_applications", True),
    ("public", "organization_branding", True),
    ("public", "organization_collection_profiles", True),
    ("public", "organization_storage_configs", True),
    ("public", "organizations", True),
    ("public", "reference_chunks", True),
    ("public", "role_field_access", True),
    ("public", "roles", True),
    ("public", "sla_events", True),
    ("public", "sla_policies", True),
    ("public", "sso_configurations", True),
    ("public", "uri_registry", True),
    ("public", "visit_interactions", True),
    ("public", "visitors", True),
    ("public", "visits", True),
    # reports schema (added 2026-04-23 during RLS coverage audit)
    ("reports", "report_schedule_recipients", True),

    # Org-scoped child tables — tenancy inherited through a NOT NULL FK to an
    # org-scoped parent. See the "_via_parent" policies in RLS_POLICIES.
    # exhibition_venues, exports, floor_plans and placements are already listed
    # above; they had force=True and no policy, i.e. deny-all, until now.
    ("collections", "collection_object_media", True),
    ("collections", "constituent_media", True),
    ("collections", "exhibition_budget_lines", True),
    ("collections", "exhibition_labels", True),
    ("collections", "exhibition_loan_objects", True),
    ("collections", "indemnity_objects", True),
    ("collections", "object_entry_item_media", True),
    ("media", "media_collection_share_access", True),
    ("media", "media_tag_values", True),
    ("public", "agent_plan_steps", True),
    ("public", "checklist_template_versions", True),
    ("public", "info_request_template_items", True),
]

# ── Standard org-isolation pattern ───────────────────────────────────────────
# Strict: queries without org context return 0 rows (no NULL bypass).
# Owner role (BYPASSRLS) is used for migrations, seeds, and system tasks.

_STD = "(organization_id = current_org_id())"

# Membership-table read pattern: a user can always see their own memberships
# (needed by /me before any org context exists), and admins of an org can see
# all members of that org. Writes still go through the org-only `_STD` rule —
# users cannot self-add or self-promote.
_MEMBERSHIP_READ = "(user_id = current_user_id() OR organization_id = current_org_id())"

# Private-to-user pattern: a row is visible/editable ONLY to the user who owns
# it — not to other members or org admins (unlike the org-isolation `_STD`).
# Used for personal data like a user's own Guide preferences. Writes additionally
# require the current org context so a row can't be planted in another org.
_OWN_USER_ROW = "(user_id = current_user_id())"
_OWN_USER_ROW_WRITE = "(user_id = current_user_id() AND organization_id = current_org_id())"

# Read pattern for org-scoped lookup tables joined by /me at bootstrap
# (organizations, roles). A member can SELECT rows in any org they belong to,
# even before current_org_id is set. Layered as a FOR SELECT policy *on top
# of* the existing FOR ALL `_STD` policy — UPDATE/DELETE still require org
# context (so a member can't delete the org they're in), and INSERT still
# requires WITH CHECK = `_STD`.
_VISIBLE_TO_MEMBER = """(
    current_user_id() IS NOT NULL
    AND organization_id IN (
        SELECT m.organization_id
        FROM public.organization_memberships m
        WHERE m.user_id = current_user_id()
    )
)"""

# ── Department-aware isolation pattern ───────────────────────────────────────
# Org isolation + department scoping with graceful degradation.
# current_dept_ids() IS NULL fallback: if dept context not set, all rows visible.

_DEPT = """(
    department_id IS NULL
    OR department_id = ANY(current_dept_ids())
    OR current_dept_bypass()
    OR current_dept_ids() IS NULL
)"""

_STD_DEPT = f"(organization_id = current_org_id() AND {_DEPT})"


def _obj_dept_subquery(table: str, fk_col: str = "object_id") -> str:
    """Subquery pattern for child tables inheriting dept through object."""
    return f"""(organization_id = current_org_id() AND (
        EXISTS (
            SELECT 1 FROM collections.collection_objects co
            WHERE co.object_id = {table}.{fk_col}
              AND (co.department_id IS NULL
                   OR co.department_id = ANY(current_dept_ids())
                   OR current_dept_bypass()
                   OR current_dept_ids() IS NULL)
        )
    ))"""


def _parent_dept_subquery(child_table: str, parent_fqn: str, alias: str, join_col: str) -> str:
    """Subquery pattern for child tables inheriting dept through a parent with department_id."""
    return f"""(organization_id = current_org_id() AND (
        EXISTS (
            SELECT 1 FROM {parent_fqn} {alias}
            WHERE {alias}.{join_col} = {child_table}.{join_col}
              AND ({alias}.department_id IS NULL
                   OR {alias}.department_id = ANY(current_dept_ids())
                   OR current_dept_bypass()
                   OR current_dept_ids() IS NULL)
        )
    ))"""

# ── Policies ─────────────────────────────────────────────────────────────────
# Format: (schema, table, policy_name, cmd, using_expr, with_check_expr_or_None)

RLS_POLICIES = [
    # ── collections schema ──
    ("collections", "acquisitions", "acquisitions_org_dept_isolation", "ALL", _STD_DEPT, _STD_DEPT),
    ("collections", "audit_campaigns", "audit_campaigns_org_isolation", "ALL", _STD, _STD),
    ("collections", "audit_results", "audit_results_org_isolation", "ALL", _STD, _STD),
    ("collections", "citations", "citations_org_isolation", "ALL", _STD, _STD),
    ("collections", "collection_objects", "collection_objects_org_dept_isolation", "ALL", _STD_DEPT, _STD_DEPT),
    ("collections", "collections_reviews", "collections_reviews_org_isolation", "ALL", _STD, _STD),
    ("collections", "condition_reports", "condition_reports_org_dept_isolation", "ALL", _STD_DEPT, _STD_DEPT),
    ("collections", "conservation_treatments", "conservation_treatments_org_dept_isolation", "ALL", _STD_DEPT, _STD_DEPT),
    ("collections", "constituents", "constituents_org_isolation", "ALL", _STD, _STD),
    ("collections", "constituent_relations", "constituent_relations_org_isolation", "ALL", _STD, _STD),
    # constituent_xrefs: org-isolation, plus dept-aware subquery for collection_object entity_type
    ("collections", "constituent_xrefs", "constituent_xrefs_org_isolation", "ALL",
     f"""(organization_id = current_org_id() AND (
        entity_type != 'collection_object'
        OR EXISTS (
            SELECT 1 FROM collections.collection_objects co
            WHERE co.object_id = constituent_xrefs.entity_id
              AND (co.department_id IS NULL
                   OR co.department_id = ANY(current_dept_ids())
                   OR current_dept_bypass()
                   OR current_dept_ids() IS NULL)
        )
    ))""",
     None),
    ("collections", "crates", "crates_org_isolation", "ALL", _STD, _STD),
    ("collections", "department_memberships", "department_memberships_org_isolation", "ALL", _STD, _STD),
    ("collections", "departments", "departments_org_isolation", "ALL", _STD, _STD),
    ("collections", "deaccession_audit", "deaccession_audit_org_dept_isolation", "ALL",
     _parent_dept_subquery("deaccession_audit", "collections.deaccessions", "d", "deaccession_id"),
     None),
    ("collections", "deaccessions", "deaccessions_org_dept_isolation", "ALL", _STD_DEPT, _STD_DEPT),
    ("collections", "documentation_plans", "documentation_plans_org_isolation", "ALL", _STD, _STD),
    ("collections", "emergency_plans", "emergency_plans_org_isolation", "ALL", _STD, _STD),
    ("collections", "event_object_links", "event_object_links_org_isolation", "ALL", _STD, None),
    # event_participants policy removed - migrated to constituent_xrefs
    ("collections", "events", "events_org_isolation", "ALL", _STD, None),

    # exhibition_content_blocks: subquery through exhibitions
    ("collections", "exhibition_content_blocks", "content_blocks_org_isolation", "ALL",
     "(EXISTS (SELECT 1 FROM collections.exhibitions e WHERE e.exhibition_id = exhibition_content_blocks.exhibition_id AND e.organization_id = current_org_id()))",
     None),

    # exhibition_floor_plans: subquery through exhibitions
    ("collections", "exhibition_floor_plans", "exhibition_floor_plans_org_isolation", "ALL",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))"),

    # exhibition_objects: direct app.current_org_id setting
    ("collections", "exhibition_objects", "exhibition_objects_org_isolation", "ALL",
     "(organization_id = (current_setting('app.current_org_id', true))::uuid)",
     None),

    # exhibition_status_history: subquery through exhibitions
    ("collections", "exhibition_status_history", "exhibition_status_history_org_isolation", "ALL",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))"),

    ("collections", "exhibitions", "exhibitions_org_dept_isolation", "ALL", _STD_DEPT, _STD_DEPT),

    # frame_styles: direct app.current_org_id setting
    ("collections", "frame_styles", "frame_styles_org_isolation", "ALL",
     "(organization_id = (current_setting('app.current_org_id', true))::uuid)",
     None),

    ("collections", "incident_report_objects", "incident_report_objects_org_isolation", "ALL", _STD, _STD),
    ("collections", "incident_reports", "incident_reports_org_isolation", "ALL", _STD, _STD),

    # label_templates: direct app.current_org_id setting
    ("collections", "label_templates", "label_templates_org_isolation", "ALL",
     "(organization_id = (current_setting('app.current_org_id', true))::uuid)",
     None),

    ("collections", "loan_in_objects", "loan_in_objects_org_dept_isolation", "ALL",
     _parent_dept_subquery("loan_in_objects", "collections.loans_in", "li", "loan_in_id"),
     None),
    ("collections", "loan_out_objects", "loan_out_objects_org_dept_isolation", "ALL",
     _parent_dept_subquery("loan_out_objects", "collections.loans_out", "lo", "loan_out_id"),
     None),
    ("collections", "loans_in", "loans_in_org_dept_isolation", "ALL", _STD_DEPT, _STD_DEPT),
    ("collections", "loans_out", "loans_out_org_dept_isolation", "ALL", _STD_DEPT, _STD_DEPT),
    ("collections", "locations", "locations_org_isolation", "ALL", _STD, _STD),

    # lookup_categories: read-only public access
    ("collections", "lookup_categories", "lookup_categories_read", "SELECT", "true", None),

    # lookup_sort_overrides
    ("collections", "lookup_sort_overrides", "lookup_sort_overrides_access", "ALL", _STD, _STD),

    # lookup_values: separate read and write policies
    # Read: allow system defaults (org_id IS NULL) + own org's values
    ("collections", "lookup_values", "lookup_values_read", "SELECT",
     "((organization_id IS NULL) OR (organization_id = current_org_id()))",
     None),
    ("collections", "lookup_values", "lookup_values_write", "ALL", _STD, _STD),

    # mount_configs: direct app.current_org_id setting
    ("collections", "mount_configs", "mount_configs_org_isolation", "ALL",
     "(organization_id = (current_setting('app.current_org_id', true))::uuid)",
     None),

    ("collections", "movements", "movements_org_dept_isolation", "ALL",
     _obj_dept_subquery("movements"), _obj_dept_subquery("movements")),
    ("collections", "object_citations", "object_citations_org_dept_isolation", "ALL",
     _obj_dept_subquery("object_citations"), None),
    # object_contacts policy removed - migrated to constituent_xrefs
    ("collections", "object_entries", "object_entries_org_dept_isolation", "ALL", _STD_DEPT, _STD_DEPT),
    ("collections", "object_entry_items", "object_entry_items_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_exit_items", "object_exit_items_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_exits", "object_exits_org_dept_isolation", "ALL", _STD_DEPT, _STD_DEPT),
    ("collections", "object_parts", "object_parts_org_dept_isolation", "ALL",
     _obj_dept_subquery("object_parts"), None),
    # object_person_authorities policy removed - migrated to constituent_xrefs
    ("collections", "object_relationships", "object_relationships_org_dept_isolation", "ALL",
     _obj_dept_subquery("object_relationships", "source_object_id"), None),
    ("collections", "object_review_assessments", "object_review_assessments_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_rights", "object_rights_org_dept_isolation", "ALL",
     _obj_dept_subquery("object_rights"), None),
    # person_authorities and person_authority_relations policies removed - migrated to constituents/constituent_relations
    ("collections", "reproduction_requests", "reproduction_requests_org_isolation", "ALL", _STD, _STD),

    # Shipping: shipments have dept isolation; child tables inherit through shipment
    ("collections", "shipment_documents", "shipment_documents_org_dept_isolation", "ALL",
     _parent_dept_subquery("shipment_documents", "collections.shipments", "s", "shipment_id"),
     None),
    ("collections", "shipment_items", "shipment_items_org_dept_isolation", "ALL",
     _parent_dept_subquery("shipment_items", "collections.shipments", "s", "shipment_id"),
     None),
    ("collections", "shipment_legs", "shipment_legs_org_dept_isolation", "ALL",
     _parent_dept_subquery("shipment_legs", "collections.shipments", "s", "shipment_id"),
     None),
    ("collections", "shipment_references", "shipment_references_org_dept_isolation", "ALL",
     _parent_dept_subquery("shipment_references", "collections.shipments", "s", "shipment_id"),
     None),
    ("collections", "shipment_status_history", "shipment_status_history_org_dept_isolation", "ALL",
     _parent_dept_subquery("shipment_status_history", "collections.shipments", "s", "shipment_id"),
     None),
    ("collections", "shipments", "shipments_org_dept_isolation", "ALL", _STD_DEPT, _STD_DEPT),

    ("collections", "use_request_objects", "use_request_objects_org_isolation", "ALL", _STD, _STD),
    ("collections", "use_requests", "use_requests_org_isolation", "ALL", _STD, _STD),

    ("collections", "user_active_context", "user_active_context_org_isolation", "ALL",
     _STD, _STD),

    ("collections", "valuations", "valuations_org_dept_isolation", "ALL",
     _obj_dept_subquery("valuations"), None),

    # venues: direct app.current_org_id setting
    ("collections", "venues", "venues_org_isolation", "ALL",
     "(organization_id = (current_setting('app.current_org_id', true))::uuid)",
     None),

    ("collections", "vocabulary_mappings", "vocabulary_mappings_org_isolation", "ALL", _STD, _STD),

    # vocabulary_term_relationships: separate read and write
    ("collections", "vocabulary_term_relationships", "vocab_rel_public_read", "SELECT", "true", None),
    ("collections", "vocabulary_term_relationships", "vocab_rel_authenticated_write", "ALL", "true", None),

    # vocabulary_terms: shared terms (org_id IS NULL) + own org's terms
    ("collections", "vocabulary_terms", "vocabulary_terms_org_isolation", "ALL",
     "((organization_id IS NULL) OR (organization_id = current_org_id()))",
     "((organization_id IS NULL) OR (organization_id = current_org_id()))"),

    # workspace_items: org isolation via parent workspace
    ("collections", "workspace_items", "workspace_items_org_isolation", "ALL",
     "(workspace_id IN (SELECT workspace_id FROM collections.workspaces WHERE organization_id = current_org_id()))",
     "(workspace_id IN (SELECT workspace_id FROM collections.workspaces WHERE organization_id = current_org_id()))"),

    ("collections", "workspace_shares", "workspace_shares_org_isolation", "ALL",
     _STD, _STD),

    ("collections", "workspaces", "workspace_org_isolation", "ALL",
     _STD, _STD),

    # ── content schema ──
    ("content", "pages", "pages_org_isolation", "ALL", _STD, _STD),
    ("content", "content_blocks", "content_blocks_org_isolation", "ALL", _STD, _STD),
    ("content", "categories", "categories_org_isolation", "ALL", _STD, _STD),
    # page_categories: no organization_id — secured via FK to pages
    ("content", "page_categories", "page_categories_via_page", "ALL",
     "(EXISTS (SELECT 1 FROM content.pages p WHERE p.page_id = page_categories.page_id AND p.organization_id = current_org_id()))",
     "(EXISTS (SELECT 1 FROM content.pages p WHERE p.page_id = page_categories.page_id AND p.organization_id = current_org_id()))"),
    ("content", "menus", "menus_org_isolation", "ALL", _STD, _STD),
    ("content", "menu_items", "menu_items_org_isolation", "ALL", _STD, _STD),

    # ── flow schema ──
    ("flow", "change_events", "change_events_org_isolation", "ALL", _STD, _STD),
    ("flow", "connector_instances", "connector_instances_org_isolation", "ALL", _STD, _STD),
    ("flow", "dataset_transformers", "dataset_transformers_org_isolation", "ALL", _STD, _STD),
    ("flow", "datasets", "datasets_org_isolation", "ALL", _STD, _STD),
    ("flow", "entity_current", "entity_current_org_isolation", "ALL", _STD, _STD),
    ("flow", "entity_fields", "entity_fields_org_isolation", "ALL", _STD, _STD),
    ("flow", "entity_relationships", "entity_relationships_org_isolation", "ALL", _STD, _STD),
    ("flow", "field_diffs", "field_diffs_org_isolation", "ALL", _STD, _STD),
    ("flow", "jobs", "jobs_org_isolation", "ALL", _STD, _STD),
    ("flow", "org_scoped_docs", "org_scoped_docs_org_isolation", "ALL", _STD, _STD),

    # pipeline_destinations: subquery through pipelines (has duplicate policies - use canonical one)
    ("flow", "pipeline_destinations", "pipeline_destinations_org_isolation", "ALL",
     "(EXISTS (SELECT 1 FROM flow.pipelines WHERE pipelines.pipeline_id = pipeline_destinations.pipeline_id AND pipelines.organization_id = current_org_id()))",
     "(EXISTS (SELECT 1 FROM flow.pipelines WHERE pipelines.pipeline_id = pipeline_destinations.pipeline_id AND pipelines.organization_id = current_org_id()))"),

    # pipeline_sources: subquery through pipelines
    ("flow", "pipeline_sources", "pipeline_sources_org_isolation", "ALL",
     "(EXISTS (SELECT 1 FROM flow.pipelines WHERE pipelines.pipeline_id = pipeline_sources.pipeline_id AND pipelines.organization_id = current_org_id()))",
     "(EXISTS (SELECT 1 FROM flow.pipelines WHERE pipelines.pipeline_id = pipeline_sources.pipeline_id AND pipelines.organization_id = current_org_id()))"),

    ("flow", "pipelines", "pipelines_org_isolation", "ALL", _STD, _STD),
    ("flow", "relationship_definitions", "relationship_definitions_org_isolation", "ALL", _STD, _STD),

    # run_destination_steps: subquery through runs
    ("flow", "run_destination_steps", "run_destination_steps_org_isolation", "ALL",
     "(EXISTS (SELECT 1 FROM flow.runs WHERE runs.run_id = run_destination_steps.run_id AND runs.organization_id = current_org_id()))",
     "(EXISTS (SELECT 1 FROM flow.runs WHERE runs.run_id = run_destination_steps.run_id AND runs.organization_id = current_org_id()))"),

    # run_source_steps: subquery through runs
    ("flow", "run_source_steps", "run_source_steps_org_isolation", "ALL",
     "(EXISTS (SELECT 1 FROM flow.runs WHERE runs.run_id = run_source_steps.run_id AND runs.organization_id = current_org_id()))",
     "(EXISTS (SELECT 1 FROM flow.runs WHERE runs.run_id = run_source_steps.run_id AND runs.organization_id = current_org_id()))"),

    ("flow", "runs", "runs_org_isolation", "ALL", _STD, _STD),
    ("flow", "schedules", "schedules_org_isolation", "ALL", _STD, _STD),

    # ── media schema ──
    ("media", "media", "media_org_isolation", "ALL", _STD, None),

    # media_collection_items: subquery through media_collections
    ("media", "media_collection_items", "media_collection_items_org_isolation", "ALL",
     "(collection_id IN (SELECT collection_id FROM media.media_collections WHERE organization_id = current_org_id()))",
     None),

    # media_collection_shares: subquery through media_collections
    ("media", "media_collection_shares", "media_collection_shares_org_isolation", "ALL",
     "(collection_id IN (SELECT collection_id FROM media.media_collections WHERE organization_id = current_org_id()))",
     None),

    ("media", "media_collections", "media_collections_org_isolation", "ALL", _STD, None),

    # media_consent: subquery through media
    ("media", "media_consent", "media_consent_org_isolation", "ALL",
     "(media_id IN (SELECT media_id FROM media.media WHERE organization_id = current_org_id()))",
     None),

    # media_derivatives: subquery through media
    ("media", "media_derivatives", "media_derivatives_org_isolation", "ALL",
     "(media_id IN (SELECT media_id FROM media.media WHERE organization_id = current_org_id()))",
     None),

    # media_download_request_items: subquery through media_download_requests
    ("media", "media_download_request_items", "media_download_request_items_org_isolation", "ALL",
     "(request_id IN (SELECT request_id FROM media.media_download_requests WHERE organization_id = current_org_id()))",
     None),

    ("media", "media_download_requests", "media_download_requests_org_isolation", "ALL", _STD, None),
    ("media", "media_field_inheritance_config", "media_field_inheritance_config_org_isolation", "ALL", _STD, None),
    ("media", "media_folders", "media_folders_org_isolation", "ALL", _STD, None),

    # media_processing_jobs: subquery through media
    ("media", "media_processing_jobs", "media_processing_jobs_org_isolation", "ALL",
     "(media_id IN (SELECT media_id FROM media.media WHERE organization_id = current_org_id()))",
     None),

    # media_rights: subquery through media
    ("media", "media_rights", "media_rights_org_isolation", "ALL",
     "(media_id IN (SELECT media_id FROM media.media WHERE organization_id = current_org_id()))",
     None),

    ("media", "media_tag_definitions", "media_tag_definitions_org_isolation", "ALL", _STD, None),

    # media_tags: subquery through media
    ("media", "media_tags", "media_tags_org_isolation", "ALL",
     "(media_id IN (SELECT media_id FROM media.media WHERE organization_id = current_org_id()))",
     None),

    # media_usage_events: subquery through media
    ("media", "media_usage_events", "media_usage_events_org_isolation", "ALL",
     "(media_id IN (SELECT media_id FROM media.media WHERE organization_id = current_org_id()))",
     None),

    # media_versions: subquery through media
    ("media", "media_versions", "media_versions_org_isolation", "ALL",
     "(media_id IN (SELECT media_id FROM media.media WHERE organization_id = current_org_id()))",
     None),

    ("media", "watermark_templates", "watermark_templates_org_isolation", "ALL", _STD, None),
    ("media", "workspace_action_runs", "media_action_runs_org_isolation", "ALL", _STD, None),

    # media workspace_items: subquery through collections.workspaces
    ("media", "workspace_items", "media_workspace_items_org_isolation", "ALL",
     "(workspace_id IN (SELECT workspace_id FROM collections.workspaces WHERE organization_id = current_org_id()))",
     None),

    ("media", "workspace_shares", "media_workspace_shares_org_isolation", "ALL", _STD, None),

    # ── public schema ──
    ("public", "api_keys", "api_keys_org_isolation", "ALL", _STD, _STD),
    ("public", "approval_requests", "approval_requests_org_isolation", "ALL", _STD, _STD),
    ("public", "approval_rules", "approval_rules_org_isolation", "ALL", _STD, _STD),
    ("public", "audit_logs", "audit_logs_org_isolation", "ALL", _STD, _STD),
    ("public", "org_role_labels", "org_role_labels_org_isolation", "ALL", _STD, _STD),
    ("public", "organization_invitations", "organization_invitations_org_isolation", "ALL", _STD, _STD),
    ("public", "organization_memberships", "organization_memberships_org_isolation", "ALL", _MEMBERSHIP_READ, _STD),
    ("public", "notifications", "notifications_org_isolation", "ALL", _STD, _STD),
    ("public", "record_comments", "record_comments_org_isolation", "ALL", _STD, None),
    ("public", "record_watches", "record_watches_org_isolation", "ALL", _STD, None),
    ("public", "tasks", "tasks_org_isolation", "ALL", _STD, _STD),
    ("public", "user_overview_prefs", "user_overview_prefs_org_isolation", "ALL", _STD, _STD),
    # Private to the owning user — not visible to other members or org admins.
    ("public", "guide_user_prefs", "guide_user_prefs_user_isolation", "ALL", _OWN_USER_ROW, _OWN_USER_ROW_WRITE),
    ("public", "user_layout_overrides", "user_layout_overrides_user_isolation", "ALL", _OWN_USER_ROW, _OWN_USER_ROW_WRITE),

    # ── reporting schema ──

    # ── reports schema ──
    ("reports", "report_runs", "report_runs_org_isolation", "ALL", _STD, _STD),
    ("reports", "report_schedules", "report_schedules_org_isolation", "ALL", _STD, _STD),
    ("reports", "reports", "reports_org_isolation", "ALL", _STD, _STD),
    # collections schema (added 2026-04-23)
    ("collections", "acquisition_objects", "acquisition_objects_org_isolation", "ALL", _STD, _STD),
    ("collections", "barcode_labels", "barcode_labels_org_isolation", "ALL", _STD, _STD),
    ("collections", "barcode_scans", "barcode_scans_org_isolation", "ALL", _STD, _STD),
    ("collections", "cataloging_history", "cataloging_history_org_isolation", "ALL", _STD, _STD),
    ("collections", "compliance_actions", "compliance_actions_org_isolation", "ALL", _STD, _STD),
    ("collections", "compliance_issue_items", "compliance_issue_items_org_isolation", "ALL", _STD, _STD),
    ("collections", "critical_responses", "critical_responses_org_isolation", "ALL", _STD, _STD),
    ("collections", "deaccession_votes", "deaccession_votes_org_isolation", "ALL", _STD, _STD),
    ("collections", "discover_configs", "discover_configs_org_isolation", "ALL", _STD, _STD),
    ("collections", "emergency_assembly_points", "emergency_assembly_points_org_isolation", "ALL", _STD, _STD),
    ("collections", "emergency_equipment", "emergency_equipment_org_isolation", "ALL", _STD, _STD),
    ("collections", "emergency_evacuation_routes", "emergency_evacuation_routes_org_isolation", "ALL", _STD, _STD),
    ("collections", "emergency_external_services", "emergency_external_services_org_isolation", "ALL", _STD, _STD),
    ("collections", "emergency_plan_contacts", "emergency_plan_contacts_org_isolation", "ALL", _STD, _STD),
    ("collections", "emergency_risk_assessments", "emergency_risk_assessments_org_isolation", "ALL", _STD, _STD),
    ("collections", "entity_images", "entity_images_org_isolation", "ALL", _STD, _STD),
    ("collections", "exhibition_loans", "exhibition_loans_org_isolation", "ALL", _STD, _STD),
    ("collections", "expiration_alerts", "expiration_alerts_org_isolation", "ALL", _STD, _STD),
    ("collections", "indemnity_arrangements", "indemnity_arrangements_org_isolation", "ALL", _STD, _STD),
    ("collections", "insurance_claims", "insurance_claims_org_isolation", "ALL", _STD, _STD),
    ("collections", "insurance_coverages", "insurance_coverages_org_isolation", "ALL", _STD, _STD),
    ("collections", "insurance_policies", "insurance_policies_org_isolation", "ALL", _STD, _STD),
    ("collections", "loan_in_entries", "loan_in_entries_org_isolation", "ALL", _STD, _STD),
    ("collections", "loan_monitoring_events", "loan_monitoring_events_org_isolation", "ALL", _STD, _STD),
    ("collections", "loan_renewals", "loan_renewals_org_isolation", "ALL", _STD, _STD),
    ("collections", "nagpra_actions", "nagpra_actions_org_isolation", "ALL", _STD, _STD),
    ("collections", "nagpra_consultation_events", "nagpra_consultation_events_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_classifications", "object_classifications_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_contexts", "object_contexts_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_inscriptions", "object_inscriptions_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_materials", "object_materials_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_measurements", "object_measurements_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_other_numbers", "object_other_numbers_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_place_authorities", "object_place_authorities_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_style_periods", "object_style_periods_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_subjects", "object_subjects_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_techniques", "object_techniques_org_isolation", "ALL", _STD, _STD),
    ("collections", "object_titles", "object_titles_org_isolation", "ALL", _STD, _STD),
    ("collections", "other_number_types", "other_number_types_org_isolation", "ALL", _STD, _STD),
    ("collections", "place_authorities", "place_authorities_org_isolation", "ALL", _STD, _STD),
    ("collections", "publish_schedules", "publish_schedules_org_isolation", "ALL", _STD, _STD),
    ("collections", "sequence_counters", "sequence_counters_org_isolation", "ALL", _STD, _STD),
    ("collections", "signed_documents", "signed_documents_org_isolation", "ALL", _STD, _STD),
    ("collections", "style_period_authorities", "style_period_authorities_org_isolation", "ALL", _STD, _STD),
    ("collections", "subject_authorities", "subject_authorities_org_isolation", "ALL", _STD, _STD),
    ("collections", "treatment_costs", "treatment_costs_org_isolation", "ALL", _STD, _STD),
    ("collections", "treatment_materials", "treatment_materials_org_isolation", "ALL", _STD, _STD),
    ("collections", "treatment_techniques", "treatment_techniques_org_isolation", "ALL", _STD, _STD),
    ("collections", "variant_terms", "variant_terms_org_isolation", "ALL", _STD, _STD),
    # content schema (added 2026-04-23)
    ("content", "redirects", "redirects_org_isolation", "ALL", _STD, _STD),
    # media schema (added 2026-04-23)
    ("media", "collection_feedback_requests", "collection_feedback_requests_org_isolation", "ALL", _STD, _STD),
    # Child of collection_feedback_requests with no organization_id of its own —
    # isolate via the parent request's org (the _STD column doesn't exist here).
    ("media", "collection_feedback_responses", "collection_feedback_responses_org_isolation", "ALL",
     "(request_id IN (SELECT request_id FROM media.collection_feedback_requests WHERE organization_id = current_org_id()))",
     "(request_id IN (SELECT request_id FROM media.collection_feedback_requests WHERE organization_id = current_org_id()))"),
    ("media", "derivative_size_configs", "derivative_size_configs_org_isolation", "ALL", _STD, _STD),
    ("media", "information_packages", "information_packages_org_isolation", "ALL", _STD, _STD),
    ("media", "media_ai_config", "media_ai_config_org_isolation", "ALL", _STD, _STD),
    ("media", "media_ai_tag_mappings", "media_ai_tag_mappings_org_isolation", "ALL", _STD, _STD),
    ("media", "media_ai_tags", "media_ai_tags_org_isolation", "ALL", _STD, _STD),
    ("media", "media_alternatives", "media_alternatives_org_isolation", "ALL", _STD, _STD),
    ("media", "media_annotations", "media_annotations_org_isolation", "ALL", _STD, _STD),
    ("media", "media_embeddings", "media_embeddings_org_isolation", "ALL", _STD, _STD),
    ("media", "media_locks", "media_locks_org_isolation", "ALL", _STD, _STD),
    ("media", "media_search_subscriptions", "media_search_subscriptions_org_isolation", "ALL", _STD, _STD),
    ("media", "metadata_templates", "metadata_templates_org_isolation", "ALL", _STD, _STD),
    ("media", "preservation_action_plans", "preservation_action_plans_org_isolation", "ALL", _STD, _STD),
    ("media", "preservation_events", "preservation_events_org_isolation", "ALL", _STD, _STD),
    ("media", "preservation_policies", "preservation_policies_org_isolation", "ALL", _STD, _STD),
    ("media", "replication_records", "replication_records_org_isolation", "ALL", _STD, _STD),
    # public schema (added 2026-04-23)
    ("public", "agent_plans", "agent_plans_org_isolation", "ALL", _STD, _STD),
    ("public", "agent_drafts", "agent_drafts_org_isolation", "ALL", _STD, _STD),
    ("public", "agent_plan_step_metrics",
     "agent_plan_step_metrics_org_isolation", "ALL", _STD, _STD),  # §2A
    ("public", "app_role_assignments", "app_role_assignments_org_isolation", "ALL", _STD, _STD),
    ("public", "checklist_templates", "checklist_templates_org_isolation", "ALL", _STD, _STD),
    ("public", "conversations", "conversations_org_isolation", "ALL", _STD, _STD),
    ("public", "document_templates", "document_templates_org_isolation", "ALL", _STD, _STD),
    ("public", "entity_audit_events", "entity_audit_events_org_isolation", "ALL", _STD, _STD),
    ("public", "entity_audit_field_diffs", "entity_audit_field_diffs_org_isolation", "ALL", _STD, _STD),
    ("public", "entity_merge_log", "entity_merge_log_org_isolation", "ALL", _STD, _STD),
    ("public", "guide_documents", "guide_documents_org_isolation", "ALL", _STD, _STD),
    ("public", "guide_metrics", "guide_metrics_org_isolation", "ALL", _STD, _STD),
    ("public", "guide_system_prompts", "guide_system_prompts_org_isolation", "ALL", _STD, _STD),
    ("public", "info_request_templates", "info_request_templates_org_isolation", "ALL", _STD, _STD),
    ("public", "messages", "messages_org_isolation", "ALL", _STD, _STD),
    # org_provisioning_jobs intentionally absent — see RLS_TABLES comment.
    ("public", "organization_applications", "organization_applications_org_isolation", "ALL", _STD, _STD),
    ("public", "organization_branding", "organization_branding_org_isolation", "ALL", _STD, _STD),
    ("public", "organization_collection_profiles", "organization_collection_profiles_org_isolation", "ALL", _STD, _STD),
    ("public", "organization_storage_configs", "organization_storage_configs_org_isolation", "ALL", _STD, _STD),
    ("public", "organizations", "organizations_org_isolation", "ALL", _STD, _STD),
    # Permissive SELECT-only overlay so /me can resolve the user's orgs before
    # current_org_id is set. Writes still gated by the FOR ALL policy above.
    ("public", "organizations", "organizations_self_orgs_visible", "SELECT", _VISIBLE_TO_MEMBER, None),
    # provisioning_audit_logs intentionally absent — see RLS_TABLES comment.
    ("public", "reference_chunks", "reference_chunks_org_isolation", "ALL", _STD, _STD),
    # The global reference corpus (organization_id IS NULL) is shared across ALL
    # tenants. The FOR ALL _STD policy above hides it (NULL != current_org_id),
    # so lookup_reference returned zero professional-standards content. This
    # permissive SELECT overlay exposes the org's own docs PLUS the global
    # corpus for reads; INSERT/UPDATE/DELETE stay org-scoped via the FOR ALL
    # policy, so tenants can read but never mutate the shared corpus (only the
    # BYPASSRLS ingest/seed writes global rows).
    ("public", "reference_chunks", "reference_chunks_global_read", "SELECT",
     "(organization_id IS NULL OR organization_id = current_org_id())", None),
    ("public", "role_field_access", "role_field_access_org_isolation", "ALL", _STD, _STD),
    ("public", "roles", "roles_org_isolation", "ALL", _STD, _STD),
    # Permissive SELECT-only overlay so /me can JOIN to the user's role rows
    # before current_org_id is set. Writes still gated by the FOR ALL policy.
    ("public", "roles", "roles_self_orgs_visible", "SELECT", _VISIBLE_TO_MEMBER, None),
    # System roles (admin, member, platform_admin, etc.) live with
    # organization_id IS NULL. The strict org-only `_STD` policy is
    # unsatisfiable for those rows under any context — without this overlay
    # no authenticated query can see system roles, breaking /me's role JOIN
    # and any RBAC lookup that resolves a system role by id.
    ("public", "roles", "roles_system_visible", "SELECT",
     "(current_user_id() IS NOT NULL AND (is_system = true OR organization_id IS NULL))", None),
    ("public", "sla_events", "sla_events_org_isolation", "ALL", _STD, _STD),
    ("public", "sla_policies", "sla_policies_org_isolation", "ALL", _STD, _STD),
    ("public", "sso_configurations", "sso_configurations_org_isolation", "ALL", _STD, _STD),
    ("public", "uri_registry", "uri_registry_org_isolation", "ALL", _STD, _STD),
    ("public", "visit_interactions", "visit_interactions_org_isolation", "ALL", _STD, _STD),
    ("public", "visitors", "visitors_org_isolation", "ALL", _STD, _STD),
    ("public", "visits", "visits_org_isolation", "ALL", _STD, _STD),
    # reports schema (added 2026-04-23)
    ("reports", "report_schedule_recipients", "report_schedule_recipients_org_isolation", "ALL", _STD, _STD),

    # ── Org-scoped CHILD tables (no organization_id of their own) ────────────
    #
    # These inherit tenancy through a NOT NULL foreign key to an org-scoped
    # parent. They were invisible to tests/postgres/test_rls_coverage.py, which
    # only looked at tables that HAVE an organization_id column, so they carried
    # no policy at all and the app layer was the only control — applied
    # inconsistently: in several routers the create handler validated the
    # parent's org and the delete/update handlers in the same file did not.
    #
    # Four of them (exhibition_venues, exports, floor_plans, placements) were
    # listed in RLS_TABLES with force=True but had no policy, which is
    # deny-all: those features returned empty rather than leaking. The policies
    # below both close the gaps and un-break those four.
    #
    # Same shape as page_categories and media_tags above. Every FK here is NOT
    # NULL, so there is no row a policy could miss.
    ("collections", "collection_object_media", "collection_object_media_via_parent", "ALL",
     "(object_id IN (SELECT object_id FROM collections.collection_objects WHERE organization_id = current_org_id()))",
     "(object_id IN (SELECT object_id FROM collections.collection_objects WHERE organization_id = current_org_id()))"),
    ("collections", "constituent_media", "constituent_media_via_parent", "ALL",
     "(constituent_id IN (SELECT constituent_id FROM collections.constituents WHERE organization_id = current_org_id()))",
     "(constituent_id IN (SELECT constituent_id FROM collections.constituents WHERE organization_id = current_org_id()))"),
    ("collections", "exhibition_budget_lines", "exhibition_budget_lines_via_parent", "ALL",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))"),
    ("collections", "exhibition_labels", "exhibition_labels_via_parent", "ALL",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))"),
    ("collections", "exhibition_loan_objects", "exhibition_loan_objects_via_parent", "ALL",
     "(link_id IN (SELECT link_id FROM collections.exhibition_loans WHERE organization_id = current_org_id()))",
     "(link_id IN (SELECT link_id FROM collections.exhibition_loans WHERE organization_id = current_org_id()))"),
    ("collections", "exhibition_venues", "exhibition_venues_via_parent", "ALL",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))"),
    ("collections", "exports", "exports_via_parent", "ALL",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))"),
    ("collections", "floor_plans", "floor_plans_via_parent", "ALL",
     "(venue_id IN (SELECT venue_id FROM collections.venues WHERE organization_id = current_org_id()))",
     "(venue_id IN (SELECT venue_id FROM collections.venues WHERE organization_id = current_org_id()))"),
    ("collections", "indemnity_objects", "indemnity_objects_via_parent", "ALL",
     "(indemnity_id IN (SELECT indemnity_id FROM collections.indemnity_arrangements WHERE organization_id = current_org_id()))",
     "(indemnity_id IN (SELECT indemnity_id FROM collections.indemnity_arrangements WHERE organization_id = current_org_id()))"),
    ("collections", "object_entry_item_media", "object_entry_item_media_via_parent", "ALL",
     "(entry_item_id IN (SELECT entry_item_id FROM collections.object_entry_items WHERE organization_id = current_org_id()))",
     "(entry_item_id IN (SELECT entry_item_id FROM collections.object_entry_items WHERE organization_id = current_org_id()))"),
    ("collections", "placements", "placements_via_parent", "ALL",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))",
     "(exhibition_id IN (SELECT exhibition_id FROM collections.exhibitions WHERE organization_id = current_org_id()))"),
    ("media", "media_collection_share_access", "media_collection_share_access_via_parent", "ALL",
     "(collection_id IN (SELECT collection_id FROM media.media_collections WHERE organization_id = current_org_id()))",
     "(collection_id IN (SELECT collection_id FROM media.media_collections WHERE organization_id = current_org_id()))"),
    ("media", "media_tag_values", "media_tag_values_via_parent", "ALL",
     "(definition_id IN (SELECT definition_id FROM media.media_tag_definitions WHERE organization_id = current_org_id()))",
     "(definition_id IN (SELECT definition_id FROM media.media_tag_definitions WHERE organization_id = current_org_id()))"),
    ("public", "agent_plan_steps", "agent_plan_steps_via_parent", "ALL",
     "(plan_id IN (SELECT plan_id FROM public.agent_plans WHERE organization_id = current_org_id()))",
     "(plan_id IN (SELECT plan_id FROM public.agent_plans WHERE organization_id = current_org_id()))"),
    ("public", "checklist_template_versions", "checklist_template_versions_via_parent", "ALL",
     "(template_id IN (SELECT template_id FROM public.checklist_templates WHERE organization_id = current_org_id()))",
     "(template_id IN (SELECT template_id FROM public.checklist_templates WHERE organization_id = current_org_id()))"),
    ("public", "info_request_template_items", "info_request_template_items_via_parent", "ALL",
     "(template_id IN (SELECT template_id FROM public.info_request_templates WHERE organization_id = current_org_id()))",
     "(template_id IN (SELECT template_id FROM public.info_request_templates WHERE organization_id = current_org_id()))"),
]

# ── Duplicate/legacy policies to also create ─────────────────────────────────
# Some tables have duplicate policies from migrations (renamed tables).
# We create these too for compatibility.

LEGACY_POLICIES = [
    ("flow", "pipeline_destinations", "route_destinations_org_isolation", "ALL",
     "(EXISTS (SELECT 1 FROM flow.pipelines WHERE pipelines.pipeline_id = pipeline_destinations.pipeline_id AND pipelines.organization_id = current_org_id()))",
     "(EXISTS (SELECT 1 FROM flow.pipelines WHERE pipelines.pipeline_id = pipeline_destinations.pipeline_id AND pipelines.organization_id = current_org_id()))"),

    ("flow", "pipeline_sources", "route_sources_org_isolation", "ALL",
     "(EXISTS (SELECT 1 FROM flow.pipelines WHERE pipelines.pipeline_id = pipeline_sources.pipeline_id AND pipelines.organization_id = current_org_id()))",
     "(EXISTS (SELECT 1 FROM flow.pipelines WHERE pipelines.pipeline_id = pipeline_sources.pipeline_id AND pipelines.organization_id = current_org_id()))"),

    ("flow", "pipelines", "integration_routes_org_isolation", "ALL", _STD, _STD),
]

# ── Deprecated policy names replaced by department-aware versions ─────────────
# Dropped during seed to avoid duplicate PERMISSIVE policies co-existing.

DEPRECATED_POLICIES = [
    ("collections", "acquisitions", "acquisitions_org_isolation"),
    ("collections", "collection_objects", "collection_objects_org_isolation"),
    ("collections", "condition_reports", "condition_reports_org_isolation"),
    ("collections", "conservation_treatments", "conservation_treatments_org_isolation"),
    ("collections", "deaccession_audit", "deaccession_audit_org_isolation"),
    ("collections", "deaccessions", "deaccessions_org_isolation"),
    ("collections", "exhibitions", "exhibitions_org_isolation"),
    ("collections", "loan_in_objects", "loan_in_objects_org_isolation"),
    ("collections", "loan_out_objects", "loan_out_objects_org_isolation"),
    ("collections", "loans_in", "loans_in_org_isolation"),
    ("collections", "loans_out", "loans_out_org_isolation"),
    ("collections", "movements", "movements_org_isolation"),
    ("collections", "object_citations", "object_citations_org_isolation"),
    ("collections", "object_contacts", "object_contacts_org_isolation"),
    ("collections", "object_entries", "object_entries_org_isolation"),
    ("collections", "object_exits", "object_exits_org_isolation"),
    ("collections", "object_parts", "object_parts_org_isolation"),
    ("collections", "object_person_authorities", "object_person_authorities_org_isolation"),
    ("collections", "object_relationships", "object_relationships_org_isolation"),
    ("collections", "object_rights", "object_rights_org_isolation"),
    ("collections", "valuations", "valuations_org_isolation"),
    # media schema — orphaned legacy "rls_*" policies from the 2026-02-20 DAM
    # migration (add_dam_ai_features). They used raw
    # current_setting('app.current_organization_id') and were never renamed to
    # current_org_id(); once org context stopped setting that legacy GUC they
    # 500 on evaluation. Drop them — the correct *_org_isolation policies replace them.
    ("media", "media_locks", "rls_media_locks_org_isolation"),
    ("media", "media_annotations", "rls_media_annotations_org_isolation"),
    ("media", "media_embeddings", "rls_media_embeddings_org_isolation"),
    ("media", "media_alternatives", "rls_media_alternatives_org_isolation"),
    ("media", "derivative_size_configs", "rls_derivative_size_configs_org_isolation"),
    ("media", "media_search_subscriptions", "rls_media_search_subscriptions_org_isolation"),
    ("media", "collection_feedback_requests", "rls_collection_feedback_requests_org_isolation"),
    ("media", "collection_feedback_responses", "rls_collection_feedback_responses_org_isolation"),
]


def seed_rls_policies():
    """Create RLS functions and all RLS policies."""
    settings = Settings()
    engine = create_engine(settings.database_url.unicode_string())

    with Session(engine) as session:
        # 1. Create/replace PostgreSQL functions
        print("Creating RLS functions...")
        session.execute(text(CURRENT_ORG_ID_FUNCTION))
        print("  + current_org_id() created/replaced")
        session.execute(text(CURRENT_DEPT_IDS_FUNCTION))
        print("  + current_dept_ids() created/replaced")
        session.execute(text(CURRENT_DEPT_BYPASS_FUNCTION))
        print("  + current_dept_bypass() created/replaced")
        session.execute(text(CURRENT_USER_ID_FUNCTION))
        print("  + current_user_id() created/replaced")

        # 2. Enable RLS on all tables
        print("\nEnabling Row-Level Security...")
        rls_enabled = 0
        rls_forced = 0
        rls_skipped = 0
        for schema, table, force in RLS_TABLES:
            fqn = f"{schema}.{table}"
            # Pre-check existence so a missing table can't raise and roll back
            # the prior table's ALTER work.
            exists = session.execute(
                text(
                    "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = :s AND c.relname = :t"
                ),
                {"s": schema, "t": table},
            ).scalar()
            if not exists:
                rls_skipped += 1
                print(f"  - {fqn} (table not found, skipped)")
                continue
            session.execute(text(f"ALTER TABLE {fqn} ENABLE ROW LEVEL SECURITY"))
            rls_enabled += 1
            if force:
                session.execute(text(f"ALTER TABLE {fqn} FORCE ROW LEVEL SECURITY"))
                rls_forced += 1

        # Commit between phases so a later skip/rollback can't undo prior
        # ALTER TABLE work. The in-loop rollback on missing-table errors
        # otherwise wipes every ENABLE ROW LEVEL SECURITY we already did
        # in the same session.
        session.commit()
        print(f"  RLS enabled: {rls_enabled}, forced: {rls_forced}, skipped: {rls_skipped}")

        # 3. Drop deprecated policy names (replaced by dept-aware versions)
        print("\nDropping deprecated policy names...")
        deprecated_dropped = 0
        for schema, table, old_name in DEPRECATED_POLICIES:
            fqn = f"{schema}.{table}"
            exists = session.execute(
                text(
                    "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = :s AND c.relname = :t"
                ),
                {"s": schema, "t": table},
            ).scalar()
            if not exists:
                continue
            session.execute(text(f"DROP POLICY IF EXISTS {old_name} ON {fqn}"))
            deprecated_dropped += 1
        session.commit()
        print(f"  Deprecated policies cleaned up: {deprecated_dropped}")

        # 4. Create all policies
        print("\nCreating RLS policies...")
        all_policies = RLS_POLICIES + LEGACY_POLICIES
        created = 0
        skipped = 0
        for schema, table, policy_name, cmd, using_expr, with_check in all_policies:
            fqn = f"{schema}.{table}"
            # Pre-check existence so a missing table can't roll back the prior
            # policy-creation work in the same session.
            exists = session.execute(
                text(
                    "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = :s AND c.relname = :t"
                ),
                {"s": schema, "t": table},
            ).scalar()
            if not exists:
                skipped += 1
                print(f"  - {fqn}.{policy_name} (table not found, skipped)")
                continue

            # Drop existing policy (idempotent)
            session.execute(text(f"DROP POLICY IF EXISTS {policy_name} ON {fqn}"))

            # Build CREATE POLICY statement
            sql = f"CREATE POLICY {policy_name} ON {fqn}"
            if cmd != "ALL":
                sql += f" FOR {cmd}"
            sql += f" USING ({using_expr})"
            if with_check is not None:
                sql += f" WITH CHECK ({with_check})"

            session.execute(text(sql))
            created += 1

        session.commit()

        print(f"\n{'=' * 80}")
        print(f"  Functions: current_org_id(), current_dept_ids(), current_dept_bypass()")
        print(f"  RLS enabled on {rls_enabled} tables ({rls_forced} forced)")
        print(f"  Policies created: {created}")
        if skipped:
            print(f"  Policies skipped (missing tables): {skipped}")
        print(f"{'=' * 80}")


if __name__ == "__main__":
    seed_rls_policies()
