/**
 * HTML sanitization utilities.
 *
 * Wraps DOMPurify for consistent XSS protection across the app.
 */

import DOMPurify from 'dompurify';

/**
 * Sanitize search highlight HTML, allowing only the tags OpenSearch
 * uses for highlighting (<mark>, <em>).
 */
export function sanitizeHighlight(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['mark', 'em'] });
}

/**
 * Sanitize rich HTML content (e.g. TipTap output, CMS blocks).
 * Allows standard prose tags but strips scripts, event handlers, and
 * dangerous elements like <iframe>, <object>, <embed>.
 */
export function sanitizeRichHtml(html: string): string {
  return DOMPurify.sanitize(html);
}
