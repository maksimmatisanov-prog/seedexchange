import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareDiscoveryBackupEntries, discoveryBackupManifestSchema, fingerprintBackupArtifact } from '../../src/domain/backup-manifest.js';

describe('discovery backup artifact manifest', () => {
  it('fingerprints three files and detects content drift', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'seedexchange-backup-domain-'));
    try {
      const dump = path.join(directory, 'database.sql.gz');
      const uploads = path.join(directory, 'uploads.tar.gz');
      const release = path.join(directory, 'legacy-release.tar.gz');
      const empty = path.join(directory, 'empty.tar.gz');
      await Promise.all([writeFile(dump, 'database'), writeFile(uploads, 'uploads'), writeFile(release, 'release'), writeFile(empty, '')]);
      const expected = await Promise.all([
        fingerprintBackupArtifact('mysql_dump', dump),
        fingerprintBackupArtifact('uploads_archive', uploads),
        fingerprintBackupArtifact('legacy_release_archive', release),
      ]);
      expect(discoveryBackupManifestSchema.parse({ version: 1, algorithm: 'sha256', entries: expected }).entries).toEqual(expected);
      expect(compareDiscoveryBackupEntries(expected, expected)).toEqual([]);
      await writeFile(uploads, 'changed uploads');
      const changed = [...expected];
      changed[1] = await fingerprintBackupArtifact('uploads_archive', uploads);
      expect(compareDiscoveryBackupEntries(expected, changed)).toContain('Backup artifact does not match the manifest: uploads_archive.');
      await expect(fingerprintBackupArtifact('legacy_release_archive', empty)).rejects.toThrow('legacy_release_archive backup artifact is empty.');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('creates and verifies an exclusive manifest through both operational CLIs', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'seedexchange-backup-cli-'));
    try {
      const dump = path.join(directory, 'database.sql.gz');
      const uploads = path.join(directory, 'uploads.tar.gz');
      const release = path.join(directory, 'legacy-release.tar.gz');
      const manifest = path.join(directory, 'manifest.json');
      await Promise.all([writeFile(dump, 'database'), writeFile(uploads, 'uploads'), writeFile(release, 'release')]);
      const runtime = path.resolve('node_modules/tsx/dist/cli.mjs');
      const createArgs = [runtime, path.resolve('scripts/discovery-backup-manifest.ts'), `--mysql-dump=${dump}`, `--uploads-archive=${uploads}`, `--legacy-release=${release}`, `--output=${manifest}`];
      const created = spawnSync(process.execPath, createArgs, { cwd: process.cwd(), encoding: 'utf8' });
      expect(created.status, created.stderr).toBe(0);
      expect(discoveryBackupManifestSchema.parse(JSON.parse(await readFile(manifest, 'utf8'))).entries).toHaveLength(3);
      const repeated = spawnSync(process.execPath, createArgs, { cwd: process.cwd(), encoding: 'utf8' });
      expect(repeated.status).not.toBe(0);
      const verified = spawnSync(process.execPath, [runtime, path.resolve('scripts/verify-discovery-backup.ts'), `--manifest=${manifest}`, `--mysql-dump=${dump}`, `--uploads-archive=${uploads}`, `--legacy-release=${release}`], { cwd: process.cwd(), encoding: 'utf8' });
      expect(verified.status, verified.stderr).toBe(0);
      expect(JSON.parse(verified.stdout)).toMatchObject({ ready: true, errors: [] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
