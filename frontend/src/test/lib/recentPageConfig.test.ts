import { describe, it, expect } from 'vitest';
import {
  ROUTE_RECORD_CONFIG,
  MEDIA_ROUTE_RECORD_CONFIG,
  parseRecordRoute,
} from '../../lib/recentPageConfig';

describe('recentPageConfig', () => {
  describe('ROUTE_RECORD_CONFIG', () => {
    it('contains expected top-level routes', () => {
      expect(ROUTE_RECORD_CONFIG.objects).toBeDefined();
      expect(ROUTE_RECORD_CONFIG.entries).toBeDefined();
      expect(ROUTE_RECORD_CONFIG['loans-in']).toBeDefined();
      expect(ROUTE_RECORD_CONFIG['loans-out']).toBeDefined();
    });

    it('each config has required fields', () => {
      for (const [key, cfg] of Object.entries(ROUTE_RECORD_CONFIG)) {
        expect(typeof cfg.type).toBe('string');
        expect(typeof cfg.queryKeyPrefix).toBe('string');
        expect(typeof cfg.labelField).toBe('string');
        expect(typeof cfg.displayName).toBe('string');
        // sanity: id should contain a reasonable key prefix
        expect(cfg.queryKeyPrefix.length).toBeGreaterThan(0);
        expect(key.length).toBeGreaterThan(0);
      }
    });

    it('objects config uses object_number as label', () => {
      expect(ROUTE_RECORD_CONFIG.objects.labelField).toBe('object_number');
      expect(ROUTE_RECORD_CONFIG.objects.type).toBe('object');
    });

    it('includes two-level insurance routes', () => {
      expect(ROUTE_RECORD_CONFIG['insurance/policies']).toBeDefined();
      expect(ROUTE_RECORD_CONFIG['insurance/indemnities']).toBeDefined();
    });
  });

  describe('MEDIA_ROUTE_RECORD_CONFIG', () => {
    it('includes _root config for bare media routes', () => {
      expect(MEDIA_ROUTE_RECORD_CONFIG._root).toBeDefined();
      expect(MEDIA_ROUTE_RECORD_CONFIG._root.type).toBe('media_asset');
    });

    it('includes media collections', () => {
      expect(MEDIA_ROUTE_RECORD_CONFIG.collections).toBeDefined();
    });
  });

  describe('parseRecordRoute', () => {
    it('returns null for non-organization routes', () => {
      expect(parseRecordRoute('/foo/bar')).toBeNull();
      expect(parseRecordRoute('/')).toBeNull();
      expect(parseRecordRoute('')).toBeNull();
    });

    it('returns null for routes missing recordId', () => {
      expect(parseRecordRoute('/organizations/o1/collections/entries')).toBeNull();
    });

    it('parses simple collections/entries/:id route', () => {
      const parsed = parseRecordRoute('/organizations/org-1/collections/entries/entry-abc');
      expect(parsed).not.toBeNull();
      expect(parsed?.orgId).toBe('org-1');
      expect(parsed?.recordId).toBe('entry-abc');
      expect(parsed?.config.type).toBe('object_entry');
    });

    it('parses collections/objects/:id route', () => {
      const parsed = parseRecordRoute('/organizations/org/collections/objects/obj-1');
      expect(parsed?.config.labelField).toBe('object_number');
      expect(parsed?.recordId).toBe('obj-1');
    });

    it('parses two-level insurance/policies route', () => {
      const parsed = parseRecordRoute(
        '/organizations/org/collections/insurance/policies/pol-1'
      );
      expect(parsed).not.toBeNull();
      expect(parsed?.recordId).toBe('pol-1');
      expect(parsed?.config.type).toBe('insurance-policy');
    });

    it('returns null for /create paths', () => {
      expect(
        parseRecordRoute('/organizations/org/collections/entries/create')
      ).toBeNull();
    });

    it('strips /edit suffix and returns underlying recordId', () => {
      const parsed = parseRecordRoute(
        '/organizations/org/collections/entries/entry-1/edit'
      );
      expect(parsed?.recordId).toBe('entry-1');
    });

    it('returns null for unknown segments', () => {
      expect(
        parseRecordRoute('/organizations/org/collections/nonexistent/abc')
      ).toBeNull();
    });

    it('returns null for non-collections/exhibit app segments', () => {
      expect(
        parseRecordRoute('/organizations/org/admin/entries/abc')
      ).toBeNull();
    });

    it('parses media root asset route /media/:mediaId', () => {
      const parsed = parseRecordRoute('/organizations/org/media/asset-123');
      expect(parsed?.orgId).toBe('org');
      expect(parsed?.recordId).toBe('asset-123');
      expect(parsed?.config.type).toBe('media_asset');
    });

    it('returns null for media root /media/create', () => {
      expect(parseRecordRoute('/organizations/org/media/create')).toBeNull();
    });

    it('returns null for media "work" and "workspaces" non-record pages', () => {
      expect(parseRecordRoute('/organizations/org/media/work')).toBeNull();
      expect(parseRecordRoute('/organizations/org/media/workspaces')).toBeNull();
    });

    it('parses media sub-route /media/:mediaId/annotations as root asset', () => {
      const parsed = parseRecordRoute(
        '/organizations/org/media/asset-1/annotations'
      );
      expect(parsed?.config.type).toBe('media_asset');
      expect(parsed?.recordId).toBe('asset-1');
    });

    it('parses media sub-category /media/collections/:id', () => {
      const parsed = parseRecordRoute(
        '/organizations/org/media/collections/col-1'
      );
      expect(parsed?.config.type).toBe('media_collection');
      expect(parsed?.recordId).toBe('col-1');
    });
  });
});
