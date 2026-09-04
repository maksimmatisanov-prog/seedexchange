import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { validateDiscoveryRuntimeOptions, verifyDiscoveryRuntime, type DiscoveryRuntimeOptions } from '../../src/domain/discovery-runtime.js';

const execFileAsync = promisify(execFile);

const options: DiscoveryRuntimeOptions = {
  origin: 'http://127.0.0.1:4200',
  expectedMigration: '003_discovery_migration_scope.sql',
  organizationPath: '/directory/example-seed-bank',
  productPath: '/product/example-seed',
  mediaPath: '/media/0123456789abcdef0123456789abcdef01234567.webp',
};

const headers = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'self'",
};

function response(path: string): Response {
  const canonical = `<link rel="canonical" href="https://seedexchange.online${path}">`;
  if (path === '/health') return Response.json({ status: 'ok', launchPhase: 'discovery', commerceEnabled: false, connectEnabled: false, marketplacePaymentsEnabled: false, payoutWorkerEnabled: false }, { headers });
  if (path === '/ready') return Response.json({ status: 'ready', database: 'ok', migration: options.expectedMigration, launchPhase: 'discovery', commerceEnabled: false, connectEnabled: false, marketplacePaymentsEnabled: false, payoutWorkerEnabled: false }, { headers });
  if (path === '/robots.txt') return new Response('Sitemap: https://seedexchange.online/sitemap.xml', { headers: { ...headers, 'content-type': 'text/plain' } });
  if (path === '/sitemap.xml') return new Response(`<urlset><loc>https://seedexchange.online${options.organizationPath}</loc><loc>https://seedexchange.online${options.productPath}</loc></urlset>`, { headers: { ...headers, 'content-type': 'application/xml' } });
  if (path === '/assets/app.css') return new Response('body{}', { headers: { ...headers, 'content-type': 'text/css' } });
  if (path === options.mediaPath) return new Response(new Uint8Array([1, 2, 3]), { headers: { ...headers, 'content-type': 'image/webp' } });
  if (path === '/__seedexchange_discovery_runtime_probe__') return new Response('<main>missing</main>', { status: 404, headers: { ...headers, 'content-type': 'text/html' } });
  const notice = path === '/marketplace' ? 'Seedexchange does not take payment in this phase.' : '';
  const external = path === options.productPath ? 'View at source' : '';
  return new Response(`${canonical}<main>${notice}${external}</main>`, { headers: { ...headers, 'content-type': 'text/html' } });
}

describe('discovery production runtime verification', () => {
  it('accepts an exact read-only production smoke result', async () => {
    const requested: string[] = [];
    const report = await verifyDiscoveryRuntime(options, async (input, init) => {
      const url = new URL(input.toString());
      requested.push(url.pathname);
      expect(init?.method).toBe('GET');
      expect(new Headers(init?.headers).get('host')).toBe('seedexchange.online');
      expect(init?.redirect).toBe('manual');
      return response(url.pathname);
    });
    expect(report).toMatchObject({ ready: true, expectedMigration: options.expectedMigration, errors: [] });
    expect(report.checks).toHaveLength(13);
    expect(requested).toContain(options.mediaPath);
  });

  it('rejects enabled commerce, stale migration and missing discovery evidence', async () => {
    const report = await verifyDiscoveryRuntime(options, async (input) => {
      const path = new URL(input.toString()).pathname;
      if (path === '/health') return Response.json({ status: 'ok', launchPhase: 'commerce', commerceEnabled: true, connectEnabled: true, marketplacePaymentsEnabled: true, payoutWorkerEnabled: false }, { headers });
      if (path === '/ready') return Response.json({ status: 'ready', database: 'ok', migration: '002_legacy_compatibility.sql', launchPhase: 'commerce', commerceEnabled: true, connectEnabled: true, marketplacePaymentsEnabled: true, payoutWorkerEnabled: false }, { headers });
      if (path === '/marketplace') return new Response('<link rel="canonical" href="https://seedexchange.online/marketplace"><main></main>', { headers: { ...headers, 'content-type': 'text/html' } });
      if (path === options.productPath) return new Response(`<link rel="canonical" href="https://seedexchange.online${path}"><form action="/cart/add"></form>`, { headers: { ...headers, 'content-type': 'text/html' } });
      if (path === '/sitemap.xml') return new Response('<urlset></urlset>', { headers: { ...headers, 'content-type': 'application/xml' } });
      return response(path);
    });
    expect(report.ready).toBe(false);
    expect(report.errors).toEqual(expect.arrayContaining([
      '/health did not confirm the discovery-only capability boundary.',
      '/ready: Expected launch phase discovery, received commerce.',
      '/ready: Expected migration 003_discovery_migration_scope.sql, received 002_legacy_compatibility.sql.',
      '/marketplace is missing the discovery payment notice.',
      `${options.productPath} did not expose an external-only purchase action.`,
      `/sitemap.xml is missing ${options.organizationPath}.`,
    ]));
  });

  it('rejects unsafe origins and non-representative paths before making requests', async () => {
    expect(validateDiscoveryRuntimeOptions({ ...options, origin: 'https://user:secret@example.test/path', productPath: '//evil.test/product' }))
      .toEqual(expect.arrayContaining([
        'origin must be a credential-free loopback HTTP(S) origin without a path, query or fragment.',
        'productPath must be an exact normalized discovery path.',
      ]));
    let requests = 0;
    const report = await verifyDiscoveryRuntime({ ...options, mediaPath: '/assets/not-media.webp' }, async () => {
      requests += 1;
      return new Response();
    });
    expect(report.ready).toBe(false);
    expect(requests).toBe(0);
  });

  it('runs the compiled operational interface against an HTTP origin', async () => {
    const receivedHosts: string[] = [];
    const server = createServer(async (request, outgoing) => {
      receivedHosts.push(request.headers.host ?? '');
      const mocked = response(request.url ?? '/');
      outgoing.writeHead(mocked.status, Object.fromEntries(mocked.headers));
      outgoing.end(Buffer.from(await mocked.arrayBuffer()));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as AddressInfo).port;
    try {
      const execution = await execFileAsync(process.execPath, [
        path.resolve('node_modules/tsx/dist/cli.mjs'),
        path.resolve('scripts/verify-discovery-runtime.ts'),
        `--origin=http://127.0.0.1:${port}`,
        `--migration=${options.expectedMigration}`,
        `--organization=${options.organizationPath}`,
        `--product=${options.productPath}`,
        `--media=${options.mediaPath}`,
      ], { cwd: process.cwd(), encoding: 'utf8' });
      expect(JSON.parse(execution.stdout)).toMatchObject({ ready: true, errors: [] });
      expect(receivedHosts).toHaveLength(13);
      expect(new Set(receivedHosts)).toEqual(new Set(['seedexchange.online']));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
