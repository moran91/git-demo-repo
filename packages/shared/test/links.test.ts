import { describe, expect, it } from 'vitest';
import { businessQrPath, businessQrUrl, parseBusinessQrLink, storefrontPath } from '../src/links.js';

describe('business QR links', () => {
  it('builds business and branch paths under /q', () => {
    expect(businessQrPath({ businessId: 'aubsDikSbKp5FjD2xjau' })).toBe('/q/aubsDikSbKp5FjD2xjau');
    expect(businessQrPath({ businessId: 'biz1', branchId: 'br_2-x' })).toBe('/q/biz1/br_2-x');
    expect(businessQrUrl('https://qareeb-dev.web.app/', { businessId: 'biz1' })).toBe('https://qareeb-dev.web.app/q/biz1');
    expect(storefrontPath({ businessId: 'biz1', branchId: 'br1' })).toBe('/b/biz1/br1');
  });
  it('rejects ids that would break the URL', () => {
    expect(() => businessQrPath({ businessId: 'a/b' })).toThrow();
    expect(() => businessQrPath({ businessId: 'ok', branchId: '' })).toThrow();
    expect(() => businessQrPath({ businessId: 'x'.repeat(65) })).toThrow();
  });
  it('round-trips full URLs, bare paths, trailing slashes, query and hash', () => {
    expect(parseBusinessQrLink('https://qareeb-dev.web.app/q/biz1/br1?src=poster#top')).toEqual({ businessId: 'biz1', branchId: 'br1' });
    expect(parseBusinessQrLink('/q/biz1/')).toEqual({ businessId: 'biz1' });
    expect(parseBusinessQrLink(businessQrUrl('https://example.com', { businessId: 'biz1', branchId: 'br1' }))).toEqual({ businessId: 'biz1', branchId: 'br1' });
  });
  it('returns null for non-QR links so callers fall back to the browser', () => {
    expect(parseBusinessQrLink('https://qareeb-dev.web.app/b/biz1')).toBeNull();
    expect(parseBusinessQrLink('/q')).toBeNull();
    expect(parseBusinessQrLink('/q/biz1/br1/extra')).toBeNull();
    expect(parseBusinessQrLink('/q/bad id')).toBeNull();
    expect(parseBusinessQrLink('not a url at all')).toBeNull();
    expect(parseBusinessQrLink('mailto:x@y.z')).toBeNull();
  });
});
