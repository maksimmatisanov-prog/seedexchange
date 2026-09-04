import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDiscoveryReleaseManifest, discoveryReleaseManifestSchema, verifyDiscoveryReleaseManifest } from '../../src/domain/release-manifest.js';

const commit = '1'.repeat(40);
const tree = '2'.repeat(40);

async function createReleaseRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'seedexchange-release-'));
  const files: Record<string, string> = {
    '.nvmrc': '24\n',
    'package.json': JSON.stringify({ name: 'seedexchange', engines: { node: '>=24 <25' } }),
    'package-lock.json': '{}',
    'dist/src/server.js': 'export {};',
    'dist/src/db/migrations/003_discovery_migration_scope.sql': 'SELECT 1;',
    'dist/scripts/verify-discovery-load.js': 'export {};',
    'dist/scripts/verify-production-environment.js': 'export {};',
    'dist/scripts/verify-production-observation.js': 'export {};',
    'dist/scripts/verify-release-manifest.js': 'export {};',
    'dist/scripts/verify-ready.js': 'export {};',
    'dist/scripts/verify-discovery-runtime.js': 'export {};',
    'ops/caddy/activate-production-caddy.sh': '#!/usr/bin/env bash',
    'ops/caddy/rollback-production-caddy.sh': '#!/usr/bin/env bash',
    'ops/caddy/seedexchange-production.caddy': 'seedexchange.online {}',
    'ops/systemd/production/seedexchange-production.service': '[Service]',
    'ops/systemd/production/seedexchange-production-outbox.service': '[Service]',
    'ops/systemd/production/seedexchange-production-outbox.timer': '[Timer]',
    'ops/systemd/production/seedexchange-production-sitemap.service': '[Service]',
    'ops/systemd/production/seedexchange-production-sitemap.timer': '[Timer]',
    'public/assets/app.css': 'body{}',
    'src/templates/layouts/base.ejs': '<main></main>',
  };
  for (const [relative, contents] of Object.entries(files)) {
    const destination = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  return root;
}

describe('production discovery release manifest', () => {
  it('creates a complete manifest and detects payload drift', async () => {
    const root = await createReleaseRoot();
    try {
      const manifest = await createDiscoveryReleaseManifest(root, commit, tree);
      expect(discoveryReleaseManifestSchema.parse(manifest)).toMatchObject({ releaseType: 'production-discovery', gitCommit: commit, gitTree: tree, nodeMajor: 24, expectedMigration: '003_discovery_migration_scope.sql' });
      expect((await verifyDiscoveryReleaseManifest(root, manifest, commit)).ready).toBe(true);
      await mkdir(path.join(root, 'node_modules/example'), { recursive: true });
      await writeFile(path.join(root, 'node_modules/example/index.js'), 'installed dependency');
      await writeFile(path.join(root, '.env'), 'runtime link placeholder');
      expect((await verifyDiscoveryReleaseManifest(root, manifest, commit)).ready).toBe(false);
      expect((await verifyDiscoveryReleaseManifest(root, manifest, commit, true)).ready).toBe(true);
      await rm(path.join(root, 'node_modules'), { recursive: true, force: true });
      await rm(path.join(root, '.env'));
      await writeFile(path.join(root, 'public/assets/app.css'), 'changed{}');
      const changed = await verifyDiscoveryReleaseManifest(root, manifest, commit);
      expect(changed.ready).toBe(false);
      expect(changed.errors).toContain('Release payload files, sizes or SHA-256 values do not match RELEASE.json.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unknown payload files, wrong runtime metadata and commit mismatch', async () => {
    const root = await createReleaseRoot();
    try {
      await writeFile(path.join(root, '.env'), 'SECRET=value');
      await expect(createDiscoveryReleaseManifest(root, commit, tree)).rejects.toThrow('Release contains a file outside the allowlist: .env.');
      await rm(path.join(root, '.env'));
      await writeFile(path.join(root, 'ops/caddy/unreviewed.txt'), 'unexpected');
      await expect(createDiscoveryReleaseManifest(root, commit, tree)).rejects.toThrow('Release contains a file outside the allowlist: ops/caddy/unreviewed.txt.');
      await rm(path.join(root, 'ops/caddy/unreviewed.txt'));
      await writeFile(path.join(root, '.nvmrc'), '22\n');
      await expect(createDiscoveryReleaseManifest(root, commit, tree)).rejects.toThrow('Release must target Node 24.');
      await writeFile(path.join(root, '.nvmrc'), '24\n');
      const manifest = await createDiscoveryReleaseManifest(root, commit, tree);
      expect((await verifyDiscoveryReleaseManifest(root, manifest, '3'.repeat(40))).errors).toContain(`Release commit does not match the expected commit ${'3'.repeat(40)}.`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('creates and verifies RELEASE.json through the operational CLIs', async () => {
    const root = await createReleaseRoot();
    const manifestPath = path.join(root, 'RELEASE.json');
    const runtime = path.resolve('node_modules/tsx/dist/cli.mjs');
    try {
      const created = spawnSync(process.execPath, [runtime, path.resolve('scripts/create-release-manifest.ts'), `--root=${root}`, `--commit=${commit}`, `--tree=${tree}`, `--output=${manifestPath}`], { cwd: process.cwd(), encoding: 'utf8' });
      expect(created.status, created.stderr).toBe(0);
      expect(JSON.parse(created.stdout)).toMatchObject({ ready: true, gitCommit: commit, gitTree: tree, expectedMigration: '003_discovery_migration_scope.sql' });
      expect(discoveryReleaseManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8'))).files.length).toBeGreaterThan(5);
      const verified = spawnSync(process.execPath, [runtime, path.resolve('scripts/verify-release-manifest.ts'), `--root=${root}`, `--manifest=${manifestPath}`, `--commit=${commit}`], { cwd: process.cwd(), encoding: 'utf8' });
      expect(verified.status, verified.stderr).toBe(0);
      expect(JSON.parse(verified.stdout)).toMatchObject({ ready: true, gitCommit: commit, errors: [] });
      await mkdir(path.join(root, 'node_modules/example'), { recursive: true });
      await writeFile(path.join(root, 'node_modules/example/index.js'), 'installed');
      await writeFile(path.join(root, '.env'), 'prepared runtime marker');
      const prepared = spawnSync(process.execPath, [runtime, path.resolve('scripts/verify-release-manifest.ts'), `--root=${root}`, `--manifest=${manifestPath}`, `--commit=${commit}`, '--runtime-prepared'], { cwd: process.cwd(), encoding: 'utf8' });
      expect(prepared.status, prepared.stderr).toBe(0);
      expect(JSON.parse(prepared.stdout)).toMatchObject({ ready: true, gitCommit: commit, errors: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
