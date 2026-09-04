import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { legacyPlansForScope } from '../../src/domain/legacy-migration.js';
import { verifyDiscoveryMigrationRehearsal } from '../../src/domain/migration-rehearsal.js';

function reports() {
  const plans = legacyPlansForScope('discovery');
  const tables = Object.fromEntries(plans.map((plan) => [plan.source, {
    count: 0,
    checksum: '0'.repeat(64),
    columns: [...plan.requiredSourceColumns!],
  }]));
  const sourceFingerprint = createHash('sha256').update(JSON.stringify(tables)).digest('hex');
  const compatibility = Object.fromEntries(plans.map((plan) => [plan.source, {
    importedColumns: [...plan.requiredSourceColumns!],
    sourceOnlyColumns: [],
    targetOnlyColumns: [...(plan.allowedTargetOnlyColumns ?? [])],
  }]));
  const report = (mode: 'inventory' | 'dry-run') => ({
    scope: 'discovery',
    sourceSnapshot: 'repeatable-read-read-only',
    sourceFingerprint,
    tables: structuredClone(tables),
    mode,
    runId: randomUUID(),
    ...(mode === 'dry-run' ? { compatibility: structuredClone(compatibility) } : {}),
  });
  return [
    { label: 'inventory-1', expectedMode: 'inventory' as const, data: report('inventory') },
    { label: 'inventory-2', expectedMode: 'inventory' as const, data: report('inventory') },
    { label: 'dry-run-1', expectedMode: 'dry-run' as const, data: report('dry-run') },
    { label: 'dry-run-2', expectedMode: 'dry-run' as const, data: report('dry-run') },
  ];
}

describe('discovery migration rehearsal verification', () => {
  it('accepts two matching inventory and dry-run reports from distinct runs', () => {
    expect(verifyDiscoveryMigrationRehearsal(reports())).toMatchObject({ ready: true, reportCount: 4, errors: [] });
  });

  it('rejects repeated command runs and changed inventories', () => {
    const inputs = reports();
    (inputs[1].data as { runId: string }).runId = (inputs[0].data as { runId: string }).runId;
    (inputs[3].data as { tables: Record<string, { count: number }> }).tables.users.count = 1;
    const errors = verifyDiscoveryMigrationRehearsal(inputs).errors;
    expect(errors).toContain('Every report must come from a distinct migration command runId.');
    expect(errors).toContain('dry-run-2 sourceFingerprint does not match its table inventory.');
    expect(errors).toContain('dry-run-2 table inventory differs from the first report.');
  });

  it('rejects a partial import map or unreviewed target-only field', () => {
    const inputs = reports();
    const compatibility = (inputs[2].data as { compatibility: Record<string, { importedColumns: string[]; targetOnlyColumns: string[] }> }).compatibility;
    compatibility.users.importedColumns = compatibility.users.importedColumns.slice(1);
    compatibility.organizations.targetOnlyColumns.push('unexpected_column');
    const errors = verifyDiscoveryMigrationRehearsal(inputs).errors;
    expect(errors).toContain('dry-run-1 does not import the complete inventoried column list for users.');
    expect(errors).toContain('dry-run-1 target-only columns for organizations differ from the reviewed allowlist.');
    expect(errors).toContain('Dry-run compatibility reports differ.');
  });

  it('verifies four distinct report files through the operational CLI', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'seedexchange-rehearsal-cli-'));
    try {
      const inputs = reports();
      const files = await Promise.all(inputs.map(async (input) => {
        const file = path.join(directory, `${input.label}.json`);
        await writeFile(file, `${JSON.stringify(input.data, null, 2)}\n`, 'utf8');
        return file;
      }));
      const execution = spawnSync(process.execPath, [
        path.resolve('node_modules/tsx/dist/cli.mjs'),
        path.resolve('scripts/verify-discovery-rehearsal.ts'),
        `--inventory=${files[0]}`,
        `--inventory=${files[1]}`,
        `--dry-run=${files[2]}`,
        `--dry-run=${files[3]}`,
      ], { cwd: process.cwd(), encoding: 'utf8' });
      expect(execution.status, execution.stderr).toBe(0);
      expect(JSON.parse(execution.stdout)).toMatchObject({ ready: true, reportCount: 4, errors: [] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
