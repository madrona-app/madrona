/**
 * Discover search state <-> URL.
 *
 * The search results URL is the permalink to a set of results, so it has to
 * be complete (query, every facet, sort, page) and canonical: the same search
 * always serialises to the same string, whatever order the visitor clicked
 * facets in. Parameters are written in a fixed order, repeated facet values
 * are sorted, defaults (relevance sort, page 1) are omitted, and values the
 * API would ignore (unknown sort, bad page) are dropped on the way in.
 */
import type { DiscoverSearchParams } from '../../types/discover';

export const DISCOVER_PAGE_SIZE = 24;

const SORTS = ['relevance', 'title_asc', 'title_desc', 'date_asc', 'date_desc', 'newest'] as const;

type ArrayFacet = 'object_type' | 'classification' | 'style_period';
type StringFacet = 'creator' | 'material' | 'technique' | 'subject' | 'creation_place' | 'date_from' | 'date_to';
type BoolFacet = 'has_image' | 'on_display';

/** Canonical parameter order. `q` first, then facets, then sort, then page. */
const ORDER: Array<
  | { key: 'q' | StringFacet; kind: 'string' }
  | { key: ArrayFacet; kind: 'array' }
  | { key: BoolFacet; kind: 'bool' }
> = [
  { key: 'q', kind: 'string' },
  { key: 'object_type', kind: 'array' },
  { key: 'classification', kind: 'array' },
  { key: 'creator', kind: 'string' },
  { key: 'material', kind: 'string' },
  { key: 'technique', kind: 'string' },
  { key: 'subject', kind: 'string' },
  { key: 'style_period', kind: 'array' },
  { key: 'creation_place', kind: 'string' },
  { key: 'date_from', kind: 'string' },
  { key: 'date_to', kind: 'string' },
  { key: 'has_image', kind: 'bool' },
  { key: 'on_display', kind: 'bool' },
];

/** Parse a results URL into API search params (limit/offset/facets included). */
export function parseSearchParams(sp: URLSearchParams): DiscoverSearchParams {
  const params: DiscoverSearchParams = {};
  for (const field of ORDER) {
    if (field.kind === 'array') {
      const values = Array.from(new Set(sp.getAll(field.key).map((v) => v.trim()).filter(Boolean))).sort();
      if (values.length) params[field.key] = values;
    } else if (field.kind === 'bool') {
      if (sp.get(field.key) === 'true') params[field.key] = true;
    } else {
      const value = sp.get(field.key)?.trim();
      if (value) params[field.key] = value;
    }
  }

  const sort = sp.get('sort');
  if (sort && (SORTS as readonly string[]).includes(sort) && sort !== 'relevance') {
    params.sort = sort as DiscoverSearchParams['sort'];
  }

  const page = parsePage(sp.get('page'));
  if (page > 1) params.offset = (page - 1) * DISCOVER_PAGE_SIZE;

  params.limit = DISCOVER_PAGE_SIZE;
  params.include_facets = true;
  return params;
}

function parsePage(raw: string | null): number {
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const n = parseInt(raw, 10);
  return n >= 1 ? n : 1;
}

/** Serialise search state to its canonical URL search params. */
export function buildSearchParamsFromState(params: DiscoverSearchParams, page = 1): URLSearchParams {
  const sp = new URLSearchParams();
  for (const field of ORDER) {
    const value = params[field.key];
    if (field.kind === 'array') {
      const values = Array.from(new Set((value as string[] | undefined) ?? [])).filter(Boolean).sort();
      values.forEach((v) => sp.append(field.key, v));
    } else if (field.kind === 'bool') {
      if (value === true) sp.set(field.key, 'true');
    } else if (typeof value === 'string' && value.trim()) {
      sp.set(field.key, value.trim());
    }
  }
  if (params.sort && params.sort !== 'relevance') sp.set('sort', params.sort);
  if (page > 1) sp.set('page', String(page));
  return sp;
}

/** Canonical `?query` string for a results URL ('' when nothing is set). */
export function canonicalSearch(params: DiscoverSearchParams, page = 1): string {
  const s = buildSearchParamsFromState(params, page).toString();
  return s ? `?${s}` : '';
}

/** Human-readable facet labels, in canonical order — e.g. "Type: painting". */
export function describeFacets(params: DiscoverSearchParams): string[] {
  const out: string[] = [];
  params.object_type?.forEach((v) => out.push(`Type: ${v}`));
  params.classification?.forEach((v) => out.push(`Classification: ${v}`));
  if (params.creator) out.push(`Maker: ${params.creator}`);
  if (params.material) out.push(`Material: ${params.material}`);
  if (params.technique) out.push(`Technique: ${params.technique}`);
  if (params.subject) out.push(`Subject: ${params.subject}`);
  params.style_period?.forEach((v) => out.push(`Period: ${v}`));
  if (params.creation_place) out.push(`Place: ${params.creation_place}`);
  if (params.date_from) out.push(`From: ${params.date_from}`);
  if (params.date_to) out.push(`To: ${params.date_to}`);
  if (params.has_image) out.push('With image');
  if (params.on_display) out.push('On display');
  return out;
}

/** True when a query or any facet narrows the results. */
export function hasSearchCriteria(params: DiscoverSearchParams): boolean {
  return !!params.q || describeFacets(params).length > 0;
}

/**
 * One-line description of a search, for breadcrumbs:
 *   Search results for “vase”, Type: painting, With image
 */
export function describeSearch(params: DiscoverSearchParams): string {
  const facets = describeFacets(params);
  const head = params.q ? `Search results for “${params.q}”` : 'Search results';
  return facets.length ? `${head}, ${facets.join(', ')}` : head;
}
