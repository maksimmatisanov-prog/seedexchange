import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compareDiscoveryBackupEntries, DISCOVERY_BACKUP_ROLES, discoveryBackupManifestSchema, fingerprintBackupArtifact, type DiscoveryBackupRole } from '../src/domain/backup-manifest.js';

const args = process.argv.slice(2);
function argument(name: string): string {
  const matches = args.filter((value) => value.startsWith(`--${name}=`));
  if (matches.length !== 1 || matches[0] === `--${name}=`) throw new Error(`Provide exactly one --${name}=<absolute-path>.`);
  const value = matches[0].slice(name.length + 3);
  if (!path.isAbsolute(value)) throw new Error(`--${name} must be an absolute path.`);
  return path.resolve(value);
}
if (args.length !== 4) throw new Error('Usage: verify-discovery-backup --manifest=<absolute.json> --mysql-dump=<absolute-file> --uploads-archive=<absolute-file> --legacy-release=<absolute-file>');
const manifestPath = argument('manifest');
const manifestContents = await readFile(manifestPath);
if (manifestContents.byteLength > 1_000_000) throw new Error('Backup manifest exceeds the 1 MB limit.');
const manifest = discoveryBackupManifestSchema.parse(JSON.parse(manifestContents.toString('utf8')));
const files: Record<DiscoveryBackupRole, string> = {
  mysql_dump: argument('mysql-dump'),
  uploads_archive: argument('uploads-archive'),
  legacy_release_archive: argument('legacy-release'),
};
if (new Set(Object.values(files).map((file) => file.toLowerCase())).size !== DISCOVERY_BACKUP_ROLES.length) throw new Error('Each backup role must use a distinct artifact file.');
const actual = await Promise.all(DISCOVERY_BACKUP_ROLES.map((role) => fingerprintBackupArtifact(role, files[role])));
const errors = compareDiscoveryBackupEntries(manifest.entries, actual);
console.log(JSON.stringify({ ready: errors.length === 0, manifestSha256: createHash('sha256').update(manifestContents).digest('hex'), entries: actual, errors }, null, 2));
if (errors.length) process.exitCode = 1;
