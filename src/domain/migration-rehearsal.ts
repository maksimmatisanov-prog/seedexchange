import { createHash } from 'node:crypto';
import { z } from 'zod';
import { legacyPlansForScope } from './legacy-migration.js';

const identifierSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const inventoryEntrySchema = z.object({
  count: z.number().int().nonnegative(),
  checksum: sha256Schema,
  columns: z.array(identifierSchema).min(1),
});
const compatibilityEntrySchema = z.object({
  importedColumns: z.array(identifierSchema).min(1),
  sourceOnlyColumns: z.array(identifierSchema),
  targetOnlyColumns: z.array(identifierSchema),
});
const reportSchema = z.object({
  mode: z.enum(['inventory', 'dry-run']),
  scope: z.literal('discovery'),
  sourceSnapshot: z.literal('repeatable-read-read-only'),
  runId: z.string().uuid(),
  sourceFingerprint: sha256Schema,
  tables: z.record(identifierSchema, inventoryEntrySchema),
  compatibility: z.record(identifierSchema, compatibilityEntrySchema).optional(),
}).passthrough();

export type RehearsalReportInput = {
  label: string;
  expectedMode: 'inventory' | 'dry-run';
  data: unknown;
};

function sameNames(actual: string[], expected: string[]): boolean {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

export function verifyDiscoveryMigrationRehearsal(inputs: readonly RehearsalReportInput[]) {
  const errors: string[] = [];
  if (inputs.length !== 4 || inputs.filter((input) => input.expectedMode === 'inventory').length !== 2
    || inputs.filter((input) => input.expectedMode === 'dry-run').length !== 2) {
    errors.push('Provide exactly two inventory reports and two dry-run reports.');
  }

  const parsed = inputs.flatMap((input) => {
    const result = reportSchema.safeParse(input.data);
    if (!result.success) {
      errors.push(`${input.label} is not a valid discovery migration report: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}.`);
      return [];
    }
    if (result.data.mode !== input.expectedMode) errors.push(`${input.label} must have mode ${input.expectedMode}, received ${result.data.mode}.`);
    if (input.expectedMode === 'dry-run' && !result.data.compatibility) errors.push(`${input.label} does not contain a compatibility report.`);
    return [{ ...input, report: result.data }];
  });

  if (parsed.length === inputs.length && parsed.length > 0) {
    const plans = legacyPlansForScope('discovery');
    const expectedTables = plans.map((plan) => plan.source);
    const runIds = parsed.map(({ report }) => report.runId);
    if (new Set(runIds).size !== runIds.length) errors.push('Every report must come from a distinct migration command runId.');

    const baseline = parsed[0].report;
    const baselineTables = JSON.stringify(baseline.tables);
    const baselineFingerprint = baseline.sourceFingerprint;
    for (const { label, report } of parsed) {
      const tableNames = Object.keys(report.tables);
      if (!sameNames(tableNames, expectedTables)) errors.push(`${label} does not contain the exact discovery table set.`);
      const computedFingerprint = createHash('sha256').update(JSON.stringify(report.tables)).digest('hex');
      if (computedFingerprint !== report.sourceFingerprint) errors.push(`${label} sourceFingerprint does not match its table inventory.`);
      if (report.sourceFingerprint !== baselineFingerprint) errors.push(`${label} sourceFingerprint differs from the first report.`);
      if (JSON.stringify(report.tables) !== baselineTables) errors.push(`${label} table inventory differs from the first report.`);

      if (report.mode === 'dry-run' && report.compatibility) {
        if (!sameNames(Object.keys(report.compatibility), expectedTables)) errors.push(`${label} compatibility does not contain the exact discovery table set.`);
        for (const plan of plans) {
          const compatibility = report.compatibility[plan.source];
          const inventory = report.tables[plan.source];
          if (!compatibility || !inventory) continue;
          if (compatibility.sourceOnlyColumns.length) errors.push(`${label} has source-only columns for ${plan.source}.`);
          if (JSON.stringify(compatibility.importedColumns) !== JSON.stringify(inventory.columns)) {
            errors.push(`${label} does not import the complete inventoried column list for ${plan.source}.`);
          }
          if (JSON.stringify(compatibility.targetOnlyColumns) !== JSON.stringify(plan.allowedTargetOnlyColumns ?? [])) {
            errors.push(`${label} target-only columns for ${plan.source} differ from the reviewed allowlist.`);
          }
        }
      }
    }

    const dryRuns = parsed.filter(({ report }) => report.mode === 'dry-run');
    if (dryRuns.length === 2 && JSON.stringify(dryRuns[0].report.compatibility) !== JSON.stringify(dryRuns[1].report.compatibility)) {
      errors.push('Dry-run compatibility reports differ.');
    }
  }

  return {
    ready: errors.length === 0,
    reportCount: inputs.length,
    sourceFingerprint: parsed[0]?.report.sourceFingerprint ?? null,
    runIds: parsed.map(({ report }) => report.runId),
    errors,
  };
}
