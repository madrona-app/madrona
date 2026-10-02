/**
 * Validate a post-login redirect target. Accepts only same-origin URLs;
 * rejects everything else (other origins, protocol-relative `//evil.com`,
 * `javascript:`, malformed). Returns the path to navigate to, or the
 * supplied fallback when the input is not safe.
 *
 * Use this any time a redirect target comes from a source the user can
 * influence — query param, navigation state from an unauthenticated
 * route, postMessage payload, etc.
 *
 * Audit ref: madrona-security-review-2026-04-30.md L6.
 */
export function safeRedirect(target: unknown, fallback = '/'): string {
  if (typeof target !== 'string' || target.length === 0) {
    return fallback;
  }

  // Protocol-relative ("//evil.com/x") would resolve against the current
  // origin in `new URL(...)` — but the resulting `.origin` is the attacker's.
  // Reject before parsing.
  if (target.startsWith('//')) {
    return fallback;
  }

  try {
    const parsed = new URL(target, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return fallback;
    }
    // Reject non-http(s) schemes that somehow survive URL parsing.
    if (parsed.protocol !== window.location.protocol) {
      return fallback;
    }
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return fallback;
  }
}
