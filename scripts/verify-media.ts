import { readFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { compareMediaManifests, mediaManifestSchema, verifyMediaInventory, type MediaAssetRecord } from '../src/domain/media-verification.js';

const expectedArgument = process.argv.find((argument) => argument.startsWith('--expected='));
if (process.argv.slice(2).some((argument) => !argument.startsWith('--expected='))) throw new Error('Usage: verify-media [--expected=/path/to/source-manifest.json]');

try {
  const result = await pool.query<MediaAssetRecord>('SELECT storage_key,mime_type,byte_size,width_px,height_px,sha256,is_active FROM media_assets ORDER BY storage_key');
  const report = await verifyMediaInventory(result.rows, config.MEDIA_ROOT);
  let sourceManifestErrors: string[] = [];
  if (expectedArgument) {
    const expected = mediaManifestSchema.parse(JSON.parse(await readFile(expectedArgument.slice('--expected='.length), 'utf8')));
    sourceManifestErrors = compareMediaManifests(expected.entries, report.manifest);
  }
  const errors = [...report.errors, ...sourceManifestErrors];
  console.log(JSON.stringify({ ...report, ready: errors.length === 0, sourceManifestCompared: Boolean(expectedArgument), errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await pool.end();
}
