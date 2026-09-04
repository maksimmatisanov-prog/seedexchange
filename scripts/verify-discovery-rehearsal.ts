import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyDiscoveryMigrationRehearsal, type RehearsalReportInput } from '../src/domain/migration-rehearsal.js';

const args = process.argv.slice(2);
const inventoryPaths = args.filter((argument) => argument.startsWith('--inventory=')).map((argument) => argument.slice('--inventory='.length));
const dryRunPaths = args.filter((argument) => argument.startsWith('--dry-run=')).map((argument) => argument.slice('--dry-run='.length));
if (args.some((argument) => !argument.startsWith('--inventory=') && !argument.startsWith('--dry-run='))
  || inventoryPaths.length !== 2 || dryRunPaths.length !== 2 || [...inventoryPaths, ...dryRunPaths].some((value) => !value)) {
  throw new Error('Usage: verify-discovery-rehearsal --inventory=<first.json> --inventory=<second.json> --dry-run=<first.json> --dry-run=<second.json>');
}

const descriptors = [
  ...inventoryPaths.map((file, index) => ({ file: path.resolve(file), label: `inventory-${index + 1}`, expectedMode: 'inventory' as const })),
  ...dryRunPaths.map((file, index) => ({ file: path.resolve(file), label: `dry-run-${index + 1}`, expectedMode: 'dry-run' as const })),
];
if (new Set(descriptors.map(({ file }) => file.toLowerCase())).size !== descriptors.length) {
  throw new Error('Each rehearsal report must use a distinct file path.');
}

const inputs: RehearsalReportInput[] = [];
const files: Array<{ label: string; path: string; byteSize: number; sha256: string }> = [];
for (const descriptor of descriptors) {
  const contents = await readFile(descriptor.file);
  if (contents.byteLength > 5_000_000) throw new Error(`${descriptor.label} exceeds the 5 MB report limit.`);
  let data: unknown;
  try { data = JSON.parse(contents.toString('utf8')); }
  catch { throw new Error(`${descriptor.label} is not valid JSON.`); }
  inputs.push({ label: descriptor.label, expectedMode: descriptor.expectedMode, data });
  files.push({ label: descriptor.label, path: descriptor.file, byteSize: contents.byteLength, sha256: createHash('sha256').update(contents).digest('hex') });
}

const result = verifyDiscoveryMigrationRehearsal(inputs);
console.log(JSON.stringify({ ...result, files }, null, 2));
if (!result.ready) process.exitCode = 1;
