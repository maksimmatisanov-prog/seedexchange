import { describe, expect, it } from 'vitest';
import { isExternalHttpsUrl, normalizeExternalHttpsUrl, sanitizePublicProductUrls } from '../../src/domain/public-url.js';

describe('public external HTTPS URL boundary', () => {
  it('normalizes a public HTTPS URL while preserving its path and query', () => {
    expect(normalizeExternalHttpsUrl('  https://seller.example/product/7?variant=blue  ', true))
      .toBe('https://seller.example/product/7?variant=blue');
  });

  it.each([
    'http://seller.example/product',
    'javascript:alert(1)',
    'https://user:secret@seller.example/product',
    'https://localhost/product',
    'https://127.0.0.1/product',
    'https://intranet/product',
  ])('rejects a non-public or unsafe URL: %s', (value) => {
    expect(isExternalHttpsUrl(value)).toBe(false);
    expect(() => normalizeExternalHttpsUrl(value, true)).toThrow();
  });

  it('allows an empty optional URL but rejects an empty required URL', () => {
    expect(normalizeExternalHttpsUrl('')).toBeNull();
    expect(() => normalizeExternalHttpsUrl('', true)).toThrow('A public HTTPS URL is required.');
  });

  it('fails a public external product closed when its destination is unsafe', () => {
    expect(sanitizePublicProductUrls({
      purchase_mode: 'external',
      external_purchase_url: 'https://localhost/buy',
      image_url: 'https://images.example/seed.webp',
    })).toBeNull();
  });

  it('omits an unsafe image without hiding a product with a safe destination', () => {
    expect(sanitizePublicProductUrls({
      purchase_mode: 'external',
      external_purchase_url: 'https://seller.example/buy',
      image_url: 'data:image/svg+xml,<svg/>',
    })).toEqual({ external_purchase_url: 'https://seller.example/buy', image_url: null });
  });

  it('preserves an application-managed WebP media path', () => {
    const image = `/media/${'a'.repeat(40)}.webp`;
    expect(sanitizePublicProductUrls({ purchase_mode: 'marketplace', external_purchase_url: null, image_url: image }))
      .toEqual({ external_purchase_url: null, image_url: image });
  });
});
