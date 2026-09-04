import { createHash, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { Pool, type PoolClient } from 'pg';
import { config } from '../src/config.js';
import {
  DISCOVERY_FORBIDDEN_TARGET_TABLES,
  legacyPlansForScope,
  quoteMysqlIdentifier,
  quotePostgresIdentifier,
  sanitizeLegacyRow,
  validateLegacySourceContract,
  validateDiscoveryRow,
  type LegacyMigrationScope,
  type LegacyTablePlan,
} from '../src/domain/legacy-migration.js';

type Mode = 'inventory' | 'dry-run' | 'import';
type Scalar = null | string | number | bigint | boolean | Date | Buffer;
type SourceRow = Record<string, Scalar | Record<string, unknown> | unknown[]>;

const args = new Set(process.argv.slice(2));
const modes: Mode[] = ['inventory', 'dry-run', 'import'];
const mode = modes.find((candidate) => args.has(`--${candidate}`));
if (!mode || modes.filter((candidate) => args.has(`--${candidate}`)).length !== 1) {
  throw new Error('Choose exactly one mode: --inventory, --dry-run, or --import.');
}
const scopeArguments = [...args].filter((value) => value.startsWith('--scope='));
if (scopeArguments.length > 1) throw new Error('Choose one migration scope.');
const scope = (scopeArguments[0]?.slice('--scope='.length) || 'discovery') as LegacyMigrationScope;
if (!['discovery', 'full'].includes(scope)) throw new Error('Migration scope must be discovery or full.');
if (scope === 'discovery' && config.LAUNCH_PHASE !== 'discovery') throw new Error('Discovery data migration requires LAUNCH_PHASE=discovery.');
const tablePlan = legacyPlansForScope(scope);
if (!config.LEGACY_MYSQL_URL) throw new Error('LEGACY_MYSQL_URL is required.');

const source = await mysql.createConnection({ uri: config.LEGACY_MYSQL_URL, decimalNumbers: false, supportBigNumbers: true, bigNumberStrings: true });
const target = mode === 'inventory' ? null : new Pool({ connectionString: config.DATABASE_URL, max: 2 });
const sourceSnapshot = 'repeatable-read-read-only';

async function existingSourceTables(): Promise<Set<string>> {
  const [rows] = await source.query<mysql.RowDataPacket[]>(`SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE'`);
  return new Set(rows.map((row) => String(row.TABLE_NAME ?? row.table_name)));
}

async function sourceColumns(table: string): Promise<string[]> {
  const [rows] = await source.query<mysql.RowDataPacket[]>(`SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position`, [table]);
  return rows.map((row) => String(row.COLUMN_NAME ?? row.column_name));
}

type TargetColumn = { dataType: string; nullable: boolean; hasDefault: boolean; identity: boolean };

async function targetColumns(client: PoolClient, table: string): Promise<Map<string, TargetColumn>> {
  const result = await client.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null; is_identity: string }>(
    `SELECT column_name,data_type,is_nullable,column_default,is_identity FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table],
  );
  return new Map(result.rows.map((row) => [row.column_name, {
    dataType: row.data_type,
    nullable: row.is_nullable === 'YES',
    hasDefault: row.column_default !== null,
    identity: row.is_identity === 'YES',
  }]));
}

function convert(value: SourceRow[string], dataType: string): unknown {
  if (value === null || value === undefined) return null;
  if (dataType === 'boolean') return value === true || value === 1 || value === '1' || value === 'true';
  if (dataType === 'jsonb' || dataType === 'json') {
    if (typeof value === 'string') {
      try { return JSON.stringify(JSON.parse(value)); } catch { return JSON.stringify({ legacy_value: value }); }
    }
    return JSON.stringify(value);
  }
  if (Buffer.isBuffer(value)) return value;
  return value;
}

type InventoryEntry = { count: number; checksum: string; columns: string[] };

function fingerprintValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number | boolean;
}

async function inventory(plans: LegacyTablePlan[], columnsByTable: ReadonlyMap<string, readonly string[]>): Promise<Record<string, InventoryEntry>> {
  const result: Record<string, InventoryEntry> = {};
  for (const table of plans) {
    const columns = [...(columnsByTable.get(table.source) ?? [])];
    const where = table.where ? ` WHERE ${table.where}` : '';
    const [rows] = await source.query<mysql.RowDataPacket[]>(`SELECT ${columns.map(quoteMysqlIdentifier).join(',')} FROM ${quoteMysqlIdentifier(table.source)}${where} ORDER BY ${quoteMysqlIdentifier(columns[0])}`);
    const hash = createHash('sha256');
    for (const row of rows) hash.update(JSON.stringify(columns.map((column) => fingerprintValue(row[column])))).update('\n');
    result[table.source] = { count: rows.length, checksum: hash.digest('hex'), columns };
  }
  return result;
}

async function compatibleColumns(client: PoolClient, plan: LegacyTablePlan, sourceNames: readonly string[]) {
  const targetNames = await targetColumns(client, plan.target);
  const columns = sourceNames.filter((name) => targetNames.has(name));
  const sourceOnly = sourceNames.filter((name) => !targetNames.has(name));
  const targetOnly = [...targetNames.keys()].filter((name) => !sourceNames.includes(name));
  const unexpectedTargetOnly = targetOnly.filter((name) => !(plan.allowedTargetOnlyColumns ?? []).includes(name));
  const targetRequiredButUnmapped = [...targetNames.entries()]
    .filter(([name, metadata]) => !sourceNames.includes(name) && !metadata.nullable && !metadata.hasDefault && !metadata.identity)
    .map(([name]) => name);
  if (sourceOnly.length) throw new Error(`Source table ${plan.source} has unmapped columns: ${sourceOnly.join(', ')}.`);
  if (unexpectedTargetOnly.length) throw new Error(`Target table ${plan.target} has unreviewed target-only columns: ${unexpectedTargetOnly.join(', ')}.`);
  if (targetRequiredButUnmapped.length) throw new Error(`Target table ${plan.target} has required unmapped columns: ${targetRequiredButUnmapped.join(', ')}.`);
  if (!columns.length) throw new Error(`No compatible columns for ${plan.source}.`);
  return { targetNames, columns, sourceOnly, targetOnly };
}

async function ensureEmptyTarget(client: PoolClient, plans: LegacyTablePlan[]): Promise<void> {
  for (const table of plans) {
    const result = await client.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM ${quotePostgresIdentifier(table.target)}`);
    const allowedSeedRow = table.target === 'founder_program_state' && Number(result.rows[0]?.total) <= 1;
    if (Number(result.rows[0]?.total) > 0 && !allowedSeedRow) throw new Error(`Target table ${table.target} is not empty.`);
  }
  if (scope === 'discovery') {
    for (const table of DISCOVERY_FORBIDDEN_TARGET_TABLES) {
      const result = await client.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM ${quotePostgresIdentifier(table)}`);
      if (Number(result.rows[0]?.total) > 0) throw new Error(`Discovery target contains forbidden commerce data in ${table}.`);
    }
  }
}

async function importTable(client: PoolClient, plan: LegacyTablePlan): Promise<number> {
  const sourceNames = await sourceColumns(plan.source);
  const { targetNames, columns } = await compatibleColumns(client, plan, sourceNames);
  const where = plan.where ? ` WHERE ${plan.where}` : '';
  const [rows] = await source.query<mysql.RowDataPacket[]>(`SELECT ${columns.map(quoteMysqlIdentifier).join(',')} FROM ${quoteMysqlIdentifier(plan.source)}${where} ORDER BY 1`);
  let imported = 0;
  for (const sourceRow of rows as SourceRow[]) {
    const row = sanitizeLegacyRow(scope, plan.target, sourceRow as Record<string, unknown>);
    const discoveryErrors = scope === 'discovery' ? validateDiscoveryRow(plan.target, row) : [];
    if (discoveryErrors.length) throw new Error(`${plan.source} row failed discovery validation: ${discoveryErrors.join(' ')}`);
    const values = columns.map((column) => convert(row[column] as SourceRow[string], targetNames.get(column)!.dataType));
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
    const conflict = plan.target === 'founder_program_state' ? ' ON CONFLICT (id) DO UPDATE SET current_slot=EXCLUDED.current_slot,updated_at=EXCLUDED.updated_at' : '';
    await client.query(`INSERT INTO ${quotePostgresIdentifier(plan.target)} (${columns.map(quotePostgresIdentifier).join(',')}) VALUES (${placeholders})${conflict}`, values);
    imported++;
  }
  if (targetNames.has('id')) {
    const sequence = await client.query<{ sequence_name: string | null }>('SELECT pg_get_serial_sequence($1,$2) sequence_name', [plan.target, 'id']);
    if (sequence.rows[0]?.sequence_name) {
      await client.query(`SELECT setval($1::regclass,COALESCE((SELECT MAX(id) FROM ${quotePostgresIdentifier(plan.target)}),1),(SELECT COUNT(*)>0 FROM ${quotePostgresIdentifier(plan.target)}))`, [sequence.rows[0].sequence_name]);
    }
  }
  return imported;
}

async function verifyOrphans(client: PoolClient): Promise<Record<string, number>> {
  const checks: Record<string, string> = {
    organization_members_user: 'SELECT COUNT(*)::text total FROM organization_members x LEFT JOIN users p ON p.id=x.user_id WHERE p.id IS NULL',
    organization_members_org: 'SELECT COUNT(*)::text total FROM organization_members x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL',
    products_org: 'SELECT COUNT(*)::text total FROM products x LEFT JOIN organizations p ON p.id=x.organization_id WHERE p.id IS NULL',
    order_items_order: 'SELECT COUNT(*)::text total FROM order_items x LEFT JOIN orders p ON p.id=x.order_id WHERE p.id IS NULL',
    order_items_product: 'SELECT COUNT(*)::text total FROM order_items x LEFT JOIN products p ON p.id=x.product_id WHERE p.id IS NULL',
    messages_conversation: 'SELECT COUNT(*)::text total FROM conversation_messages x LEFT JOIN conversations p ON p.id=x.conversation_id WHERE p.id IS NULL',
  };
  const report: Record<string, number> = {};
  for (const [name, sql] of Object.entries(checks)) report[name] = Number((await client.query<{ total: string }>(sql)).rows[0]?.total ?? 0);
  return report;
}

let exitCode = 0;
try {
  await source.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await source.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  const available = await existingSourceTables();
  const columnsByTable = new Map<string, string[]>();
  for (const plan of tablePlan) {
    if (available.has(plan.source)) columnsByTable.set(plan.source, await sourceColumns(plan.source));
  }
  const contractErrors = validateLegacySourceContract(tablePlan, available, columnsByTable);
  if (contractErrors.length) throw new Error(`Legacy source contract failed: ${contractErrors.join(' ')}`);
  const plans = tablePlan;
  const sourceInventory = await inventory(plans, columnsByTable);
  const sourceFingerprint = createHash('sha256').update(JSON.stringify(sourceInventory)).digest('hex');
  if (mode === 'inventory') {
    console.log(JSON.stringify({ mode, scope, sourceSnapshot, sourceFingerprint, tables: sourceInventory }, null, 2));
  } else {
    const client = await target!.connect();
    const runId = randomUUID();
    try {
      await ensureEmptyTarget(client, plans);
      if (mode === 'dry-run') {
        const compatibility: Record<string, { importedColumns: string[]; sourceOnlyColumns: string[]; targetOnlyColumns: string[] }> = {};
        for (const plan of plans) {
          const result = await compatibleColumns(client, plan, columnsByTable.get(plan.source)!);
          compatibility[plan.source] = {
            importedColumns: result.columns,
            sourceOnlyColumns: result.sourceOnly,
            targetOnlyColumns: result.targetOnly,
          };
        }
        console.log(JSON.stringify({ mode, scope, sourceSnapshot, runId, sourceFingerprint, tables: sourceInventory, compatibility }, null, 2));
      } else {
        await client.query('BEGIN');
        await client.query(`INSERT INTO legacy_migration_runs(id,source_fingerprint,scope,mode,status,source_inventory) VALUES($1,$2,$3,'import','running',$4::jsonb)`, [runId, sourceFingerprint, scope, JSON.stringify(sourceInventory)]);
        const importedCounts: Record<string, number> = {};
        for (const plan of plans) importedCounts[plan.target] = await importTable(client, plan);
        const orphans = await verifyOrphans(client);
        const mismatches = plans.filter((plan) => importedCounts[plan.target] !== sourceInventory[plan.source].count)
          .map((plan) => ({ source: plan.source, target: plan.target, expected: sourceInventory[plan.source].count, actual: importedCounts[plan.target] }));
        if (mismatches.length || Object.values(orphans).some((count) => count !== 0)) throw new Error(`Parity verification failed: ${JSON.stringify({ mismatches, orphans })}`);
        await client.query(`UPDATE legacy_migration_runs SET status='succeeded',imported_counts=$2::jsonb,verification_report=$3::jsonb,completed_at=now() WHERE id=$1`, [runId, JSON.stringify(importedCounts), JSON.stringify({ orphans })]);
        await client.query('COMMIT');
        console.log(JSON.stringify({ mode, scope, sourceSnapshot, runId, sourceFingerprint, importedCounts, orphans }, null, 2));
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  await source.rollback().catch(() => undefined);
  await source.end();
  await target?.end();
  process.exitCode = exitCode;
}
