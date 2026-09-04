import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const productionHost = 'seedexchange.online';
const maximumResponseBytes = 2_000_000;

export type DiscoveryLoadOptions = {
  origin: string;
  organizationPath: string;
  productPath: string;
  requests: number;
  concurrency: number;
  timeoutMs: number;
  p95LimitMs: number;
};

type LoadSample = { path: string; status: number | null; bytes: number; durationMs: number; error: string | null };
export type DiscoveryLoadRoute = { path: string; requests: number; failures: number; p95Ms: number; maxMs: number; bytes: number };
export type DiscoveryLoadReport = {
  ready: boolean;
  origin: string;
  requests: number;
  concurrency: number;
  timeoutMs: number;
  p95LimitMs: number;
  durationMs: number;
  requestsPerSecond: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  statusCounts: Record<string, number>;
  routes: DiscoveryLoadRoute[];
  errors: string[];
};

function validatePath(value: string, pattern: RegExp, label: string): string[] {
  return pattern.test(value) ? [] : [`${label} must be a normalized lowercase slug path.`];
}

export function validateDiscoveryLoadOptions(options: DiscoveryLoadOptions): string[] {
  const errors: string[] = [];
  try {
    const origin = new URL(options.origin);
    if (!['http:', 'https:'].includes(origin.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
      errors.push('origin must be a credential-free loopback HTTP(S) origin without a path, query or fragment.');
    }
  } catch { errors.push('origin must be a valid loopback HTTP(S) origin.'); }
  errors.push(...validatePath(options.organizationPath, /^\/directory\/[a-z0-9-]+$/, 'organizationPath'));
  errors.push(...validatePath(options.productPath, /^\/product\/[a-z0-9-]+$/, 'productPath'));
  if (!Number.isSafeInteger(options.requests) || options.requests < 20 || options.requests > 2_000) errors.push('requests must be an integer from 20 to 2000.');
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 50 || options.concurrency > options.requests) errors.push('concurrency must be an integer from 1 to 50 and no greater than requests.');
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 250 || options.timeoutMs > 10_000) errors.push('timeoutMs must be an integer from 250 to 10000.');
  if (!Number.isSafeInteger(options.p95LimitMs) || options.p95LimitMs < 50 || options.p95LimitMs > 5_000) errors.push('p95LimitMs must be an integer from 50 to 5000.');
  return errors;
}

function percentile(values: number[], ratio: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)] ?? 0;
}

async function requestPath(origin: string, requestPath: string, timeoutMs: number): Promise<LoadSample> {
  const started = performance.now();
  try {
    return await new Promise<LoadSample>((resolve, reject) => {
      const url = new URL(requestPath, origin);
      const requester = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const request = requester(url, { method: 'GET', headers: { Host: productionHost }, signal: AbortSignal.timeout(timeoutMs) }, (response) => {
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes > maximumResponseBytes) response.destroy(new Error(`Response exceeded ${maximumResponseBytes} bytes.`));
        });
        response.on('error', reject);
        response.on('end', () => resolve({ path: requestPath, status: response.statusCode ?? null, bytes, durationMs: Math.round(performance.now() - started), error: null }));
      });
      request.on('error', reject);
      request.end();
    });
  } catch (error) {
    return { path: requestPath, status: null, bytes: 0, durationMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) };
  }
}

export async function verifyDiscoveryLoad(options: DiscoveryLoadOptions): Promise<DiscoveryLoadReport> {
  const errors = validateDiscoveryLoadOptions(options);
  const empty = { ready: false, origin: options.origin, requests: options.requests, concurrency: options.concurrency, timeoutMs: options.timeoutMs, p95LimitMs: options.p95LimitMs, durationMs: 0, requestsPerSecond: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, statusCounts: {}, routes: [], errors };
  if (errors.length) return empty;

  const paths = ['/health', '/ready', '/', '/directory', options.organizationPath, '/marketplace', options.productPath, '/exchange', '/about', '/assets/app.css', '/sitemap.xml'];
  const samples: LoadSample[] = new Array(options.requests);
  let next = 0;
  const started = performance.now();
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= options.requests) return;
      samples[index] = await requestPath(options.origin, paths[index % paths.length], options.timeoutMs);
    }
  };
  await Promise.all(Array.from({ length: options.concurrency }, worker));
  const durationMs = Math.max(1, Math.round(performance.now() - started));
  const durations = samples.map((sample) => sample.durationMs);
  const p95Ms = percentile(durations, 0.95);
  const statusCounts: Record<string, number> = {};
  for (const sample of samples) statusCounts[String(sample.status)] = (statusCounts[String(sample.status)] ?? 0) + 1;
  const routes = paths.map((requestPath) => {
    const routeSamples = samples.filter((sample) => sample.path === requestPath);
    const routeDurations = routeSamples.map((sample) => sample.durationMs);
    return {
      path: requestPath,
      requests: routeSamples.length,
      failures: routeSamples.filter((sample) => sample.status !== 200 || sample.error !== null).length,
      p95Ms: percentile(routeDurations, 0.95),
      maxMs: Math.max(...routeDurations),
      bytes: routeSamples.reduce((sum, sample) => sum + sample.bytes, 0),
    };
  });
  for (const route of routes.filter((route) => route.failures > 0)) errors.push(`${route.path} had ${route.failures} failed request(s).`);
  if (p95Ms > options.p95LimitMs) errors.push(`Overall p95 ${p95Ms} ms exceeded the ${options.p95LimitMs} ms limit.`);
  return {
    ready: errors.length === 0,
    origin: options.origin,
    requests: options.requests,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    p95LimitMs: options.p95LimitMs,
    durationMs,
    requestsPerSecond: Number((options.requests * 1000 / durationMs).toFixed(2)),
    p50Ms: percentile(durations, 0.5),
    p95Ms,
    p99Ms: percentile(durations, 0.99),
    maxMs: Math.max(...durations),
    statusCounts,
    routes,
    errors,
  };
}
