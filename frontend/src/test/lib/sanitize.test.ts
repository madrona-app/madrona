import { describe, it, expect } from 'vitest';
import { sanitizeHighlight, sanitizeRichHtml } from '../../lib/sanitize';

describe('sanitize', () => {
  describe('sanitizeHighlight', () => {
    it('allows <mark> tags', () => {
      const html = '<mark>highlighted</mark>';
      expect(sanitizeHighlight(html)).toBe('<mark>highlighted</mark>');
    });

    it('allows <em> tags', () => {
      const html = '<em>emphasis</em>';
      expect(sanitizeHighlight(html)).toBe('<em>emphasis</em>');
    });

    it('strips script tags', () => {
      const html = '<mark>ok</mark><script>alert(1)</script>';
      const result = sanitizeHighlight(html);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('alert(1)');
      expect(result).toContain('<mark>ok</mark>');
    });

    it('strips arbitrary tags (e.g. <a>, <img>, <div>)', () => {
      expect(sanitizeHighlight('<a href="x">link</a>')).not.toContain('<a');
      expect(sanitizeHighlight('<img src="x">')).not.toContain('<img');
      expect(sanitizeHighlight('<div>content</div>')).not.toContain('<div');
    });

    it('strips event handlers', () => {
      const html = '<mark onclick="alert(1)">text</mark>';
      const result = sanitizeHighlight(html);
      expect(result).not.toContain('onclick');
    });

    it('returns empty string for empty input', () => {
      expect(sanitizeHighlight('')).toBe('');
    });

    it('returns plain text when no tags', () => {
      expect(sanitizeHighlight('hello world')).toBe('hello world');
    });
  });

  describe('sanitizeRichHtml', () => {
    it('allows standard prose tags', () => {
      const html = '<p>paragraph</p>';
      expect(sanitizeRichHtml(html)).toContain('<p>paragraph</p>');
    });

    it('allows <strong>, <em>, <a>', () => {
      expect(sanitizeRichHtml('<strong>bold</strong>')).toContain('<strong>');
      expect(sanitizeRichHtml('<em>italic</em>')).toContain('<em>');
    });

    it('strips <script> tags', () => {
      const html = '<p>safe</p><script>alert(1)</script>';
      const result = sanitizeRichHtml(html);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('alert(1)');
    });

    it('strips <iframe>', () => {
      const result = sanitizeRichHtml('<iframe src="x"></iframe>');
      expect(result).not.toContain('<iframe');
    });

    it('strips inline event handlers', () => {
      const html = '<p onclick="evil()">text</p>';
      const result = sanitizeRichHtml(html);
      expect(result).not.toContain('onclick');
    });

    it('handles empty input', () => {
      expect(sanitizeRichHtml('')).toBe('');
    });
  });
});
