import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyDiscoveryLoad } from '../src/domain/discovery-load.js';

const argumentsByName = new Map<string, string>();
for (const argument of process.argv.slice(2)) {
  const match = /^--([a-z0-9-]+)=(.+)$/.exec(argument);
  if (!match || argumentsByName.has(match[1])) throw new Error('Arguments must be unique --name=value pairs.');
  argumentsByName.set(match[1], match[2]);
}
const allowed = new Set(['origin', 'organization', 'product', 'requests', 'concurrency', 'timeout-ms', 'p95-ms', 'output']);
const unexpected = [...argumentsByName.keys()].filter((name) => !allowed.has(name));
if (unexpected.length) throw new Error(`Unexpected argument(s): ${unexpected.join(', ')}.`);
for (const required of ['origin', 'organization', 'product']) if (!argumentsByName.has(required)) throw new Error(`Missing --${required}=<value>.`);
const output = argumentsByName.get('output') ?? null;
if (output && !path.isAbsolute(output)) throw new Error('Load report output must be an absolute new JSON file path.');
const integer = (name: string, fallback: number) => argumentsByName.has(name) ? Number(argumentsByName.get(name)) : fallback;
const report = await verifyDiscoveryLoad({
  origin: argumentsByName.get('origin')!,
  organizationPath: argumentsByName.get('organization')!,
  productPath: argumentsByName.get('product')!,
  requests: integer('requests', 72),
  concurrency: integer('concurrency', 6),
  timeoutMs: integer('timeout-ms', 3_000),
  p95LimitMs: integer('p95-ms', 750),
});
const serialized = `${JSON.stringify({ capturedAt: new Date().toISOString(), ...report }, null, 2)}\n`;
if (output) await writeFile(path.resolve(output), serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ...JSON.parse(serialized), output: output ? path.resolve(output) : null, reportSha256: createHash('sha256').update(serialized).digest('hex') }, null, 2));
if (!report.ready) process.exitCode = 1;
