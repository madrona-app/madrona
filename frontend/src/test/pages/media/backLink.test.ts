import { describe, it, expect } from 'vitest';
import { resolveMediaBackLink } from '../../../pages/media/MediaDetailPage/backLink';

describe('resolveMediaBackLink', () => {
  it('defaults to the Media Library when there is no returnTo', () => {
    expect(resolveMediaBackLink(null, 'org-1')).toEqual({
      href: '/organizations/org-1/media',
      label: 'Media Library',
    });
    expect(resolveMediaBackLink(undefined, 'org-1').label).toBe('Media Library');
  });

  it('honors a site-relative returnTo and labels it "Back"', () => {
    const ret = '/organizations/org-1/collections/entries/e1';
    expect(resolveMediaBackLink(ret, 'org-1')).toEqual({ href: ret, label: 'Back' });
  });

  it('preserves the query string on the returnTo path', () => {
    const ret = '/organizations/org-1/collections/entries/e1?tab=media';
    expect(resolveMediaBackLink(ret, 'org-1').href).toBe(ret);
  });

  it('ignores an absolute URL (open-redirect guard)', () => {
    expect(resolveMediaBackLink('https://evil.example.com', 'org-1').label).toBe('Media Library');
  });

  it('ignores a protocol-relative URL', () => {
    expect(resolveMediaBackLink('//evil.example.com', 'org-1')).toEqual({
      href: '/organizations/org-1/media',
      label: 'Media Library',
    });
  });

  it('ignores a non-path value', () => {
    expect(resolveMediaBackLink('javascript:alert(1)', 'org-1').label).toBe('Media Library');
  });
});
