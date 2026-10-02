"""
Permission metadata and registry for Madrona.

Contains the PermissionMetadata class and the PERMISSION_REGISTRY dict
that maps each Permission enum member to its display metadata.
"""
from __future__ import annotations

from typing import Dict, List

from app.permissions.enums import Permission

__all__ = [
    "PermissionMetadata",
    "PERMISSION_REGISTRY",
    "get_all_permissions",
    "get_permissions_by_scope",
    "get_permission_metadata",
    "validate_permission",
]


class PermissionMetadata:
    """Metadata for a permission including display name and description."""

    def __init__(self, key: str, scope: str, action: str, display_name: str, description: str):
        self.key = key
        self.scope = scope
        self.action = action
        self.display_name = display_name
        self.description = description

    def to_dict(self) -> Dict[str, str]:
        """Convert to dictionary for database seeding."""
        return {
            'permission_key': self.key,
            'scope': self.scope,
            'action': self.action,
            'display_name': self.display_name,
            'description': self.description,
        }


# Canonical permission definitions with metadata
PERMISSION_REGISTRY: Dict[Permission, PermissionMetadata] = {
    # Organization
    Permission.ORG_MANAGE_MEMBERS: PermissionMetadata(
        key=Permission.ORG_MANAGE_MEMBERS.value,
        scope='org',
        action='manage_members',
        display_name='Manage Members',
        description='Invite, remove, and manage organization members'
    ),
    Permission.ORG_MANAGE_ROLES: PermissionMetadata(
        key=Permission.ORG_MANAGE_ROLES.value,
        scope='org',
        action='manage_roles',
        display_name='Manage Roles',
        description='Assign and change member roles within the organization'
    ),
    Permission.ORG_USERS_CREATE: PermissionMetadata(
        key=Permission.ORG_USERS_CREATE.value,
        scope='org',
        action='users_create',
        display_name='Create Users',
        description='Create and invite user accounts within the organization'
    ),
    Permission.ORG_USERS_UPDATE: PermissionMetadata(
        key=Permission.ORG_USERS_UPDATE.value,
        scope='org',
        action='users_update',
        display_name='Update Users',
        description='Update user account details and role assignments within the organization'
    ),
    Permission.ORG_USERS_DEACTIVATE: PermissionMetadata(
        key=Permission.ORG_USERS_DEACTIVATE.value,
        scope='org',
        action='users_deactivate',
        display_name='Deactivate Users',
        description='Deactivate user memberships within the organization (does not delete global user account)'
    ),
    Permission.ORG_MANAGE_API_KEYS: PermissionMetadata(
        key=Permission.ORG_MANAGE_API_KEYS.value,
        scope='org',
        action='manage_api_keys',
        display_name='Manage API Keys',
        description='Create, view, and revoke API keys for organization'
    ),
    Permission.ORG_MANAGE_SETTINGS: PermissionMetadata(
        key=Permission.ORG_MANAGE_SETTINGS.value,
        scope='org',
        action='manage_settings',
        display_name='Manage Settings',
        description='Manage organization settings and profile configuration'
    ),
    Permission.ORG_VIEW_AUDIT_LOGS: PermissionMetadata(
        key=Permission.ORG_VIEW_AUDIT_LOGS.value,
        scope='org',
        action='view_audit_logs',
        display_name='View Audit Logs',
        description='View organization audit logs and change history'
    ),

    # Connectors
    Permission.CONNECTORS_VIEW: PermissionMetadata(
        key=Permission.CONNECTORS_VIEW.value,
        scope='connectors',
        action='view',
        display_name='View Connectors',
        description='View connector definitions and instances'
    ),
    Permission.CONNECTORS_EDIT: PermissionMetadata(
        key=Permission.CONNECTORS_EDIT.value,
        scope='connectors',
        action='edit',
        display_name='Edit Connectors',
        description='Create, modify, and delete connector instances'
    ),

    # Pipelines
    Permission.PIPELINES_VIEW: PermissionMetadata(
        key=Permission.PIPELINES_VIEW.value,
        scope='pipelines',
        action='view',
        display_name='View Pipelines',
        description='View integration pipelines and their configuration'
    ),
    Permission.PIPELINES_EDIT: PermissionMetadata(
        key=Permission.PIPELINES_EDIT.value,
        scope='pipelines',
        action='edit',
        display_name='Edit Pipelines',
        description='Create, modify, and delete integration pipelines'
    ),
    Permission.SCHEDULES_MANAGE: PermissionMetadata(
        key=Permission.SCHEDULES_MANAGE.value,
        scope='schedules',
        action='manage',
        display_name='Manage Schedules',
        description='Manage pipeline schedules (create, edit, enable/disable, delete)'
    ),

    # Runs
    Permission.RUNS_VIEW: PermissionMetadata(
        key=Permission.RUNS_VIEW.value,
        scope='runs',
        action='view',
        display_name='View Runs',
        description='View run history and status'
    ),
    Permission.RUNS_VIEW_LOGS: PermissionMetadata(
        key=Permission.RUNS_VIEW_LOGS.value,
        scope='runs',
        action='view_logs',
        display_name='View Run Logs',
        description='View detailed run logs and error messages'
    ),
    Permission.RUNS_EXECUTE: PermissionMetadata(
        key=Permission.RUNS_EXECUTE.value,
        scope='runs',
        action='execute',
        display_name='Execute Runs',
        description='Trigger manual runs'
    ),
    Permission.RUNS_FORCE_FULL: PermissionMetadata(
        key=Permission.RUNS_FORCE_FULL.value,
        scope='runs',
        action='force_full',
        display_name='Force Full Refresh',
        description='Force full refresh (skip incremental sync)'
    ),
    Permission.RUNS_DELETE: PermissionMetadata(
        key=Permission.RUNS_DELETE.value,
        scope='runs',
        action='delete',
        display_name='Delete Runs',
        description='Delete run records (admin only)'
    ),
    Permission.RUNS_ROLLBACK: PermissionMetadata(
        key=Permission.RUNS_ROLLBACK.value,
        scope='runs',
        action='rollback',
        display_name='Rollback Runs',
        description='Rollback a completed run to reverse its changes'
    ),

    # Data
    Permission.DATA_VIEW: PermissionMetadata(
        key=Permission.DATA_VIEW.value,
        scope='data',
        action='view',
        display_name='View Data',
        description='View canonical entity data'
    ),
    Permission.DATA_QUERY: PermissionMetadata(
        key=Permission.DATA_QUERY.value,
        scope='data',
        action='query',
        display_name='Query Data',
        description='Query and filter entity data'
    ),
    Permission.DATA_EXPORT: PermissionMetadata(
        key=Permission.DATA_EXPORT.value,
        scope='data',
        action='export',
        display_name='Export Data',
        description='Export entity data in various formats'
    ),
    Permission.DATA_MANAGE: PermissionMetadata(
        key=Permission.DATA_MANAGE.value,
        scope='data',
        action='manage',
        display_name='Manage Data',
        description='Manage entity data, classification, and transformations'
    ),

    # Mappings
    Permission.MAPPINGS_VIEW: PermissionMetadata(
        key=Permission.MAPPINGS_VIEW.value,
        scope='mappings',
        action='view',
        display_name='View Mappings',
        description='View transformation mappings and transformers'
    ),
    Permission.MAPPINGS_EDIT: PermissionMetadata(
        key=Permission.MAPPINGS_EDIT.value,
        scope='mappings',
        action='edit',
        display_name='Edit Mappings',
        description='Create, modify, and delete transformation mappings'
    ),

    # Platform
    Permission.PLATFORM_ADMIN: PermissionMetadata(
        key=Permission.PLATFORM_ADMIN.value,
        scope='platform',
        action='admin',
        display_name='Platform Admin',
        description='Full platform administration access (internal only)'
    ),

    # Collections
    Permission.COLLECTIONS_VIEW: PermissionMetadata(
        key=Permission.COLLECTIONS_VIEW.value,
        scope='collections',
        action='view',
        display_name='View Collections',
        description='View collection objects and their details'
    ),
    Permission.COLLECTIONS_CREATE: PermissionMetadata(
        key=Permission.COLLECTIONS_CREATE.value,
        scope='collections',
        action='create',
        display_name='Create Collections',
        description='Create new collection objects'
    ),
    Permission.COLLECTIONS_EDIT: PermissionMetadata(
        key=Permission.COLLECTIONS_EDIT.value,
        scope='collections',
        action='edit',
        display_name='Edit Collections',
        description='Edit existing collection objects'
    ),
    Permission.COLLECTIONS_DELETE: PermissionMetadata(
        key=Permission.COLLECTIONS_DELETE.value,
        scope='collections',
        action='delete',
        display_name='Delete Collections',
        description='Delete collection objects'
    ),
    Permission.DISCOVER_PUBLISH: PermissionMetadata(
        key=Permission.DISCOVER_PUBLISH.value,
        scope='discover',
        action='publish',
        display_name='Publish to Discover',
        description='Bulk publish, schedule, and manage public discovery of collection objects'
    ),

    # Locations
    Permission.LOCATIONS_VIEW: PermissionMetadata(
        key=Permission.LOCATIONS_VIEW.value,
        scope='locations',
        action='view',
        display_name='View Locations',
        description='View storage locations and hierarchy'
    ),
    Permission.LOCATIONS_EDIT: PermissionMetadata(
        key=Permission.LOCATIONS_EDIT.value,
        scope='locations',
        action='edit',
        display_name='Edit Locations',
        description='Create, modify, and delete storage locations'
    ),

    # Movements
    Permission.MOVEMENTS_VIEW: PermissionMetadata(
        key=Permission.MOVEMENTS_VIEW.value,
        scope='movements',
        action='view',
        display_name='View Movements',
        description='View movement history and tracking'
    ),
    Permission.MOVEMENTS_CREATE: PermissionMetadata(
        key=Permission.MOVEMENTS_CREATE.value,
        scope='movements',
        action='create',
        display_name='Create Movements',
        description='Create movement records (relocate objects)'
    ),

    # Lookups
    Permission.LOOKUPS_VIEW: PermissionMetadata(
        key=Permission.LOOKUPS_VIEW.value,
        scope='lookups',
        action='view',
        display_name='View Lookups',
        description='View lookup values for dropdowns'
    ),
    Permission.LOOKUPS_MANAGE: PermissionMetadata(
        key=Permission.LOOKUPS_MANAGE.value,
        scope='lookups',
        action='manage',
        display_name='Manage Lookups',
        description='Create and manage organization-specific lookup values'
    ),

    # Branding & Documents
    Permission.BRANDING_VIEW: PermissionMetadata(
        key=Permission.BRANDING_VIEW.value,
        scope='branding',
        action='view',
        display_name='View Branding',
        description='View organization branding settings'
    ),
    Permission.BRANDING_EDIT: PermissionMetadata(
        key=Permission.BRANDING_EDIT.value,
        scope='branding',
        action='edit',
        display_name='Edit Branding',
        description='Edit organization branding settings including logo upload'
    ),
    Permission.DOCUMENTS_GENERATE: PermissionMetadata(
        key=Permission.DOCUMENTS_GENERATE.value,
        scope='documents',
        action='generate',
        display_name='Generate Documents',
        description='Generate PDF documents from collections data'
    ),
    Permission.DOCUMENTS_TEMPLATES_VIEW: PermissionMetadata(
        key=Permission.DOCUMENTS_TEMPLATES_VIEW.value,
        scope='documents',
        action='templates.view',
        display_name='View Document Templates',
        description='View document templates'
    ),
    Permission.DOCUMENTS_TEMPLATES_EDIT: PermissionMetadata(
        key=Permission.DOCUMENTS_TEMPLATES_EDIT.value,
        scope='documents',
        action='templates.edit',
        display_name='Edit Document Templates',
        description='Create and edit document templates'
    ),

    # Media / DAM
    Permission.MEDIA_VIEW: PermissionMetadata(
        key=Permission.MEDIA_VIEW.value,
        scope='media',
        action='view',
        display_name='View Media',
        description='View media library and files'
    ),
    Permission.MEDIA_EDIT: PermissionMetadata(
        key=Permission.MEDIA_EDIT.value,
        scope='media',
        action='edit',
        display_name='Edit Media',
        description='Upload, edit, and organize media files'
    ),
    Permission.MEDIA_DELETE: PermissionMetadata(
        key=Permission.MEDIA_DELETE.value,
        scope='media',
        action='delete',
        display_name='Delete Media',
        description='Delete media files from the library'
    ),
    Permission.MEDIA_PUBLISH: PermissionMetadata(
        key=Permission.MEDIA_PUBLISH.value,
        scope='media',
        action='publish',
        display_name='Publish Media',
        description='Publish media for public access'
    ),
    Permission.MEDIA_APPROVE_RIGHTS: PermissionMetadata(
        key=Permission.MEDIA_APPROVE_RIGHTS.value,
        scope='media',
        action='approve_rights',
        display_name='Approve Media Rights',
        description='Sign off on a media rights/license record'
    ),
    Permission.MEDIA_APPROVE_REVIEW: PermissionMetadata(
        key=Permission.MEDIA_APPROVE_REVIEW.value,
        scope='media',
        action='approve_review',
        display_name='Approve Media Review',
        description='Sign off on a media sensitive-content review'
    ),
    Permission.MEDIA_DOWNLOAD_ORIGINAL: PermissionMetadata(
        key=Permission.MEDIA_DOWNLOAD_ORIGINAL.value,
        scope='media',
        action='download_original',
        display_name='Download Original Media',
        description='Download full resolution media files'
    ),
    Permission.MEDIA_DOWNLOAD_DERIVATIVES: PermissionMetadata(
        key=Permission.MEDIA_DOWNLOAD_DERIVATIVES.value,
        scope='media',
        action='download_derivatives',
        display_name='Download Derivatives',
        description='Download thumbnails and preview versions'
    ),
    Permission.MEDIA_VIEW_UNPUBLISHED: PermissionMetadata(
        key=Permission.MEDIA_VIEW_UNPUBLISHED.value,
        scope='media',
        action='view_unpublished',
        display_name='View Unpublished Media',
        description='View media that has not been published'
    ),
    Permission.MEDIA_ADMIN: PermissionMetadata(
        key=Permission.MEDIA_ADMIN.value,
        scope='media',
        action='admin',
        display_name='Administer Media',
        description='Configure AI tagging, manage tag mappings, and other media admin settings'
    ),

    # Exhibit
    Permission.EXHIBIT_VIEW: PermissionMetadata(
        key=Permission.EXHIBIT_VIEW.value,
        scope='exhibit',
        action='view',
        display_name='View Exhibitions',
        description='View exhibitions and virtual galleries'
    ),
    Permission.EXHIBIT_CREATE: PermissionMetadata(
        key=Permission.EXHIBIT_CREATE.value,
        scope='exhibit',
        action='create',
        display_name='Create Exhibitions',
        description='Create new exhibitions'
    ),
    Permission.EXHIBIT_EDIT: PermissionMetadata(
        key=Permission.EXHIBIT_EDIT.value,
        scope='exhibit',
        action='edit',
        display_name='Edit Exhibitions',
        description='Edit exhibition placements and settings'
    ),
    Permission.EXHIBIT_DELETE: PermissionMetadata(
        key=Permission.EXHIBIT_DELETE.value,
        scope='exhibit',
        action='delete',
        display_name='Delete Exhibitions',
        description='Delete exhibitions'
    ),
    Permission.EXHIBIT_PUBLISH: PermissionMetadata(
        key=Permission.EXHIBIT_PUBLISH.value,
        scope='exhibit',
        action='publish',
        display_name='Publish Exhibitions',
        description='Publish exhibitions as public virtual galleries'
    ),

    # Venues
    Permission.VENUES_VIEW: PermissionMetadata(
        key=Permission.VENUES_VIEW.value,
        scope='venues',
        action='view',
        display_name='View Venues',
        description='View venues and floor plans'
    ),
    Permission.VENUES_EDIT: PermissionMetadata(
        key=Permission.VENUES_EDIT.value,
        scope='venues',
        action='edit',
        display_name='Edit Venues',
        description='Create, modify, and delete venues and floor plans'
    ),

    # Exhibition Labels
    Permission.LABELS_VIEW: PermissionMetadata(
        key=Permission.LABELS_VIEW.value,
        scope='labels',
        action='view',
        display_name='View Labels',
        description='View exhibition label templates and generated labels'
    ),
    Permission.LABELS_EDIT: PermissionMetadata(
        key=Permission.LABELS_EDIT.value,
        scope='labels',
        action='edit',
        display_name='Edit Labels',
        description='Create and edit label templates and generate labels'
    ),
    Permission.LABELS_APPROVE: PermissionMetadata(
        key=Permission.LABELS_APPROVE.value,
        scope='labels',
        action='approve',
        display_name='Approve Labels',
        description='Approve labels for printing'
    ),

    # Exhibition Content
    Permission.EXHIBIT_CONTENT_VIEW: PermissionMetadata(
        key=Permission.EXHIBIT_CONTENT_VIEW.value,
        scope='exhibit',
        action='content_view',
        display_name='View Exhibition Content',
        description='View interpretive content blocks'
    ),
    Permission.EXHIBIT_CONTENT_EDIT: PermissionMetadata(
        key=Permission.EXHIBIT_CONTENT_EDIT.value,
        scope='exhibit',
        action='content_edit',
        display_name='Edit Exhibition Content',
        description='Create and edit interpretive content blocks'
    ),
    Permission.EXHIBIT_CONTENT_PUBLISH: PermissionMetadata(
        key=Permission.EXHIBIT_CONTENT_PUBLISH.value,
        scope='exhibit',
        action='content_publish',
        display_name='Publish Exhibition Content',
        description='Publish content blocks for public view'
    ),

    # Content CMS
    Permission.CONTENT_VIEW: PermissionMetadata(
        key=Permission.CONTENT_VIEW.value,
        scope='content',
        action='view',
        display_name='View Content',
        description='View CMS pages and blog posts in admin'
    ),
    Permission.CONTENT_EDIT: PermissionMetadata(
        key=Permission.CONTENT_EDIT.value,
        scope='content',
        action='edit',
        display_name='Edit Content',
        description='Create and edit CMS pages and blog posts'
    ),
    Permission.CONTENT_PUBLISH: PermissionMetadata(
        key=Permission.CONTENT_PUBLISH.value,
        scope='content',
        action='publish',
        display_name='Publish Content',
        description='Publish and unpublish CMS pages and blog posts'
    ),
    Permission.CONTENT_DELETE: PermissionMetadata(
        key=Permission.CONTENT_DELETE.value,
        scope='content',
        action='delete',
        display_name='Delete Content',
        description='Delete CMS pages and blog posts'
    ),

    # Touring Exhibitions
    Permission.TOURING_VIEW: PermissionMetadata(
        key=Permission.TOURING_VIEW.value,
        scope='touring',
        action='view',
        display_name='View Touring Schedule',
        description='View touring exhibition schedules and venues'
    ),
    Permission.TOURING_EDIT: PermissionMetadata(
        key=Permission.TOURING_EDIT.value,
        scope='touring',
        action='edit',
        display_name='Edit Touring Schedule',
        description='Manage touring exhibition venues and schedules'
    ),

    # ==================== Procedures ====================

    # Constituents (unified contacts + person authorities)
    Permission.CONSTITUENTS_VIEW: PermissionMetadata(
        key=Permission.CONSTITUENTS_VIEW.value,
        scope='constituents',
        action='view',
        display_name='View Constituents',
        description='View constituents (persons, organizations, corporate bodies)'
    ),
    Permission.CONSTITUENTS_CREATE: PermissionMetadata(
        key=Permission.CONSTITUENTS_CREATE.value,
        scope='constituents',
        action='create',
        display_name='Create Constituents',
        description='Create new constituent records'
    ),
    Permission.CONSTITUENTS_EDIT: PermissionMetadata(
        key=Permission.CONSTITUENTS_EDIT.value,
        scope='constituents',
        action='edit',
        display_name='Edit Constituents',
        description='Edit constituent records'
    ),
    Permission.CONSTITUENTS_DELETE: PermissionMetadata(
        key=Permission.CONSTITUENTS_DELETE.value,
        scope='constituents',
        action='delete',
        display_name='Delete Constituents',
        description='Delete constituent records'
    ),
    Permission.CONSTITUENTS_MERGE: PermissionMetadata(
        key=Permission.CONSTITUENTS_MERGE.value,
        scope='constituents',
        action='merge',
        display_name='Merge Constituents',
        description='Merge duplicate constituent records'
    ),

    # Contacts (legacy - kept for backward compatibility)
    Permission.CONTACTS_VIEW: PermissionMetadata(
        key=Permission.CONTACTS_VIEW.value,
        scope='contacts',
        action='view',
        display_name='View Contacts',
        description='View external contacts (deprecated: use constituents.view)'
    ),
    Permission.CONTACTS_EDIT: PermissionMetadata(
        key=Permission.CONTACTS_EDIT.value,
        scope='contacts',
        action='edit',
        display_name='Edit Contacts',
        description='Create, modify, and delete contacts (deprecated: use constituents.edit)'
    ),

    # Condition Reports (CDWA 14)
    Permission.CONDITION_REPORTS_VIEW: PermissionMetadata(
        key=Permission.CONDITION_REPORTS_VIEW.value,
        scope='condition_reports',
        action='view',
        display_name='View Condition Reports',
        description='View condition check and examination reports'
    ),
    Permission.CONDITION_REPORTS_CREATE: PermissionMetadata(
        key=Permission.CONDITION_REPORTS_CREATE.value,
        scope='condition_reports',
        action='create',
        display_name='Create Condition Reports',
        description='Create new condition reports'
    ),
    Permission.CONDITION_REPORTS_EDIT: PermissionMetadata(
        key=Permission.CONDITION_REPORTS_EDIT.value,
        scope='condition_reports',
        action='edit',
        display_name='Edit Condition Reports',
        description='Edit condition reports'
    ),
    Permission.CONDITION_REPORTS_DELETE: PermissionMetadata(
        key=Permission.CONDITION_REPORTS_DELETE.value,
        scope='condition_reports',
        action='delete',
        display_name='Delete Condition Reports',
        description='Delete condition reports'
    ),
    Permission.CONDITION_REPORTS_REVIEW: PermissionMetadata(
        key=Permission.CONDITION_REPORTS_REVIEW.value,
        scope='condition_reports',
        action='review',
        display_name='Review Condition Reports',
        description='Approve and finalize condition reports'
    ),

    # Object Entry (procedures)
    Permission.ENTRIES_VIEW: PermissionMetadata(
        key=Permission.ENTRIES_VIEW.value,
        scope='entries',
        action='view',
        display_name='View Object Entries',
        description='View incoming object entry records'
    ),
    Permission.ENTRIES_CREATE: PermissionMetadata(
        key=Permission.ENTRIES_CREATE.value,
        scope='entries',
        action='create',
        display_name='Create Object Entries',
        description='Create new object entry records'
    ),
    Permission.ENTRIES_EDIT: PermissionMetadata(
        key=Permission.ENTRIES_EDIT.value,
        scope='entries',
        action='edit',
        display_name='Edit Object Entries',
        description='Edit and process object entries'
    ),

    # Acquisitions (procedures + CDWA 23)
    Permission.ACQUISITIONS_VIEW: PermissionMetadata(
        key=Permission.ACQUISITIONS_VIEW.value,
        scope='acquisitions',
        action='view',
        display_name='View Acquisitions',
        description='View acquisition and accessioning records'
    ),
    Permission.ACQUISITIONS_CREATE: PermissionMetadata(
        key=Permission.ACQUISITIONS_CREATE.value,
        scope='acquisitions',
        action='create',
        display_name='Create Acquisitions',
        description='Create new acquisition proposals'
    ),
    Permission.ACQUISITIONS_EDIT: PermissionMetadata(
        key=Permission.ACQUISITIONS_EDIT.value,
        scope='acquisitions',
        action='edit',
        display_name='Edit Acquisitions',
        description='Edit acquisition records'
    ),
    Permission.ACQUISITIONS_APPROVE: PermissionMetadata(
        key=Permission.ACQUISITIONS_APPROVE.value,
        scope='acquisitions',
        action='approve',
        display_name='Approve Acquisitions',
        description='Approve acquisitions for accessioning'
    ),
    Permission.ACQUISITIONS_ROLLBACK: PermissionMetadata(
        key=Permission.ACQUISITIONS_ROLLBACK.value,
        scope='acquisitions',
        action='rollback',
        display_name='Rollback Acquisitions',
        description='Revert acquisition status to a previous step'
    ),

    # Loans (procedures + CDWA 24)
    Permission.LOANS_VIEW: PermissionMetadata(
        key=Permission.LOANS_VIEW.value,
        scope='loans',
        action='view',
        display_name='View Loans',
        description='View incoming and outgoing loan records'
    ),
    Permission.LOANS_CREATE: PermissionMetadata(
        key=Permission.LOANS_CREATE.value,
        scope='loans',
        action='create',
        display_name='Create Loans',
        description='Create new loan requests'
    ),
    Permission.LOANS_EDIT: PermissionMetadata(
        key=Permission.LOANS_EDIT.value,
        scope='loans',
        action='edit',
        display_name='Edit Loans',
        description='Edit loan records and conditions'
    ),
    Permission.LOANS_APPROVE: PermissionMetadata(
        key=Permission.LOANS_APPROVE.value,
        scope='loans',
        action='approve',
        display_name='Approve Loans',
        description='Approve loan requests'
    ),
    Permission.LOANS_ROLLBACK: PermissionMetadata(
        key=Permission.LOANS_ROLLBACK.value,
        scope='loans',
        action='rollback',
        display_name='Rollback Loans',
        description='Revert loan status to a previous step'
    ),

    # Conservation (procedures + CDWA 15)
    Permission.CONSERVATION_VIEW: PermissionMetadata(
        key=Permission.CONSERVATION_VIEW.value,
        scope='conservation',
        action='view',
        display_name='View Conservation',
        description='View conservation treatment records'
    ),
    Permission.CONSERVATION_CREATE: PermissionMetadata(
        key=Permission.CONSERVATION_CREATE.value,
        scope='conservation',
        action='create',
        display_name='Create Conservation',
        description='Create conservation treatment proposals'
    ),
    Permission.CONSERVATION_EDIT: PermissionMetadata(
        key=Permission.CONSERVATION_EDIT.value,
        scope='conservation',
        action='edit',
        display_name='Edit Conservation',
        description='Edit conservation treatment records'
    ),
    Permission.CONSERVATION_APPROVE: PermissionMetadata(
        key=Permission.CONSERVATION_APPROVE.value,
        scope='conservation',
        action='approve',
        display_name='Approve Conservation',
        description='Approve conservation treatments'
    ),

    # Object Exit (procedures)
    Permission.EXITS_VIEW: PermissionMetadata(
        key=Permission.EXITS_VIEW.value,
        scope='exits',
        action='view',
        display_name='View Object Exits',
        description='View object exit records'
    ),
    Permission.EXITS_CREATE: PermissionMetadata(
        key=Permission.EXITS_CREATE.value,
        scope='exits',
        action='create',
        display_name='Create Object Exits',
        description='Create new object exit records'
    ),
    Permission.EXITS_EDIT: PermissionMetadata(
        key=Permission.EXITS_EDIT.value,
        scope='exits',
        action='edit',
        display_name='Edit Object Exits',
        description='Edit and process object exits'
    ),
    Permission.EXITS_ROLLBACK: PermissionMetadata(
        key=Permission.EXITS_ROLLBACK.value,
        scope='exits',
        action='rollback',
        display_name='Rollback Object Exits',
        description='Revert object exit status to a previous step'
    ),

    # Deaccession (procedure - most restrictive)
    Permission.DEACCESSION_VIEW: PermissionMetadata(
        key=Permission.DEACCESSION_VIEW.value,
        scope='deaccession',
        action='view',
        display_name='View Deaccessions',
        description='View deaccession proposals and records'
    ),
    Permission.DEACCESSION_CREATE: PermissionMetadata(
        key=Permission.DEACCESSION_CREATE.value,
        scope='deaccession',
        action='create',
        display_name='Create Deaccessions',
        description='Create deaccession proposals'
    ),
    Permission.DEACCESSION_EDIT: PermissionMetadata(
        key=Permission.DEACCESSION_EDIT.value,
        scope='deaccession',
        action='edit',
        display_name='Edit Deaccessions',
        description='Edit deaccession proposals'
    ),
    Permission.DEACCESSION_REVIEW: PermissionMetadata(
        key=Permission.DEACCESSION_REVIEW.value,
        scope='deaccession',
        action='review',
        display_name='Review Deaccessions',
        description='Conduct committee review of deaccession proposals'
    ),
    Permission.DEACCESSION_APPROVE: PermissionMetadata(
        key=Permission.DEACCESSION_APPROVE.value,
        scope='deaccession',
        action='approve',
        display_name='Approve Deaccessions',
        description='Board-level approval of deaccessions'
    ),
    Permission.DEACCESSION_COMPLETE: PermissionMetadata(
        key=Permission.DEACCESSION_COMPLETE.value,
        scope='deaccession',
        action='complete',
        display_name='Complete Deaccessions',
        description='Finalize and complete deaccession process'
    ),
    Permission.DEACCESSION_ROLLBACK: PermissionMetadata(
        key=Permission.DEACCESSION_ROLLBACK.value,
        scope='deaccession',
        action='rollback',
        display_name='Rollback Deaccessions',
        description='Revert deaccession status to a previous step'
    ),

    # NAGPRA Compliance
    Permission.NAGPRA_VIEW: PermissionMetadata(
        key=Permission.NAGPRA_VIEW.value,
        scope='nagpra',
        action='view',
        display_name='View NAGPRA Records',
        description='View NAGPRA compliance records'
    ),
    Permission.NAGPRA_CREATE: PermissionMetadata(
        key=Permission.NAGPRA_CREATE.value,
        scope='nagpra',
        action='create',
        display_name='Create NAGPRA Actions',
        description='Create NAGPRA compliance actions'
    ),
    Permission.NAGPRA_EDIT: PermissionMetadata(
        key=Permission.NAGPRA_EDIT.value,
        scope='nagpra',
        action='edit',
        display_name='Edit NAGPRA Records',
        description='Edit NAGPRA compliance records'
    ),

    # CDWA Authority Records
    Permission.AUTHORITIES_VIEW: PermissionMetadata(
        key=Permission.AUTHORITIES_VIEW.value,
        scope='authorities',
        action='view',
        display_name='View Authorities',
        description='View person and corporate body authority records'
    ),
    Permission.AUTHORITIES_CREATE: PermissionMetadata(
        key=Permission.AUTHORITIES_CREATE.value,
        scope='authorities',
        action='create',
        display_name='Create Authorities',
        description='Create new authority records'
    ),
    Permission.AUTHORITIES_EDIT: PermissionMetadata(
        key=Permission.AUTHORITIES_EDIT.value,
        scope='authorities',
        action='edit',
        display_name='Edit Authorities',
        description='Edit authority records'
    ),
    Permission.AUTHORITIES_DELETE: PermissionMetadata(
        key=Permission.AUTHORITIES_DELETE.value,
        scope='authorities',
        action='delete',
        display_name='Delete Authorities',
        description='Delete authority records'
    ),
    Permission.AUTHORITIES_MERGE: PermissionMetadata(
        key=Permission.AUTHORITIES_MERGE.value,
        scope='authorities',
        action='merge',
        display_name='Merge Authorities',
        description='Merge duplicate authority records'
    ),

    # Object Relationships (CDWA Category 20)
    Permission.OBJECT_RELATIONSHIPS_VIEW: PermissionMetadata(
        key=Permission.OBJECT_RELATIONSHIPS_VIEW.value,
        scope='object_relationships',
        action='view',
        display_name='View Object Relationships',
        description='View object relationship records'
    ),
    Permission.OBJECT_RELATIONSHIPS_EDIT: PermissionMetadata(
        key=Permission.OBJECT_RELATIONSHIPS_EDIT.value,
        scope='object_relationships',
        action='edit',
        display_name='Edit Object Relationships',
        description='Create, modify, and delete object relationships'
    ),

    # Citations (CDWA Category 27)
    Permission.CITATIONS_VIEW: PermissionMetadata(
        key=Permission.CITATIONS_VIEW.value,
        scope='citations',
        action='view',
        display_name='View Citations',
        description='View bibliographic citations'
    ),
    Permission.CITATIONS_EDIT: PermissionMetadata(
        key=Permission.CITATIONS_EDIT.value,
        scope='citations',
        action='edit',
        display_name='Edit Citations',
        description='Create, modify, and delete citations'
    ),

    # Documentation Plans (Procedure 9)
    Permission.DOCUMENTATION_PLANS_VIEW: PermissionMetadata(
        key=Permission.DOCUMENTATION_PLANS_VIEW.value,
        scope='documentation_plans',
        action='view',
        display_name='View Documentation Plans',
        description='View documentation plans'
    ),
    Permission.DOCUMENTATION_PLANS_CREATE: PermissionMetadata(
        key=Permission.DOCUMENTATION_PLANS_CREATE.value,
        scope='documentation_plans',
        action='create',
        display_name='Create Documentation Plans',
        description='Create documentation plans'
    ),
    Permission.DOCUMENTATION_PLANS_EDIT: PermissionMetadata(
        key=Permission.DOCUMENTATION_PLANS_EDIT.value,
        scope='documentation_plans',
        action='edit',
        display_name='Edit Documentation Plans',
        description='Edit documentation plans'
    ),
    Permission.DOCUMENTATION_PLANS_APPROVE: PermissionMetadata(
        key=Permission.DOCUMENTATION_PLANS_APPROVE.value,
        scope='documentation_plans',
        action='approve',
        display_name='Approve Documentation Plans',
        description='Approve documentation plans'
    ),

    # Emergency Plans (Procedure 15)
    Permission.EMERGENCY_PLANS_VIEW: PermissionMetadata(
        key=Permission.EMERGENCY_PLANS_VIEW.value,
        scope='emergency_plans',
        action='view',
        display_name='View Emergency Plans',
        description='View emergency preparedness plans'
    ),
    Permission.EMERGENCY_PLANS_CREATE: PermissionMetadata(
        key=Permission.EMERGENCY_PLANS_CREATE.value,
        scope='emergency_plans',
        action='create',
        display_name='Create Emergency Plans',
        description='Create emergency plans'
    ),
    Permission.EMERGENCY_PLANS_EDIT: PermissionMetadata(
        key=Permission.EMERGENCY_PLANS_EDIT.value,
        scope='emergency_plans',
        action='edit',
        display_name='Edit Emergency Plans',
        description='Edit emergency plans'
    ),
    Permission.EMERGENCY_PLANS_APPROVE: PermissionMetadata(
        key=Permission.EMERGENCY_PLANS_APPROVE.value,
        scope='emergency_plans',
        action='approve',
        display_name='Approve Emergency Plans',
        description='Approve emergency plans'
    ),

    # Incident Reports (Procedure 16)
    Permission.INCIDENTS_VIEW: PermissionMetadata(
        key=Permission.INCIDENTS_VIEW.value,
        scope='incidents',
        action='view',
        display_name='View Incidents',
        description='View damage and loss incident reports'
    ),
    Permission.INCIDENTS_CREATE: PermissionMetadata(
        key=Permission.INCIDENTS_CREATE.value,
        scope='incidents',
        action='create',
        display_name='Create Incidents',
        description='Create incident reports'
    ),
    Permission.INCIDENTS_EDIT: PermissionMetadata(
        key=Permission.INCIDENTS_EDIT.value,
        scope='incidents',
        action='edit',
        display_name='Edit Incidents',
        description='Edit incident reports'
    ),
    Permission.INCIDENTS_INVESTIGATE: PermissionMetadata(
        key=Permission.INCIDENTS_INVESTIGATE.value,
        scope='incidents',
        action='investigate',
        display_name='Investigate Incidents',
        description='Lead incident investigations'
    ),
    Permission.INCIDENTS_RESOLVE: PermissionMetadata(
        key=Permission.INCIDENTS_RESOLVE.value,
        scope='incidents',
        action='resolve',
        display_name='Resolve Incidents',
        description='Resolve and close incident reports'
    ),

    # Collections Reviews (Procedure 20)
    Permission.REVIEWS_VIEW: PermissionMetadata(
        key=Permission.REVIEWS_VIEW.value,
        scope='reviews',
        action='view',
        display_name='View Reviews',
        description='View collections review campaigns'
    ),
    Permission.REVIEWS_CREATE: PermissionMetadata(
        key=Permission.REVIEWS_CREATE.value,
        scope='reviews',
        action='create',
        display_name='Create Reviews',
        description='Create review campaigns'
    ),
    Permission.REVIEWS_EDIT: PermissionMetadata(
        key=Permission.REVIEWS_EDIT.value,
        scope='reviews',
        action='edit',
        display_name='Edit Reviews',
        description='Edit review campaigns and assessments'
    ),
    Permission.REVIEWS_APPROVE: PermissionMetadata(
        key=Permission.REVIEWS_APPROVE.value,
        scope='reviews',
        action='approve',
        display_name='Approve Reviews',
        description='Approve review campaigns'
    ),

    # Audit Campaigns (Procedure 21)
    Permission.AUDITS_VIEW: PermissionMetadata(
        key=Permission.AUDITS_VIEW.value,
        scope='audits',
        action='view',
        display_name='View Audits',
        description='View audit campaigns'
    ),
    Permission.AUDITS_CREATE: PermissionMetadata(
        key=Permission.AUDITS_CREATE.value,
        scope='audits',
        action='create',
        display_name='Create Audits',
        description='Create audit campaigns'
    ),
    Permission.AUDITS_EDIT: PermissionMetadata(
        key=Permission.AUDITS_EDIT.value,
        scope='audits',
        action='edit',
        display_name='Edit Audits',
        description='Edit audit campaigns and results'
    ),
    Permission.AUDITS_APPROVE: PermissionMetadata(
        key=Permission.AUDITS_APPROVE.value,
        scope='audits',
        action='approve',
        display_name='Approve Audits',
        description='Approve audit campaigns'
    ),

    # Barcode & Inventory
    Permission.BARCODES_VIEW: PermissionMetadata(
        key=Permission.BARCODES_VIEW.value,
        scope='barcodes',
        action='view',
        display_name='View Barcodes',
        description='View barcode labels and scan history'
    ),
    Permission.BARCODES_MANAGE: PermissionMetadata(
        key=Permission.BARCODES_MANAGE.value,
        scope='barcodes',
        action='manage',
        display_name='Manage Barcodes',
        description='Create, edit, and void barcode labels'
    ),
    Permission.BARCODES_SCAN: PermissionMetadata(
        key=Permission.BARCODES_SCAN.value,
        scope='barcodes',
        action='scan',
        display_name='Scan Barcodes',
        description='Perform barcode scans and record inventory transactions'
    ),

    # Rights Management (Procedure 18)
    Permission.RIGHTS_VIEW: PermissionMetadata(
        key=Permission.RIGHTS_VIEW.value,
        scope='rights',
        action='view',
        display_name='View Rights',
        description='View object rights records'
    ),
    Permission.RIGHTS_CREATE: PermissionMetadata(
        key=Permission.RIGHTS_CREATE.value,
        scope='rights',
        action='create',
        display_name='Create Rights',
        description='Create rights records'
    ),
    Permission.RIGHTS_EDIT: PermissionMetadata(
        key=Permission.RIGHTS_EDIT.value,
        scope='rights',
        action='edit',
        display_name='Edit Rights',
        description='Edit rights records'
    ),

    # Use Requests (Procedure 10)
    Permission.USE_REQUESTS_VIEW: PermissionMetadata(
        key=Permission.USE_REQUESTS_VIEW.value,
        scope='use_requests',
        action='view',
        display_name='View Use Requests',
        description='View use of collections requests'
    ),
    Permission.USE_REQUESTS_CREATE: PermissionMetadata(
        key=Permission.USE_REQUESTS_CREATE.value,
        scope='use_requests',
        action='create',
        display_name='Create Use Requests',
        description='Create use requests'
    ),
    Permission.USE_REQUESTS_EDIT: PermissionMetadata(
        key=Permission.USE_REQUESTS_EDIT.value,
        scope='use_requests',
        action='edit',
        display_name='Edit Use Requests',
        description='Edit use requests'
    ),
    Permission.USE_REQUESTS_APPROVE: PermissionMetadata(
        key=Permission.USE_REQUESTS_APPROVE.value,
        scope='use_requests',
        action='approve',
        display_name='Approve Use Requests',
        description='Approve use requests'
    ),

    # Events
    Permission.EVENTS_VIEW: PermissionMetadata(
        key=Permission.EVENTS_VIEW.value,
        scope='events',
        action='view',
        display_name='View Events',
        description='View event records and their details'
    ),
    Permission.EVENTS_EDIT: PermissionMetadata(
        key=Permission.EVENTS_EDIT.value,
        scope='events',
        action='edit',
        display_name='Edit Events',
        description='Create, edit, and delete events'
    ),

    # Reports
    Permission.REPORTS_VIEW: PermissionMetadata(
        key=Permission.REPORTS_VIEW.value,
        scope='reports',
        action='view',
        display_name='View Reports',
        description='View reports and their results'
    ),
    Permission.REPORTS_CREATE: PermissionMetadata(
        key=Permission.REPORTS_CREATE.value,
        scope='reports',
        action='create',
        display_name='Create Reports',
        description='Create new reports'
    ),
    Permission.REPORTS_EDIT: PermissionMetadata(
        key=Permission.REPORTS_EDIT.value,
        scope='reports',
        action='edit',
        display_name='Edit Reports',
        description='Edit existing reports'
    ),
    Permission.REPORTS_DELETE: PermissionMetadata(
        key=Permission.REPORTS_DELETE.value,
        scope='reports',
        action='delete',
        display_name='Delete Reports',
        description='Delete reports'
    ),
    Permission.REPORTS_EXECUTE: PermissionMetadata(
        key=Permission.REPORTS_EXECUTE.value,
        scope='reports',
        action='execute',
        display_name='Execute Reports',
        description='Run reports and view results'
    ),
    Permission.REPORTS_SCHEDULE: PermissionMetadata(
        key=Permission.REPORTS_SCHEDULE.value,
        scope='reports',
        action='schedule',
        display_name='Schedule Reports',
        description='Create and manage report schedules'
    ),
    Permission.REPORTS_EXPORT: PermissionMetadata(
        key=Permission.REPORTS_EXPORT.value,
        scope='reports',
        action='export',
        display_name='Export Reports',
        description='Export reports to PDF, Excel, or CSV'
    ),

    # Valuations (Procedure 13)
    Permission.VALUATIONS_VIEW: PermissionMetadata(
        key=Permission.VALUATIONS_VIEW.value,
        scope='valuations',
        action='view',
        display_name='View Valuations',
        description='View valuation records'
    ),
    Permission.VALUATIONS_CREATE: PermissionMetadata(
        key=Permission.VALUATIONS_CREATE.value,
        scope='valuations',
        action='create',
        display_name='Create Valuations',
        description='Create valuation records'
    ),
    Permission.VALUATIONS_EDIT: PermissionMetadata(
        key=Permission.VALUATIONS_EDIT.value,
        scope='valuations',
        action='edit',
        display_name='Edit Valuations',
        description='Edit valuation records'
    ),
    Permission.VALUATIONS_DELETE: PermissionMetadata(
        key=Permission.VALUATIONS_DELETE.value,
        scope='valuations',
        action='delete',
        display_name='Delete Valuations',
        description='Delete valuation records'
    ),

    # Reproduction Requests (Procedure 19)
    Permission.REPRODUCTION_REQUESTS_VIEW: PermissionMetadata(
        key=Permission.REPRODUCTION_REQUESTS_VIEW.value,
        scope='reproduction_requests',
        action='view',
        display_name='View Reproduction Requests',
        description='View reproduction requests'
    ),
    Permission.REPRODUCTION_REQUESTS_CREATE: PermissionMetadata(
        key=Permission.REPRODUCTION_REQUESTS_CREATE.value,
        scope='reproduction_requests',
        action='create',
        display_name='Create Reproduction Requests',
        description='Create reproduction requests'
    ),
    Permission.REPRODUCTION_REQUESTS_EDIT: PermissionMetadata(
        key=Permission.REPRODUCTION_REQUESTS_EDIT.value,
        scope='reproduction_requests',
        action='edit',
        display_name='Edit Reproduction Requests',
        description='Edit reproduction requests'
    ),
    Permission.REPRODUCTION_REQUESTS_DELETE: PermissionMetadata(
        key=Permission.REPRODUCTION_REQUESTS_DELETE.value,
        scope='reproduction_requests',
        action='delete',
        display_name='Delete Reproduction Requests',
        description='Delete reproduction requests'
    ),
    Permission.REPRODUCTION_REQUESTS_APPROVE: PermissionMetadata(
        key=Permission.REPRODUCTION_REQUESTS_APPROVE.value,
        scope='reproduction_requests',
        action='approve',
        display_name='Approve Reproduction Requests',
        description='Approve reproduction requests and clear rights'
    ),

    # Workspaces
    Permission.WORKSPACES_VIEW: PermissionMetadata(
        key=Permission.WORKSPACES_VIEW.value,
        scope='workspaces',
        action='view',
        display_name='View Workspaces',
        description='View workspaces and their contents'
    ),
    Permission.WORKSPACES_CREATE: PermissionMetadata(
        key=Permission.WORKSPACES_CREATE.value,
        scope='workspaces',
        action='create',
        display_name='Create Workspaces',
        description='Create new workspaces'
    ),
    Permission.WORKSPACES_EDIT: PermissionMetadata(
        key=Permission.WORKSPACES_EDIT.value,
        scope='workspaces',
        action='edit',
        display_name='Edit Workspaces',
        description='Edit workspace details and add/remove items'
    ),
    Permission.WORKSPACES_DELETE: PermissionMetadata(
        key=Permission.WORKSPACES_DELETE.value,
        scope='workspaces',
        action='delete',
        display_name='Delete Workspaces',
        description='Delete workspaces'
    ),
    Permission.WORKSPACES_SHARE: PermissionMetadata(
        key=Permission.WORKSPACES_SHARE.value,
        scope='workspaces',
        action='share',
        display_name='Share Workspaces',
        description='Share workspaces with other users'
    ),
    Permission.WORKSPACES_EXECUTE: PermissionMetadata(
        key=Permission.WORKSPACES_EXECUTE.value,
        scope='workspaces',
        action='execute',
        display_name='Execute Workspace Actions',
        description='Execute bulk actions on workspace objects'
    ),

    # Media Workspaces
    Permission.MEDIA_WORKSPACES_VIEW: PermissionMetadata(
        key=Permission.MEDIA_WORKSPACES_VIEW.value,
        scope='media_workspaces',
        action='view',
        display_name='View Media Workspaces',
        description='View media workspaces and their contents'
    ),
    Permission.MEDIA_WORKSPACES_CREATE: PermissionMetadata(
        key=Permission.MEDIA_WORKSPACES_CREATE.value,
        scope='media_workspaces',
        action='create',
        display_name='Create Media Workspaces',
        description='Create new media workspaces'
    ),
    Permission.MEDIA_WORKSPACES_EDIT: PermissionMetadata(
        key=Permission.MEDIA_WORKSPACES_EDIT.value,
        scope='media_workspaces',
        action='edit',
        display_name='Edit Media Workspaces',
        description='Edit media workspace details and add/remove items'
    ),
    Permission.MEDIA_WORKSPACES_DELETE: PermissionMetadata(
        key=Permission.MEDIA_WORKSPACES_DELETE.value,
        scope='media_workspaces',
        action='delete',
        display_name='Delete Media Workspaces',
        description='Delete media workspaces'
    ),
    Permission.MEDIA_WORKSPACES_SHARE: PermissionMetadata(
        key=Permission.MEDIA_WORKSPACES_SHARE.value,
        scope='media_workspaces',
        action='share',
        display_name='Share Media Workspaces',
        description='Share media workspaces with other users'
    ),
    Permission.MEDIA_WORKSPACES_EXECUTE: PermissionMetadata(
        key=Permission.MEDIA_WORKSPACES_EXECUTE.value,
        scope='media_workspaces',
        action='execute',
        display_name='Execute Media Workspace Actions',
        description='Execute bulk actions on media workspace assets'
    ),

    # Media Download Requests
    Permission.DOWNLOAD_REQUESTS_VIEW: PermissionMetadata(
        key=Permission.DOWNLOAD_REQUESTS_VIEW.value,
        scope='download_requests',
        action='view',
        display_name='View Download Requests',
        description='View own download requests (users with review permission can see all)'
    ),
    Permission.DOWNLOAD_REQUESTS_CREATE: PermissionMetadata(
        key=Permission.DOWNLOAD_REQUESTS_CREATE.value,
        scope='download_requests',
        action='create',
        display_name='Create Download Requests',
        description='Create download requests from lightboxes'
    ),
    Permission.DOWNLOAD_REQUESTS_REVIEW: PermissionMetadata(
        key=Permission.DOWNLOAD_REQUESTS_REVIEW.value,
        scope='download_requests',
        action='review',
        display_name='Review Download Requests',
        description='Review and approve/deny download requests'
    ),
    Permission.DOWNLOAD_REQUESTS_FULFILL: PermissionMetadata(
        key=Permission.DOWNLOAD_REQUESTS_FULFILL.value,
        scope='download_requests',
        action='fulfill',
        display_name='Fulfill Download Requests',
        description='Fulfill approved requests by generating download tokens'
    ),

    # Tasks
    Permission.TASKS_VIEW: PermissionMetadata(
        key=Permission.TASKS_VIEW.value,
        scope='tasks',
        action='view',
        display_name='View Tasks',
        description='View tasks'
    ),
    Permission.TASKS_CREATE: PermissionMetadata(
        key=Permission.TASKS_CREATE.value,
        scope='tasks',
        action='create',
        display_name='Create Tasks',
        description='Create new tasks'
    ),
    Permission.TASKS_EDIT: PermissionMetadata(
        key=Permission.TASKS_EDIT.value,
        scope='tasks',
        action='edit',
        display_name='Edit Tasks',
        description='Edit tasks'
    ),
    Permission.TASKS_DELETE: PermissionMetadata(
        key=Permission.TASKS_DELETE.value,
        scope='tasks',
        action='delete',
        display_name='Delete Tasks',
        description='Delete tasks'
    ),

    # Insurance Management (Procedure 14)
    Permission.INSURANCE_VIEW: PermissionMetadata(
        key=Permission.INSURANCE_VIEW.value,
        scope='insurance',
        action='view',
        display_name='View Insurance',
        description='View insurance policies and coverages'
    ),
    Permission.INSURANCE_CREATE: PermissionMetadata(
        key=Permission.INSURANCE_CREATE.value,
        scope='insurance',
        action='create',
        display_name='Create Insurance',
        description='Create insurance policies and coverages'
    ),
    Permission.INSURANCE_EDIT: PermissionMetadata(
        key=Permission.INSURANCE_EDIT.value,
        scope='insurance',
        action='edit',
        display_name='Edit Insurance',
        description='Edit insurance policies and coverages'
    ),
    Permission.INSURANCE_DELETE: PermissionMetadata(
        key=Permission.INSURANCE_DELETE.value,
        scope='insurance',
        action='delete',
        display_name='Delete Insurance',
        description='Delete insurance policies and coverages'
    ),
    Permission.INSURANCE_APPROVE: PermissionMetadata(
        key=Permission.INSURANCE_APPROVE.value,
        scope='insurance',
        action='approve',
        display_name='Approve Insurance',
        description='Approve insurance policies'
    ),
    Permission.INSURANCE_CLAIMS_CREATE: PermissionMetadata(
        key=Permission.INSURANCE_CLAIMS_CREATE.value,
        scope='insurance',
        action='claims_create',
        display_name='Create Claims',
        description='Create insurance claims'
    ),
    Permission.INSURANCE_CLAIMS_MANAGE: PermissionMetadata(
        key=Permission.INSURANCE_CLAIMS_MANAGE.value,
        scope='insurance',
        action='claims_manage',
        display_name='Manage Claims',
        description='Manage and settle insurance claims'
    ),
    Permission.INDEMNITY_VIEW: PermissionMetadata(
        key=Permission.INDEMNITY_VIEW.value,
        scope='indemnity',
        action='view',
        display_name='View Indemnity',
        description='View indemnity arrangements'
    ),
    Permission.INDEMNITY_CREATE: PermissionMetadata(
        key=Permission.INDEMNITY_CREATE.value,
        scope='indemnity',
        action='create',
        display_name='Create Indemnity',
        description='Create indemnity arrangements'
    ),
    Permission.INDEMNITY_EDIT: PermissionMetadata(
        key=Permission.INDEMNITY_EDIT.value,
        scope='indemnity',
        action='edit',
        display_name='Edit Indemnity',
        description='Edit indemnity arrangements'
    ),
    Permission.INDEMNITY_SUBMIT: PermissionMetadata(
        key=Permission.INDEMNITY_SUBMIT.value,
        scope='indemnity',
        action='submit',
        display_name='Submit Indemnity',
        description='Submit indemnity applications'
    ),

    # Departments
    Permission.DEPARTMENTS_VIEW: PermissionMetadata(
        key=Permission.DEPARTMENTS_VIEW.value,
        scope='departments',
        action='view',
        display_name='View Departments',
        description='View departments and their members'
    ),
    Permission.DEPARTMENTS_CREATE: PermissionMetadata(
        key=Permission.DEPARTMENTS_CREATE.value,
        scope='departments',
        action='create',
        display_name='Create Departments',
        description='Create new departments'
    ),
    Permission.DEPARTMENTS_EDIT: PermissionMetadata(
        key=Permission.DEPARTMENTS_EDIT.value,
        scope='departments',
        action='edit',
        display_name='Edit Departments',
        description='Edit department details'
    ),
    Permission.DEPARTMENTS_DELETE: PermissionMetadata(
        key=Permission.DEPARTMENTS_DELETE.value,
        scope='departments',
        action='delete',
        display_name='Delete Departments',
        description='Delete departments'
    ),
    Permission.DEPARTMENTS_MANAGE_MEMBERS: PermissionMetadata(
        key=Permission.DEPARTMENTS_MANAGE_MEMBERS.value,
        scope='departments',
        action='manage_members',
        display_name='Manage Department Members',
        description='Add/remove department members and change roles'
    ),
    Permission.COLLECTIONS_VIEW_ALL_DEPARTMENTS: PermissionMetadata(
        key=Permission.COLLECTIONS_VIEW_ALL_DEPARTMENTS.value,
        scope='collections',
        action='view_all_departments',
        display_name='View All Departments',
        description='Bypass department filtering to see all records across departments'
    ),
    Permission.GUIDE_APPROVE_PLAN: PermissionMetadata(
        key=Permission.GUIDE_APPROVE_PLAN.value,
        scope='guide',
        action='approve_plan',
        display_name='Approve Guide Plans',
        description='Approve a Guide agent plan step before the executor proceeds'
    ),
}


# ==================== Permission Helpers ====================

def get_all_permissions() -> List[str]:
    """Get list of all canonical permission keys."""
    return [p.value for p in Permission]


def get_permissions_by_scope(scope: str) -> List[str]:
    """Get all permissions for a specific scope."""
    return [
        p.value for p, meta in PERMISSION_REGISTRY.items()
        if meta.scope == scope
    ]


def get_permission_metadata(permission: Permission) -> PermissionMetadata:
    """Get metadata for a permission."""
    return PERMISSION_REGISTRY[permission]


def validate_permission(permission_key: str) -> bool:
    """Check if a permission key is valid."""
    return permission_key in [p.value for p in Permission]
