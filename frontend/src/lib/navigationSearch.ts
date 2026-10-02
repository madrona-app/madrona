/**
 * Natural-language fuzzy search over the flat nav catalog.
 *
 * Mirrors the scoring logic in `backend/app/services/agent_tools/nav_tools.py`
 * so the command palette and the backend `navigate_to` tool rank destinations
 * consistently. Hand-rolled on purpose — no fuzzy-search dependency — because
 * the catalog is small (~80 entries), the inputs are short, and we want
 * deterministic weights that match the backend.
 */

import type { NavEntry } from './navigationCatalog';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'for',
  'from', 'get', 'go', 'have', 'how', 'i', 'if', 'in', 'into', 'is',
  'it', 'me', 'my', 'of', 'on', 'or', 'page', 'screen', 'show', 'take',
  'that', 'the', 'this', 'to', 'want', 'was', 'we', 'what', 'where',
  'which', 'with', 'you', 'your',
]);

/** Below this score, the palette doesn't surface a match. */
export const MIN_NAV_SEARCH_SCORE = 20;

/** Case-insensitive, punctuation-split, stop-word stripped. */
export function tokenizeQuery(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP_WORDS.has(t));
}

function scoreEntry(entry: NavEntry, tokens: string[], phrase: string): number {
  if (tokens.length === 0) return 0;

  // 1. Exact nav-id tail match — user typed the canonical slug.
  const idTail = entry.id.split(':').slice(-1)[0].replace(/-/g, ' ');
  if (phrase === idTail) return 1000;

  // 2. Phrase equals a curated synonym/keyword.
  if (phrase && entry.keywords.includes(phrase)) return 900;

  const labelLower = entry.label.toLowerCase();
  const labelTokens = new Set(labelLower.split(/[^a-z0-9]+/).filter(Boolean));

  // Flatten keywords into a token bag (full phrases + individual words).
  const keywordBag = new Set<string>();
  for (const kw of entry.keywords) {
    keywordBag.add(kw);
    for (const part of kw.split(/\s+/)) keywordBag.add(part);
  }

  const breadcrumbLower = entry.breadcrumb.map((c) => c.toLowerCase());

  let matchedLabels = 0;
  let matchedKeywords = 0;
  let matchedBreadcrumb = 0;
  for (const t of tokens) {
    if (labelTokens.has(t)) matchedLabels++;
    if (keywordBag.has(t)) matchedKeywords++;
    if (breadcrumbLower.some((c) => c.includes(t))) matchedBreadcrumb++;
  }

  let score =
    matchedLabels * 25 + matchedKeywords * 15 + matchedBreadcrumb * 5;

  if (phrase) {
    if (labelLower.includes(phrase)) score += 50;
    if (entry.keywords.some((kw) => kw.includes(phrase))) score += 20;
  }

  // Coverage bonus when every query token matches via label or keyword.
  if (matchedLabels + matchedKeywords >= tokens.length) {
    score += 20;
  }

  return score;
}

export interface NavSearchOptions {
  /** Optional product filter, e.g. `"collections"`. */
  product?: string;
  /** Cap on returned results. */
  limit?: number;
  /** Override the minimum score threshold. */
  minScore?: number;
}

/**
 * Rank entries against a query. Empty query returns an empty array — the
 * caller is responsible for surfacing "recent" or "browse all" affordances
 * when there's nothing to search.
 */
export function searchNavCatalog(
  entries: NavEntry[],
  query: string,
  options: NavSearchOptions = {},
): NavEntry[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const phrase = tokens.join(' ');
  const minScore = options.minScore ?? MIN_NAV_SEARCH_SCORE;
  const limit = options.limit ?? 8;

  const pool = options.product
    ? entries.filter((e) => e.product === options.product)
    : entries;

  const scored: Array<{ entry: NavEntry; score: number }> = [];
  for (const entry of pool) {
    const score = scoreEntry(entry, tokens, phrase);
    if (score >= minScore) scored.push({ entry, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.id.localeCompare(b.entry.id);
  });

  return scored.slice(0, limit).map((s) => s.entry);
}
