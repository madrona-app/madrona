import { describe, it, expect } from 'vitest';
import {
  products,
  adminItems,
  platformAdminItems,
  buildPath,
  isPathActive,
} from '../../lib/navigationConfig';

describe('navigationConfig', () => {
  describe('products array', () => {
    it('contains all top-level products', () => {
      const ids = products.map(p => p.id);
      expect(ids).toContain('bridge');
      expect(ids).toContain('collections');
      expect(ids).toContain('media');
      expect(ids).toContain('content');
      expect(ids).toContain('guide');
    });

    it('every product has required metadata', () => {
      for (const p of products) {
        expect(typeof p.id).toBe('string');
        expect(typeof p.label).toBe('string');
        expect(p.icon).toBeDefined();
        expect(Array.isArray(p.items)).toBe(true);
        expect(p.items.length).toBeGreaterThan(0);
      }
    });

    it('every nav item with a path includes :orgId placeholder', () => {
      for (const p of products) {
        const walkItems = (items: typeof p.items) => {
          for (const item of items) {
            if (item.path) {
              // External paths like /docs/ are exempt
              if (!item.path.startsWith('/docs')) {
                expect(item.path).toContain(':orgId');
              }
            }
            if (item.children) walkItems(item.children);
          }
        };
        walkItems(p.items);
      }
    });
  });

  describe('adminItems', () => {
    it('includes users and roles', () => {
      const ids = adminItems.map(i => i.id);
      expect(ids).toContain('users');
      expect(ids).toContain('roles');
    });

    it('each admin item requires a permission', () => {
      for (const i of adminItems) {
        expect(typeof i.requiresPermission).toBe('string');
        expect(i.requiresPermission.length).toBeGreaterThan(0);
      }
    });
  });

  describe('platformAdminItems', () => {
    it('are all gated by platform.admin permission', () => {
      for (const i of platformAdminItems) {
        expect(i.requiresPermission).toBe('platform.admin');
      }
    });
  });

  describe('buildPath', () => {
    it('replaces :orgId in a path', () => {
      expect(
        buildPath('/organizations/:orgId/collections', 'abc')
      ).toBe('/organizations/abc/collections');
    });

    it('returns pattern unchanged if orgId is null', () => {
      expect(buildPath('/organizations/:orgId', null)).toBe('/organizations/:orgId');
    });

    it('returns pattern unchanged if orgId is undefined', () => {
      expect(buildPath('/organizations/:orgId', undefined)).toBe('/organizations/:orgId');
    });

    it('returns pattern unchanged if no :orgId token present', () => {
      expect(buildPath('/static/path', 'abc')).toBe('/static/path');
    });
  });

  describe('isPathActive', () => {
    it('returns true for exact match', () => {
      expect(
        isPathActive(
          '/organizations/:orgId/bridge',
          '/organizations/o/bridge',
          'o',
          true
        )
      ).toBe(true);
    });

    it('returns false for exact-required with child path', () => {
      expect(
        isPathActive(
          '/organizations/:orgId/bridge',
          '/organizations/o/bridge/runs',
          'o',
          true
        )
      ).toBe(false);
    });

    it('returns true for prefix match (non-exact)', () => {
      expect(
        isPathActive(
          '/organizations/:orgId/collections',
          '/organizations/o/collections/objects',
          'o',
          false
        )
      ).toBe(true);
    });

    it('does not match /flow on /flow-something', () => {
      expect(
        isPathActive(
          '/organizations/:orgId/flow',
          '/organizations/o/flow-something',
          'o'
        )
      ).toBe(false);
    });

    it('returns true when paths exactly equal', () => {
      expect(
        isPathActive(
          '/organizations/:orgId/media',
          '/organizations/o/media',
          'o'
        )
      ).toBe(true);
    });

    it('handles setup paths with prefix match', () => {
      expect(
        isPathActive(
          '/organizations/:orgId/bridge/setup',
          '/organizations/o/bridge/setup/connectors',
          'o'
        )
      ).toBe(true);
    });

    it('returns false for non-matching paths', () => {
      expect(
        isPathActive(
          '/organizations/:orgId/bridge',
          '/organizations/o/media',
          'o'
        )
      ).toBe(false);
    });
  });
});
