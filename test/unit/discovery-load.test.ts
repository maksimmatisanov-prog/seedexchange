import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { validateDiscoveryLoadOptions, verifyDiscoveryLoad } from '../../src/domain/discovery-load.js';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))));

const options = {
  origin: 'http://127.0.0.1:1',
  organizationPath: '/directory/example-bank',
  productPath: '/product/example-seed',
  requests: 22,
  concurrency: 4,
  timeoutMs: 1_000,
  p95LimitMs: 500,
};

describe('bounded discovery load verification', () => {
  it('rejects external origins and unsafe load bounds', () => {
    expect(validateDiscoveryLoadOptions({ ...options, origin: 'https://seedexchange.online', requests: 2, concurrency: 51 }))
      .toEqual(expect.arrayContaining([
        'origin must be a credential-free loopback HTTP(S) origin without a path, query or fragment.',
        'requests must be an integer from 20 to 2000.',
        'concurrency must be an integer from 1 to 50 and no greater than requests.',
      ]));
  });

  it('uses the production Host header and reports bounded route metrics', async () => {
    const hosts = new Set<string>();
    const server = createServer((request, response) => {
      hosts.add(request.headers.host ?? '');
      response.writeHead(200, { 'content-type': request.url?.endsWith('.css') ? 'text/css' : 'text/html' });
      response.end('ok');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');
    const report = await verifyDiscoveryLoad({ ...options, origin: `http://127.0.0.1:${address.port}` });
    expect(report).toMatchObject({ ready: true, requests: 22, concurrency: 4, statusCounts: { '200': 22 }, errors: [] });
    expect(report.routes).toHaveLength(11);
    expect(report.routes.every((route) => route.requests === 2 && route.failures === 0)).toBe(true);
    expect(hosts).toEqual(new Set(['seedexchange.online']));
  });

  it('fails when a representative route returns a non-200 response', async () => {
    const server = createServer((request, response) => {
      response.writeHead(request.url === options.productPath ? 503 : 200);
      response.end('result');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');
    const report = await verifyDiscoveryLoad({ ...options, origin: `http://127.0.0.1:${address.port}` });
    expect(report.ready).toBe(false);
    expect(report.errors).toContain(`${options.productPath} had 2 failed request(s).`);
  });
});
