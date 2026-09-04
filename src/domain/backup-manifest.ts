import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const DISCOVERY_BACKUP_ROLES = ['mysql_dump', 'uploads_archive', 'legacy_release_archive'] as const;
export type DiscoveryBackupRole = typeof DISCOVERY_BACKUP_ROLES[number];

const entrySchema = z.object({
  role: z.enum(DISCOVERY_BACKUP_ROLES),
  fileName: z.string().min(1).max(255),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const discoveryBackupManifestSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('sha256'),
  entries: z.array(entrySchema).length(DISCOVERY_BACKUP_ROLES.length),
});

export type DiscoveryBackupEntry = z.infer<typeof entrySchema>;

export async function fingerprintBackupArtifact(role: DiscoveryBackupRole, file: string): Promise<DiscoveryBackupEntry> {
  const resolved = path.resolve(file);
  const linkMetadata = await lstat(resolved);
  if (linkMetadata.isSymbolicLink() || !linkMetadata.isFile()) throw new Error(`${role} must be a regular file, not a link or directory.`);
  const handle = await open(resolved, 'r');
  try {
    const before = await handle.stat();
    if (before.size < 1) throw new Error(`${role} backup artifact is empty.`);
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`${role} changed while it was being fingerprinted.`);
    return { role, fileName: path.basename(resolved), byteSize: after.size, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
}

export function compareDiscoveryBackupEntries(expected: readonly DiscoveryBackupEntry[], actual: readonly DiscoveryBackupEntry[]): string[] {
  const errors: string[] = [];
  const expectedByRole = new Map<DiscoveryBackupRole, DiscoveryBackupEntry>();
  const actualByRole = new Map<DiscoveryBackupRole, DiscoveryBackupEntry>();
  for (const entry of expected) {
    if (expectedByRole.has(entry.role)) errors.push(`Backup manifest contains duplicate role ${entry.role}.`);
    expectedByRole.set(entry.role, entry);
  }
  for (const entry of actual) {
    if (actualByRole.has(entry.role)) errors.push(`Verified backup set contains duplicate role ${entry.role}.`);
    actualByRole.set(entry.role, entry);
  }
  for (const role of DISCOVERY_BACKUP_ROLES) {
    const expectedEntry = expectedByRole.get(role);
    const actualEntry = actualByRole.get(role);
    if (!expectedEntry) { errors.push(`Backup manifest is missing role ${role}.`); continue; }
    if (!actualEntry) { errors.push(`Verified backup set is missing role ${role}.`); continue; }
    if (expectedEntry.fileName !== actualEntry.fileName || expectedEntry.byteSize !== actualEntry.byteSize || expectedEntry.sha256 !== actualEntry.sha256) {
      errors.push(`Backup artifact does not match the manifest: ${role}.`);
    }
  }
  return errors;
}
