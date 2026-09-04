import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { verifyMediaInventory, type MediaAssetRecord } from '../src/domain/media-verification.js';

try {
  const result = await pool.query<MediaAssetRecord>('SELECT storage_key,mime_type,byte_size,width_px,height_px,sha256,is_active FROM media_assets ORDER BY storage_key');
  const report = await verifyMediaInventory(result.rows, config.MEDIA_ROOT);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready) process.exitCode = 1;
} finally {
  await pool.end();
}
