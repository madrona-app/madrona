import { describe, it, expect } from 'vitest';
import {
  buildSearchParamsFromState,
  canonicalSearch,
  describeSearch,
  parseSearchParams,
} from '../../../pages/discover/searchUrl';

const roundTrip = (qs: string) => {
  const params = parseSearchParams(new URLSearchParams(qs));
  const page = params.offset ? params.offset / 24 + 1 : 1;
  return canonicalSearch(params, page);
};

describe('discover search URL (permalink)', () => {
  it('round-trips every facet, sort and page', () => {
    const qs =
      '?q=vase&object_type=painting&classification=Ceramic&creator=Jane&material=clay' +
      '&technique=glaze&subject=sea&style_period=Baroque&creation_place=Lyon' +
      '&date_from=1800&date_to=1900&has_image=true&on_display=true&sort=date_desc&page=3';
    expect(roundTrip(qs)).toBe(qs);
  });

  it('is canonical regardless of parameter and facet order', () => {
    const a = roundTrip('?page=2&object_type=sculpture&q=bowl&object_type=painting&sort=title_asc');
    const b = roundTrip('?sort=title_asc&q=bowl&object_type=painting&object_type=sculpture&page=2');
    expect(a).toBe(b);
    expect(a).toBe('?q=bowl&object_type=painting&object_type=sculpture&sort=title_asc&page=2');
  });

  it('drops defaults and values the API would ignore', () => {
    expect(roundTrip('?sort=relevance&page=1')).toBe('');
    expect(roundTrip('?sort=bogus&page=abc&has_image=false')).toBe('');
    expect(roundTrip('?page=-4&object_type=a&object_type=a')).toBe('?object_type=a');
    expect(roundTrip('?q=%20%20')).toBe('');
  });

  it('builds canonical params from state', () => {
    const sp = buildSearchParamsFromState({ style_period: ['b', 'a'], q: ' x ', has_image: true }, 1);
    expect(sp.toString()).toBe('q=x&style_period=a&style_period=b&has_image=true');
  });

  it('describes a search in words', () => {
    expect(describeSearch({ q: 'vase', object_type: ['painting'], has_image: true })).toBe(
      'Search results for “vase”, Type: painting, With image',
    );
    expect(describeSearch({})).toBe('Search results');
  });
});
