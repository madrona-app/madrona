"""
Canonical Permission Enum for Madrona.

Defines the global, fixed set of permissions that apply across all organizations
and industries. Permissions are stable and independent of UI role labels.

All authorization logic MUST reference these canonical permissions, never role names.

Permission Format: domain.action
- Domain: Logical grouping (org, connectors, pipelines, runs, data, mappings, platform)
- Action: What can be done (view, edit, execute, manage, etc.)

These permissions are the single source of truth for authorization.

FUTURE-PROOFING DESIGN:

Adding New Permissions:
1. Add new permission to this enum (append-only)
2. Add metadata to PERMISSION_METADATA dict
3. Create Alembic migration to:
   - INSERT INTO permissions table
   - INSERT INTO role_permissions (assign to appropriate roles)
4. Protect new API routes with @require_permission(Permission.NEW_PERMISSION)
5. Update frontend to check hasPermission('new.permission')

Assumptions:
- Permission keys are immutable once defined
- Permissions are never deleted (only deprecated)
- New permissions default to False (secure by default)
- Permission additions are backward compatible
- Old code without new permission checks continues working
- Organizations inherit new permissions via role assignments

See docs/RBAC_MIGRATION_DESIGN.md for detailed design.
"""
from __future__ import annotations

from enum import Enum

__all__ = ["Permission"]


class Permission(str, Enum):
    """
    Canonical permissions for Madrona authorization.

    Format: DOMAIN_ACTION (e.g., ORG_MANAGE_MEMBERS)

    Domains:
    - ORG: Organization management (members, roles, audit)
    - CONNECTORS: Connector definitions and instances
    - PIPELINES: Integration pipelines
    - RUNS: Run execution and monitoring
    - DATA: Canonical data access (entities)
    - MAPPINGS: Transformation mappings/transformers
    - PLATFORM: Platform administration (internal only)
    """

    # ==================== Organization Domain ====================
    # Organization-level management capabilities

    ORG_MANAGE_MEMBERS = "org.manage_members"
    """Invite, remove, and manage organization members"""

    ORG_MANAGE_ROLES = "org.manage_roles"
    """Assign and change member roles within the organization"""

    ORG_USERS_CREATE = "org.users.create"
    """Create and invite user accounts within the organization"""

    ORG_USERS_UPDATE = "org.users.update"
    """Update user account details and role assignments within the organization"""

    ORG_USERS_DEACTIVATE = "org.users.deactivate"
    """Deactivate user memberships within the organization (does not delete global user account)"""

    ORG_MANAGE_API_KEYS = "org.manage_api_keys"
    """Create, view, and revoke API keys for organization"""

    ORG_MANAGE_SETTINGS = "org.manage_settings"
    """Manage organization settings and profile configuration"""

    ORG_VIEW_AUDIT_LOGS = "org.view_audit_logs"
    """View organization audit logs and change history"""

    # ==================== Control Plane: Connectors ====================
    # Source/target connector definitions and instances

    CONNECTORS_VIEW = "connectors.view"
    """View connector definitions and instances"""

    CONNECTORS_EDIT = "connectors.edit"
    """Create, modify, and delete connector instances"""

    # ==================== Control Plane: Pipelines ====================
    # Integration pipelines (source → target mappings)

    PIPELINES_VIEW = "pipelines.view"
    """View integration pipelines and their configuration"""

    PIPELINES_EDIT = "pipelines.edit"
    """Create, modify, and delete integration pipelines"""

    SCHEDULES_MANAGE = "schedules.manage"
    """Manage pipeline schedules (create, edit, enable/disable, delete)"""

    # ==================== Control Plane: Runs ====================
    # Run execution and monitoring

    RUNS_VIEW = "runs.view"
    """View run history and status"""

    RUNS_VIEW_LOGS = "runs.view_logs"
    """View detailed run logs and error messages"""

    RUNS_EXECUTE = "runs.execute"
    """Trigger manual runs"""

    RUNS_FORCE_FULL = "runs.force_full"
    """Force full refresh (skip incremental sync)"""

    RUNS_DELETE = "runs.delete"
    """Delete run records (admin only)"""

    RUNS_ROLLBACK = "runs.rollback"
    """Rollback a completed run to reverse its changes"""

    # ==================== Data Plane: Canonical Data ====================
    # Access to canonical entity data

    DATA_VIEW = "data.view"
    """View canonical entity data"""

    DATA_QUERY = "data.query"
    """Query and filter entity data"""

    DATA_EXPORT = "data.export"
    """Export entity data in various formats"""

    DATA_MANAGE = "data.manage"
    """Manage entity data, classification, and transformations"""

    # ==================== Configuration: Mappings ====================
    # Transformation mappings and transformers

    MAPPINGS_VIEW = "mappings.view"
    """View transformation mappings and transformers"""

    MAPPINGS_EDIT = "mappings.edit"
    """Create, modify, and delete transformation mappings"""

    # ==================== Platform Administration ====================
    # Platform-level administration (internal use only)

    PLATFORM_ADMIN = "platform.admin"
    """Full platform administration access (internal only)"""

    # ==================== Collections ====================
    # procedure-compliant collection management

    COLLECTIONS_VIEW = "collections.view"
    """View collection objects and their details"""

    COLLECTIONS_CREATE = "collections.create"
    """Create new collection objects"""

    COLLECTIONS_EDIT = "collections.edit"
    """Edit existing collection objects"""

    COLLECTIONS_DELETE = "collections.delete"
    """Delete collection objects"""

    DISCOVER_PUBLISH = "discover.publish"
    """Bulk publish, schedule, and manage public discovery of collection objects"""

    LOCATIONS_VIEW = "locations.view"
    """View storage locations and hierarchy"""

    LOCATIONS_EDIT = "locations.edit"
    """Create, modify, and delete storage locations"""

    MOVEMENTS_VIEW = "movements.view"
    """View movement history and tracking"""

    MOVEMENTS_CREATE = "movements.create"
    """Create movement records (relocate objects)"""

    LOOKUPS_VIEW = "lookups.view"
    """View lookup values for dropdowns"""

    LOOKUPS_MANAGE = "lookups.manage"
    """Create and manage organization-specific lookup values"""

    # ==================== Branding & Documents ====================
    # Organization branding and document generation

    BRANDING_VIEW = "branding.view"
    """View organization branding settings"""

    BRANDING_EDIT = "branding.edit"
    """Edit organization branding settings including logo upload"""

    DOCUMENTS_GENERATE = "documents.generate"
    """Generate PDF documents from collections data"""

    DOCUMENTS_TEMPLATES_VIEW = "documents.templates.view"
    """View document templates"""

    DOCUMENTS_TEMPLATES_EDIT = "documents.templates.edit"
    """Create and edit document templates"""

    # ==================== Media / DAM ====================
    # Digital Asset Management for media files

    MEDIA_VIEW = "media.view"
    """View media library and files"""

    MEDIA_EDIT = "media.edit"
    """Upload, edit, and organize media files"""

    MEDIA_DELETE = "media.delete"
    """Delete media files from the library"""

    MEDIA_PUBLISH = "media.publish"
    """Publish media for public access"""

    MEDIA_APPROVE_RIGHTS = "media.approve_rights"
    """Sign off on a media rights/license record (rights gate)"""

    MEDIA_APPROVE_REVIEW = "media.approve_review"
    """Sign off on a media sensitive-content review (review gate)"""

    MEDIA_DOWNLOAD_ORIGINAL = "media.download_original"
    """Download full resolution media files"""

    MEDIA_DOWNLOAD_DERIVATIVES = "media.download_derivatives"
    """Download thumbnails and preview versions"""

    MEDIA_VIEW_UNPUBLISHED = "media.view_unpublished"
    """View media that has not been published"""

    MEDIA_ADMIN = "media.admin"
    """Administer media settings including AI tagging configuration"""

    # ==================== Exhibitions ====================
    # Exhibition planning and virtual galleries

    EXHIBIT_VIEW = "exhibit.view"
    """View exhibitions and virtual galleries"""

    EXHIBIT_CREATE = "exhibit.create"
    """Create new exhibitions"""

    EXHIBIT_EDIT = "exhibit.edit"
    """Edit exhibition placements and settings"""

    EXHIBIT_DELETE = "exhibit.delete"
    """Delete exhibitions"""

    EXHIBIT_PUBLISH = "exhibit.publish"
    """Publish exhibitions as public virtual galleries"""

    VENUES_VIEW = "venues.view"
    """View venues and floor plans"""

    VENUES_EDIT = "venues.edit"
    """Create, modify, and delete venues and floor plans"""

    # Exhibition Labels
    LABELS_VIEW = "labels.view"
    """View exhibition label templates and generated labels"""

    LABELS_EDIT = "labels.edit"
    """Create and edit label templates and generate labels"""

    LABELS_APPROVE = "labels.approve"
    """Approve labels for printing"""

    # Exhibition Content
    EXHIBIT_CONTENT_VIEW = "exhibit.content.view"
    """View interpretive content blocks"""

    EXHIBIT_CONTENT_EDIT = "exhibit.content.edit"
    """Create and edit interpretive content blocks"""

    EXHIBIT_CONTENT_PUBLISH = "exhibit.content.publish"
    """Publish content blocks for public view"""

    # ==================== Content CMS ====================
    # CMS pages and blog posts

    CONTENT_VIEW = "content.view"
    """View CMS pages and blog posts in admin"""

    CONTENT_EDIT = "content.edit"
    """Create and edit CMS pages and blog posts"""

    CONTENT_PUBLISH = "content.publish"
    """Publish and unpublish CMS pages and blog posts"""

    CONTENT_DELETE = "content.delete"
    """Delete CMS pages and blog posts"""

    # Touring Exhibitions
    TOURING_VIEW = "touring.view"
    """View touring exhibition schedules and venues"""

    TOURING_EDIT = "touring.edit"
    """Manage touring exhibition venues and schedules"""

    # ==================== Procedures ====================
    # Museum collections management procedures

    # Constituents (unified contacts + person authorities)
    CONSTITUENTS_VIEW = "constituents.view"
    """View constituents (persons, organizations, corporate bodies)"""

    CONSTITUENTS_CREATE = "constituents.create"
    """Create new constituent records"""

    CONSTITUENTS_EDIT = "constituents.edit"
    """Edit constituent records"""

    CONSTITUENTS_DELETE = "constituents.delete"
    """Delete constituent records"""

    CONSTITUENTS_MERGE = "constituents.merge"
    """Merge duplicate constituent records"""

    # Legacy aliases for backward compatibility during migration
    CONTACTS_VIEW = "contacts.view"
    """View external contacts (deprecated: use constituents.view)"""

    CONTACTS_EDIT = "contacts.edit"
    """Create, modify, and delete contacts (deprecated: use constituents.edit)"""

    # Condition Reports (CDWA 14)
    CONDITION_REPORTS_VIEW = "condition_reports.view"
    """View condition check and examination reports"""

    CONDITION_REPORTS_CREATE = "condition_reports.create"
    """Create new condition reports"""

    CONDITION_REPORTS_EDIT = "condition_reports.edit"
    """Edit condition reports"""

    CONDITION_REPORTS_DELETE = "condition_reports.delete"
    """Delete condition reports"""

    CONDITION_REPORTS_REVIEW = "condition_reports.review"
    """Approve and finalize condition reports"""

    # Object Entry (procedures)
    ENTRIES_VIEW = "entries.view"
    """View incoming object entry records"""

    ENTRIES_CREATE = "entries.create"
    """Create new object entry records"""

    ENTRIES_EDIT = "entries.edit"
    """Edit and process object entries"""

    # Acquisitions (procedures + CDWA 23)
    ACQUISITIONS_VIEW = "acquisitions.view"
    """View acquisition and accessioning records"""

    ACQUISITIONS_CREATE = "acquisitions.create"
    """Create new acquisition proposals"""

    ACQUISITIONS_EDIT = "acquisitions.edit"
    """Edit acquisition records"""

    ACQUISITIONS_APPROVE = "acquisitions.approve"
    """Approve acquisitions for accessioning"""

    ACQUISITIONS_ROLLBACK = "acquisitions.rollback"
    """Revert acquisition status to a previous step"""

    # Loans (procedures + CDWA 24)
    LOANS_VIEW = "loans.view"
    """View incoming and outgoing loan records"""

    LOANS_CREATE = "loans.create"
    """Create new loan requests"""

    LOANS_EDIT = "loans.edit"
    """Edit loan records and conditions"""

    LOANS_APPROVE = "loans.approve"
    """Approve loan requests"""

    LOANS_ROLLBACK = "loans.rollback"
    """Revert loan status to a previous step"""

    # Conservation (procedures + CDWA 15)
    CONSERVATION_VIEW = "conservation.view"
    """View conservation treatment records"""

    CONSERVATION_CREATE = "conservation.create"
    """Create conservation treatment proposals"""

    CONSERVATION_EDIT = "conservation.edit"
    """Edit conservation treatment records"""

    CONSERVATION_APPROVE = "conservation.approve"
    """Approve conservation treatments"""

    # Object Exit (procedures)
    EXITS_VIEW = "exits.view"
    """View object exit records"""

    EXITS_CREATE = "exits.create"
    """Create new object exit records"""

    EXITS_EDIT = "exits.edit"
    """Edit and process object exits"""

    EXITS_ROLLBACK = "exits.rollback"
    """Revert object exit status to a previous step"""

    # Deaccession (procedure - most restrictive)
    DEACCESSION_VIEW = "deaccession.view"
    """View deaccession proposals and records"""

    DEACCESSION_CREATE = "deaccession.create"
    """Create deaccession proposals"""

    DEACCESSION_EDIT = "deaccession.edit"
    """Edit deaccession proposals"""

    DEACCESSION_REVIEW = "deaccession.review"
    """Conduct committee review of deaccession proposals"""

    DEACCESSION_APPROVE = "deaccession.approve"
    """Board-level approval of deaccessions"""

    DEACCESSION_COMPLETE = "deaccession.complete"
    """Finalize and complete deaccession process"""

    DEACCESSION_ROLLBACK = "deaccession.rollback"
    """Revert deaccession status to a previous step"""

    # ==================== NAGPRA Compliance ====================
    # NAGPRA compliance action and consultation tracking

    NAGPRA_VIEW = "nagpra.view"
    """View NAGPRA compliance records"""

    NAGPRA_CREATE = "nagpra.create"
    """Create NAGPRA compliance actions"""

    NAGPRA_EDIT = "nagpra.edit"
    """Edit NAGPRA compliance records"""

    # ==================== CDWA Authority Records ====================
    # Person/corporate body authority management

    AUTHORITIES_VIEW = "authorities.view"
    """View person and corporate body authority records"""

    AUTHORITIES_CREATE = "authorities.create"
    """Create new authority records"""

    AUTHORITIES_EDIT = "authorities.edit"
    """Edit authority records"""

    AUTHORITIES_DELETE = "authorities.delete"
    """Delete authority records"""

    AUTHORITIES_MERGE = "authorities.merge"
    """Merge duplicate authority records"""

    # Object Relationships (CDWA Category 20)
    OBJECT_RELATIONSHIPS_VIEW = "object_relationships.view"
    """View object relationship records"""

    OBJECT_RELATIONSHIPS_EDIT = "object_relationships.edit"
    """Create, modify, and delete object relationships"""

    # Citations (CDWA Category 27)
    CITATIONS_VIEW = "citations.view"
    """View bibliographic citations"""

    CITATIONS_EDIT = "citations.edit"
    """Create, modify, and delete citations"""

    # ==================== Secondary Procedures ====================
    # Documentation planning, emergency, incidents, reviews, audits

    # Documentation Plans (Procedure 9)
    DOCUMENTATION_PLANS_VIEW = "documentation_plans.view"
    """View documentation plans"""

    DOCUMENTATION_PLANS_CREATE = "documentation_plans.create"
    """Create documentation plans"""

    DOCUMENTATION_PLANS_EDIT = "documentation_plans.edit"
    """Edit documentation plans"""

    DOCUMENTATION_PLANS_APPROVE = "documentation_plans.approve"
    """Approve documentation plans"""

    # Emergency Plans (Procedure 15)
    EMERGENCY_PLANS_VIEW = "emergency_plans.view"
    """View emergency preparedness plans"""

    EMERGENCY_PLANS_CREATE = "emergency_plans.create"
    """Create emergency plans"""

    EMERGENCY_PLANS_EDIT = "emergency_plans.edit"
    """Edit emergency plans"""

    EMERGENCY_PLANS_APPROVE = "emergency_plans.approve"
    """Approve emergency plans"""

    # Incident Reports (Procedure 16)
    INCIDENTS_VIEW = "incidents.view"
    """View damage and loss incident reports"""

    INCIDENTS_CREATE = "incidents.create"
    """Create incident reports"""

    INCIDENTS_EDIT = "incidents.edit"
    """Edit incident reports"""

    INCIDENTS_INVESTIGATE = "incidents.investigate"
    """Lead incident investigations"""

    INCIDENTS_RESOLVE = "incidents.resolve"
    """Resolve and close incident reports"""

    # Collections Reviews (Procedure 20)
    REVIEWS_VIEW = "reviews.view"
    """View collections review campaigns"""

    REVIEWS_CREATE = "reviews.create"
    """Create review campaigns"""

    REVIEWS_EDIT = "reviews.edit"
    """Edit review campaigns and assessments"""

    REVIEWS_APPROVE = "reviews.approve"
    """Approve review campaigns"""

    # Audit Campaigns (Procedure 21)
    AUDITS_VIEW = "audits.view"
    """View audit campaigns"""

    AUDITS_CREATE = "audits.create"
    """Create audit campaigns"""

    AUDITS_EDIT = "audits.edit"
    """Edit audit campaigns and results"""

    AUDITS_APPROVE = "audits.approve"
    """Approve audit campaigns"""

    # Barcode & Inventory
    BARCODES_VIEW = "barcodes.view"
    """View barcode labels and scan history"""

    BARCODES_MANAGE = "barcodes.manage"
    """Create, edit, and void barcode labels"""

    BARCODES_SCAN = "barcodes.scan"
    """Perform barcode scans and record inventory transactions"""

    # Rights Management (Procedure 18)
    RIGHTS_VIEW = "rights.view"
    """View object rights records"""

    RIGHTS_CREATE = "rights.create"
    """Create rights records"""

    RIGHTS_EDIT = "rights.edit"
    """Edit rights records"""

    # Use Requests (Procedure 10)
    USE_REQUESTS_VIEW = "use_requests.view"
    """View use of collections requests"""

    USE_REQUESTS_CREATE = "use_requests.create"
    """Create use requests"""

    USE_REQUESTS_EDIT = "use_requests.edit"
    """Edit use requests"""

    USE_REQUESTS_APPROVE = "use_requests.approve"
    """Approve use requests"""

    # ==================== Events ====================
    # Museum programming activities (lectures, tours, workshops, etc.)

    EVENTS_VIEW = "events.view"
    """View event records and their details"""

    EVENTS_EDIT = "events.edit"
    """Create, edit, and delete events"""

    # ==================== Reports ====================
    # Comprehensive reporting system

    REPORTS_VIEW = "reports.view"
    """View reports and their results"""

    REPORTS_CREATE = "reports.create"
    """Create new reports"""

    REPORTS_EDIT = "reports.edit"
    """Edit existing reports"""

    REPORTS_DELETE = "reports.delete"
    """Delete reports"""

    REPORTS_EXECUTE = "reports.execute"
    """Run reports and view results"""

    REPORTS_SCHEDULE = "reports.schedule"
    """Create and manage report schedules"""

    REPORTS_EXPORT = "reports.export"
    """Export reports to PDF, Excel, or CSV"""

    # ==================== Valuations (Procedure 13) ====================
    # Valuation control for insurance, market value, etc.

    VALUATIONS_VIEW = "valuations.view"
    """View valuation records"""

    VALUATIONS_CREATE = "valuations.create"
    """Create valuation records"""

    VALUATIONS_EDIT = "valuations.edit"
    """Edit valuation records"""

    VALUATIONS_DELETE = "valuations.delete"
    """Delete valuation records"""

    # ==================== Reproduction Requests (Procedure 19) ====================
    # Reproduction rights and fulfillment

    REPRODUCTION_REQUESTS_VIEW = "reproduction_requests.view"
    """View reproduction requests"""

    REPRODUCTION_REQUESTS_CREATE = "reproduction_requests.create"
    """Create reproduction requests"""

    REPRODUCTION_REQUESTS_EDIT = "reproduction_requests.edit"
    """Edit reproduction requests"""

    REPRODUCTION_REQUESTS_DELETE = "reproduction_requests.delete"
    """Delete reproduction requests"""

    REPRODUCTION_REQUESTS_APPROVE = "reproduction_requests.approve"
    """Approve reproduction requests and clear rights"""

    # ==================== Workspaces (Working Sets) ====================
    # Saveable, shareable sets of collection objects for bulk operations

    WORKSPACES_VIEW = "workspaces.view"
    """View workspaces and their contents"""

    WORKSPACES_CREATE = "workspaces.create"
    """Create new workspaces"""

    WORKSPACES_EDIT = "workspaces.edit"
    """Edit workspace details and add/remove items"""

    WORKSPACES_DELETE = "workspaces.delete"
    """Delete workspaces"""

    WORKSPACES_SHARE = "workspaces.share"
    """Share workspaces with other users"""

    WORKSPACES_EXECUTE = "workspaces.execute"
    """Execute bulk actions on workspace objects"""

    # =====================
    # DAM WORKSPACES
    # =====================
    # Saveable, shareable sets of media assets for bulk operations

    MEDIA_WORKSPACES_VIEW = "media_workspaces.view"
    """View media workspaces and their contents"""

    MEDIA_WORKSPACES_CREATE = "media_workspaces.create"
    """Create new media workspaces"""

    MEDIA_WORKSPACES_EDIT = "media_workspaces.edit"
    """Edit media workspace details and add/remove items"""

    MEDIA_WORKSPACES_DELETE = "media_workspaces.delete"
    """Delete media workspaces"""

    MEDIA_WORKSPACES_SHARE = "media_workspaces.share"
    """Share media workspaces with other users"""

    MEDIA_WORKSPACES_EXECUTE = "media_workspaces.execute"
    """Execute bulk actions on media workspace assets"""

    # ==================== Media Download Requests ====================
    # Workflow for requesting high-res downloads from lightboxes

    DOWNLOAD_REQUESTS_VIEW = "download_requests.view"
    """View own download requests (users with review permission can see all)"""

    DOWNLOAD_REQUESTS_CREATE = "download_requests.create"
    """Create download requests from lightboxes"""

    DOWNLOAD_REQUESTS_REVIEW = "download_requests.review"
    """Review and approve/deny download requests"""

    DOWNLOAD_REQUESTS_FULFILL = "download_requests.fulfill"
    """Fulfill approved requests by generating download tokens"""

    # ==================== Tasks ====================
    # User task management across all applications

    TASKS_VIEW = "tasks.view"
    """View tasks"""

    TASKS_CREATE = "tasks.create"
    """Create new tasks"""

    TASKS_EDIT = "tasks.edit"
    """Edit tasks"""

    TASKS_DELETE = "tasks.delete"
    """Delete tasks"""

    # ==================== Insurance Management (Procedure 14) ====================
    # Centralized insurance management for collections

    INSURANCE_VIEW = "insurance.view"
    """View insurance policies and coverages"""

    INSURANCE_CREATE = "insurance.create"
    """Create insurance policies and coverages"""

    INSURANCE_EDIT = "insurance.edit"
    """Edit insurance policies and coverages"""

    INSURANCE_DELETE = "insurance.delete"
    """Delete insurance policies and coverages"""

    INSURANCE_APPROVE = "insurance.approve"
    """Approve insurance policies"""

    INSURANCE_CLAIMS_CREATE = "insurance.claims.create"
    """Create insurance claims"""

    INSURANCE_CLAIMS_MANAGE = "insurance.claims.manage"
    """Manage and settle insurance claims"""

    INDEMNITY_VIEW = "indemnity.view"
    """View indemnity arrangements"""

    INDEMNITY_CREATE = "indemnity.create"
    """Create indemnity arrangements"""

    INDEMNITY_EDIT = "indemnity.edit"
    """Edit indemnity arrangements"""

    INDEMNITY_SUBMIT = "indemnity.submit"
    """Submit indemnity applications"""

    # ==================== CDWA Extended Authorities ====================
    # Place, Style/Period, Subject authorities and related records

    # Place Authorities (CDWA 29)
    PLACE_AUTHORITIES_VIEW = "place_authorities.view"
    """View place authority records"""

    PLACE_AUTHORITIES_CREATE = "place_authorities.create"
    """Create place authority records"""

    PLACE_AUTHORITIES_EDIT = "place_authorities.edit"
    """Edit place authority records"""

    PLACE_AUTHORITIES_DELETE = "place_authorities.delete"
    """Delete place authority records"""

    # Style/Period Authorities (CDWA 5)
    STYLE_PERIOD_AUTHORITIES_VIEW = "style_period_authorities.view"
    """View style and period authority records"""

    STYLE_PERIOD_AUTHORITIES_CREATE = "style_period_authorities.create"
    """Create style and period authority records"""

    STYLE_PERIOD_AUTHORITIES_EDIT = "style_period_authorities.edit"
    """Edit style and period authority records"""

    STYLE_PERIOD_AUTHORITIES_DELETE = "style_period_authorities.delete"
    """Delete style and period authority records"""

    # Subject Authorities (CDWA 31)
    SUBJECT_AUTHORITIES_VIEW = "subject_authorities.view"
    """View subject authority records"""

    SUBJECT_AUTHORITIES_CREATE = "subject_authorities.create"
    """Create subject authority records"""

    SUBJECT_AUTHORITIES_EDIT = "subject_authorities.edit"
    """Edit subject authority records"""

    SUBJECT_AUTHORITIES_DELETE = "subject_authorities.delete"
    """Delete subject authority records"""

    # Critical Responses (CDWA 19)
    CRITICAL_RESPONSES_VIEW = "critical_responses.view"
    """View scholarly commentary records"""

    CRITICAL_RESPONSES_CREATE = "critical_responses.create"
    """Create scholarly commentary records"""

    CRITICAL_RESPONSES_EDIT = "critical_responses.edit"
    """Edit scholarly commentary records"""

    CRITICAL_RESPONSES_DELETE = "critical_responses.delete"
    """Delete scholarly commentary records"""

    # Cataloging History (CDWA 25)
    CATALOGING_HISTORY_VIEW = "cataloging_history.view"
    """View record change history"""

    CATALOGING_HISTORY_CREATE = "cataloging_history.create"
    """Create cataloging history entries"""

    # Object Contexts (CDWA 17)
    OBJECT_CONTEXTS_VIEW = "object_contexts.view"
    """View architectural and historical contexts"""

    OBJECT_CONTEXTS_CREATE = "object_contexts.create"
    """Create context records"""

    OBJECT_CONTEXTS_EDIT = "object_contexts.edit"
    """Edit context records"""

    OBJECT_CONTEXTS_DELETE = "object_contexts.delete"
    """Delete context records"""

    # ==================== Departments ====================
    # Department management and cross-department access

    DEPARTMENTS_VIEW = "departments.view"
    """View departments and their members"""

    DEPARTMENTS_CREATE = "departments.create"
    """Create new departments"""

    DEPARTMENTS_EDIT = "departments.edit"
    """Edit department details"""

    DEPARTMENTS_DELETE = "departments.delete"
    """Delete departments"""

    DEPARTMENTS_MANAGE_MEMBERS = "departments.manage_members"
    """Add/remove department members and change roles"""

    COLLECTIONS_VIEW_ALL_DEPARTMENTS = "collections.view_all_departments"
    """Bypass department filtering to see all records across departments"""

    # ==================== Guide / Agent Orchestration ====================
    # Human-in-the-loop gates for the multi-agent plan executor.

    GUIDE_APPROVE_PLAN = "guide.approve_plan"
    """Approve a Guide agent plan step before the executor proceeds"""
