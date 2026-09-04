import { Resolver } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { validateLaunchReadiness, type LaunchReadiness } from './launch.js';

const productionOrigin = 'https://seedexchange.online';
const maximumResponseBytes = 2_000_000;
const resolvers = [{ name: 'cloudflare', server: '1.1.1.1' }, { name: 'google', server: '8.8.8.8' }] as const;

export type PublicCutoverOptions = {
  expectedIpv4: string;
  expectedIpv6: string | null;
  expectedMigration: string;
  organizationPath: string;
  productPath: string;
  mediaPath: string;
};
export type PublicDnsCheck = { resolver: string; server: string; host: string; ipv4: string[]; ipv6: string[] };
export type PublicHttpCheck = { url: string; status: number | null; contentType: string | null; bytes: number; durationMs: number; tlsProtocol: string | null; location: string | null };
type PublicHttpResponse = PublicHttpCheck & { body: string; headers: Record<string, string> };
type PublicCutoverDependencies = {
  resolve?: (server: string, host: string, family: 4 | 6) => Promise<string[]>;
  request?: (url: URL) => Promise<PublicHttpResponse>;
};

function exactPath(value: string, pattern: RegExp, label: string): string[] {
  return pattern.test(value) ? [] : [`${label} must be an exact normalized discovery path.`];
}

function isPublicIpv4(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const [first, second, third] = value.split('.').map(Number);
  return first !== 0 && first !== 10 && first !== 127 && first < 224
    && !(first === 100 && second >= 64 && second <= 127)
    && !(first === 169 && second === 254)
    && !(first === 172 && second >= 16 && second <= 31)
    && !(first === 192 && second === 0 && [0, 2].includes(third))
    && !(first === 192 && second === 88 && third === 99)
    && !(first === 192 && second === 168)
    && !(first === 198 && [18, 19].includes(second))
    && !(first === 198 && second === 51 && third === 100)
    && !(first === 203 && second === 0 && third === 113);
}

function isPublicIpv6(value: string): boolean {
  if (isIP(value) !== 6) return false;
  const normalized = normalizedIp(value);
  return !['::', '::1'].includes(normalized)
    && !/^f[cd]/.test(normalized)
    && !/^fe[89ab]/.test(normalized)
    && !/^ff/.test(normalized)
    && !/^2001:db8:/.test(normalized)
    && !/^::ffff:/.test(normalized);
}

export function validatePublicCutoverOptions(options: PublicCutoverOptions): string[] {
  const errors: string[] = [];
  if (!isPublicIpv4(options.expectedIpv4)) errors.push('expectedIpv4 must be one public IPv4 address.');
  if (options.expectedIpv6 !== null && !isPublicIpv6(options.expectedIpv6)) errors.push('expectedIpv6 must be one public IPv6 address or omitted.');
  if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(options.expectedMigration)) errors.push('expectedMigration must be a migration filename.');
  errors.push(...exactPath(options.organizationPath, /^\/directory\/[a-z0-9-]+$/, 'organizationPath'));
  errors.push(...exactPath(options.productPath, /^\/product\/[a-z0-9-]+$/, 'productPath'));
  errors.push(...exactPath(options.mediaPath, /^\/media\/[a-f0-9]{40}\.webp$/, 'mediaPath'));
  return errors;
}

async function resolveAddress(server: string, host: string, family: 4 | 6): Promise<string[]> {
  const resolver = new Resolver();
  resolver.setServers([server]);
  try { return family === 4 ? await resolver.resolve4(host) : await resolver.resolve6(host); }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (['ENODATA', 'ENOTFOUND'].includes(code)) return [];
    throw error;
  }
}

async function requestPublic(url: URL): Promise<PublicHttpResponse> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { method: 'GET', minVersion: 'TLSv1.2', signal: AbortSignal.timeout(5_000) }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      const tlsProtocol = (response.socket as TLSSocket).getProtocol();
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > maximumResponseBytes) response.destroy(new Error(`Response exceeded ${maximumResponseBytes} bytes.`));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
        resolve({
          url: url.toString(),
          status: response.statusCode ?? null,
          contentType: headers['content-type'] ?? null,
          bytes,
          durationMs: Math.round(performance.now() - started),
          tlsProtocol,
          location: headers.location ?? null,
          body: Buffer.concat(chunks).toString('utf8'),
          headers,
        });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

function normalizedIp(value: string): string {
  if (isIP(value) !== 6) return value;
  const hostname = new URL(`http://[${value}]`).hostname.toLowerCase();
  return hostname.slice(1, -1);
}

export async function verifyPublicCutover(options: PublicCutoverOptions, dependencies: PublicCutoverDependencies = {}): Promise<{ ready: boolean; dns: PublicDnsCheck[]; http: PublicHttpCheck[]; errors: string[] }> {
  const errors = validatePublicCutoverOptions(options);
  if (errors.length) return { ready: false, dns: [], http: [], errors };
  const resolver = dependencies.resolve ?? resolveAddress;
  const requester = dependencies.request ?? requestPublic;
  const dns: PublicDnsCheck[] = [];
  for (const item of resolvers) {
    for (const host of ['seedexchange.online', 'www.seedexchange.online']) {
      try {
        const [ipv4, ipv6] = await Promise.all([resolver(item.server, host, 4), resolver(item.server, host, 6)]);
        dns.push({ resolver: item.name, server: item.server, host, ipv4: [...new Set(ipv4)].sort(), ipv6: [...new Set(ipv6.map(normalizedIp))].sort() });
      } catch { errors.push(`${item.name} DNS lookup failed for ${host}.`); }
    }
  }
  const expectedIpv6 = options.expectedIpv6 === null ? [] : [normalizedIp(options.expectedIpv6)];
  for (const check of dns) {
    if (JSON.stringify(check.ipv4) !== JSON.stringify([options.expectedIpv4])) errors.push(`${check.resolver} did not return only the approved IPv4 address for ${check.host}.`);
    if (JSON.stringify(check.ipv6) !== JSON.stringify(expectedIpv6)) errors.push(`${check.resolver} returned an unexpected IPv6 result for ${check.host}.`);
  }

  const urls = [
    `${productionOrigin}/health`, `${productionOrigin}/ready`, `${productionOrigin}${options.organizationPath}`,
    `${productionOrigin}${options.productPath}`, `${productionOrigin}/sitemap.xml`, `${productionOrigin}${options.mediaPath}`,
    `${productionOrigin}/cart`, 'https://www.seedexchange.online/cutover-probe?source=www',
  ];
  const responses = new Map<string, PublicHttpResponse>();
  for (const value of urls) {
    try { responses.set(value, await requester(new URL(value))); }
    catch { errors.push(`HTTPS request failed for ${new URL(value).pathname}.`); }
  }
  const expectedStatuses = new Map(urls.map((url) => [url, url.endsWith('/cart') ? 404 : url.startsWith('https://www.') ? 308 : 200]));
  for (const [url, response] of responses) {
    if (response.status !== expectedStatuses.get(url)) errors.push(`${new URL(url).pathname} returned HTTP ${String(response.status)} instead of ${String(expectedStatuses.get(url))}.`);
    if (!['TLSv1.2', 'TLSv1.3'].includes(response.tlsProtocol ?? '')) errors.push(`${new URL(url).pathname} did not negotiate TLS 1.2 or 1.3.`);
  }
  const health = responses.get(`${productionOrigin}/health`);
  const ready = responses.get(`${productionOrigin}/ready`);
  try {
    const body = JSON.parse(health?.body ?? '') as LaunchReadiness & { status?: string };
    if (body.status !== 'ok' || body.launchPhase !== 'discovery' || body.commerceEnabled || body.connectEnabled || body.marketplacePaymentsEnabled || body.payoutWorkerEnabled) errors.push('/health did not confirm the discovery-only boundary.');
  } catch { errors.push('/health did not return valid discovery JSON.'); }
  try { errors.push(...validateLaunchReadiness(JSON.parse(ready?.body ?? '') as LaunchReadiness, 'discovery', options.expectedMigration).map((error) => `/ready: ${error}`)); }
  catch { errors.push('/ready did not return valid readiness JSON.'); }
  for (const requestPath of [options.organizationPath, options.productPath]) {
    const response = responses.get(`${productionOrigin}${requestPath}`);
    if (!response?.contentType?.includes('text/html') || !response.body.includes(`<link rel="canonical" href="${productionOrigin}${requestPath}">`)) errors.push(`${requestPath} is missing canonical public HTML.`);
  }
  const product = responses.get(`${productionOrigin}${options.productPath}`);
  if (!product?.body.includes('View at source') || product.body.includes('action="/cart/add"')) errors.push(`${options.productPath} is not an external-only offer.`);
  const sitemap = responses.get(`${productionOrigin}/sitemap.xml`);
  for (const requestPath of [options.organizationPath, options.productPath]) if (!sitemap?.body.includes(`<loc>${productionOrigin}${requestPath}</loc>`)) errors.push(`/sitemap.xml is missing ${requestPath}.`);
  const media = responses.get(`${productionOrigin}${options.mediaPath}`);
  if (!media?.contentType?.includes('image/webp') || media.bytes < 1) errors.push(`${options.mediaPath} is not a non-empty WebP response.`);
  const www = responses.get('https://www.seedexchange.online/cutover-probe?source=www');
  if (www?.location !== `${productionOrigin}/cutover-probe?source=www`) errors.push('www did not redirect to the exact canonical URI.');
  for (const response of responses.values()) {
    if (response.headers['x-content-type-options'] !== 'nosniff') errors.push(`${new URL(response.url).pathname} is missing X-Content-Type-Options.`);
    if (!response.headers['strict-transport-security']?.includes('max-age=')) errors.push(`${new URL(response.url).pathname} is missing HSTS.`);
  }
  return { ready: errors.length === 0, dns, http: [...responses.values()].map(({ body: _body, headers: _headers, ...check }) => check), errors };
}
