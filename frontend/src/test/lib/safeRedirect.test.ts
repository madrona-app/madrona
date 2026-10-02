import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { safeRedirect } from '../../lib/safeRedirect';

describe('safeRedirect', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: new URL('https://madrona.example.org/sign-in'),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  describe('accepts same-origin paths', () => {
    it('returns a relative path unchanged', () => {
      expect(safeRedirect('/admin')).toBe('/admin');
    });

    it('preserves query string and fragment', () => {
      expect(safeRedirect('/admin/users?org=acme#row-3')).toBe(
        '/admin/users?org=acme#row-3',
      );
    });

    it('accepts a same-origin absolute URL and returns just the path', () => {
      expect(safeRedirect('https://madrona.example.org/admin')).toBe('/admin');
    });
  });

  describe('rejects open-redirect attempts', () => {
    it.each([
      ['protocol-relative', '//evil.example.com/x'],
      ['cross-origin absolute URL', 'https://evil.example.com/x'],
      ['javascript: scheme', 'javascript:alert(1)'],
      ['data: scheme', 'data:text/html,<script>alert(1)</script>'],
      ['scheme on different origin via // trickery', '//attacker.com/'],
    ])('rejects %s', (_label, target) => {
      expect(safeRedirect(target)).toBe('/');
    });

    it('rejects an http URL when the page is loaded over https (scheme downgrade)', () => {
      expect(safeRedirect('http://madrona.example.org/admin')).toBe('/');
    });
  });

  describe('rejects malformed input', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['number', 42],
      ['empty string', ''],
    ])('rejects %s', (_label, target) => {
      expect(safeRedirect(target)).toBe('/');
    });
  });

  describe('honors custom fallback', () => {
    it('returns custom fallback for invalid input', () => {
      expect(safeRedirect('https://evil.example.com', '/dashboard')).toBe(
        '/dashboard',
      );
    });
  });
});
