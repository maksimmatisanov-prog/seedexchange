import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { validateLaunchReadiness, type LaunchReadiness } from './launch.js';

const productionOrigin = 'https://seedexchange.online';
const maximumResponseBytes = 12_000_000;
const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
} as const;

export type DiscoveryRuntimeOptions = {
  origin: string;
  expectedMigration: string;
  organizationPath: string;
  productPath: string;
  mediaPath: string;
};

export type RuntimeCheck = {
  path: string;
  status: number | null;
  contentType: string | null;
  bytes: number;
  durationMs: number;
};

type RuntimeResponse = RuntimeCheck & { body: string; headers: Headers };
type RuntimeFetcher = (input: URL, init: RequestInit) => Promise<Response>;

const fetchWithProductionHost: RuntimeFetcher = async (input, init) => new Promise((resolve, reject) => {
  const requester = input.protocol === 'https:' ? httpsRequest : httpRequest;
  const request = requester(input, { method: 'GET', headers: { Host: 'seedexchange.online' }, signal: init.signal ?? undefined }, (response) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let aborted = false;
    response.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maximumResponseBytes) {
        aborted = true;
        response.destroy(new Error(`Response exceeded ${maximumResponseBytes} bytes.`));
        return;
      }
      chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => {
      if (aborted) return;
      if (!response.statusCode) return reject(new Error('Response did not contain an HTTP status.'));
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
        else if (value !== undefined) responseHeaders.set(name, value);
      }
      resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: responseHeaders }));
    });
  });
  request.on('error', reject);
  request.end();
});

function validatePath(value: string, prefix: string, label: string): string[] {
  if (!value.startsWith(prefix) || value === prefix || value.startsWith('//') || value.includes('?') || value.includes('#')) {
    return [`${label} must be a query-free local path below ${prefix}.`];
  }
  try {
    const parsed = new URL(value, productionOrigin);
    if (parsed.origin !== productionOrigin || parsed.pathname !== value) return [`${label} is not a normalized local path.`];
  } catch {
    return [`${label} is not a valid local path.`];
  }
  return [];
}

export function validateDiscoveryRuntimeOptions(options: DiscoveryRuntimeOptions): string[] {
  const errors: string[] = [];
  try {
    const origin = new URL(options.origin);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
      errors.push('origin must be an HTTP(S) origin without credentials, path, query or fragment.');
    }
  } catch {
    errors.push('origin must be a valid HTTP(S) origin.');
  }
  if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(options.expectedMigration)) errors.push('expectedMigration must be a migration filename.');
  errors.push(...validatePath(options.organizationPath, '/directory/', 'organizationPath'));
  errors.push(...validatePath(options.productPath, '/product/', 'productPath'));
  errors.push(...validatePath(options.mediaPath, '/media/', 'mediaPath'));
  return errors;
}

async function readBoundedBody(response: Response): Promise<{ body: string; bytes: number }> {
  if (!response.body) return { body: '', bytes: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumResponseBytes) throw new Error(`Response exceeded ${maximumResponseBytes} bytes.`);
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(body), bytes };
}

function requireSecurityHeaders(response: RuntimeResponse, errors: string[]) {
  for (const [name, expected] of Object.entries(securityHeaders)) {
    if (response.headers.get(name) !== expected) errors.push(`${response.path} has an invalid ${name} header.`);
  }
  if (!response.headers.get('content-security-policy')?.includes("default-src 'self'")) {
    errors.push(`${response.path} is missing the expected Content-Security-Policy.`);
  }
}

function requireContentType(response: RuntimeResponse, expected: string, errors: string[]) {
  if (!response.contentType?.toLowerCase().includes(expected)) errors.push(`${response.path} did not return ${expected}.`);
}

export async function verifyDiscoveryRuntime(
  options: DiscoveryRuntimeOptions,
  fetcher: RuntimeFetcher = fetchWithProductionHost,
): Promise<{ ready: boolean; origin: string; expectedMigration: string; checks: RuntimeCheck[]; errors: string[] }> {
  const errors = validateDiscoveryRuntimeOptions(options);
  if (errors.length) return { ready: false, origin: options.origin, expectedMigration: options.expectedMigration, checks: [], errors };

  const paths = [
    '/health',
    '/ready',
    '/',
    '/directory',
    options.organizationPath,
    '/marketplace',
    options.productPath,
    '/exchange',
    '/robots.txt',
    '/sitemap.xml',
    '/assets/app.css',
    options.mediaPath,
    '/__seedexchange_discovery_runtime_probe__',
  ];
  const responses = new Map<string, RuntimeResponse>();

  for (const requestPath of paths) {
    const started = performance.now();
    try {
      const response = await fetcher(new URL(requestPath, options.origin), {
        method: 'GET',
        headers: { host: 'seedexchange.online' },
        redirect: 'manual',
        signal: AbortSignal.timeout(5_000),
      });
      const received = await readBoundedBody(response);
      responses.set(requestPath, {
        path: requestPath,
        status: response.status,
        contentType: response.headers.get('content-type'),
        bytes: received.bytes,
        durationMs: Math.round(performance.now() - started),
        body: received.body,
        headers: response.headers,
      });
    } catch (error) {
      errors.push(`${requestPath} request failed: ${error instanceof Error ? error.message : String(error)}`);
      responses.set(requestPath, { path: requestPath, status: null, contentType: null, bytes: 0, durationMs: Math.round(performance.now() - started), body: '', headers: new Headers() });
    }
  }

  for (const [requestPath, response] of responses) {
    const expectedStatus = requestPath === '/__seedexchange_discovery_runtime_probe__' ? 404 : 200;
    if (response.status !== expectedStatus) errors.push(`${requestPath} returned HTTP ${String(response.status)}; expected ${expectedStatus}.`);
    if (response.status !== null) requireSecurityHeaders(response, errors);
  }

  const health = responses.get('/health')!;
  const ready = responses.get('/ready')!;
  requireContentType(health, 'application/json', errors);
  requireContentType(ready, 'application/json', errors);
  try {
    const body = JSON.parse(health.body) as LaunchReadiness & { status?: string };
    if (body.status !== 'ok') errors.push('/health did not report status ok.');
    if (body.launchPhase !== 'discovery' || body.commerceEnabled || body.connectEnabled || body.marketplacePaymentsEnabled || body.payoutWorkerEnabled) {
      errors.push('/health did not confirm the discovery-only capability boundary.');
    }
  } catch {
    errors.push('/health did not return valid JSON.');
  }
  try {
    errors.push(...validateLaunchReadiness(JSON.parse(ready.body) as LaunchReadiness, 'discovery', options.expectedMigration).map((error) => `/ready: ${error}`));
  } catch {
    errors.push('/ready did not return valid JSON.');
  }

  const htmlPaths = ['/', '/directory', options.organizationPath, '/marketplace', options.productPath, '/exchange'];
  for (const requestPath of htmlPaths) {
    const response = responses.get(requestPath)!;
    requireContentType(response, 'text/html', errors);
    const canonical = `${productionOrigin}${requestPath}`;
    if (!response.body.includes(`<link rel="canonical" href="${canonical}">`)) errors.push(`${requestPath} is missing canonical ${canonical}.`);
  }
  if (!responses.get('/marketplace')!.body.includes('Seedexchange does not take payment in this phase.')) {
    errors.push('/marketplace is missing the discovery payment notice.');
  }
  if (!responses.get(options.productPath)!.body.includes('View at source') || responses.get(options.productPath)!.body.includes('action="/cart/add"')) {
    errors.push(`${options.productPath} did not expose an external-only purchase action.`);
  }

  const robots = responses.get('/robots.txt')!;
  requireContentType(robots, 'text/plain', errors);
  if (!robots.body.includes(`Sitemap: ${productionOrigin}/sitemap.xml`)) errors.push('/robots.txt does not advertise the production sitemap.');
  const sitemap = responses.get('/sitemap.xml')!;
  requireContentType(sitemap, 'application/xml', errors);
  for (const dynamicPath of [options.organizationPath, options.productPath]) {
    if (!sitemap.body.includes(`<loc>${productionOrigin}${dynamicPath}</loc>`)) errors.push(`/sitemap.xml is missing ${dynamicPath}.`);
  }
  requireContentType(responses.get('/assets/app.css')!, 'text/css', errors);
  requireContentType(responses.get(options.mediaPath)!, 'image/webp', errors);
  if (responses.get(options.mediaPath)!.bytes === 0) errors.push(`${options.mediaPath} returned an empty media response.`);

  return {
    ready: errors.length === 0,
    origin: options.origin,
    expectedMigration: options.expectedMigration,
    checks: [...responses.values()].map(({ body: _body, headers: _headers, ...check }) => check),
    errors,
  };
}
