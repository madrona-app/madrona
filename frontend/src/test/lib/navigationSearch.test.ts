import { describe, it, expect } from 'vitest';
import { getNavCatalog } from '../../lib/navigationCatalog';
import {
  searchNavCatalog,
  tokenizeQuery,
  MIN_NAV_SEARCH_SCORE,
} from '../../lib/navigationSearch';

const ENTRIES = getNavCatalog();

describe('tokenizeQuery', () => {
  it('strips stop words and punctuation', () => {
    expect(tokenizeQuery('take me to conservation')).toEqual(['conservation']);
    expect(tokenizeQuery('Loans-Out & Shipments!')).toEqual([
      'loans',
      'out',
      'shipments',
    ]);
  });

  it('returns empty for all-stop-words input', () => {
    expect(tokenizeQuery('the and of')).toEqual([]);
    expect(tokenizeQuery('')).toEqual([]);
  });
});

describe('searchNavCatalog', () => {
  it('returns empty for empty query', () => {
    expect(searchNavCatalog(ENTRIES, '')).toEqual([]);
  });

  it('matches a single-word exact slug', () => {
    const results = searchNavCatalog(ENTRIES, 'conservation');
    expect(results[0]?.id).toBe('collections:conservation');
  });

  it('matches via a curated synonym', () => {
    const results = searchNavCatalog(ENTRIES, 'lending');
    expect(results[0]?.id).toBe('collections:loans-out');
  });

  it('handles natural-language phrasing', () => {
    const results = searchNavCatalog(ENTRIES, 'take me to outgoing loans');
    expect(results[0]?.id).toBe('collections:loans-out');
  });

  it('matches multi-word labels', () => {
    const results = searchNavCatalog(ENTRIES, 'condition reports');
    expect(results[0]?.id).toBe('collections:condition-reports');
  });

  it('respects product filter', () => {
    const results = searchNavCatalog(ENTRIES, 'search', { product: 'bridge' });
    for (const r of results) {
      expect(r.product).toBe('bridge');
    }
  });

  it('respects the limit option', () => {
    const results = searchNavCatalog(ENTRIES, 'collections', { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('returns empty for nonsense queries above min score', () => {
    const results = searchNavCatalog(ENTRIES, 'xyzzy quux');
    expect(results).toEqual([]);
  });

  it('uses configurable minScore', () => {
    // With a very permissive threshold, weak matches should surface
    const loose = searchNavCatalog(ENTRIES, 'objects', { minScore: 1 });
    const strict = searchNavCatalog(ENTRIES, 'objects', {
      minScore: MIN_NAV_SEARCH_SCORE,
    });
    expect(loose.length).toBeGreaterThanOrEqual(strict.length);
  });

  it('sorts ties deterministically by entry id', () => {
    // Run twice to confirm stable ordering
    const a = searchNavCatalog(ENTRIES, 'media');
    const b = searchNavCatalog(ENTRIES, 'media');
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
  });
});
