import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyPublicCutover } from '../src/domain/public-cutover.js';

const values = new Map<string, string>();
for (const argument of process.argv.slice(2)) {
  const match = /^--([a-z0-9-]+)=(.+)$/.exec(argument);
  if (!match || values.has(match[1])) throw new Error('Arguments must be unique --name=value pairs.');
  values.set(match[1], match[2]);
}
const allowed = new Set(['expected-ipv4', 'expected-ipv6', 'migration', 'organization', 'product', 'media', 'output']);
const unexpected = [...values.keys()].filter((name) => !allowed.has(name));
if (unexpected.length) throw new Error(`Unexpected argument(s): ${unexpected.join(', ')}.`);
for (const required of ['expected-ipv4', 'migration', 'organization', 'product', 'media']) if (!values.has(required)) throw new Error(`Missing --${required}=<value>.`);
const output = values.get('output') ?? null;
if (output && !path.isAbsolute(output)) throw new Error('Public cutover output must be an absolute new JSON file path.');
const report = await verifyPublicCutover({
  expectedIpv4: values.get('expected-ipv4')!,
  expectedIpv6: values.get('expected-ipv6') ?? null,
  expectedMigration: values.get('migration')!,
  organizationPath: values.get('organization')!,
  productPath: values.get('product')!,
  mediaPath: values.get('media')!,
});
const serialized = `${JSON.stringify({ capturedAt: new Date().toISOString(), ...report }, null, 2)}\n`;
if (output) await writeFile(path.resolve(output), serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ...JSON.parse(serialized), output: output ? path.resolve(output) : null, reportSha256: createHash('sha256').update(serialized).digest('hex') }, null, 2));
if (!report.ready) process.exitCode = 1;
