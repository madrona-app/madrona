import { describe, it, expect } from 'vitest';
import { getNavCatalog } from '../../lib/navigationCatalog';

describe('navigationCatalog', () => {
  it('produces a non-empty, stable catalog', () => {
    const entries = getNavCatalog();
    expect(entries.length).toBeGreaterThan(20);
    // IDs are unique
    const ids = new Set(entries.map((e) => e.id));
    expect(ids.size).toBe(entries.length);
    // Every entry has a path pattern
    for (const entry of entries) {
      expect(entry.pathPattern).toBeTruthy();
      expect(entry.breadcrumb.length).toBeGreaterThan(0);
      expect(entry.keywords.length).toBeGreaterThan(0);
    }
  });

  it('covers expected destinations', () => {
    const entries = getNavCatalog();
    const ids = new Set(entries.map((e) => e.id));
    // Spot check a handful of critical destinations
    expect(ids).toContain('collections:objects');
    expect(ids).toContain('collections:conservation');
    expect(ids).toContain('collections:loans-out');
    expect(ids).toContain('collections:constituents');
    expect(ids).toContain('media:library');
    expect(ids).toContain('admin:users');
  });

  it('keywords include curated synonyms', () => {
    const entries = getNavCatalog();
    const conservation = entries.find((e) => e.id === 'collections:conservation');
    expect(conservation?.keywords).toContain('treatment');
    const loansOut = entries.find((e) => e.id === 'collections:loans-out');
    expect(loansOut?.keywords).toContain('lending');
  });

  // This snapshot IS the source-of-truth JSON the backend loads. It is written
  // into the backend package rather than a repo-root shared/ directory so that
  // it ships inside the backend image — the build context is ./backend, and
  // anything outside it simply is not there at runtime.
  //
  // When `navigationConfig.ts` changes, run `pnpm run build:nav-catalog` to
  // regenerate it; CI runs the test in verify mode, so drift fails the build.
  it('matches the catalog committed in the backend package', async () => {
    const entries = getNavCatalog();
    const payload = {
      // Version bumps signal backend-incompatible schema changes.
      schema_version: 1,
      entries,
    };
    const serialized = JSON.stringify(payload, null, 2) + '\n';
    await expect(serialized).toMatchFileSnapshot(
      '../../../../backend/app/services/agent_tools/nav_catalog.json',
    );
  });
});
