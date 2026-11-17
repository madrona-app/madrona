import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from 'vitest';

import {
  RECORD_HISTORY_UI,
  HISTORY_BASE_PERMISSION,
  historyPermissionsFor,
} from '../../../components/audit/recordHistoryRegistry';
import { CHILD_ENTITY_LABELS } from '../../../components/audit/childRowSentences';

/**
 * Every audited record type that had no staff history screen (the API alone
 * could read it) now has one. For each type this checks:
 * - it is in the registry with the API's own view permission;
 * - the registered file really mounts the History entry point for that type.
 * It also checks that every child-row type the backend records on a parent's
 * history has a readable name on the parent's panel.
 */

const SRC = join(__dirname, '../../..');
const BACKEND = join(SRC, '../../backend/app');

/** The types with no panel before this change (audit coverage inventory). */
const TYPES_WITHOUT_PANEL = [
  'location',
  'venue',
  'label_template',
  'frame_style',
  'mount_config',
  'info_request_template',
  'checklist_template',
  'lookup_value',
  'vocabulary_term',
  'other_number_type',
  'critical_response',
  'nagpra_action',
  'compliance_action',
  'task',
  'department',
  'record_flag_definition',
  'completeness_rule',
  'custom_field_definition',
  'preservation_policy',
  'metadata_template',
  'redirect',
  'content_category',
  'discover_config',
  'publish_schedule',
  'portal_member',
  'media_rights',
  'media_consent',
  'watermark_template',
  'media_tag_definition',
  'media_folder',
];

/** ENTITY_TYPE_PERMISSIONS in the history router, resolved to permission strings. */
function backendHistoryPermissions(): Record<string, string> {
  const router = readFileSync(join(BACKEND, 'fastapi_app/routers/collections_discover.py'), 'utf8');
  const enums = readFileSync(join(BACKEND, 'permissions/enums.py'), 'utf8');
  const values: Record<string, string> = {};
  for (const m of enums.matchAll(/^\s+([A-Z0-9_]+)\s*=\s*"([^"]+)"/gm)) values[m[1]] = m[2];
  const block = router.slice(router.indexOf('ENTITY_TYPE_PERMISSIONS'));
  const body = block.slice(0, block.indexOf('\n}\n'));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^\s+"([a-z_]+)":\s*Permission\.([A-Z0-9_]+)/gm)) out[m[1]] = values[m[2]];
  return out;
}

const apiPermissions = backendHistoryPermissions();

describe('record history registry', () => {
  it('reads the backend permission map', () => {
    expect(Object.keys(apiPermissions).length).toBeGreaterThan(50);
    expect(apiPermissions.location).toBe('locations.view');
  });

  it('lists exactly the types that had no panel', () => {
    expect(Object.keys(RECORD_HISTORY_UI).sort()).toEqual([...TYPES_WITHOUT_PANEL].sort());
  });

  describe.each(TYPES_WITHOUT_PANEL)('%s', (entityType) => {
    const entry = RECORD_HISTORY_UI[entityType];

    it('has a registry entry', () => {
      expect(entry).toBeDefined();
      expect(entry.label).toBeTruthy();
      expect(entry.where).toBeTruthy();
    });

    it('is offered only with the permission the history API requires', () => {
      expect(apiPermissions[entityType]).toBeDefined();
      expect(entry.permission).toBe(apiPermissions[entityType]);
      // The endpoint also requires data.view for every type.
      expect(historyPermissionsFor(entityType)).toContain(HISTORY_BASE_PERMISSION);
      expect(historyPermissionsFor(entityType)).toContain(apiPermissions[entityType]);
    });

    it('is mounted in the registered file', () => {
      const source = readFileSync(join(SRC, entry.source), 'utf8');
      const component = 'RecordHistoryButton';
      expect(source).toMatch(new RegExp(`import \\{[^}]*\\b${component}\\b`));
      expect(source).toMatch(new RegExp(`<${component}\\b[^>]*entityType="${entityType}"`));
    });
  });
});

describe('child rows on the parent panel', () => {
  const audit = readFileSync(join(BACKEND, 'services/entity_audit.py'), 'utf8');
  const childTypes = [...new Set([...audit.matchAll(/"child_type":\s*"([a-z_]+)"/g)].map((m) => m[1]))].sort();

  it('finds the child-row types the backend records', () => {
    expect(childTypes.length).toBeGreaterThan(50);
  });

  it.each(childTypes)('%s has a readable name', (childType) => {
    expect(CHILD_ENTITY_LABELS[childType]).toBeTruthy();
  });
});
