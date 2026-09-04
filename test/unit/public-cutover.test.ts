import { describe, expect, it } from 'vitest';
import { validatePublicCutoverOptions, verifyPublicCutover, type PublicCutoverOptions } from '../../src/domain/public-cutover.js';

const options: PublicCutoverOptions = {
  expectedIpv4: '187.52.119.107', expectedIpv6: null, expectedMigration: '003_discovery_migration_scope.sql',
  organizationPath: '/directory/example-bank', productPath: '/product/example-seed', mediaPath: `/media/${'a'.repeat(40)}.webp`,
};
const security = { 'x-content-type-options': 'nosniff', 'strict-transport-security': 'max-age=31536000; includeSubDomains' };

function response(url: URL) {
  const base = { url: url.toString(), status: 200, contentType: 'text/html', bytes: 10, durationMs: 12, tlsProtocol: 'TLSv1.3', location: null, headers: security, body: '' };
  if (url.pathname === '/health') return { ...base, contentType: 'application/json', body: JSON.stringify({ status: 'ok', launchPhase: 'discovery', commerceEnabled: false, connectEnabled: false, marketplacePaymentsEnabled: false, payoutWorkerEnabled: false }) };
  if (url.pathname === '/ready') return { ...base, contentType: 'application/json', body: JSON.stringify({ status: 'ready', database: 'ok', migration: options.expectedMigration, launchPhase: 'discovery', commerceEnabled: false, connectEnabled: false, marketplacePaymentsEnabled: false, payoutWorkerEnabled: false }) };
  if (url.pathname === options.organizationPath) return { ...base, body: `<link rel="canonical" href="https://seedexchange.online${options.organizationPath}">` };
  if (url.pathname === options.productPath) return { ...base, body: `<link rel="canonical" href="https://seedexchange.online${options.productPath}">View at source` };
  if (url.pathname === '/sitemap.xml') return { ...base, contentType: 'application/xml', body: `<loc>https://seedexchange.online${options.organizationPath}</loc><loc>https://seedexchange.online${options.productPath}</loc>` };
  if (url.pathname === options.mediaPath) return { ...base, contentType: 'image/webp', bytes: 100 };
  if (url.pathname === '/cart') return { ...base, status: 404 };
  return { ...base, status: 308, location: 'https://seedexchange.online/cutover-probe?source=www' };
}

describe('public discovery cutover evidence', () => {
  it('rejects invalid addresses and non-representative paths before I/O', async () => {
    expect(validatePublicCutoverOptions({ ...options, expectedIpv4: 'not-ip', expectedIpv6: '::1', productPath: '/product/../unsafe' })).toEqual(expect.arrayContaining([
      'expectedIpv4 must be one public IPv4 address.', 'expectedIpv6 must be one public IPv6 address or omitted.', 'productPath must be an exact normalized discovery path.',
    ]));
    let requests = 0;
    const report = await verifyPublicCutover({ ...options, mediaPath: '/media/not-a-key.webp' }, { request: async (url) => { requests++; return response(url); } });
    expect(report.ready).toBe(false);
    expect(requests).toBe(0);
  });

  it('accepts exact two-resolver DNS and public HTTPS discovery evidence', async () => {
    const report = await verifyPublicCutover(options, {
      resolve: async (_server, _host, family) => family === 4 ? [options.expectedIpv4] : [],
      request: async (url) => response(url),
    });
    expect(report).toMatchObject({ ready: true, errors: [] });
    expect(report.dns).toHaveLength(4);
    expect(report.http).toHaveLength(8);
    expect(report.http.every((item) => !('body' in item) && !('headers' in item))).toBe(true);
  });

  it('rejects DNS drift, enabled commerce, weak TLS and a wrong www redirect', async () => {
    const report = await verifyPublicCutover(options, {
      resolve: async (_server, host, family) => family === 4 ? [host.startsWith('www') ? '203.0.113.20' : options.expectedIpv4] : ['2001:db8::1'],
      request: async (url) => {
        const current = response(url);
        if (url.pathname === '/health') current.body = JSON.stringify({ status: 'ok', launchPhase: 'commerce', commerceEnabled: true, connectEnabled: true, marketplacePaymentsEnabled: true, payoutWorkerEnabled: true });
        return { ...current, tlsProtocol: 'TLSv1.1', location: url.hostname === 'www.seedexchange.online' ? 'https://wrong.example/' : current.location };
      },
    });
    expect(report.ready).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([
      'cloudflare did not return only the approved IPv4 address for www.seedexchange.online.',
      'google returned an unexpected IPv6 result for seedexchange.online.',
      '/health did not confirm the discovery-only boundary.',
      'www did not redirect to the exact canonical URI.',
    ]));
    expect(report.errors.some((error) => error.includes('TLS 1.2 or 1.3'))).toBe(true);
  });
});
