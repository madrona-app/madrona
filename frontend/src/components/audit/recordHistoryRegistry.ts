/**
 * Where staff read the change history of each audited record type that has no
 * workspace page of its own.
 *
 * The history API (GET /organizations/{org}/entity-history/{type}/{id})
 * requires `data.view` plus the permission listed here for the type
 * (ENTITY_TYPE_PERMISSIONS in backend/app/fastapi_app/routers/collections_discover.py).
 * The UI uses the same pair, so the History control is only offered to staff
 * the API will answer.
 *
 * None of these types has a workspace page, so each uses one pattern: a
 * RecordHistoryButton ("History") on the row (or detail header) where the
 * record is managed, opening RecordAuditHistory in an accessible dialog.
 *
 * `source` is the file (relative to frontend/src) that mounts the entry point;
 * a test checks each file really mounts it for that type.
 */

export const HISTORY_BASE_PERMISSION = 'data.view';

export interface RecordHistoryEntry {
  /** Name of the record type as staff see it ("Label template"). */
  label: string;
  /** The type's view permission, as the history API checks it. */
  permission: string;
  /** File (relative to frontend/src) that mounts the History entry point. */
  source: string;
  /** Where staff find it, in words (for docs and the test name). */
  where: string;
}

export const RECORD_HISTORY_UI: Record<string, RecordHistoryEntry> = {
  location: {
    label: 'Location',
    permission: 'locations.view',
    source: 'pages/collections/CollectionLocationsPage.tsx',
    where: 'Collections > Settings > Locations, the selected location',
  },
  venue: {
    label: 'Venue',
    permission: 'venues.view',
    source: 'pages/exhibit/VenuesPage.tsx',
    where: 'Exhibitions > Venues, each venue',
  },
  label_template: {
    label: 'Label template',
    permission: 'labels.view',
    source: 'pages/exhibit/LabelTemplatesPage.tsx',
    where: 'Exhibitions > Settings > Label templates, each template',
  },
  frame_style: {
    label: 'Frame style',
    permission: 'exhibit.view',
    source: 'pages/exhibit/ExhibitSettingsPage.tsx',
    where: 'Exhibitions > Settings > Frame styles, each style',
  },
  mount_config: {
    label: 'Mount configuration',
    permission: 'exhibit.view',
    source: 'pages/exhibit/ExhibitSettingsPage.tsx',
    where: 'Exhibitions > Settings > Mounts, each mount',
  },
  info_request_template: {
    label: 'Information request template',
    permission: 'exhibit.view',
    source: 'components/exhibit/ExhibitionInfoTab.tsx',
    where: 'Exhibition > Information requests > Generate from template dialog, each template',
  },
  checklist_template: {
    label: 'Checklist template',
    permission: 'exhibit.view',
    source: 'pages/exhibit/ChecklistTemplatesPage.tsx',
    where: 'Exhibitions > Settings > Checklist templates, each template',
  },
  lookup_value: {
    label: 'Lookup value',
    permission: 'lookups.view',
    source: 'pages/collections/LookupValuesPage.tsx',
    where: 'Collections > Settings > Lookup values, each organization value',
  },
  vocabulary_term: {
    label: 'Vocabulary term',
    permission: 'lookups.view',
    source: 'pages/collections/VocabularyExplorerPage.tsx',
    where: 'Collections > Vocabularies, each imported term',
  },
  other_number_type: {
    label: 'Other number type',
    permission: 'lookups.view',
    source: 'components/collections/OtherNumberTypesManager.tsx',
    where: 'Collections > Settings > Other number types, each type',
  },
  critical_response: {
    label: 'Critical response',
    permission: 'critical_responses.view',
    source: 'components/collections/CriticalResponsesList.tsx',
    where: 'Object workspace > Citations & References > Critical responses, each response',
  },
  nagpra_action: {
    label: 'NAGPRA action',
    permission: 'nagpra.view',
    source: 'components/collections/NagpraManager.tsx',
    where: 'Object workspace > NAGPRA, the object\'s NAGPRA action',
  },
  compliance_action: {
    label: 'Action',
    permission: 'data.view',
    source: 'components/collections/ComplianceActionsHistoryList.tsx',
    where: 'Audit campaign (Findings), incident report (Resolution) and documentation plan (Actions) workspaces, each action',
  },
  task: {
    label: 'Task',
    permission: 'tasks.view',
    source: 'pages/work/GlobalWorkPage.tsx',
    where: 'Work > Tasks, each task',
  },
  department: {
    label: 'Department',
    permission: 'departments.view',
    source: 'pages/admin/DepartmentManagementPage.tsx',
    where: 'Admin > Departments, each department',
  },
  record_flag_definition: {
    label: 'Record flag',
    permission: 'collections.view',
    source: 'pages/collections/RecordRulesSettingsPage.tsx',
    where: 'Collections > Settings > Record rules, each flag',
  },
  completeness_rule: {
    label: 'Completeness rule',
    permission: 'collections.view',
    source: 'pages/collections/RecordRulesSettingsPage.tsx',
    where: 'Collections > Settings > Record rules, each rule',
  },
  custom_field_definition: {
    label: 'Custom field',
    permission: 'collections.view',
    source: 'pages/collections/CustomFieldsSettingsPage.tsx',
    where: 'Collections > Settings > Custom fields, each field',
  },
  preservation_policy: {
    label: 'Preservation policy',
    permission: 'media.view',
    source: 'pages/media/MediaPreservationDashboardPage.tsx',
    where: 'Media > Preservation, each policy',
  },
  metadata_template: {
    label: 'Metadata template',
    permission: 'media.view',
    source: 'pages/media/MetadataTemplatesPage.tsx',
    where: 'Media > Metadata templates, each template',
  },
  redirect: {
    label: 'Redirect',
    permission: 'content.view',
    source: 'pages/content/ContentSiteSettingsPage.tsx',
    where: 'Content > Site settings > Redirects, each redirect',
  },
  content_category: {
    label: 'Category',
    permission: 'content.view',
    source: 'pages/content/CategoriesPage.tsx',
    where: 'Content > Categories, each category',
  },
  discover_config: {
    label: 'Portal settings',
    permission: 'discover.publish',
    source: 'pages/collections/DiscoverSettingsPage.tsx',
    where: 'Collections > Settings > Discover, page header',
  },
  publish_schedule: {
    label: 'Publish schedule',
    permission: 'discover.publish',
    source: 'pages/collections/DiscoverSettingsPage.tsx',
    where: 'Collections > Settings > Discover > Publish schedules, each schedule',
  },
  portal_member: {
    label: 'Portal member',
    permission: 'org.manage_settings',
    source: 'pages/collections/discover/PortalMembersSection.tsx',
    where: 'Collections > Settings > Discover > Portal members, each member',
  },
  media_rights: {
    label: 'Media rights',
    permission: 'media.view',
    source: 'components/dam/MediaRightsManager.tsx',
    where: 'Media record > Rights, each rights statement',
  },
  media_consent: {
    label: 'Consent record',
    permission: 'media.view',
    source: 'components/dam/ConsentRecordsList.tsx',
    where: 'Media record > Consent, each consent record',
  },
  watermark_template: {
    label: 'Watermark template',
    permission: 'media.view',
    source: 'pages/media/WatermarkTemplatesPage.tsx',
    where: 'Media > Watermark templates, each template',
  },
  media_tag_definition: {
    label: 'Tag definition',
    permission: 'media.view',
    source: 'components/dam/TagDefinitionsManager.tsx',
    where: 'Media > Tag settings, each tag definition',
  },
  media_folder: {
    label: 'Folder',
    permission: 'media.view',
    source: 'components/dam/FolderTree.tsx',
    where: 'Media library folder list, the selected folder',
  },
};

/** Permissions the history API requires for a type (both must be held). */
export function historyPermissionsFor(entityType: string): string[] {
  const entry = RECORD_HISTORY_UI[entityType];
  if (!entry) return [HISTORY_BASE_PERMISSION];
  return entry.permission === HISTORY_BASE_PERMISSION
    ? [HISTORY_BASE_PERMISSION]
    : [HISTORY_BASE_PERMISSION, entry.permission];
}
