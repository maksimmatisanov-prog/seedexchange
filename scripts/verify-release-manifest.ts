import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyDiscoveryReleaseManifest } from '../src/domain/release-manifest.js';

const args = process.argv.slice(2);
function argument(name: string): string {
  const matches = args.filter((value) => value.startsWith(`--${name}=`));
  if (matches.length !== 1 || matches[0] === `--${name}=`) throw new Error(`Provide exactly one --${name}=<value>.`);
  return matches[0].slice(name.length + 3);
}
const runtimePrepared = args.includes('--runtime-prepared');
if (args.length !== (runtimePrepared ? 4 : 3) || args.some((value) => !value.startsWith('--root=') && !value.startsWith('--manifest=') && !value.startsWith('--commit=') && value !== '--runtime-prepared')) throw new Error('Usage: verify-release-manifest --root=<absolute-release-directory> --manifest=<absolute-RELEASE.json> --commit=<git-sha> [--runtime-prepared]');
const rootArgument = argument('root');
const manifestArgument = argument('manifest');
if (!path.isAbsolute(rootArgument) || !path.isAbsolute(manifestArgument)) throw new Error('root and manifest paths must be absolute.');
const root = path.resolve(rootArgument);
const manifestPath = path.resolve(manifestArgument);
if (manifestPath !== path.join(root, 'RELEASE.json')) throw new Error('manifest must be <root>/RELEASE.json.');
const manifestMetadata = await lstat(manifestPath);
if (manifestMetadata.isSymbolicLink() || !manifestMetadata.isFile()) throw new Error('RELEASE.json must be a regular non-symlink file.');
const contents = await readFile(manifestPath);
if (contents.byteLength > 10_000_000) throw new Error('Release manifest exceeds the 10 MB limit.');
const report = await verifyDiscoveryReleaseManifest(root, JSON.parse(contents.toString('utf8')), argument('commit'), runtimePrepared);
console.log(JSON.stringify({ ready: report.ready, manifestSha256: createHash('sha256').update(contents).digest('hex'), gitCommit: report.manifest?.gitCommit ?? null, gitTree: report.manifest?.gitTree ?? null, expectedMigration: report.manifest?.expectedMigration ?? null, files: report.manifest?.files.length ?? null, errors: report.errors }, null, 2));
if (!report.ready) process.exitCode = 1;
