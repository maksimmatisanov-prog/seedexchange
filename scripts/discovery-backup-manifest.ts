import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DISCOVERY_BACKUP_ROLES, fingerprintBackupArtifact, type DiscoveryBackupRole } from '../src/domain/backup-manifest.js';

const args = process.argv.slice(2);
function argument(name: string): string {
  const matches = args.filter((value) => value.startsWith(`--${name}=`));
  if (matches.length !== 1 || matches[0] === `--${name}=`) throw new Error(`Provide exactly one --${name}=<absolute-path>.`);
  const value = matches[0].slice(name.length + 3);
  if (!path.isAbsolute(value)) throw new Error(`--${name} must be an absolute path.`);
  return path.resolve(value);
}
if (args.length !== 4) throw new Error('Usage: discovery-backup-manifest --mysql-dump=<absolute-file> --uploads-archive=<absolute-file> --legacy-release=<absolute-file> --output=<absolute-new.json>');
const files: Record<DiscoveryBackupRole, string> = {
  mysql_dump: argument('mysql-dump'),
  uploads_archive: argument('uploads-archive'),
  legacy_release_archive: argument('legacy-release'),
};
const outputPath = argument('output');
if (new Set(Object.values(files).map((file) => file.toLowerCase())).size !== DISCOVERY_BACKUP_ROLES.length) throw new Error('Each backup role must use a distinct artifact file.');
const entries = await Promise.all(DISCOVERY_BACKUP_ROLES.map((role) => fingerprintBackupArtifact(role, files[role])));
const serialized = `${JSON.stringify({ version: 1, algorithm: 'sha256', entries }, null, 2)}\n`;
await writeFile(outputPath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ready: true, outputPath, manifestSha256: createHash('sha256').update(serialized).digest('hex'), entries }, null, 2));
