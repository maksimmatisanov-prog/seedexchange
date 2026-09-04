import { createHash } from 'node:crypto';
import { lstat, open, opendir, readFile } from 'node:fs/promises';
import path from 'node:path';

const sha256Pattern = /^[a-f0-9]{64}$/;
const gitObjectPattern = /^[a-f0-9]{40}$/;
const migrationPattern = /^\d{3}_[a-z0-9_]+\.sql$/;
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export type ReleaseFileEntry = { path: string; byteSize: number; sha256: string };
export type DiscoveryReleaseManifest = {
  version: 1;
  algorithm: 'sha256';
  releaseType: 'production-discovery';
  gitCommit: string;
  gitTree: string;
  nodeMajor: 24;
  expectedMigration: string;
  files: ReleaseFileEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseManifest(input: unknown): DiscoveryReleaseManifest {
  if (!isRecord(input)) throw new Error('manifest must be an object');
  const exactKeys = ['algorithm', 'expectedMigration', 'files', 'gitCommit', 'gitTree', 'nodeMajor', 'releaseType', 'version'];
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(exactKeys)) throw new Error('manifest fields are not exact');
  if (input.version !== 1 || input.algorithm !== 'sha256' || input.releaseType !== 'production-discovery' || input.nodeMajor !== 24) throw new Error('manifest identity is invalid');
  if (typeof input.gitCommit !== 'string' || !gitObjectPattern.test(input.gitCommit) || typeof input.gitTree !== 'string' || !gitObjectPattern.test(input.gitTree)) throw new Error('Git identity is invalid');
  if (typeof input.expectedMigration !== 'string' || !migrationPattern.test(input.expectedMigration)) throw new Error('expectedMigration is invalid');
  if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > 10_000) throw new Error('files must contain 1 to 10000 entries');
  const files: ReleaseFileEntry[] = input.files.map((entry, index) => {
    if (!isRecord(entry) || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(['byteSize', 'path', 'sha256'])) throw new Error(`files.${index} fields are not exact`);
    if (typeof entry.path !== 'string' || entry.path.length < 1 || entry.path.length > 500 || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').includes('..')) throw new Error(`files.${index}.path is invalid`);
    if (typeof entry.byteSize !== 'number' || !Number.isSafeInteger(entry.byteSize) || entry.byteSize < 0) throw new Error(`files.${index}.byteSize is invalid`);
    if (typeof entry.sha256 !== 'string' || !sha256Pattern.test(entry.sha256)) throw new Error(`files.${index}.sha256 is invalid`);
    return { path: entry.path, byteSize: entry.byteSize, sha256: entry.sha256 };
  });
  const paths = files.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length || JSON.stringify(paths) !== JSON.stringify([...paths].sort(compareText))) throw new Error('file paths must be unique and sorted');
  return { version: 1, algorithm: 'sha256', releaseType: 'production-discovery', gitCommit: input.gitCommit, gitTree: input.gitTree, nodeMajor: 24, expectedMigration: input.expectedMigration, files };
}

export const discoveryReleaseManifestSchema = { parse: parseManifest } as const;

const allowedExactFiles = new Set(['.nvmrc', 'package.json', 'package-lock.json']);
const allowedPrefixes = ['dist/', 'public/', 'src/templates/'];
const requiredFiles = [
  '.nvmrc',
  'package.json',
  'package-lock.json',
  'dist/src/server.js',
  'dist/scripts/verify-production-environment.js',
  'dist/scripts/verify-release-manifest.js',
  'dist/scripts/verify-ready.js',
  'dist/scripts/verify-discovery-runtime.js',
  'public/assets/app.css',
  'src/templates/layouts/base.ejs',
] as const;

function normalizeRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

function isAllowedReleaseFile(relative: string): boolean {
  return allowedExactFiles.has(relative) || allowedPrefixes.some((prefix) => relative.startsWith(prefix));
}

function isAllowedReleaseDirectory(relative: string): boolean {
  return ['dist', 'public', 'src', 'src/templates'].includes(relative)
    || relative.startsWith('dist/')
    || relative.startsWith('public/')
    || relative.startsWith('src/templates/');
}

async function fingerprintFile(root: string, file: string): Promise<ReleaseFileEntry> {
  const relative = normalizeRelative(root, file);
  if (!isAllowedReleaseFile(relative)) throw new Error(`Release contains a file outside the allowlist: ${relative}.`);
  const metadata = await lstat(file);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`Release payload entry must be a regular file: ${relative}.`);
  const handle = await open(file, 'r');
  try {
    const before = await handle.stat();
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Release file changed while hashing: ${relative}.`);
    return { path: relative, byteSize: after.size, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
}

async function listPayloadFiles(root: string, allowRuntimeAdditions = false): Promise<string[]> {
  const resolvedRoot = path.resolve(root);
  const rootMetadata = await lstat(resolvedRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) throw new Error('Release root must be a real directory.');
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = [];
    for await (const entry of await opendir(directory)) entries.push(entry);
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeRelative(resolvedRoot, absolute);
      if (relative === 'RELEASE.json') continue;
      if (allowRuntimeAdditions && (relative === '.env' || relative === 'node_modules')) continue;
      if (entry.isSymbolicLink()) throw new Error(`Release payload cannot contain a symbolic link: ${relative}.`);
      if (entry.isDirectory()) {
        if (!isAllowedReleaseDirectory(relative)) throw new Error(`Release contains a directory outside the allowlist: ${relative}.`);
        await visit(absolute);
      }
      else if (entry.isFile()) files.push(absolute);
      else throw new Error(`Release payload contains an unsupported filesystem entry: ${relative}.`);
    }
  };
  await visit(resolvedRoot);
  return files;
}

async function collectReleaseFiles(root: string, allowRuntimeAdditions = false): Promise<ReleaseFileEntry[]> {
  const resolvedRoot = path.resolve(root);
  const entries: ReleaseFileEntry[] = [];
  for (const file of await listPayloadFiles(resolvedRoot, allowRuntimeAdditions)) entries.push(await fingerprintFile(resolvedRoot, file));
  entries.sort((left, right) => compareText(left.path, right.path));
  const available = new Set(entries.map((entry) => entry.path));
  const missing = requiredFiles.filter((file) => !available.has(file));
  if (missing.length) throw new Error(`Release is missing required file(s): ${missing.join(', ')}.`);
  const migrations = entries.map((entry) => entry.path).filter((file) => /^dist\/src\/db\/migrations\/\d{3}_[a-z0-9_]+\.sql$/.test(file)).sort();
  if (!migrations.length) throw new Error('Release contains no compiled database migration.');
  const nodeVersion = (await readFile(path.join(resolvedRoot, '.nvmrc'), 'utf8')).trim();
  if (nodeVersion !== '24') throw new Error('Release must target Node 24.');
  const packageDocument = JSON.parse(await readFile(path.join(resolvedRoot, 'package.json'), 'utf8')) as { name?: unknown; engines?: { node?: unknown } };
  if (packageDocument.name !== 'seedexchange' || packageDocument.engines?.node !== '>=24 <25') throw new Error('Release package metadata does not match the Node 24 Seedexchange contract.');
  return entries;
}

export async function createDiscoveryReleaseManifest(root: string, gitCommit: string, gitTree: string): Promise<DiscoveryReleaseManifest> {
  if (!gitObjectPattern.test(gitCommit) || !gitObjectPattern.test(gitTree)) throw new Error('Git commit and tree must be 40-character lowercase object IDs.');
  const files = await collectReleaseFiles(root);
  const migrations = files.map((entry) => entry.path).filter((file) => /^dist\/src\/db\/migrations\/\d{3}_[a-z0-9_]+\.sql$/.test(file)).sort();
  return {
    version: 1,
    algorithm: 'sha256',
    releaseType: 'production-discovery',
    gitCommit,
    gitTree,
    nodeMajor: 24,
    expectedMigration: path.posix.basename(migrations.at(-1)!),
    files,
  };
}

export async function verifyDiscoveryReleaseManifest(root: string, input: unknown, expectedCommit: string, allowRuntimeAdditions = false): Promise<{ ready: boolean; manifest: DiscoveryReleaseManifest | null; errors: string[] }> {
  let manifest: DiscoveryReleaseManifest;
  try {
    manifest = discoveryReleaseManifestSchema.parse(input);
  } catch (error) {
    return { ready: false, manifest: null, errors: [`Release manifest is invalid: ${error instanceof Error ? error.message : String(error)}.`] };
  }
  const errors: string[] = [];
  if (!gitObjectPattern.test(expectedCommit)) errors.push('Expected commit must be a 40-character lowercase Git object ID.');
  else if (manifest.gitCommit !== expectedCommit) errors.push(`Release commit does not match the expected commit ${expectedCommit}.`);
  try {
    const actual = await collectReleaseFiles(root, allowRuntimeAdditions);
    const expected = manifest.files;
    if (JSON.stringify(expected) !== JSON.stringify(actual)) errors.push('Release payload files, sizes or SHA-256 values do not match RELEASE.json.');
    const migrations = actual.map((entry) => entry.path).filter((file) => /^dist\/src\/db\/migrations\/\d{3}_[a-z0-9_]+\.sql$/.test(file)).sort();
    if (path.posix.basename(migrations.at(-1)!) !== manifest.expectedMigration) errors.push('Release expectedMigration does not match the newest compiled migration.');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { ready: errors.length === 0, manifest, errors };
}
