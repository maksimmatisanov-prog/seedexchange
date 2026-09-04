import { createHash } from 'node:crypto';
import { lstat, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { validateProductionObservation, type ProductionObservationState } from '../src/domain/production-observation.js';

const args = process.argv.slice(2);
function argument(name: string, required = true): string | null {
  const matches = args.filter((value) => value.startsWith(`--${name}=`));
  if (matches.length > 1 || (required && matches.length !== 1) || matches[0] === `--${name}=`) throw new Error(`Provide ${required ? 'exactly one' : 'at most one'} --${name}=<value>.`);
  return matches[0]?.slice(name.length + 3) ?? null;
}
if (args.some((value) => !['migration', 'organization', 'product', 'output'].some((name) => value.startsWith(`--${name}=`)))) throw new Error('Unexpected observation argument.');
const expectedMigration = argument('migration')!;
const organizationPath = argument('organization')!;
const productPath = argument('product')!;
const outputArgument = argument('output', false);
if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(expectedMigration) || !/^\/directory\/[a-z0-9-]+$/.test(organizationPath) || !/^\/product\/[a-z0-9-]+$/.test(productPath)) throw new Error('Migration or representative discovery paths are invalid.');
if (outputArgument && !path.isAbsolute(outputArgument)) throw new Error('Observation output must be an absolute new JSON file path.');

try {
  const [migration, database, outbox] = await Promise.all([
    pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'),
    pool.query<Record<string, string>>(`SELECT
      current_database() database_name,
      pg_database_size(current_database())::text database_size_bytes,
      current_setting('max_connections') max_connections,
      (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database())::text connections,
      (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND pid<>pg_backend_pid() AND query_start<now()-interval '30 seconds')::text long_running_queries,
      (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND state_change<now()-interval '60 seconds')::text idle_in_transaction`),
    pool.query<Record<string, string>>(`SELECT
      count(*) FILTER (WHERE status='failed')::text failed_outbox,
      count(*) FILTER (WHERE status='pending' AND created_at<now()-interval '5 minutes')::text stale_pending_outbox,
      count(*) FILTER (WHERE status='processing' AND locked_at<now()-interval '15 minutes')::text stale_processing_outbox
      FROM outbox_messages`),
  ]);
  const sitemapPath = path.resolve(config.SITEMAP_PATH);
  let sitemapRegularFile = false;
  let sitemapByteSize = 0;
  let sitemapAgeMinutes: number | null = null;
  let sitemap = '';
  try {
    const metadata = await lstat(sitemapPath);
    sitemapRegularFile = metadata.isFile() && !metadata.isSymbolicLink();
    if (sitemapRegularFile && metadata.size <= 10_000_000) {
      const handle = await open(sitemapPath, 'r');
      try {
        const before = await handle.stat();
        sitemap = await handle.readFile('utf8');
        const after = await handle.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Sitemap changed during observation.');
        sitemapByteSize = after.size;
        sitemapAgeMinutes = Math.max(0, (Date.now() - after.mtimeMs) / 60_000);
      } finally { await handle.close(); }
    }
  } catch { /* state below remains fail-closed without exposing filesystem details */ }
  const databaseRow = database.rows[0];
  const outboxRow = outbox.rows[0];
  const state: ProductionObservationState = {
    currentMigration: migration.rows[0]?.version ?? null,
    expectedMigration,
    databaseName: databaseRow.database_name,
    databaseSizeBytes: Number(databaseRow.database_size_bytes),
    connections: Number(databaseRow.connections),
    maxConnections: Number(databaseRow.max_connections),
    longRunningQueries: Number(databaseRow.long_running_queries),
    idleInTransaction: Number(databaseRow.idle_in_transaction),
    failedOutbox: Number(outboxRow.failed_outbox),
    stalePendingOutbox: Number(outboxRow.stale_pending_outbox),
    staleProcessingOutbox: Number(outboxRow.stale_processing_outbox),
    sitemapRegularFile,
    sitemapByteSize,
    sitemapAgeMinutes,
    sitemapHasOrganization: sitemap.includes(`<loc>${config.APP_URL}${organizationPath}</loc>`),
    sitemapHasProduct: sitemap.includes(`<loc>${config.APP_URL}${productPath}</loc>`),
  };
  const errors = validateProductionObservation(state);
  const report = { ready: errors.length === 0, capturedAt: new Date().toISOString(), ...state, errors };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputArgument) await writeFile(path.resolve(outputArgument), serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...report, output: outputArgument ? path.resolve(outputArgument) : null, reportSha256: createHash('sha256').update(serialized).digest('hex') }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await pool.end();
}
