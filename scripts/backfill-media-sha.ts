import { readFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { compareMediaManifests, mediaManifestSchema, verifyMediaInventory, type MediaAssetRecord } from '../src/domain/media-verification.js';

const argumentsSet = new Set(process.argv.slice(2));
if ([...argumentsSet].some((argument) => argument !== '--commit' && !argument.startsWith('--expected='))) throw new Error('Usage: backfill-media-sha [--expected=/path/to/source-manifest.json] [--commit]');
const commit = argumentsSet.has('--commit');
const expectedArgument = [...argumentsSet].find((argument) => argument.startsWith('--expected='));

type Row = MediaAssetRecord & { id: string };

try {
  const result = await pool.query<Row>('SELECT id,storage_key,mime_type,byte_size,width_px,height_px,sha256,is_active FROM media_assets ORDER BY storage_key');
  const report = await verifyMediaInventory(result.rows, config.MEDIA_ROOT);
  const blockingErrors = report.issues.filter((issue) => issue.code !== 'database_sha_missing').map((issue) => issue.message);
  const missingKeys = new Set(report.issues.filter((issue) => issue.code === 'database_sha_missing').map((issue) => issue.storageKey));
  const candidates = report.manifest.filter((entry) => missingKeys.has(entry.storageKey));
  let expectedEntries: ReturnType<typeof mediaManifestSchema.parse>['entries'] | null = null;
  if (expectedArgument) {
    expectedEntries = mediaManifestSchema.parse(JSON.parse(await readFile(expectedArgument.slice('--expected='.length), 'utf8'))).entries;
    blockingErrors.push(...compareMediaManifests(expectedEntries, report.manifest));
  } else if (candidates.length) {
    blockingErrors.push('A clean source media manifest is required before legacy SHA-256 backfill.');
  }
  if (blockingErrors.length) {
    console.log(JSON.stringify({ readyForCommit: false, mode: commit ? 'commit' : 'dry-run', sourceManifestCompared: Boolean(expectedEntries), candidates: [], errors: blockingErrors }, null, 2));
    process.exitCode = 1;
  } else if (!commit) {
    console.log(JSON.stringify({ readyForCommit: true, complete: candidates.length === 0, mode: 'dry-run', sourceManifestCompared: Boolean(expectedEntries), candidates, writes: 0, errors: [] }, null, 2));
  } else {
    const ids = new Map(result.rows.map((row) => [row.storage_key, row.id]));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const candidate of candidates) {
        const id = ids.get(candidate.storageKey);
        const updated = await client.query<{id:string}>(`UPDATE media_assets SET sha256=$1 WHERE id=$2 AND sha256 IS NULL RETURNING id`, [candidate.sha256, id]);
        if (!updated.rows[0]) throw new Error(`Media SHA-256 backfill conflict: ${candidate.storageKey}.`);
        await client.query(`INSERT INTO audit_events(actor_user_id,entity_type,entity_id,event_name,payload)
          VALUES(NULL,'media_asset',$1,'media.sha256_backfilled',$2::jsonb)`, [updated.rows[0].id, JSON.stringify({ storageKey: candidate.storageKey, sha256: candidate.sha256 })]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const verifiedRows = await pool.query<MediaAssetRecord>('SELECT storage_key,mime_type,byte_size,width_px,height_px,sha256,is_active FROM media_assets ORDER BY storage_key');
    const verified = await verifyMediaInventory(verifiedRows.rows, config.MEDIA_ROOT);
    const errors = [...verified.errors, ...(expectedEntries ? compareMediaManifests(expectedEntries, verified.manifest) : [])];
    console.log(JSON.stringify({ ready: errors.length === 0, mode: 'commit', sourceManifestCompared: Boolean(expectedEntries), candidates, writes: candidates.length, errors }, null, 2));
    if (errors.length) process.exitCode = 1;
  }
} finally {
  await pool.end();
}
