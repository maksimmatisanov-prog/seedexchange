import { createHash, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { Pool, type PoolClient } from 'pg';
import { config } from '../src/config.js';

type Mode = 'inventory' | 'dry-run' | 'import';
type Scalar = null | string | number | bigint | boolean | Date | Buffer;
type SourceRow = Record<string, Scalar | Record<string, unknown> | unknown[]>;
type TablePlan = { source: string; target: string; where?: string };

const tablePlan: TablePlan[] = [
  { source: 'users', target: 'users' },
  { source: 'organizations', target: 'organizations' },
  { source: 'organization_members', target: 'organization_members' },
  { source: 'founder_program_state', target: 'founder_program_state' },
  { source: 'founder_program_members', target: 'founder_program_members' },
  { source: 'media_assets', target: 'media_assets' },
  { source: 'shipping_zones', target: 'shipping_zones' },
  { source: 'seller_shipping_zones', target: 'seller_shipping_zones' },
  { source: 'supplier_catalog_imports', target: 'supplier_catalog_imports' },
  { source: 'supplier_publication_batches', target: 'supplier_publication_batches' },
  { source: 'products', target: 'products' },
  { source: 'supplier_catalog_items', target: 'supplier_catalog_items' },
  { source: 'supplier_publication_batch_items', target: 'supplier_publication_batch_items' },
  { source: 'exchange_listings', target: 'exchange_listings' },
  { source: 'orders', target: 'orders' },
  { source: 'seller_orders', target: 'seller_orders' },
  { source: 'order_items', target: 'order_items' },
  { source: 'inventory_reservations', target: 'inventory_reservations' },
  { source: 'stripe_events', target: 'stripe_events' },
  { source: 'seller_transfers', target: 'seller_transfers' },
  { source: 'delivery_cases', target: 'delivery_cases' },
  { source: 'favorites', target: 'favorites' },
  { source: 'collection_items', target: 'collection_items' },
  { source: 'growth_journal_entries', target: 'growth_journal_entries' },
  { source: 'reviews', target: 'reviews' },
  { source: 'review_responses', target: 'review_responses' },
  { source: 'organization_channels', target: 'organization_channels' },
  { source: 'conversations', target: 'conversations' },
  { source: 'conversation_messages', target: 'conversation_messages' },
  { source: 'reports', target: 'reports' },
  { source: 'notifications', target: 'notifications' },
  { source: 'point_ledger', target: 'point_ledger' },
  { source: 'achievement_unlocks', target: 'achievement_unlocks' },
  { source: 'audit_events', target: 'audit_events' },
  // Pending messages may contain active verification or reset links, so they are deliberately excluded.
  { source: 'outbox_messages', target: 'outbox_messages', where: "status IN ('sent','failed')" },
];

const args = new Set(process.argv.slice(2));
const modes: Mode[] = ['inventory', 'dry-run', 'import'];
const mode = modes.find((candidate) => args.has(`--${candidate}`));
if (!mode || modes.filter((candidate) => args.has(`--${candidate}`)).length !== 1) {
  throw new Error('Choose exactly one mode: --inventory, --dry-run, or --import.');
}
if (!config.LEGACY_MYSQL_URL) throw new Error('LEGACY_MYSQL_URL is required.');

const source = await mysql.createConnection({ uri: config.LEGACY_MYSQL_URL, decimalNumbers: false, supportBigNumbers: true, bigNumberStrings: true });
const target = mode === 'inventory' ? null : new Pool({ connectionString: config.DATABASE_URL, max: 2 });

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe identifier: ${value}`);
  return `"${value}"`;
}

async function existingSourceTables(): Promise<Set<string>> {
  const [rows] = await source.query<mysql.RowDataPacket[]>(`SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE'`);
  return new Set(rows.map((row) => String(row.TABLE_NAME ?? row.table_name)));
}

async function countSource(table: TablePlan): Promise<number> {
  const where = table.where ? ` WHERE ${table.where}` : '';
  const [rows] = await source.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table.source)}${where}`);
  return Number(rows[0]?.total ?? 0);
}

async function sourceColumns(table: string): Promise<string[]> {
  const [rows] = await source.query<mysql.RowDataPacket[]>(`SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position`, [table]);
  return rows.map((row) => String(row.COLUMN_NAME ?? row.column_name));
}

async function targetColumns(client: PoolClient, table: string): Promise<Map<string, string>> {
  const result = await client.query<{ column_name: string; data_type: string }>(`SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
  return new Map(result.rows.map((row) => [row.column_name, row.data_type]));
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

async function inventory(plans: TablePlan[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of plans) result[table.source] = await countSource(table);
  return result;
}

async function ensureEmptyTarget(client: PoolClient, plans: TablePlan[]): Promise<void> {
  for (const table of plans) {
    const result = await client.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM ${quoteIdentifier(table.target)}`);
    const allowedSeedRow = table.target === 'founder_program_state' && Number(result.rows[0]?.total) <= 1;
    if (Number(result.rows[0]?.total) > 0 && !allowedSeedRow) throw new Error(`Target table ${table.target} is not empty.`);
  }
}

async function importTable(client: PoolClient, plan: TablePlan): Promise<number> {
  const sourceNames = await sourceColumns(plan.source);
  const targetNames = await targetColumns(client, plan.target);
  const columns = sourceNames.filter((name) => targetNames.has(name));
  if (!columns.length) throw new Error(`No compatible columns for ${plan.source}.`);
  const where = plan.where ? ` WHERE ${plan.where}` : '';
  const [rows] = await source.query<mysql.RowDataPacket[]>(`SELECT ${columns.map(quoteIdentifier).join(',')} FROM ${quoteIdentifier(plan.source)}${where} ORDER BY 1`);
  let imported = 0;
  for (const row of rows as SourceRow[]) {
    const values = columns.map((column) => convert(row[column], targetNames.get(column)!));
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
    const conflict = plan.target === 'founder_program_state' ? ' ON CONFLICT (id) DO UPDATE SET current_slot=EXCLUDED.current_slot,updated_at=EXCLUDED.updated_at' : '';
    await client.query(`INSERT INTO ${quoteIdentifier(plan.target)} (${columns.map(quoteIdentifier).join(',')}) VALUES (${placeholders})${conflict}`, values);
    imported++;
  }
  if (targetNames.has('id')) {
    await client.query(`SELECT setval(pg_get_serial_sequence($1,'id'),COALESCE((SELECT MAX(id) FROM ${quoteIdentifier(plan.target)}),1),true)`, [plan.target]);
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
  const available = await existingSourceTables();
  const plans = tablePlan.filter((item) => available.has(item.source));
  const sourceInventory = await inventory(plans);
  const sourceFingerprint = createHash('sha256').update(JSON.stringify(sourceInventory)).digest('hex');
  if (mode === 'inventory') {
    console.log(JSON.stringify({ mode, sourceFingerprint, tables: sourceInventory }, null, 2));
  } else {
    const client = await target!.connect();
    const runId = randomUUID();
    try {
      await ensureEmptyTarget(client, plans);
      if (mode === 'dry-run') {
        const compatibility: Record<string, string[]> = {};
        for (const plan of plans) {
          const sourceNames = await sourceColumns(plan.source);
          const targetNames = await targetColumns(client, plan.target);
          compatibility[plan.source] = sourceNames.filter((name) => targetNames.has(name));
          if (!compatibility[plan.source].length) throw new Error(`No compatible columns for ${plan.source}.`);
        }
        console.log(JSON.stringify({ mode, runId, sourceFingerprint, tables: sourceInventory, compatibility }, null, 2));
      } else {
        await client.query('BEGIN');
        await client.query(`INSERT INTO legacy_migration_runs(id,source_fingerprint,mode,status,source_inventory) VALUES($1,$2,'import','running',$3::jsonb)`, [runId, sourceFingerprint, JSON.stringify(sourceInventory)]);
        const importedCounts: Record<string, number> = {};
        for (const plan of plans) importedCounts[plan.target] = await importTable(client, plan);
        const orphans = await verifyOrphans(client);
        const mismatches = Object.entries(sourceInventory).filter(([table, count]) => importedCounts[table] !== count);
        if (mismatches.length || Object.values(orphans).some((count) => count !== 0)) throw new Error(`Parity verification failed: ${JSON.stringify({ mismatches, orphans })}`);
        await client.query(`UPDATE legacy_migration_runs SET status='succeeded',imported_counts=$2::jsonb,verification_report=$3::jsonb,completed_at=now() WHERE id=$1`, [runId, JSON.stringify(importedCounts), JSON.stringify({ orphans })]);
        await client.query('COMMIT');
        console.log(JSON.stringify({ mode, runId, sourceFingerprint, importedCounts, orphans }, null, 2));
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
  await source.end();
  await target?.end();
  process.exitCode = exitCode;
}
